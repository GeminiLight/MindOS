import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const webAppRoot = path.join(repoRoot, 'packages/web/app');

function listFiles(dir: string, predicate: (file: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

describe('Web page runtime boundaries', () => {
  it('allows server redirect only in pure-redirect App pages (mixed pages regress hook order)', () => {
    const pageFiles = listFiles(webAppRoot, file => file.endsWith(`${path.sep}page.tsx`));

    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (!/\bredirect\(/.test(source)) continue;

      // 2026-05 incident: a page that conditionally called redirect() and
      // otherwise rendered a client component tree broke App Router hook
      // order when the condition flipped between navigations. A page that
      // ONLY redirects (no client directive, no JSX) has no hooks and no
      // rendered tree, so the failure mode cannot occur — and it is the
      // cheapest possible entry point (no throwaway hydrate + hard reload).
      const rel = path.relative(repoRoot, file);
      expect(source, `${rel} mixes redirect() with a client directive`).not.toMatch(/['"]use client['"]/);
      expect(source, `${rel} mixes redirect() with rendered JSX`).not.toMatch(/<[A-Za-z]/);
    }
  });

  it('keeps instrumentation Node-only helpers behind the nodejs runtime branch', () => {
    const file = path.join(repoRoot, 'packages/web/instrumentation.ts');
    const source = fs.readFileSync(file, 'utf8');

    expect(source).not.toMatch(/^import .*@\/lib\/project-root/m);
    expect(source).toContain("process.env.NEXT_RUNTIME === 'nodejs'");
    expect(source).toContain("await import('@/lib/project-root')");
  });
});
