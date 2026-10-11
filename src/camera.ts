import { FaceLiveness } from './engine.js';
import {
  DEFAULT_LIVENESS_THRESHOLD,
  LivenessError,
  type LivenessResult,
  type Rect,
} from './types.js';

export type LivenessCameraOptions = {
  /** Called for every processed frame. */
  onResult?: (result: LivenessResult) => void;
  /** Called once each time a face becomes verified. */
  onVerified?: (result: LivenessResult) => void;
  /** Called when the camera or the engine can't be started. */
  onError?: (error: LivenessError) => void;
  /** Default 0.915. Higher is stricter. */
  livenessThreshold?: number;
  /** Consecutive live frames before `onVerified`. Default 8. */
  requiredLiveFrames?: number;
  /** 'user' (front, default) or 'environment' (back). */
  facingMode?: 'user' | 'environment';
  /** Draw a green / red box around the face. Default true. */
  showFaceOverlay?: boolean;
  /** Reuse an engine; otherwise one is created (and disposed) by the camera. */
  engine?: FaceLiveness;
};

const LIVE_COLOR = '#34C759';
const SPOOF_COLOR = '#FF3B30';

/**
 * Framework-agnostic camera: renders the camera into `container` and checks every
 * frame for a real face.
 *
 * ```ts
 * const camera = new LivenessCamera(document.getElementById('camera')!, {
 *   onVerified: (r) => console.log('Real face', r.face?.livenessScore),
 * });
 * await camera.start();
 * ```
 */
export class LivenessCamera {
  readonly video: HTMLVideoElement;
  private readonly overlay: HTMLCanvasElement;
  private options: LivenessCameraOptions;
  private engine: FaceLiveness | null = null;
  private ownsEngine = false;
  private stream: MediaStream | null = null;
  private running = false;
  private busy = false;
  private frameHandle = 0;
  private consecutiveLive = 0;
  private verifiedNotified = false;
  private lastResult: LivenessResult | null = null;
  private readonly onVisibilityChange = () => {
    if (document.hidden) this.pauseStream();
    else if (this.running) void this.resumeStream();
  };

  constructor(
    private readonly container: HTMLElement,
    options: LivenessCameraOptions = {}
  ) {
    this.options = options;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      background: '#000',
    });

    this.overlay = document.createElement('canvas');
    Object.assign(this.overlay.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });

    container.append(this.video, this.overlay);
    this.applyMirroring();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Updates options; takes effect on the next frame (facingMode on the next `start`). */
  setOptions(options: Partial<LivenessCameraOptions>): void {
    const facingChanged =
      options.facingMode !== undefined && options.facingMode !== this.options.facingMode;
    this.options = { ...this.options, ...options };
    if (this.engine) this.engine.livenessThreshold = this.threshold;
    this.applyMirroring();
    if (facingChanged && this.running) {
      this.stop();
      void this.start();
    }
  }

  /** Asks for camera permission (if needed), loads the engine and starts checking frames. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.resetVerification();
    try {
      if (!this.engine) {
        if (this.options.engine) {
          this.engine = this.options.engine;
        } else {
          this.engine = await FaceLiveness.create();
          this.ownsEngine = true;
        }
      }
      this.engine.livenessThreshold = this.threshold;
      if (!this.running) return;
      await this.resumeStream();
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    } catch (e) {
      this.running = false;
      this.options.onError?.(toLivenessError(e));
    }
  }

  /** Stops the camera (the engine is kept for a later `start`). */
  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.pauseStream();
    this.lastResult = null;
    this.drawOverlay();
  }

  /** Stops the camera, frees the engine (if owned) and removes the elements. */
  async dispose(): Promise<void> {
    this.stop();
    this.video.remove();
    this.overlay.remove();
    if (this.ownsEngine) await this.engine?.dispose();
    this.engine = null;
  }

  private get threshold(): number {
    return this.options.livenessThreshold ?? DEFAULT_LIVENESS_THRESHOLD;
  }

  private get mirrored(): boolean {
    return (this.options.facingMode ?? 'user') === 'user';
  }

  private applyMirroring(): void {
    this.video.style.transform = this.mirrored ? 'scaleX(-1)' : '';
  }

  private resetVerification(): void {
    this.consecutiveLive = 0;
    this.verifiedNotified = false;
  }

  private async resumeStream(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new LivenessError('camera-unavailable', 'Camera access needs HTTPS and a browser with getUserMedia.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: this.options.facingMode ?? 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    if (!this.running) {
      this.pauseStream();
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    this.scheduleFrame();
  }

  private pauseStream(): void {
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.resetVerification();
  }

  private scheduleFrame(): void {
    this.frameHandle = requestAnimationFrame(() => {
      if (!this.stream) return;
      if (!this.busy && this.video.readyState >= 2 && this.video.videoWidth > 0) {
        void this.processFrame();
      }
      this.scheduleFrame();
    });
  }

  private async processFrame(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.busy = true;
    try {
      const begin = performance.now();
      const faces = await engine.detect(this.video);
      const processingTimeMs = performance.now() - begin;
      if (!this.running || !this.stream) return;

      const face = faces[0] ?? null;
      if (face?.isLive) {
        this.consecutiveLive++;
      } else {
        this.consecutiveLive = 0;
        this.verifiedNotified = false;
      }
      const required = Math.max(1, this.options.requiredLiveFrames ?? 8);
      const imageSize = { width: this.video.videoWidth, height: this.video.videoHeight };
      const result: LivenessResult = {
        face,
        faceFrameInView: face ? this.toViewRect(face.bounds, imageSize) : null,
        imageSize,
        processingTimeMs,
        consecutiveLiveFrames: this.consecutiveLive,
        isVerified: this.consecutiveLive >= required,
      };
      this.lastResult = result;
      this.drawOverlay();
      this.options.onResult?.(result);
      if (result.isVerified && !this.verifiedNotified) {
        this.verifiedNotified = true;
        this.options.onVerified?.(result);
      }
    } catch (e) {
      this.options.onError?.(toLivenessError(e));
    } finally {
      this.busy = false;
    }
  }

  /** Maps image pixels to container CSS pixels for object-fit: cover (+ mirroring). */
  private toViewRect(bounds: Rect, image: { width: number; height: number }): Rect {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const scale = Math.max(w / image.width, h / image.height);
    const dx = (w - image.width * scale) / 2;
    const dy = (h - image.height * scale) / 2;
    const x = this.mirrored ? image.width - bounds.x - bounds.width : bounds.x;
    return { x: x * scale + dx, y: bounds.y * scale + dy, width: bounds.width * scale, height: bounds.height * scale };
  }

  private drawOverlay(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (this.overlay.width !== Math.round(w * dpr)) this.overlay.width = Math.round(w * dpr);
    if (this.overlay.height !== Math.round(h * dpr)) this.overlay.height = Math.round(h * dpr);
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const result = this.lastResult;
    if (!result?.face || !result.faceFrameInView || this.options.showFaceOverlay === false) return;
    const r = result.faceFrameInView;
    ctx.strokeStyle = result.face.isLive ? LIVE_COLOR : SPOOF_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, r.width / 12);
    ctx.stroke();
  }
}

function toLivenessError(e: unknown): LivenessError {
  if (e instanceof LivenessError) return e;
  const name = (e as { name?: string })?.name;
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new LivenessError('permission-denied', 'Camera permission denied.');
  }
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
    return new LivenessError('camera-unavailable', message || 'No camera available.');
  }
  return new LivenessError('engine-error', message);
}
