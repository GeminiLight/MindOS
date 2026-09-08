import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('mobile drawer accessibility contract', () => {
  it('exposes the mobile sidebar as a dialog with focus and background guards', () => {
    const source = readSource('components/SidebarLayout.tsx');

    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-expanded={mobileOpen}');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('mobileDrawerCloseRef.current?.focus()');
    expect(source).toContain("if (e.key === 'Escape') setMobileOpen(false)");
    expect(source).toContain('aria-hidden={mobileOpen || undefined}');
    expect(source).toContain('inert={mobileOpen ? true : undefined}');
  });

  it('does not mount the drawer file tree on desktop viewports', () => {
    const source = readSource('components/SidebarLayout.tsx');

    // Desktop renders already mount the Files panel tree; a second always-on
    // copy in the hidden drawer doubled hooks, polling and DOM.
    expect(source).toContain('const mountMobileDrawerTree = mobileOpen || (viewportWidth > 0 && viewportWidth < MOBILE_DRAWER_BREAKPOINT_PX);');
    expect(source).toMatch(/\{mountMobileDrawerTree && \(\s*<MindFileTreeSections/);
  });
});
