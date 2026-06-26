import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function indexOfOrFail(source: string, token: string, file: string): number {
  const index = source.indexOf(token);
  expect(index, `${file} missing ${token}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('primary sidebar panel chrome', () => {
  it('keeps route-backed primary navigation fixed above the scroll area', () => {
    const files = [
      'components/panels/StudioPanel.tsx',
      'components/panels/EchoPanel.tsx',
      'components/panels/DiscoverPanel.tsx',
    ];

    for (const file of files) {
      const source = read(file);
      const headerIndex = indexOfOrFail(source, '<PanelHeader', file);
      const primaryNavIndex = indexOfOrFail(source, '<PanelPrimaryNav', file);
      const scrollAreaIndex = indexOfOrFail(source, 'sidebar-scroll-area', file);

      expect(primaryNavIndex, file).toBeGreaterThan(headerIndex);
      expect(scrollAreaIndex, file).toBeGreaterThan(primaryNavIndex);
      expect(source, file).not.toContain('PANEL_NAV_SECTION_CLASS');
    }
  });

  it('uses the fixed primary nav inside Agents hub navigation', () => {
    const hubSource = read('components/panels/AgentsPanelHubNav.tsx');
    const panelSource = read('components/panels/AgentsPanel.tsx');

    expect(hubSource).toContain('<PanelPrimaryNav aria-label={ariaLabel}>');
    expect(hubSource).not.toContain('PANEL_NAV_SECTION_CLASS');
    expect(panelSource.indexOf('{hub}')).toBeLessThan(panelSource.indexOf('sidebar-scroll-area'));
  });

  it('defines the fixed primary nav as chrome, not scroll content', () => {
    const source = read('components/panels/PanelNavRow.tsx');

    expect(source).toContain('export function PanelPrimaryNav');
    expect(source).toContain('shrink-0 border-b border-border/60');
    expect(source).toContain('className={cn(PANEL_NAV_STACK_CLASS');
  });
});
