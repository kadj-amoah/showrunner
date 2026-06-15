import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The Studio backend (`showrunner studio`) listens on :4321 by default.
// In dev we run Vite separately and proxy /api to it.
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4321',
    },
  },
});
