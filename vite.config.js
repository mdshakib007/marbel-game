import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js is one big dependency; the warning is noise for a game
    chunkSizeWarningLimit: 1500,
  },
});
