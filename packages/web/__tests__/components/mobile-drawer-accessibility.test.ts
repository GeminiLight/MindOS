import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('mobile drawer accessibility contract', () => {
  it('makes the translated-away drawer unavailable to keyboard and assistive technology', () => {
    const source = readSource('components/MobileNavigationDrawer.tsx');
    expect(source).toContain('<Dialog.Root open={visible}');
    expect(source).toContain('<Dialog.Popup');
    expect(source).toContain('const visible = open && !desktop;');
  });
  it('exposes the mobile sidebar as a dialog with focus and background guards', () => {
    const source = readSource('components/SidebarLayout.tsx');

    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-expanded={mobileOpen}');
    expect(source).toContain('<MobileNavigationDrawer');
    expect(source).not.toContain('inert={mobileOpen');
    expect(source).not.toContain('const closeOnEscape');
  });

  it('does not mount the drawer file tree on desktop viewports', () => {
    const source = readSource('components/SidebarLayout.tsx');

    // Desktop renders already mount the Files panel tree; a second always-on
    // copy in the hidden drawer doubled hooks, polling and DOM.
    expect(source).toContain('const mountMobileDrawerTree = mobileOpen || (viewportWidth > 0 && viewportWidth < MOBILE_DRAWER_BREAKPOINT_PX);');
    expect(source).toMatch(/\{mountMobileDrawerTree && \(\s*<MindFileTreeSections/);
  });
});
