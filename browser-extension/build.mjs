import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: ['chrome120'],
};

async function run() {
  mkdirSync('dist/popup', { recursive: true });
  mkdirSync('dist/background', { recursive: true });
  mkdirSync('dist/content', { recursive: true });
  mkdirSync('dist/icons', { recursive: true });

  // Copy static assets
  cpSync('src/manifest.json', 'dist/manifest.json');
  cpSync('src/popup/popup.html', 'dist/popup/popup.html');
  cpSync('src/popup/popup.css', 'dist/popup/popup.css');
  cpSync('src/icons', 'dist/icons', { recursive: true });

  // ESM entries (popup + service worker)
  const esmOptions = {
    ...shared,
    format: 'esm',
    entryPoints: [
      { in: 'src/popup/popup.ts', out: 'popup/popup' },
      { in: 'src/background/service-worker.ts', out: 'background/service-worker' },
    ],
    outdir: 'dist',
  };

  // Content script must be IIFE — executeScript needs it to return
  // the last expression value, which ESM module wrappers prevent.
  const contentOptions = {
    ...shared,
    format: 'iife',
    entryPoints: ['src/content/extractor.ts'],
    outfile: 'dist/content/extractor.js',
  };

  if (isWatch) {
    const [ctx1, ctx2] = await Promise.all([
      context(esmOptions),
      context(contentOptions),
    ]);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('[watch] Watching for changes...');
  } else {
    await Promise.all([
      build(esmOptions),
      build(contentOptions),
    ]);
    console.log('[build] Done.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
