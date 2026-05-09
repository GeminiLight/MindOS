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
  it('avoids server redirect in App pages because it regresses App Router hook order', () => {
    const pageFiles = listFiles(webAppRoot, file => file.endsWith(`${path.sep}page.tsx`));

    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, path.relative(repoRoot, file)).not.toMatch(/from ['"]next\/navigation['"];?\s*[\s\S]*\bredirect\(/);
      expect(source, path.relative(repoRoot, file)).not.toMatch(/\bredirect\(/);
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
