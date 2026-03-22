import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main.ts'),
        },
        output: {
          entryFileNames: 'main.js',
          format: 'cjs',
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
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload.ts'),
          'connect-preload': resolve(__dirname, 'src/connect-preload.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    build: {
      outDir: 'dist-electron/renderer',
      rollupOptions: {
        input: {
          'connect-renderer': resolve(__dirname, 'src/connect-renderer.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          format: 'iife',
        },
      },
    },
  },
});
