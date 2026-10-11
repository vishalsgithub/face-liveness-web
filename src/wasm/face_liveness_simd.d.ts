// Types for the Emscripten module built from wasm/ (copied next to this file at build time).

export interface WasmModule {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  stringToNewUTF8(value: string): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _fl_create(): number;
  _fl_destroy(engine: number): void;
  _fl_load(engine: number, modelDir: number): number;
  _fl_set_options(engine: number, minFaceSize: number, detectionThreshold: number, numThreads: number): void;
  _fl_detect(
    engine: number,
    data: number,
    width: number,
    height: number,
    bytesPerRow: number,
    format: number,
    orientation: number,
    allFaces: number,
    out: number,
    maxFaces: number
  ): number;
}

declare function createFaceLivenessModule(options?: Record<string, unknown>): Promise<WasmModule>;
export default createFaceLivenessModule;
