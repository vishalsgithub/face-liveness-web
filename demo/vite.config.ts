import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Served from https://vishalsgithub.github.io/face-liveness-web/
  base: './',
  plugins: [react()],
  // The package loads its Web Worker, WebAssembly and models with
  // `new URL(..., import.meta.url)`, which Vite's dependency pre-bundling would break.
  optimizeDeps: { exclude: ['@solankivishal/face-liveness-web'] },
  worker: { format: 'es' },
  // The demo links the package from `..`, which has its own dev copy of React.
  resolve: { dedupe: ['react', 'react-dom'] },
});
