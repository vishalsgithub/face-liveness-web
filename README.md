# @solankivishal/face-liveness-web

[![npm](https://img.shields.io/npm/v/@solankivishal/face-liveness-web.svg)](https://www.npmjs.com/package/@solankivishal/face-liveness-web)

On-device **face liveness (anti-spoofing) detection in the browser**. It checks whether the face in front of the webcam is real or a presentation attack (printed photo, screen replay, mask). The user doesn't have to blink or turn their head, and **frames never leave the device**: everything runs in WebAssembly.

**[Live demo →](https://vishalsgithub.github.io/face-liveness-web/)**

- `<FaceLivenessCamera />`: a React component with a live verdict
- `LivenessCamera`: the same camera for plain JavaScript, Vue, Svelte and others
- `FaceLiveness.detect()`: checks photos, `<img>`, `<canvas>`, video frames or `Blob`s
- Runs in a Web Worker so the page stays smooth; about 15–20 ms per frame on a laptop
- Uses WebAssembly SIMD where available, with an automatic fallback for older browsers
- Models are included (about 5.5 MB, downloaded on first use)

## Installation

```sh
npm install @solankivishal/face-liveness-web
```

**Vite users:** exclude the package from dependency pre-bundling, so its worker, WebAssembly and model files load correctly:

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: { exclude: ['@solankivishal/face-liveness-web'] },
});
```

Webpack 5 and Next.js need no configuration. In Next.js, render the camera in a client component (`'use client'`).

The camera needs **HTTPS**; `localhost` also works.

## Usage

### React

```tsx
import { FaceLivenessCamera } from '@solankivishal/face-liveness-web/react';

<FaceLivenessCamera
  style={{ width: '100%', height: 480 }}
  onVerified={(result) => {
    // A real face was seen for 8 consecutive frames.
    console.log('Real face', result.face?.livenessScore);
  }}
  onResult={(result) => {
    // Every processed frame: result.face is null when no face is visible.
  }}
  onError={(error) => console.warn(error.code, error.message)}
/>
```

| Prop | Default | Meaning |
| --- | --- | --- |
| `livenessThreshold` | `0.915` | Minimum score for a face to count as live |
| `requiredLiveFrames` | `8` | Consecutive live frames before `onVerified` is called |
| `facingMode` | `'user'` | `'user'` (front) or `'environment'` (back) |
| `showFaceOverlay` | `true` | Draw a green or red box around the face |
| `active` | `true` | Set to `false` to stop the camera without unmounting |
| `engine` | none | Share a `FaceLiveness` engine between components |

Each `LivenessResult` contains:
- `face`: `{ bounds, livenessScore, detectionConfidence, isLive }`, or `null` when no face is visible.
- `faceFrameInView`, `isVerified`, `consecutiveLiveFrames`, `imageSize` and `processingTimeMs`.

`onError` codes are `permission-denied`, `camera-unavailable` and `engine-error`.

The camera pauses while the tab is hidden.

### Plain JavaScript (or any framework)

```ts
import { LivenessCamera } from '@solankivishal/face-liveness-web';

const camera = new LivenessCamera(document.getElementById('camera')!, {
  onVerified: (result) => console.log('Real face', result.face?.livenessScore),
});
await camera.start();   // asks for camera permission
// camera.stop(); await camera.dispose();
```

### Photos

```ts
import { FaceLiveness } from '@solankivishal/face-liveness-web';

const liveness = await FaceLiveness.create();
const faces = await liveness.detect(file); // File/Blob, <img>, <canvas>, <video>, ImageData, ImageBitmap
if (faces.length > 0) {
  console.log(faces[0].isLive, faces[0].livenessScore, faces[0].bounds);
}
await liveness.dispose();
```

`Blob`s and `File`s have their EXIF orientation applied. Pass `{ allFaces: true }` to evaluate every face instead of only the largest.

**Hosting the models yourself** (for example on a CDN): copy `node_modules/@solankivishal/face-liveness-web/dist/models` and pass `FaceLiveness.create({ modelBaseUrl: 'https://cdn.example.com/models' })`.

A single frame is noisy. For a verification flow, rely on `onVerified`, which requires several consecutive live frames.

## Browser support

Chrome, Edge, Firefox and Safari (desktop and mobile) on current versions. The SIMD build is used where WebAssembly SIMD is available (Chrome 91+, Firefox 89+, Safari 16.4+); other browsers use the slower fallback build automatically.

## How it works

1. **Face detection**: an SSD-style detector finds faces in a 192 px version of the frame.
2. **Liveness**: two MiniFASNet models look at the face at 2.7× and 4.0× context (resized to 80×80). Each outputs a "real face" probability, and the two are averaged.

The same C++ engine that powers the mobile packages is compiled to WebAssembly with [ncnn](https://github.com/Tencent/ncnn) and runs in a Web Worker.

## Related packages

- React Native: [@solankivishal/react-native-face-liveness](https://www.npmjs.com/package/@solankivishal/react-native-face-liveness)
- Flutter: [face_liveness](https://pub.dev/packages/face_liveness)
- Android: [vishalsgithub/face-liveness-android](https://github.com/vishalsgithub/face-liveness-android)
- iOS (Swift Package Manager): [vishalsgithub/face-liveness](https://github.com/vishalsgithub/face-liveness)

## Development

```sh
npm install
npm run build:wasm   # needs an activated emsdk (https://emscripten.org)
npm run build
cd demo && npm install && npm run dev
```

## License

Apache-2.0. See [LICENSE](LICENSE). ncnn is distributed under BSD-3-Clause.
