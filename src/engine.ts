import {
  DEFAULT_LIVENESS_THRESHOLD,
  type EngineOptions,
  type LivenessFace,
  type WorkerRequest,
  type WorkerResponse,
} from './types.js';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type OkResponse = Extract<WorkerResponse, { ok: true }>;

/** Anything that can be drawn on a canvas, or raw RGBA pixels. */
export type ImageInput =
  | ImageData
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | OffscreenCanvas
  | Blob;

const MODEL_FILES = [
  'detection/detection.param',
  'detection/detection.bin',
  'live/config.json',
  'live/model_1.param',
  'live/model_1.bin',
  'live/model_2.param',
  'live/model_2.bin',
] as const;

// Literal `new URL(…, import.meta.url)` calls let bundlers (Vite, webpack 5, …) emit the models.
function bundledModelUrls(): Record<string, string> {
  return {
    'detection/detection.param': new URL('./models/detection/detection.param', import.meta.url).href,
    'detection/detection.bin': new URL('./models/detection/detection.bin', import.meta.url).href,
    'live/config.json': new URL('./models/live/config.json', import.meta.url).href,
    'live/model_1.param': new URL('./models/live/model_1.param', import.meta.url).href,
    'live/model_1.bin': new URL('./models/live/model_1.bin', import.meta.url).href,
    'live/model_2.param': new URL('./models/live/model_2.param', import.meta.url).href,
    'live/model_2.bin': new URL('./models/live/model_2.bin', import.meta.url).href,
  };
}

/**
 * Face detection + liveness engine. Runs WebAssembly in a Web Worker, so calls
 * never block the page. Create it once and reuse it.
 */
export class FaceLiveness {
  /** Faces with `livenessScore >= livenessThreshold` are reported as live. */
  livenessThreshold = DEFAULT_LIVENESS_THRESHOLD;

  /** True when the WebAssembly SIMD build is used (faster). */
  readonly simd: boolean;

  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (r: WorkerResponse) => void }>();
  private nextId = 0;
  private disposed = false;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  private constructor(worker: Worker, simd: boolean) {
    this.worker = worker;
    this.simd = simd;
  }

  /** Downloads the models (about 5.5 MB) and starts the engine. */
  static async create(options: EngineOptions = {}): Promise<FaceLiveness> {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const modelUrls = options.modelBaseUrl
      ? Object.fromEntries(
          MODEL_FILES.map((name) => [name, `${options.modelBaseUrl!.replace(/\/$/, '')}/${name}`])
        )
      : bundledModelUrls();

    const engine = new FaceLiveness(worker, false);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const handler = engine.pending.get(event.data.id);
      if (!handler) return;
      engine.pending.delete(event.data.id);
      handler.resolve(event.data);
    };
    worker.onerror = (event) => {
      const message = event.message || 'The face liveness worker failed to start.';
      for (const handler of engine.pending.values()) {
        handler.resolve({ id: -1, ok: false, error: message });
      }
      engine.pending.clear();
    };

    const response = await engine.request({
      type: 'init',
      modelUrls,
      minFaceSize: options.minFaceSize ?? 64,
      faceDetectionThreshold: options.faceDetectionThreshold ?? 0.6,
    });
    (engine as { simd: boolean }).simd = response.simd ?? false;
    return engine;
  }

  /**
   * Detects faces in an image, video frame, canvas or Blob. Returns the largest face
   * first; only the largest face is evaluated unless `allFaces`.
   */
  async detect(input: ImageInput, options: { allFaces?: boolean } = {}): Promise<LivenessFace[]> {
    const image = await this.toImageData(input);
    return this.detectPixels(image.data, image.width, image.height, options);
  }

  /** Detects faces in tightly packed RGBA pixels. The buffer is transferred to the worker. */
  async detectPixels(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    options: { allFaces?: boolean } = {}
  ): Promise<LivenessFace[]> {
    const pixels =
      rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength
        ? (rgba.buffer as ArrayBuffer)
        : (rgba.slice().buffer as ArrayBuffer);
    const response = await this.request(
      { type: 'detect', pixels, width, height, allFaces: options.allFaces ?? false },
      [pixels]
    );
    const values = response.faces ?? new Float32Array();
    const faces: LivenessFace[] = [];
    for (let i = 0; i + 5 < values.length; i += 6) {
      const x1 = values[i]!, y1 = values[i + 1]!, x2 = values[i + 2]!, y2 = values[i + 3]!;
      const livenessScore = values[i + 5]!;
      faces.push({
        bounds: { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 },
        detectionConfidence: values[i + 4]!,
        livenessScore,
        isLive: livenessScore >= this.livenessThreshold,
      });
    }
    return faces;
  }

  /** Stops the worker and frees memory. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.request({ type: 'dispose' }).catch(() => undefined);
    this.disposed = true;
    this.worker.terminate();
  }

  private request(message: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<OkResponse> {
    if (this.disposed) return Promise.reject(new Error('FaceLiveness has been disposed.'));
    const id = this.nextId++;
    return new Promise<OkResponse>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (response) => (response.ok ? resolve(response) : reject(new Error(response.error))),
      });
      this.worker.postMessage({ ...message, id } as WorkerRequest, transfer);
    });
  }

  private async toImageData(input: ImageInput): Promise<ImageData> {
    if (typeof ImageData !== 'undefined' && input instanceof ImageData) return input;
    let source: CanvasImageSource = input as CanvasImageSource;
    let width: number;
    let height: number;
    let bitmap: ImageBitmap | null = null;
    if (input instanceof Blob) {
      // Applies the EXIF orientation of photos.
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
      source = bitmap;
    }
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
      width = source.videoWidth;
      height = source.videoHeight;
    } else if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      width = source.naturalWidth;
      height = source.naturalHeight;
    } else {
      width = (source as { width: number }).width;
      height = (source as { height: number }).height;
    }
    if (!width || !height) throw new Error('The image has no pixels (not loaded yet?).');

    const ctx = this.context2d(width, height);
    ctx.drawImage(source, 0, 0, width, height);
    bitmap?.close();
    return ctx.getImageData(0, 0, width, height);
  }

  private context2d(width: number, height: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    if (!this.canvas) {
      this.canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Canvas 2D is not available.');
    return ctx;
  }
}
