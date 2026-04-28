import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header layout', () => {
  it('uses a full-width header row instead of centering actions inside content-width', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('className="w-full min-w-0 flex items-center justify-between gap-3 h-full"');
    expect(source).not.toContain('className="content-width flex items-center justify-between gap-2 h-full"');
  });
});
