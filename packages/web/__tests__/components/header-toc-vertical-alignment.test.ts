import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Desktop layout: fixed titlebar row (var(--app-titlebar-h) = 42px) on top, then the
// app content scrollport starts below it. Anything pinned "below the view header"
// uses local scrollport coordinates, and JS scroll math measures the rendered view
// header at runtime. See wiki/41-dev-pitfall-patterns.md 规则 10.
describe('Page header and TOC vertical alignment', () => {
  it('TOC rail sits below the view header inside the content scrollport', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // The rail is sticky below the shared workspace header with a small
    // reading-layout gutter; the scrollport itself already starts below titlebar.
    expect(source).toContain('top: `calc(${VIEW_HEADER_CSS_VAR} + 24px)`');
    expect(source).toContain('maxHeight: `calc(100dvh - var(--app-titlebar-h) - ${VIEW_HEADER_CSS_VAR} - 48px)`');
    expect(source).not.toContain('top: `calc(var(--app-titlebar-h) + ${VIEW_HEADER_CSS_VAR} + 24px)`');
    expect(source).not.toContain('top-[calc(var(--app-titlebar-h)+var(--workspace-header-h))]');
    expect(source).not.toContain('top-[46px]');
    expect(source).not.toContain('top-[52px]');

    // Scroll math (IntersectionObserver rootMargin + scrollTo) must include the
    // measured view header at runtime and use the app scrollport when available.
    expect(source).toContain('getPropertyValue(\'--app-titlebar-h\')');
    expect(source).toContain('getMainScrollContainer() ? 0 : titlebarOffset()');
    expect(source).toContain('viewHeaderHeight() + 12');
    expect(source).toContain('root: scrollRoot');
    expect(source).toContain('getMainScrollRelativeTop(el) - scrollOffset()');
    expect(source).toContain("document.querySelector<HTMLElement>('.view-page-topbar')");
    expect(source).not.toContain('const SCROLL_OFFSET');
    expect(source).not.toContain('const TOPBAR_H = 46');
  });

  it('FindInPage sticky top sits below the view header inside the scrollport on desktop', () => {
    const filePath = path.resolve(process.cwd(), 'components/FindInPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('md:top-[var(--workspace-header-h)]');
    expect(source).not.toContain('md:top-[calc(var(--app-titlebar-h)+var(--workspace-header-h))]');
    expect(source).not.toContain('md:top-[46px]');
    expect(source).not.toContain('md:top-[44px]');
  });
});
