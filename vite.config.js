import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
});
