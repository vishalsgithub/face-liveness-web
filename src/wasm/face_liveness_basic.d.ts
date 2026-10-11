// Types for the non-SIMD Emscripten module (same API as face_liveness_simd).

import type { WasmModule } from './face_liveness_simd.js';

declare function createFaceLivenessModule(options?: Record<string, unknown>): Promise<WasmModule>;
export default createFaceLivenessModule;
