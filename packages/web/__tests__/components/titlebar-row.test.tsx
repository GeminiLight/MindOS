// @vitest-environment jsdom
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import TitlebarRow from '@/components/TitlebarRow';

// Phase 2: the row hosts TitlebarTabStrip, whose sync hook reads the route and
// fires the initial session fetch — mock both so the row renders standalone.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const webRoot = path.join(__dirname, '..', '..');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('TitlebarRow (spec-titlebar-row Phase 1 + 2)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    // Keep the strip's refreshSessions pending: these tests only assert geometry.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  function render(props: React.ComponentProps<typeof TitlebarRow> = {}): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(React.createElement(TitlebarRow, props)));
    const el = container.firstElementChild as HTMLElement | null;
    expect(el).not.toBeNull();
    return el!;
  }

  it('renders a fixed full-row strip gated by the titlebar-row class', () => {
    const el = render();
    expect(el.className).toContain('titlebar-row');
    expect(el.className).toContain('fixed');
    expect(el.className).toContain('top-0');
    expect(el.className).toContain('right-0');
    expect(el.className).toContain('z-30');
  });

  it('binds geometry to the shell CSS variables', () => {
    const el = render();
    const style = el.getAttribute('style') ?? '';
    expect(style).toContain('left: var(--rail-width)');
    expect(style).toContain('height: var(--app-titlebar-h)');
    expect(style).toContain('max(0px, calc(var(--window-controls-left) - var(--rail-width)))');
  });

  it('is draggable and animates in sync with the rail (200ms ease-out)', () => {
    const el = render();
    // jsdom does not serialize -webkit-app-region into the style attribute;
    // React assigns it as a camelCase expando on the style object
    expect((el.style as unknown as Record<string, string>).WebkitAppRegion).toBe('drag');
    const style = el.getAttribute('style') ?? '';
    expect(style).toMatch(/transition:[^;]*left 200ms ease-out/);
    expect(style).toMatch(/transition:[^;]*padding-left 200ms ease-out/);
  });

  it('hosts the tab strip and reserves >=110px of pure drag space at the right end', () => {
    const el = render();
    // Phase 2: interactive content lives inside, so the row is no longer aria-hidden
    expect(el.getAttribute('aria-hidden')).toBeNull();
    expect(el.querySelector('[data-titlebar-search-trigger]')).not.toBeNull();
    expect(el.querySelector('[role="tablist"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="New chat"]')).not.toBeNull();

    const spacer = el.querySelector<HTMLElement>('[data-drag-spacer]');
    expect(spacer).not.toBeNull();
    expect(spacer!.style.minWidth).toBe('110px');
    expect((spacer!.style as unknown as Record<string, string>).WebkitAppRegion).toBe('drag');
    // The spacer is the last child: nothing can render to its right
    expect(el.lastElementChild).toBe(spacer);
  });

  it('renders the leading Search trigger before the tablist without joining the tab model', () => {
    const onSearchOpenOrFocus = vi.fn();
    const onSidebarExpandedChange = vi.fn();
    const el = render({
      searchActive: true,
      onSearchOpenOrFocus,
      sidebarExpanded: true,
      onSidebarExpandedChange,
    });
    const searchButton = el.querySelector<HTMLButtonElement>('[data-titlebar-search-trigger]');
    const sidebarToggle = el.querySelector<HTMLButtonElement>('[data-titlebar-sidebar-toggle]');
    const tablist = el.querySelector<HTMLElement>('[role="tablist"]');

    expect(searchButton).not.toBeNull();
    expect(searchButton!.getAttribute('aria-label')).toBe('Search');
    expect(searchButton!.getAttribute('aria-pressed')).toBe('true');
    expect(searchButton!.getAttribute('aria-expanded')).toBe('true');
    expect(searchButton!.getAttribute('title')).toContain('⌘K');
    expect(searchButton!.getAttribute('role')).toBeNull();
    expect((searchButton!.style as unknown as Record<string, string>).WebkitAppRegion).toBe('no-drag');
    expect(searchButton!.parentElement).toBe(el);
    expect(searchButton!.className).toContain('self-end');
    expect(searchButton!.className).toContain('mb-1');
    expect(searchButton!.className).toContain('rounded-full');
    expect(searchButton!.className).not.toContain('self-center');
    expect(searchButton!.className).not.toMatch(/(^|\s)border(?:-|\s|$)/);
    expect(searchButton!.className).not.toContain('border-r');
    expect(sidebarToggle).not.toBeNull();
    expect(sidebarToggle!.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(sidebarToggle!.getAttribute('aria-pressed')).toBe('true');
    expect((sidebarToggle!.style as unknown as Record<string, string>).WebkitAppRegion).toBe('no-drag');
    expect(tablist).not.toBeNull();
    expect(searchButton!.compareDocumentPosition(sidebarToggle!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sidebarToggle!.compareDocumentPosition(tablist!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(searchButton!.compareDocumentPosition(tablist!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    act(() => {
      searchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSearchOpenOrFocus).toHaveBeenCalledTimes(1);

    act(() => {
      sidebarToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSidebarExpandedChange).toHaveBeenCalledWith(false);
  });

  it('globals.css gates display and defines the shell variables', () => {
    const css = readFileSync(path.join(webRoot, 'app', 'globals.css'), 'utf-8');
    // Hidden unless the mac shell declares the capability
    expect(css).toMatch(/\.titlebar-row\s*\{\s*display:\s*none;?\s*\}/);
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\s+\.titlebar-row\s*\{\s*display:\s*flex;?\s*\}/);
    // Variables default to 0 (browser/win/linux/old shell = zero diff)
    expect(css).toContain('--app-titlebar-h: 0px');
    expect(css).toContain('--window-controls-left: 0px');
    // Rail offset exists only for the mac traffic lights: 0 by default so the
    // rail logo sits in the first row on browser/win/linux desktops
    expect(css).toMatch(/:root\s*\{[^}]*--rail-titlebar-offset:\s*0px/);
    // Mac shell geometry
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\s*\{[^}]*--app-titlebar-h:\s*42px/);
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\s*\{[^}]*--window-controls-left:\s*70px/);
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\s*\{[^}]*--rail-titlebar-offset:\s*var\(--app-titlebar-h\)/);
    // Fullscreen hides traffic lights: clearance collapses to 0
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\[data-mac-fullscreen\]\s*\{[^}]*--window-controls-left:\s*0px/);
    expect(css).toMatch(/html\[data-mac-titlebar-row\]\[data-mac-fullscreen\]\s*\{[^}]*--rail-titlebar-offset:\s*0px/);
    // Legacy injected-CSS fallback is gone
    expect(css).not.toContain('.electron-mac-titlebar-pad');
  });

  it('full-viewport pages subtract the titlebar height instead of using bare 100dvh', () => {
    // #main-content gets padding-top: var(--app-titlebar-h). A child sized
    // h-[100dvh] overflows the document by that padding, so the page can
    // scroll the view's header underneath the fixed titlebar row, which then
    // swallows its clicks (user-reported: focus-mode chat header buttons only
    // clickable along their bottom edge).
    const fullHeightPages = [
      path.join(webRoot, 'components', 'HomeContent.tsx'),
      path.join(webRoot, 'app', 'chat', '[sessionId]', 'ChatPageClient.tsx'),
    ];
    for (const file of fullHeightPages) {
      const src = readFileSync(file, 'utf-8');
      expect(src, `${file} must not size itself with bare 100dvh`).not.toMatch(/h-\[100dvh\]/);
      expect(src).toContain('h-[calc(100dvh-var(--app-titlebar-h))]');
    }
    // The SidebarLayout children wrapper guarantees a full-height background —
    // it must subtract the titlebar height too, or every page gets a titlebar-height
    // document scroll slack on desktop.
    const layoutSrc = readFileSync(path.join(webRoot, 'components', 'SidebarLayout.tsx'), 'utf-8');
    expect(layoutSrc).toContain('min-h-[calc(100vh-var(--app-titlebar-h))] bg-background');
  });
});
