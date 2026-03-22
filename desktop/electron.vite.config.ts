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
  renderer: {
    // No renderer build — we load the Next.js server via loadURL
    // connect.html is loaded directly as a local file
    build: {
      outDir: 'dist-renderer',
    },
  },
});
