import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('DiscoverPanel plugin market boundary', () => {
  const sourcePath = path.resolve(__dirname, '../../components/panels/DiscoverPanel.tsx');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('routes capability discovery entries into the Explore family instead of Settings', () => {
    expect(source).toContain('href="/explore/capabilities"');
    expect(source).toContain('href="/explore/skills"');
    expect(source).toContain('href="/explore/mcp"');
    expect(source).toContain('href="/explore/plugins"');
    expect(source).toContain('href="/explore"');
    expect(source).not.toContain('/settings?tab=mcp');
    expect(source).not.toContain('/settings?tab=plugins&panel=community');
  });

  it('does not embed plugin manager renderer toggles in Discover', () => {
    expect(source).not.toContain('Installed extensions');
    expect(source).not.toContain('setRendererEnabled');
    expect(source).not.toContain('getPluginRenderers');
    expect(source).not.toContain('isRendererEnabled');
  });

  it('uses panel navigation without subtitles or fullscreen controls', () => {
    expect(source).toContain("import { usePathname } from 'next/navigation'");
    expect(source).toContain('<PanelHeader title={d.title} />');
    expect(source).not.toContain('maximized={maximized}');
    expect(source).not.toContain('onMaximize={onMaximize}');
    expect(source).not.toContain('subtitle={d.pluginMarketDesc}');
    expect(source).not.toContain('subtitle={d.skillMarketDesc}');
    expect(source).toContain('activeVariant="rail"');
  });

  it('puts use cases after market entries in the primary navigation', () => {
    const capabilitiesIndex = source.indexOf('title={d.capabilityMarketplace}');
    const pluginIndex = source.indexOf('title={d.pluginMarket}');
    const skillIndex = source.indexOf('title={d.skillMarket}');
    const mcpIndex = source.indexOf('title={d.mcpServers}');
    const useCasesIndex = source.indexOf('title={d.useCases}');

    expect(capabilitiesIndex).toBeGreaterThan(-1);
    expect(skillIndex).toBeGreaterThan(capabilitiesIndex);
    expect(mcpIndex).toBeGreaterThan(skillIndex);
    expect(pluginIndex).toBeGreaterThan(mcpIndex);
    expect(useCasesIndex).toBeGreaterThan(pluginIndex);
  });
});
