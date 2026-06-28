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

describe('main content scrollport gutter stability', () => {
  it('reserves the gutter on the app content scrollport below the titlebar', () => {
    const css = read('app/globals.css');
    const source = read('components/SidebarLayout.tsx');
    const mainOpeningTag = source.match(/<main[\s\S]*?id="main-content"[\s\S]*?>/)?.[0] ?? '';

    expect(cssBlock(css, '.app-main-scrollport')).toContain('scrollbar-gutter: stable;');
    expect(cssBlock(css, '.app-main-scrollport')).toContain('background-color: var(--background);');
    expect(cssBlock(css, '.app-main-scrollport')).toContain('scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);');
    expect(mainOpeningTag).toContain('id="main-content"');
    expect(mainOpeningTag).toContain('tabIndex={-1}');
    expect(mainOpeningTag).toContain('app-main-scrollport');
    expect(mainOpeningTag).toContain('fixed');
    expect(mainOpeningTag).toContain('top-[var(--app-titlebar-h)]');
    expect(mainOpeningTag).toContain('bottom-0');
  });

  it('keeps the titlebar outside the app scrollport and avoids duplicate top padding', () => {
    const source = read('components/SidebarLayout.tsx');
    const mainOpeningTag = source.match(/<main[\s\S]*?id="main-content"[\s\S]*?>/)?.[0] ?? '';

    expect(source.indexOf('<TitlebarRow')).toBeLessThan(source.indexOf('<main'));
    expect(mainOpeningTag).toContain('overflow-y-auto');
    expect(mainOpeningTag).not.toContain('overflow-y-scroll');
    expect(source).toContain("import { getMainScrollContainer } from '@/lib/main-scroll-container';");
    expect(source).toContain("getMainScrollContainer()?.scrollTo({ left: 0, top: 0, behavior: 'auto' });");
    expect(source).not.toContain('padding-top: var(--app-titlebar-h);');
    expect(source).toContain('min-h-full bg-background');
  });

  it('keeps the reserved scrollbar lane theme-aware without showing an empty track', () => {
    const css = read('app/globals.css');

    expect(cssBlock(css, ':root')).toContain('color-scheme: light;');
    expect(cssBlock(css, ':root')).toContain('--scrollbar-track: transparent;');
    expect(cssBlock(css, ':root')).toContain('--scrollbar-thumb:');
    expect(cssBlock(css, '.dark')).toContain('color-scheme: dark;');
    expect(cssBlock(css, '.dark')).toContain('--scrollbar-thumb:');
    expect(cssBlock(css, '::-webkit-scrollbar-track')).toContain('background: var(--scrollbar-track);');
    expect(cssBlock(css, '::-webkit-scrollbar-thumb')).toContain('background: var(--scrollbar-thumb);');
    expect(cssBlock(css, '::-webkit-scrollbar-thumb:hover')).toContain('background: var(--scrollbar-thumb-hover);');
  });
});
