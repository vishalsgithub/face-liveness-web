// Web Worker hosting the WebAssembly engine, so inference never blocks the page.

import createBasicModule from './wasm/face_liveness_basic.js';
import createSimdModule, { type WasmModule } from './wasm/face_liveness_simd.js';
import type { WorkerRequest, WorkerResponse } from './types.js';

const MAX_FACES = 16;
const FORMAT_RGBA = 2;

const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  close(): void;
};

let wasm: WasmModule | null = null;
let engine = 0;
let input = 0;
let inputSize = 0;
let output = 0;

// Smallest module using a SIMD instruction: validates only where wasm SIMD is supported.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
  15, 253, 98, 11,
]);

// Static imports (no import()): bundlers that emit classic (IIFE) workers, such as
// Vite 7 and older by default, can't code-split inside a worker. Only the chosen
// variant's .wasm file is downloaded.
async function loadModule(): Promise<{ module: WasmModule; simd: boolean }> {
  if (WebAssembly.validate(SIMD_PROBE)) {
    return { module: await createSimdModule(), simd: true };
  }
  return { module: await createBasicModule(), simd: false };
}

async function init(
  modelUrls: Record<string, string>,
  minFaceSize: number,
  detectionThreshold: number
): Promise<boolean> {
  const { module, simd } = await loadModule();
  wasm = module;

  // Write the models into the in-memory file system the engine reads from.
  await Promise.all(
    Object.entries(modelUrls).map(async ([name, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download model ${name} (${response.status}) from ${url}`);
      const data = new Uint8Array(await response.arrayBuffer());
      const dir = `/models/${name.split('/')[0]}`;
      try {
        module.FS.mkdirTree(dir);
      } catch {
        // already exists
      }
      module.FS.writeFile(`/models/${name}`, data);
    })
  );

  engine = module._fl_create();
  // Single-threaded build: ncnn fixes the thread count when the models load, so set it first.
  module._fl_set_options(engine, minFaceSize, detectionThreshold, 1);
  const path = module.stringToNewUTF8('/models');
  const ret = module._fl_load(engine, path);
  module._free(path);
  if (ret !== 0) throw new Error(`Failed to load the models (error ${ret}).`);
  output = module._malloc(MAX_FACES * 6 * 4);
  return simd;
}

function detect(pixels: ArrayBuffer, width: number, height: number, allFaces: boolean): Float32Array {
  const module = wasm;
  if (!module || !engine) throw new Error('Engine is not initialised.');
  const size = pixels.byteLength;
  if (size > inputSize) {
    if (input) module._free(input);
    input = module._malloc(size);
    inputSize = size;
  }
  module.HEAPU8.set(new Uint8Array(pixels), input);
  const count = module._fl_detect(engine, input, width, height, width * 4, FORMAT_RGBA, 1, allFaces ? 1 : 0, output, MAX_FACES);
  if (count < 0) throw new Error(`Detection failed (error ${count}).`);
  // HEAPF32 may be replaced when memory grows, so read it after the call.
  return module.HEAPF32.slice(output / 4, output / 4 + count * 6);
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'init': {
        const simd = await init(request.modelUrls, request.minFaceSize, request.faceDetectionThreshold);
        scope.postMessage({ id: request.id, ok: true, simd });
        break;
      }
      case 'detect': {
        const faces = detect(request.pixels, request.width, request.height, request.allFaces);
        scope.postMessage({ id: request.id, ok: true, faces }, [faces.buffer]);
        break;
      }
      case 'dispose': {
        if (wasm && engine) wasm._fl_destroy(engine);
        engine = 0;
        scope.postMessage({ id: request.id, ok: true });
        scope.close();
        break;
      }
    }
  } catch (e) {
    scope.postMessage({ id: request.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
