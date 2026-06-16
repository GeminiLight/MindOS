import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('DiscoverPanel plugin market boundary', () => {
  const sourcePath = path.resolve(__dirname, '../../components/panels/DiscoverPanel.tsx');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('routes Plugin Market into the Explore family instead of Settings', () => {
    expect(source).toContain('href="/explore/plugins"');
    expect(source).not.toContain('/settings?tab=plugins&panel=community');
  });

  it('does not embed plugin manager renderer toggles in Discover', () => {
    expect(source).not.toContain('Installed extensions');
    expect(source).not.toContain('setRendererEnabled');
    expect(source).not.toContain('getPluginRenderers');
    expect(source).not.toContain('isRendererEnabled');
  });
});
