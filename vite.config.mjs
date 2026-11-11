import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The renderer is a React app in ui/, built to src/renderer-dist/ and loaded by src/main.js.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'ui/src') } },
  build: { outDir: '../src/renderer-dist', emptyOutDir: true, target: 'chrome140', sourcemap: false },
});
