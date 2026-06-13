import { describe, expect, it } from 'vitest';
import { DEFAULT_LEFT_PANEL_WIDTH, LEFT_PANEL, getLeftPanelWidth } from '@/lib/config/panel-sizes';

describe('getLeftPanelWidth', () => {
  it('uses the user-resized width for every panel once one is stored', () => {
    // Width is one global value — flipping to per-panel defaults during
    // local/route state mismatches was the rail-click flicker.
    expect(getLeftPanelWidth('agents', 360)).toBe(360);
    expect(getLeftPanelWidth('capture', 360)).toBe(360);
    expect(getLeftPanelWidth('files', 360)).toBe(360);
    expect(getLeftPanelWidth(null, 360)).toBe(360);
  });

  it('falls back to the per-panel default when the user never resized', () => {
    expect(getLeftPanelWidth('agents', null)).toBe(DEFAULT_LEFT_PANEL_WIDTH.agents);
    expect(getLeftPanelWidth('echo', null)).toBe(DEFAULT_LEFT_PANEL_WIDTH.echo);
    expect(getLeftPanelWidth(null, null)).toBe(LEFT_PANEL.DEFAULT);
  });
});
