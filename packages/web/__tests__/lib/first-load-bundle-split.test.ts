import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf-8');

/** Matches any static value import from the given module specifier. */
function staticValueImport(specifier: string): RegExp {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+['"]${escaped}['"]`);
}

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('first-load bundle split contracts', () => {
  it('locale store statically bundles only the default locale (en)', () => {
    const src = read('lib/stores/locale-store.ts');
    expect(src).toMatch(staticValueImport('@/lib/i18n/messages-en'));
    // index re-exports both locales — value-importing it would drag zh into
    // every route's first-load chunk.
    expect(src).not.toMatch(staticValueImport('@/lib/i18n'));
    expect(src).not.toMatch(staticValueImport('@/lib/i18n/messages-zh'));
    expect(src).toContain("import('@/lib/i18n/messages-zh')");
  });

  it('the zh bundle is selected per request on the server, not in shared client code', () => {
    const server = read('lib/stores/LocaleStoreInit.tsx');
    expect(server).not.toContain("'use client'");
    expect(server).toContain('LocaleStoreInitZhLoader');
    // The server component must not reference LocaleStoreInitZh directly —
    // not even via dynamic()/import(): the flight-client-entry plugin makes
    // every client component referenced from a server module (static OR
    // dynamic edge) an eager part of that entry's chunk group, which put
    // messages-zh into the layout's <script async> set for ALL requests.
    expect(server).not.toContain("'./LocaleStoreInitZh'");

    // The dynamic boundary must live in the CLIENT graph, where import()
    // produces a real async chunk that only zh requests preload.
    const loader = read('lib/stores/LocaleStoreInitZhLoader.tsx');
    expect(loader).toContain("'use client'");
    expect(loader).toContain("import('./LocaleStoreInitZh')");
    expect(loader).not.toMatch(staticValueImport('./LocaleStoreInitZh'));
    expect(loader).not.toMatch(staticValueImport('@/lib/i18n/messages-zh'));

    const shared = read('lib/stores/LocaleStoreInitClient.tsx');
    expect(shared).toContain("'use client'");
    expect(shared).not.toMatch(staticValueImport('@/lib/i18n/messages-zh'));
    expect(shared).not.toContain("import('@/lib/i18n/messages-zh')");

    const zhInit = read('lib/stores/LocaleStoreInitZh.tsx');
    expect(zhInit).toContain("'use client'");
    expect(zhInit).toMatch(staticValueImport('@/lib/i18n/messages-zh'));
  });

  it('no client module value-imports the @/lib/i18n aggregate (it statically contains zh)', () => {
    // SWC keeps ambiguous (non-`import type`) imports under isolatedModules,
    // so even a type-only usage drags messages-zh into that route's chunk.
    // Client code must use `import type { ... } from '@/lib/i18n'` or import
    // values from '@/lib/i18n/messages-en'.
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'hooks', 'lib']) {
      for (const file of listSourceFiles(path.join(webRoot, dir))) {
        const src = readFileSync(file, 'utf-8');
        if (!/^['"]use client['"]/m.test(src)) continue;
        if (staticValueImport('@/lib/i18n').test(src)) offenders.push(path.relative(webRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("messages-en's static import graph contains no zh export (zh strings stay out of en first load)", () => {
    const i18nRoot = path.join(webRoot, 'lib/i18n');
    const zhExport = /export const \w+Zh/;
    // Collect every relative import specifier from messages-en and resolve each
    // to a file under lib/i18n. webpack tree-shakes per-module, not per-export,
    // so any file importer that also exports a *Zh const ships zh in en's chunk.
    const visited = new Set<string>();
    const offenders: string[] = [];

    const resolveSpecifier = (fromFile: string, spec: string): string | null => {
      const base = path.resolve(path.dirname(fromFile), spec);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          readFileSync(candidate, 'utf-8');
          return candidate;
        } catch {
          /* try next */
        }
      }
      return null;
    };

    const walk = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      const src = readFileSync(file, 'utf-8');
      if (zhExport.test(src)) offenders.push(path.relative(i18nRoot, file));
      // Only follow relative specifiers — externals can't be under lib/i18n.
      const importRe = /import\s+(?:type\s+)?[^;]*from\s+['"](\.[^'"]+)['"]/g;
      for (const m of src.matchAll(importRe)) {
        const target = resolveSpecifier(file, m[1]);
        if (target && target.startsWith(i18nRoot)) walk(target);
      }
    };

    walk(path.join(i18nRoot, 'messages-en.ts'));
    expect(offenders).toEqual([]);
  });

  it('the /view markdown renderer defers rehype-highlight (highlight.js) out of first load', () => {
    const src = read('components/MarkdownView.tsx');
    expect(src).not.toMatch(staticValueImport('rehype-highlight'));
    expect(src).toContain("import('rehype-highlight')");
  });

  it('echo insight defers react-markdown out of the echo first screen', () => {
    const src = read('components/echo/EchoInsightCollapsible.tsx');
    expect(src).not.toMatch(staticValueImport('react-markdown'));
    expect(src).not.toMatch(staticValueImport('remark-gfm'));
    expect(src).toContain("import('./EchoInsightMarkdown')");
  });

  it('entry redirect pages use server redirects instead of client reload redirects', () => {
    // `/` is a real content page (home), not a redirect: its setup gate lives
    // in the proxy (fast 307) with a ClientRedirect fallback, because mixing
    // redirect() with rendered JSX regresses App Router hook order (see
    // tests/web-page-runtime-boundary-contract.test.ts). Only /echo remains a
    // pure redirect entry.
    const echo = read('app/echo/page.tsx');
    expect(echo, 'app/echo/page.tsx must redirect on the server').toContain("from 'next/navigation'");
    expect(echo, 'app/echo/page.tsx must not hard-reload via ClientRedirect').not.toContain('ClientRedirect');
    expect(echo).toContain('defaultEchoPath');

    const home = read('app/page.tsx');
    expect(home, 'home must render content, not bounce to echo').not.toContain('defaultEchoPath');
  });
});
