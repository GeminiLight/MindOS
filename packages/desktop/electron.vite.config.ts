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
          // Externalized deps are require()d from the CJS bundle. ESM-only ones
          // (electron-store 10) come back as a namespace with __esModule, so
          // let Rollup pick `.default` at runtime instead of assuming CJS.
          interop: 'auto',
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
          // Externalized deps are require()d from the CJS bundle. ESM-only ones
          // (electron-store 10) come back as a namespace with __esModule, so
          // let Rollup pick `.default` at runtime instead of assuming CJS.
          interop: 'auto',
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
