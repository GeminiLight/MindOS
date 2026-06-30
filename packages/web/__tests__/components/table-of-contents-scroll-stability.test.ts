// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollTocLinkIntoNavView } from '@/components/TableOfContents';

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('TableOfContents scroll stability', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps observer-driven active link scrolling inside the TOC nav', () => {
    const main = document.createElement('main');
    main.id = 'main-content';
    main.scrollTop = 360;
    const nav = document.createElement('nav');
    nav.scrollTop = 100;
    const link = document.createElement('a');
    main.appendChild(nav);
    nav.appendChild(link);
    document.body.appendChild(main);

    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rect(100, 200));
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rect(360, 20));
    const navScrollTo = vi.fn((options: ScrollToOptions) => {
      nav.scrollTop = Number(options.top ?? nav.scrollTop);
    });
    Object.defineProperty(nav, 'scrollTo', { configurable: true, value: navScrollTo });

    scrollTocLinkIntoNavView(link, nav);

    expect(navScrollTo).toHaveBeenCalledWith({ top: 270, behavior: 'auto' });
    expect(nav.scrollTop).toBe(270);
    expect(main.scrollTop).toBe(360);
  });

  it('does not move the TOC nav when the active link is already readable', () => {
    const nav = document.createElement('nav');
    nav.scrollTop = 64;
    const link = document.createElement('a');
    nav.appendChild(link);
    document.body.appendChild(nav);

    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rect(100, 200));
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rect(150, 20));
    const navScrollTo = vi.fn();
    Object.defineProperty(nav, 'scrollTo', { configurable: true, value: navScrollTo });

    scrollTocLinkIntoNavView(link, nav);

    expect(navScrollTo).not.toHaveBeenCalled();
    expect(nav.scrollTop).toBe(64);
  });
});
