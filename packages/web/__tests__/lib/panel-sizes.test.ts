import { describe, expect, it } from 'vitest';
import { DEFAULT_LEFT_PANEL_WIDTH, LEFT_PANEL, STANDARD_LEFT_PANEL_WIDTH, getLeftPanelWidth } from '@/lib/config/panel-sizes';

describe('getLeftPanelWidth', () => {
  it('uses the user-resized width for every panel once one is stored', () => {
    // Width is one global value — flipping to per-panel defaults during
    // local/route state mismatches was the rail-click flicker.
    expect(getLeftPanelWidth('agents', 360)).toBe(360);
    expect(getLeftPanelWidth('capture', 360)).toBe(360);
    expect(getLeftPanelWidth('files', 360)).toBe(360);
    expect(getLeftPanelWidth(null, 360)).toBe(360);
  });

  it('uses one standard default width before the user resizes', () => {
    const widths = Object.values(DEFAULT_LEFT_PANEL_WIDTH);

    expect(new Set(widths)).toEqual(new Set([STANDARD_LEFT_PANEL_WIDTH]));
    expect(getLeftPanelWidth('agents', null)).toBe(STANDARD_LEFT_PANEL_WIDTH);
    expect(getLeftPanelWidth('echo', null)).toBe(STANDARD_LEFT_PANEL_WIDTH);
    expect(getLeftPanelWidth('search', null)).toBe(STANDARD_LEFT_PANEL_WIDTH);
    expect(getLeftPanelWidth(null, null)).toBe(LEFT_PANEL.DEFAULT);
    expect(LEFT_PANEL.DEFAULT).toBe(STANDARD_LEFT_PANEL_WIDTH);
  });
});
