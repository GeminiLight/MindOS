import { build } from 'esbuild';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The browser host is bundled from its single Web source; never copy a source tree. */
export async function buildObsidianDesktopRuntime(outputDirectory = resolve(root, 'packages/desktop/dist-electron/obsidian')) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) throw new Error('An absolute artifact directory is required.');
  await Promise.all([
    build({ entryPoints: [resolve(root, 'packages/web/lib/obsidian-compat/browser-host/desktop-entry.ts')],
      bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', outfile: resolve(outputDirectory, 'runtime.js') }),
    build({ entryPoints: [resolve(root, 'packages/desktop/src/obsidian-editor-preload.ts')],
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], outfile: resolve(outputDirectory, 'preload.js') }),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildObsidianDesktopRuntime();
