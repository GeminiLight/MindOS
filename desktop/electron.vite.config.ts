import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/main.ts'),
          'connect-window': resolve(__dirname, 'src/connect-window.ts'),
        },
      },
    },
    resolve: {
      alias: {
        shared: resolve(__dirname, '../shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'src/preload.ts'),
          'connect-preload': resolve(__dirname, 'src/connect-preload.ts'),
        },
      },
    },
  },
  // No renderer config — we don't have a renderer entry.
  // Main window loads Next.js via loadURL('http://localhost:3456').
  // Connect window loads a local HTML file directly.
});
