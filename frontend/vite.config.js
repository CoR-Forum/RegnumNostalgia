import { defineConfig } from 'vite';

export default defineConfig({
  // Static assets directory (served at / during dev, copied to dist/ on build).
  // Points to ../public which contains the assets/ directory (tiles, markers, etc.).
  publicDir: '../public',

  // Vite dev server settings
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Watch for file changes inside Docker volumes
    watch: {
      usePolling: true,
      interval: 300,
    },
  },

  // Production build
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Don't copy public/ to dist/ — assets are served separately by nginx
    copyPublicDir: false,
  },
});
