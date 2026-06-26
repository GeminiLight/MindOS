import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('primary sidebar panel chrome', () => {
  it('keeps route-backed panels on the shared header and nav stack', () => {
    const files = [
      'components/panels/StudioPanel.tsx',
      'components/panels/EchoPanel.tsx',
      'components/panels/DiscoverPanel.tsx',
      'components/panels/AppsPanel.tsx',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source, file).toContain('PanelHeader');
      expect(source, file).toContain('sidebar-scroll-area');
      expect(source, file).toContain('PANEL_NAV_STACK_CLASS');
      expect(source, file).not.toContain('PANEL_NAV_SECTION_CLASS');
    }
  });

  it('uses the same primary nav stack inside Agents hub navigation', () => {
    const source = read('components/panels/AgentsPanelHubNav.tsx');

    expect(source).toContain('PANEL_NAV_STACK_CLASS');
    expect(source).not.toContain('PANEL_NAV_SECTION_CLASS');
  });

  it('does not keep a custom Apps intro block above the shared header scroll rhythm', () => {
    const appsSource = read('components/panels/AppsPanel.tsx');
    const rowSource = read('components/panels/PanelNavRow.tsx');

    expect(appsSource).toContain('<PanelHeader title={copy.title} />');
    expect(appsSource).toContain('className={PANEL_NAV_STACK_CLASS}');
    expect(appsSource).not.toContain('Experimental scenario workspaces');
    expect(appsSource).not.toContain('实验中的场景工作台');
    expect(appsSource).not.toContain('border-b border-border px-4 py-4');
    expect(rowSource).not.toContain('PANEL_NAV_SECTION_CLASS');
  });
});
