import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Page header and TOC vertical alignment', () => {
  it('TOC toggle button top aligns with header height (46px)', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('const TOPBAR_H = 46;');
    expect(source).toContain('top-[46px]');
    expect(source).not.toContain('top-[52px]');
    expect(source).not.toContain('top-[50px]');
  });

  it('FindInPage sticky top aligns with header height on desktop', () => {
    const filePath = path.resolve(process.cwd(), 'components/FindInPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('md:top-[46px]');
    expect(source).not.toContain('md:top-[44px]');
  });
});
