import { build, context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, rmSync } from 'fs';

const isWatch = process.argv.includes('--watch');
const OUT = 'extension';
const ROOT = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: ['chrome120'],
};

async function run() {
  rmSync(resolve(ROOT, OUT), { recursive: true, force: true });
  mkdirSync(resolve(ROOT, OUT, 'popup'), { recursive: true });
  mkdirSync(resolve(ROOT, OUT, 'background'), { recursive: true });
  mkdirSync(resolve(ROOT, OUT, 'content'), { recursive: true });
  mkdirSync(resolve(ROOT, OUT, 'icons'), { recursive: true });

  // Copy static assets
  cpSync(resolve(ROOT, 'src/manifest.json'), resolve(ROOT, OUT, 'manifest.json'));
  cpSync(resolve(ROOT, 'src/popup/popup.html'), resolve(ROOT, OUT, 'popup/popup.html'));
  cpSync(resolve(ROOT, 'src/popup/popup.css'), resolve(ROOT, OUT, 'popup/popup.css'));
  cpSync(resolve(ROOT, 'src/icons'), resolve(ROOT, OUT, 'icons'), { recursive: true });

  // ESM entries (popup + service worker)
  const esmOptions = {
    ...shared,
    format: 'esm',
    entryPoints: [
      { in: resolve(ROOT, 'src/popup/popup.ts'), out: 'popup/popup' },
      { in: resolve(ROOT, 'src/background/service-worker.ts'), out: 'background/service-worker' },
    ],
    outdir: resolve(ROOT, OUT),
  };

  // Content script must be IIFE — executeScript needs it to return
  // the last expression value, which ESM module wrappers prevent.
  const contentOptions = {
    ...shared,
    format: 'iife',
    entryPoints: [resolve(ROOT, 'src/content/extractor.ts')],
    outfile: resolve(ROOT, OUT, 'content/extractor.js'),
  };

  const bridgeOptions = {
    ...shared,
    format: 'iife',
    entryPoints: [resolve(ROOT, 'src/content/mindos-bridge.ts')],
    outfile: resolve(ROOT, OUT, 'content/mindos-bridge.js'),
  };

  if (isWatch) {
    const [ctx1, ctx2, ctx3] = await Promise.all([
      context(esmOptions),
      context(contentOptions),
      context(bridgeOptions),
    ]);
    await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch()]);
    console.log('[watch] Watching for changes...');
  } else {
    await Promise.all([
      build(esmOptions),
      build(contentOptions),
      build(bridgeOptions),
    ]);
    console.log('[build] Done.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
