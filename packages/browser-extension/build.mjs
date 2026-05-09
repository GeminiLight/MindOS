import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');
const OUT = 'extension';

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: ['chrome120'],
};

async function run() {
  mkdirSync(`${OUT}/popup`, { recursive: true });
  mkdirSync(`${OUT}/background`, { recursive: true });
  mkdirSync(`${OUT}/content`, { recursive: true });
  mkdirSync(`${OUT}/icons`, { recursive: true });

  // Copy static assets
  cpSync('src/manifest.json', `${OUT}/manifest.json`);
  cpSync('src/popup/popup.html', `${OUT}/popup/popup.html`);
  cpSync('src/popup/popup.css', `${OUT}/popup/popup.css`);
  cpSync('src/icons', `${OUT}/icons`, { recursive: true });

  // ESM entries (popup + service worker)
  const esmOptions = {
    ...shared,
    format: 'esm',
    entryPoints: [
      { in: 'src/popup/popup.ts', out: 'popup/popup' },
      { in: 'src/background/service-worker.ts', out: 'background/service-worker' },
    ],
    outdir: OUT,
  };

  // Content script must be IIFE — executeScript needs it to return
  // the last expression value, which ESM module wrappers prevent.
  const contentOptions = {
    ...shared,
    format: 'iife',
    entryPoints: ['src/content/extractor.ts'],
    outfile: `${OUT}/content/extractor.js`,
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
