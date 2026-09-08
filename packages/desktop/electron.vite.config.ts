import { builtinModules } from 'node:module';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];
const electronMainExternal = ['electron', ...nodeBuiltins];

export default defineConfig({
  main: {
    build: {
      // electron-vite 5 moved dependency externalization from a plugin to this option.
      externalizeDeps: { include: ['electron'] },
      outDir: 'dist-electron/main',
      rollupOptions: {
        external: electronMainExternal,
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
      externalizeDeps: { include: ['electron'] },
      outDir: 'dist-electron/preload',
      rollupOptions: {
        external: electronMainExternal,
        input: {
          index: resolve(__dirname, 'src/preload.ts'),
          'connect-preload': resolve(__dirname, 'src/connect-preload.ts'),
          'splash-preload': resolve(__dirname, 'src/splash-preload.ts'),
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
