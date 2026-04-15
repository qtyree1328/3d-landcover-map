import { defineConfig } from 'vite';

// Set VITE_BASE (or the `--base` CLI flag) when building for GitHub Pages:
//   VITE_BASE=/3d-landcover-map/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE || './',
  server: {
    open: true,
  },
  assetsInclude: ['**/*.hdr'],
});
