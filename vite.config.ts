import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Two pages: ATLAS Live at / and the Earth observatory (Mizpah) at /earth/.
// Cesium, which the Earth page uses, fetches its workers, shaders and default
// assets at runtime from CESIUM_BASE_URL, so those are copied verbatim.
const cesium = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  plugins: [
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({ src: `${cesium}/${dir}`, dest: 'cesium' })),
    }),
  ],
  // satellite.js ships an optional WebAssembly worker that uses top-level await.
  // ATLAS itself has no bundled workers, so this only affects the Earth page.
  // Its main-thread loader also uses top-level await, which every browser that
  // can run ATLAS supports; allowing it keeps the default build target unchanged.
  worker: { format: 'es' },
  esbuild: { supported: { 'top-level-await': true } },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        earth: resolve(import.meta.dirname, 'earth/index.html'),
      },
    },
  },
});
