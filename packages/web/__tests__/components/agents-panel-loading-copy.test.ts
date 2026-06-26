import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const webRoot = path.resolve(__dirname, '../..');

describe('Agents panel loading copy', () => {
  it('uses the shared route panel fallback for every lazy sidebar panel', () => {
    const source = readFileSync(path.join(webRoot, 'components', 'SidebarLayout.tsx'), 'utf-8');

    expect(source).toContain("import PanelLoadingFallback from './panels/PanelLoadingFallback'");
    expect(source).toContain('function RoutePanelLoading');
    for (const panel of ['search', 'capture', 'agents', 'studio', 'discover', 'echo', 'workflows']) {
      expect(source).toContain(`loading: () => <RoutePanelLoading panel="${panel}" />`);
    }
    expect(source).not.toContain('AgentsPanelLoading');
  });

  it('keeps the shared fallback semantic and panel-scoped', () => {
    const source = readFileSync(path.join(webRoot, 'components', 'panels', 'PanelLoadingFallback.tsx'), 'utf-8');

    expect(source).toContain('aria-busy="true"');
    expect(source).toContain('role="status"');
    expect(source).toContain('data-panel-loading-fallback={panelId}');
  });
});
