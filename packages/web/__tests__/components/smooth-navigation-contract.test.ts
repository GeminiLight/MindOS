import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }
    if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('smooth navigation contract', () => {
  it('keeps client components from starting route work synchronously', () => {
    const componentsDir = path.resolve(process.cwd(), 'components');
    const offenders = listSourceFiles(componentsDir)
      .filter((file) => !file.endsWith(path.join('hooks', 'useSmoothRouterPush.ts')))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('router.push('))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
