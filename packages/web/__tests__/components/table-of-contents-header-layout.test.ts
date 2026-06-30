import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TableOfContents header layout', () => {
  it('renders as an inline sticky rail owned by the Markdown page layout', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("const VIEW_HEADER_CSS_VAR = 'var(--workspace-header-h)';");
    expect(source).toContain('const VIEW_HEADER_FALLBACK_H = 40;');
    expect(source).toContain('data-markdown-toc-panel');
    expect(source).toContain('hidden xl:flex min-w-0 flex-col z-app-sticky overflow-visible');
    expect(source).toContain('self-start sticky relative');
    expect(source).toContain('data-markdown-toc-toggle');
    expect(source).not.toContain("'absolute right-0 top-0 h-8 w-0'");
    expect(source).toContain('collapsed ? \'left-0 rounded-md\' : \'-left-7 rounded-l-md border-r-0\'');
    expect(source).not.toContain("'right-0 w-7 rounded-md shadow-sm'");
    expect(source).not.toContain('className="flex items-center h-[46px] px-4 border-l border-b border-border"');
    expect(source).not.toContain('className="flex h-9 shrink-0 items-center justify-end border-l border-border bg-background/95 pl-2 pr-2"');
    expect(source).not.toContain('className="hidden xl:flex fixed');
    expect(source).not.toContain('font-semibold uppercase tracking-wider');
  });

  it('publishes collapse state so the page layout can release the reserved TOC lane', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('export function hasTableOfContents(content: string): boolean');
    expect(source).not.toContain('const TOC_COLLAPSED_W');
    expect(source).toContain('width: collapsed ? 0 : NAV_W');
    expect(source).toContain("export const TOC_COLLAPSED_KEY = 'mindos.toc.collapsed';");
    expect(source).toContain("export const TOC_COLLAPSED_EVENT = 'mindos:toc-collapsed-change';");
    expect(source).toContain('export function readTableOfContentsCollapsed(): boolean');
    expect(source).toContain('export function subscribeTableOfContentsCollapsed(callback: () => void): () => void');
    expect(source).toContain('export function parseTableOfContentsHeadings(content: string)');
    expect(source).toContain('const h = providedHeadings ?? parseTableOfContentsHeadings(content);');
    expect(source).toContain('const handleCollapsedToggle = useCallback(() => {');
    expect(source).toContain('onClick={handleCollapsedToggle}');
    expect(source).not.toContain('useLayoutEffect');
    expect(source).not.toContain("setProperty('--toc-width'");
    expect(source).not.toContain("setProperty('--toc-margin'");
    expect(source).not.toContain('removeProperty(\'--toc-width\')');
    expect(source).not.toContain('setCollapsed(value => {');
    expect(source).not.toContain('useDeferredValue');
  });

  it('keeps the TOC handle inside the rail instead of floating as a viewport button', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('data-markdown-toc-toggle');
    expect(source).toContain("'absolute top-12 z-10 flex h-8 items-center justify-center");
    expect(source).toContain("'w-7 shadow-sm'");
    expect(source).toContain("collapsed ? 'left-0 rounded-md' : '-left-7 rounded-l-md border-r-0'");
    expect(source).toContain('const toggleLabel = collapsed ? t.view.tocExpandLabel : t.view.tocCollapseLabel;');
    expect(source).toContain('aria-label={toggleLabel}');
    expect(source).toContain('title={toggleLabel}');
    expect(source).toContain('PanelRightOpen');
    expect(source).toContain('PanelRightClose');
    expect(source).not.toContain('t.view.tocCompactLabel');
    expect(source).not.toContain('TableOfContentsIcon');
    expect(source).not.toContain('writing-mode:vertical-rl');
    expect(source).toContain('aria-expanded={!collapsed}');
    expect(source).not.toContain('className="hidden xl:flex fixed');
    expect(source).not.toContain('right: `calc(var(--right-panel-width, 0px) + ${NAV_W}px)`');
    expect(source).not.toContain('right: `calc(var(--right-panel-width, 0px) + ${collapsed ? 0 : NAV_W}px)`');
  });

  it('does not swallow anchor navigation when rendered headings are not yet available', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('findHeadingElementById(headings[idx])');
    expect(source).toContain('if (!el) {\n      setActiveIdx(idx);\n      return;\n    }\n    e.preventDefault();');
    expect(source).not.toContain('const handleClick = (e: React.MouseEvent, idx: number) => {\n    e.preventDefault();');
  });

  it('keeps automatic TOC active-link tracking confined to the TOC nav', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('scrollTocLinkIntoNavView(link, nav)');
    expect(source).toContain("nav.scrollTo({ top: nextTop, behavior: 'auto' });");
    expect(source).not.toContain('link.scrollIntoView');
  });
});
