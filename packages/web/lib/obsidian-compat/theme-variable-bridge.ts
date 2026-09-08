/**
 * Obsidian Plugin Compatibility - Theme variable bridge
 *
 * Obsidian plugins and themes style themselves against Obsidian's CSS custom
 * properties (`--background-primary`, `--text-muted`, …) and structural class
 * names (`.view-content`, `.setting-item`, …). MindOS has its own design tokens.
 * This module is the single mapping table between the two: it emits a scoped
 * declaration block that defines the Obsidian variables in terms of MindOS
 * tokens, so plugin `styles.css` resolves without touching the global theme.
 *
 * The table is intentionally data, not logic: adding a variable is one row.
 * Values must reference MindOS tokens (`var(--…)`) or be dimension literals;
 * never hard-code colors here (see wiki/21-design-principle.md).
 */

export interface ObsidianThemeVariableMapping {
  /** Obsidian variable name, including the leading `--`. */
  obsidian: string;
  /** CSS value expressed with MindOS tokens or a dimension literal. */
  value: string;
  /** Why this mapping is what it is, when non-obvious. */
  note?: string;
}

export const OBSIDIAN_THEME_VARIABLE_MAP: readonly ObsidianThemeVariableMapping[] = [
  // Backgrounds
  { obsidian: '--background-primary', value: 'var(--background)' },
  { obsidian: '--background-primary-alt', value: 'var(--card)' },
  { obsidian: '--background-secondary', value: 'var(--sidebar)' },
  { obsidian: '--background-secondary-alt', value: 'var(--secondary)' },
  { obsidian: '--background-modifier-border', value: 'var(--border)' },
  { obsidian: '--background-modifier-border-hover', value: 'var(--input)' },
  { obsidian: '--background-modifier-border-focus', value: 'var(--ring)' },
  { obsidian: '--background-modifier-hover', value: 'var(--accent)' },
  { obsidian: '--background-modifier-active-hover', value: 'var(--amber-subtle)' },
  { obsidian: '--background-modifier-form-field', value: 'var(--card)' },
  { obsidian: '--background-modifier-error', value: 'var(--destructive)' },
  { obsidian: '--background-modifier-error-hover', value: 'var(--destructive)' },
  { obsidian: '--background-modifier-success', value: 'var(--success)' },
  { obsidian: '--background-modifier-message', value: 'var(--popover)' },
  { obsidian: '--background-modifier-cover', value: 'color-mix(in srgb, var(--foreground) 45%, transparent)', note: 'Modal backdrop.' },
  // Text
  { obsidian: '--text-normal', value: 'var(--foreground)' },
  { obsidian: '--text-muted', value: 'var(--muted-foreground)' },
  { obsidian: '--text-faint', value: 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)' },
  { obsidian: '--text-on-accent', value: 'var(--amber-foreground)', note: 'Amber CTA text is always white per design system.' },
  { obsidian: '--text-on-accent-inverted', value: 'var(--foreground)' },
  { obsidian: '--text-accent', value: 'var(--amber-text)' },
  { obsidian: '--text-accent-hover', value: 'var(--amber-action)' },
  { obsidian: '--text-error', value: 'var(--error)' },
  { obsidian: '--text-success', value: 'var(--success)' },
  { obsidian: '--text-warning', value: 'var(--amber-text)' },
  { obsidian: '--text-selection', value: 'var(--amber-dim)' },
  { obsidian: '--text-highlight-bg', value: 'var(--amber-dim)' },
  // Interactive
  { obsidian: '--interactive-normal', value: 'var(--secondary)' },
  { obsidian: '--interactive-hover', value: 'var(--accent)' },
  { obsidian: '--interactive-accent', value: 'var(--amber)' },
  { obsidian: '--interactive-accent-hover', value: 'var(--amber-action)' },
  // Links, tags, blockquotes, code
  { obsidian: '--link-color', value: 'var(--amber-text)' },
  { obsidian: '--link-color-hover', value: 'var(--amber-action)' },
  { obsidian: '--link-external-color', value: 'var(--amber-text)' },
  { obsidian: '--link-external-color-hover', value: 'var(--amber-action)' },
  { obsidian: '--link-unresolved-color', value: 'var(--muted-foreground)' },
  { obsidian: '--tag-color', value: 'var(--amber-text)' },
  { obsidian: '--tag-color-hover', value: 'var(--amber-action)' },
  { obsidian: '--tag-background', value: 'var(--amber-subtle)' },
  { obsidian: '--tag-background-hover', value: 'var(--amber-dim)' },
  { obsidian: '--blockquote-border-color', value: 'var(--amber)' },
  { obsidian: '--blockquote-color', value: 'var(--prose-muted)' },
  { obsidian: '--code-background', value: 'var(--prose-pre-bg)' },
  { obsidian: '--code-normal', value: 'var(--prose-pre-color)' },
  { obsidian: '--code-comment', value: 'var(--hljs-comment)' },
  { obsidian: '--code-keyword', value: 'var(--hljs-keyword)' },
  { obsidian: '--code-string', value: 'var(--hljs-string)' },
  { obsidian: '--code-function', value: 'var(--hljs-title)' },
  { obsidian: '--code-value', value: 'var(--hljs-number)' },
  { obsidian: '--hr-color', value: 'var(--prose-border)' },
  { obsidian: '--table-border-color', value: 'var(--prose-border)' },
  { obsidian: '--table-header-background', value: 'var(--prose-th-bg)' },
  { obsidian: '--checkbox-color', value: 'var(--amber)' },
  { obsidian: '--checkbox-color-hover', value: 'var(--amber-action)' },
  { obsidian: '--checkbox-border-color', value: 'var(--input)' },
  { obsidian: '--checkbox-marker-color', value: 'var(--amber-foreground)' },
  // Headings and prose
  { obsidian: '--h1-color', value: 'var(--prose-heading)' },
  { obsidian: '--h2-color', value: 'var(--prose-heading)' },
  { obsidian: '--h3-color', value: 'var(--prose-heading)' },
  { obsidian: '--h4-color', value: 'var(--prose-heading)' },
  { obsidian: '--h5-color', value: 'var(--prose-heading)' },
  { obsidian: '--h6-color', value: 'var(--prose-heading)' },
  { obsidian: '--bold-color', value: 'inherit' },
  { obsidian: '--italic-color', value: 'inherit' },
  // Semantic hues (Obsidian ships fixed hues; MindOS only has semantic tokens)
  { obsidian: '--color-red', value: 'var(--destructive)' },
  { obsidian: '--color-green', value: 'var(--success)' },
  { obsidian: '--color-orange', value: 'var(--amber)' },
  { obsidian: '--color-yellow', value: 'var(--amber)' },
  { obsidian: '--color-blue', value: 'var(--tool-read)' },
  { obsidian: '--color-cyan', value: 'var(--tool-read)' },
  { obsidian: '--color-purple', value: 'var(--tool-search)' },
  { obsidian: '--color-accent', value: 'var(--amber)' },
  { obsidian: '--color-accent-1', value: 'var(--amber-text)' },
  { obsidian: '--color-accent-2', value: 'var(--amber-action)' },
  { obsidian: '--color-base-00', value: 'var(--background)' },
  { obsidian: '--color-base-05', value: 'var(--card)' },
  { obsidian: '--color-base-10', value: 'var(--sidebar)' },
  { obsidian: '--color-base-20', value: 'var(--secondary)' },
  { obsidian: '--color-base-25', value: 'var(--accent)' },
  { obsidian: '--color-base-30', value: 'var(--border)' },
  { obsidian: '--color-base-35', value: 'var(--input)' },
  { obsidian: '--color-base-40', value: 'var(--prose-border)' },
  { obsidian: '--color-base-50', value: 'var(--prose-subtle)' },
  { obsidian: '--color-base-60', value: 'var(--muted-foreground)' },
  { obsidian: '--color-base-70', value: 'var(--prose-muted)' },
  { obsidian: '--color-base-100', value: 'var(--foreground)' },
  // Icons, dividers, scrollbars, shadows
  { obsidian: '--icon-color', value: 'var(--muted-foreground)' },
  { obsidian: '--icon-color-hover', value: 'var(--foreground)' },
  { obsidian: '--icon-color-active', value: 'var(--foreground)' },
  { obsidian: '--icon-color-focused', value: 'var(--foreground)' },
  { obsidian: '--icon-size', value: '18px' },
  { obsidian: '--icon-stroke', value: '1.75px' },
  { obsidian: '--divider-color', value: 'var(--border)' },
  { obsidian: '--divider-color-hover', value: 'var(--input)' },
  { obsidian: '--divider-width', value: '1px' },
  { obsidian: '--scrollbar-bg', value: 'var(--scrollbar-track)' },
  { obsidian: '--scrollbar-thumb-bg', value: 'var(--scrollbar-thumb)' },
  { obsidian: '--scrollbar-active-thumb-bg', value: 'var(--scrollbar-thumb-hover)' },
  { obsidian: '--shadow-s', value: '0 1px 2px color-mix(in srgb, var(--foreground) 12%, transparent)' },
  { obsidian: '--shadow-l', value: '0 8px 24px color-mix(in srgb, var(--foreground) 18%, transparent)' },
  { obsidian: '--titlebar-background', value: 'var(--sidebar)' },
  { obsidian: '--titlebar-text-color', value: 'var(--sidebar-foreground)' },
  { obsidian: '--tab-background-active', value: 'var(--background)' },
  { obsidian: '--tab-text-color', value: 'var(--muted-foreground)' },
  { obsidian: '--tab-text-color-active', value: 'var(--foreground)' },
  { obsidian: '--nav-item-color', value: 'var(--sidebar-foreground)' },
  { obsidian: '--nav-item-color-hover', value: 'var(--foreground)' },
  { obsidian: '--nav-item-color-active', value: 'var(--foreground)' },
  { obsidian: '--nav-item-background-hover', value: 'var(--sidebar-accent)' },
  { obsidian: '--nav-item-background-active', value: 'var(--sidebar-accent)' },
  // Typography
  { obsidian: '--font-interface', value: 'var(--font-ui)' },
  { obsidian: '--font-text', value: 'var(--font-lora)' },
  { obsidian: '--font-monospace', value: 'var(--font-code)' },
  { obsidian: '--font-interface-theme', value: 'var(--font-ui)' },
  { obsidian: '--font-text-theme', value: 'var(--font-lora)' },
  { obsidian: '--font-monospace-theme', value: 'var(--font-code)' },
  { obsidian: '--font-text-size', value: '16px' },
  { obsidian: '--font-ui-smaller', value: '12px' },
  { obsidian: '--font-ui-small', value: '13px' },
  { obsidian: '--font-ui-medium', value: '15px' },
  { obsidian: '--font-ui-larger', value: '20px' },
  { obsidian: '--font-smallest', value: '0.8em' },
  { obsidian: '--font-smaller', value: '0.875em' },
  { obsidian: '--font-small', value: '0.933em' },
  { obsidian: '--font-normal', value: '400' },
  { obsidian: '--font-medium', value: '500' },
  { obsidian: '--font-semibold', value: '600' },
  { obsidian: '--font-bold', value: '700' },
  { obsidian: '--line-height-normal', value: '1.5' },
  { obsidian: '--line-height-tight', value: '1.3' },
  // Radii and spacing scale (Obsidian's fixed scale; MindOS only defines --radius)
  { obsidian: '--radius-s', value: 'calc(var(--radius) * 0.5)' },
  { obsidian: '--radius-m', value: 'var(--radius)' },
  { obsidian: '--radius-l', value: 'calc(var(--radius) * 1.5)' },
  { obsidian: '--radius-xl', value: 'calc(var(--radius) * 2)' },
  { obsidian: '--size-2-1', value: '2px' },
  { obsidian: '--size-2-2', value: '4px' },
  { obsidian: '--size-2-3', value: '6px' },
  { obsidian: '--size-4-1', value: '4px' },
  { obsidian: '--size-4-2', value: '8px' },
  { obsidian: '--size-4-3', value: '12px' },
  { obsidian: '--size-4-4', value: '16px' },
  { obsidian: '--size-4-5', value: '20px' },
  { obsidian: '--size-4-6', value: '24px' },
  { obsidian: '--size-4-8', value: '32px' },
  { obsidian: '--size-4-9', value: '36px' },
  { obsidian: '--size-4-12', value: '48px' },
  { obsidian: '--size-4-16', value: '64px' },
  { obsidian: '--size-4-18', value: '72px' },
  // Layers map onto the five MindOS z-index semantics
  { obsidian: '--layer-cover', value: 'var(--z-app-page)' },
  { obsidian: '--layer-sidedock', value: 'var(--z-app-nav)' },
  { obsidian: '--layer-status-bar', value: 'var(--z-app-sticky)' },
  { obsidian: '--layer-popover', value: 'var(--z-app-popover)' },
  { obsidian: '--layer-slides', value: 'var(--z-app-overlay)' },
  { obsidian: '--layer-modal', value: 'var(--z-app-modal)' },
  { obsidian: '--layer-notice', value: 'var(--z-app-popover-flyout)' },
  { obsidian: '--layer-menu', value: 'var(--z-app-popover-flyout)' },
  { obsidian: '--layer-tooltip', value: 'var(--z-app-popover-flyout)' },
  { obsidian: '--layer-dragged-item', value: 'var(--z-app-popover-flyout)' },
  // Animation
  { obsidian: '--anim-duration-none', value: '0s' },
  { obsidian: '--anim-duration-superfast', value: '0.07s' },
  { obsidian: '--anim-duration-fast', value: '0.14s' },
  { obsidian: '--anim-duration-moderate', value: '0.3s', note: 'MindOS caps motion at 0.3s.' },
  { obsidian: '--anim-duration-slow', value: '0.3s', note: 'Clamped to the MindOS 0.3s ceiling.' },
  { obsidian: '--anim-motion-smooth', value: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)' },
  { obsidian: '--anim-motion-swing', value: 'cubic-bezier(0, 0.55, 0.45, 1)' },
];

/**
 * Structural class names Obsidian puts on host containers. Plugin CSS targets
 * them; compat containers must carry them so scoped `styles.css` matches.
 */
export const OBSIDIAN_HOST_CLASS_NAMES = {
  app: ['app-container', 'mod-macos'],
  workspace: ['workspace', 'mod-root'],
  leaf: ['workspace-leaf', 'mod-active'],
  leafContent: ['workspace-leaf-content'],
  viewHeader: ['view-header'],
  viewContent: ['view-content'],
  markdownPreview: ['markdown-preview-view', 'markdown-rendered', 'node-insert-event', 'is-readable-line-width', 'allow-fold-headings', 'allow-fold-lists'],
  markdownSource: ['markdown-source-view', 'cm-s-obsidian', 'mod-cm6', 'is-live-preview'],
  modal: ['modal'],
  modalContainer: ['modal-container', 'mod-dim'],
  modalTitle: ['modal-title'],
  modalContent: ['modal-content'],
  settingItem: ['setting-item'],
  settingItemInfo: ['setting-item-info'],
  settingItemName: ['setting-item-name'],
  settingItemDescription: ['setting-item-description'],
  settingItemControl: ['setting-item-control'],
  statusBar: ['status-bar'],
  statusBarItem: ['status-bar-item', 'plugin-status-bar-item'],
  ribbon: ['side-dock-ribbon', 'mod-left'],
  ribbonAction: ['side-dock-ribbon-action', 'clickable-icon'],
  notice: ['notice'],
  menu: ['menu'],
  menuItem: ['menu-item'],
  suggestionContainer: ['suggestion-container'],
  suggestionItem: ['suggestion-item'],
} as const;

export type ObsidianHostClassKind = keyof typeof OBSIDIAN_HOST_CLASS_NAMES;

export const OBSIDIAN_THEME_CLASS_NAMES = { light: 'theme-light', dark: 'theme-dark' } as const;

export function obsidianHostClassName(kind: ObsidianHostClassKind, extra: readonly string[] = []): string {
  return [...OBSIDIAN_HOST_CLASS_NAMES[kind], ...extra].join(' ');
}

export function obsidianThemeClassName(isDarkMode: boolean): string {
  return isDarkMode ? OBSIDIAN_THEME_CLASS_NAMES.dark : OBSIDIAN_THEME_CLASS_NAMES.light;
}

const VARIABLE_NAME_RE = /^--[a-z0-9-]+$/;
const FORBIDDEN_VALUE_RE = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

/** Guards the table shape; used by tests and by the builder before emitting CSS. */
export function validateObsidianThemeVariableMap(map: readonly ObsidianThemeVariableMapping[] = OBSIDIAN_THEME_VARIABLE_MAP): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of map) {
    if (!VARIABLE_NAME_RE.test(entry.obsidian)) problems.push(`Invalid variable name: ${entry.obsidian}`);
    if (seen.has(entry.obsidian)) problems.push(`Duplicate mapping: ${entry.obsidian}`);
    seen.add(entry.obsidian);
    if (!entry.value.trim()) problems.push(`Empty value: ${entry.obsidian}`);
    if (FORBIDDEN_VALUE_RE.test(entry.value)) problems.push(`Hard-coded color in ${entry.obsidian}: ${entry.value}`);
    if (/[{};]/.test(entry.value)) problems.push(`Unsafe characters in ${entry.obsidian}: ${entry.value}`);
  }
  return problems;
}

/**
 * Emit the bridge as one scoped rule. Applying it on the plugin scope container
 * means plugin `styles.css` (already scoped by `scopePluginCss`) resolves
 * Obsidian variables to MindOS tokens, and MindOS' own dark theme flips them.
 */
export function buildObsidianThemeBridgeCss(
  scopeSelector: string,
  map: readonly ObsidianThemeVariableMapping[] = OBSIDIAN_THEME_VARIABLE_MAP,
): string {
  const problems = validateObsidianThemeVariableMap(map);
  if (problems.length > 0) {
    throw new Error(`Obsidian theme variable map is invalid: ${problems.join('; ')}`);
  }
  const selector = scopeSelector.trim();
  if (!selector) throw new Error('Theme bridge scope selector is required.');
  const declarations = map.map((entry) => `  ${entry.obsidian}: ${entry.value};`).join('\n');
  return `${selector} {\n${declarations}\n}\n`;
}

export function listObsidianThemeVariables(map: readonly ObsidianThemeVariableMapping[] = OBSIDIAN_THEME_VARIABLE_MAP): string[] {
  return map.map((entry) => entry.obsidian);
}

/** Obsidian variables referenced by a stylesheet that the bridge does not define yet. */
export function findUnmappedObsidianVariables(
  css: string,
  map: readonly ObsidianThemeVariableMapping[] = OBSIDIAN_THEME_VARIABLE_MAP,
): string[] {
  const known = new Set(map.map((entry) => entry.obsidian));
  const referenced = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (match[1]) referenced.add(match[1].toLowerCase());
  }
  // Only variables the stylesheet reads but never defines itself are gaps.
  const defined = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    if (match[1]) defined.add(match[1].toLowerCase());
  }
  return [...referenced].filter((name) => !known.has(name) && !defined.has(name)).sort((a, b) => a.localeCompare(b, 'en'));
}
