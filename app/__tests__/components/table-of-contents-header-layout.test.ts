import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TableOfContents header layout', () => {
  it('uses a dedicated compact header row instead of a large blank top gutter', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('const TOPBAR_H = 46;');
    expect(source).toContain('className="flex items-center h-[46px] px-4 border-l border-b border-border"');
    expect(source).toContain('className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pt-3 pb-5 pl-2 pr-3 border-l border-border"');
    expect(source).not.toContain('py-5 pl-2 pr-3 border-l border-border');
  });
});
