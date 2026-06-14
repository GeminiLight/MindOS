import { describe, expect, it } from 'vitest';
import { pluginStyleScopeSelector, scopePluginCss } from '@/lib/obsidian-compat/stylesheet-host';

describe('stylesheet-host', () => {
  it('scopes plugin selectors to a plugin view container', () => {
    const scope = pluginStyleScopeSelector('daily');
    const css = `
      :root { --daily-color: red; }
      .daily-card, button:hover, .item:is(.active, .pinned) { color: var(--daily-color); }
      @media (min-width: 720px) {
        body .daily-card { padding: 12px; }
      }
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
      @font-face { font-family: PluginFont; src: url(font.woff2); }
      @import url("remote.css");
    `;

    const scoped = scopePluginCss(css, scope);

    expect(scoped).toContain('[data-obsidian-plugin-view="daily"] { --daily-color: red; }');
    expect(scoped).toContain('[data-obsidian-plugin-view="daily"] .daily-card');
    expect(scoped).toContain('[data-obsidian-plugin-view="daily"] button:hover');
    expect(scoped).toContain('[data-obsidian-plugin-view="daily"] .item:is(.active, .pinned)');
    expect(scoped).toContain('@media (min-width: 720px)');
    expect(scoped).toContain('[data-obsidian-plugin-view="daily"] .daily-card { padding: 12px; }');
    expect(scoped).not.toContain('@keyframes');
    expect(scoped).not.toContain('@font-face');
    expect(scoped).not.toContain('@import');
  });

  it('escapes plugin ids used in the CSS attribute selector', () => {
    expect(pluginStyleScopeSelector('plugin"with\\quotes')).toBe('[data-obsidian-plugin-view="plugin\\"with\\\\quotes"]');
  });
});
