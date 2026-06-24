import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function cssBlock(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('main viewport scrollbar gutter stability', () => {
  it('reserves the document viewport gutter on the root scroll owner', () => {
    const css = read('app/globals.css');

    expect(cssBlock(css, 'html')).toContain('scrollbar-gutter: stable;');
    expect(cssBlock(css, 'body')).toContain('scrollbar-gutter: stable;');
  });

  it('keeps main content on document scroll instead of an inner overflow scroller', () => {
    const source = read('components/SidebarLayout.tsx');
    const mainOpeningTag = source.match(/<main[\s\S]*?id="main-content"[\s\S]*?>/)?.[0] ?? '';

    expect(mainOpeningTag).toContain('id="main-content"');
    expect(mainOpeningTag).not.toContain('overflow-y-auto');
    expect(mainOpeningTag).not.toContain('overflow-y-scroll');
  });
});
