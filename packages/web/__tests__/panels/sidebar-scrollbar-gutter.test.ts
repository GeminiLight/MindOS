import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('sidebar scroll gutter stability', () => {
  it('defines a shared sidebar scroll area gutter rule', () => {
    const css = read('app/globals.css');

    expect(css).toContain('.sidebar-scroll-area {');
    expect(css).toContain('scrollbar-gutter: stable;');
  });

  it('uses the shared gutter on primary left sidebar scroll containers', () => {
    const files = [
      'components/Panel.tsx',
      'components/panels/HomePanel.tsx',
      'components/panels/AgentsPanel.tsx',
      'components/panels/StudioPanel.tsx',
      'components/panels/DiscoverPanel.tsx',
      'components/panels/EchoPanel.tsx',
      'components/panels/PluginsPanel.tsx',
      'components/panels/WorkflowsPanel.tsx',
      'components/panels/CapturePanel.tsx',
      'components/panels/SearchPanel.tsx',
      'components/panels/ImportHistoryPanel.tsx',
    ];

    for (const file of files) {
      expect(read(file), file).toContain('sidebar-scroll-area');
    }
  });
});
