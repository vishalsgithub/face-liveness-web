# Changelog

## 1.0.1

- Works with Vite 7 and older out of the box: the Web Worker no longer uses dynamic `import()`, which classic (IIFE) worker bundles can't handle. Previously those projects needed `worker: { format: 'es' }`.

## 1.0.0

- First release: `FaceLiveness` engine (WebAssembly in a Web Worker, SIMD with fallback), `LivenessCamera` and the `FaceLivenessCamera` React component.
