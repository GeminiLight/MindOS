import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header layout', () => {
  it('uses a full-width header row instead of centering actions inside content-width', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('className="view-page-topbar sticky top-[52px] md:top-[var(--app-titlebar-h)] z-20 border-b border-border');
    expect(source).toContain('h-[var(--workspace-header-h)]');
    expect(source).toContain('className="view-header-row w-full min-w-0 flex items-center justify-between gap-3 h-full"');
    expect(source).not.toContain('className="content-width flex items-center justify-between gap-2 h-full"');
    expect(source).not.toContain('h-[46px] flex items-center transition-[width]');
  });

  it('keeps the header independent from the Markdown TOC reserve', () => {
    const viewFile = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const cssFile = path.resolve(process.cwd(), 'app/globals.css');
    const layoutFile = path.resolve(process.cwd(), 'components/SidebarLayout.tsx');
    const viewSource = fs.readFileSync(viewFile, 'utf8');
    const cssSource = fs.readFileSync(cssFile, 'utf8');
    const layoutSource = fs.readFileSync(layoutFile, 'utf8');
    const tocCollapsedBlock = cssSource.match(/\.markdown-view-frame--toc-collapsed \{[^}]*\}/)?.[0] ?? '';
    const tocExpandedBlock = cssSource.match(/\.markdown-view-frame--with-toc \{[^}]*\}/)?.[0] ?? '';

    expect(viewSource).toContain('className="view-header-actions flex items-center gap-1.5 md:gap-2 shrink-0"');
    expect(viewSource).toContain('className="view-header-breadcrumb min-w-0 flex-1 flex items-center gap-1.5"');
    expect(viewSource).toContain('const tocCollapsed = useSyncExternalStore(');
    expect(viewSource).toContain('const markdownTocHeadings = useMemo(() => {');
    expect(viewSource).toContain('const hasMarkdownToc = markdownTocHeadings.length >= 2;');
    expect(viewSource).toContain("'content-width markdown-view-frame markdown-view-frame--with-toc'");
    expect(viewSource).toContain("'content-width markdown-view-frame markdown-view-frame--toc-collapsed'");
    expect(viewSource).toContain('const shouldRenderToc = hasMarkdownToc;');
    expect(viewSource).toContain('data-markdown-view-frame');
    expect(viewSource).toContain("const markdownBodyClassName = 'markdown-view-body';");
    expect(viewSource).not.toContain("width: 'calc(100% + var(--toc-extra-right, 0px))'");
    expect(viewSource).not.toContain("marginRight: 'calc(var(--toc-extra-right, 0px) * -1)'");
    expect(viewSource).not.toContain('toc-reserved-content');
    expect(viewSource).not.toContain('view-topbar-border-extension');
    expect(viewSource).not.toMatch(/paddingRight:\s*['"`][^'"`]*toc-extra-right/);
    expect(viewSource).not.toContain('view-header-actions-reserve');
    expect(layoutSource).not.toContain("overflowX: 'clip'");
    expect(layoutSource).not.toContain('overflowClipMargin');
    expect(layoutSource).toContain('--right-ask-panel-visual-width:');
    expect(layoutSource).toContain('--right-dock-reserved-width:');
    expect(layoutSource).toContain('--right-panel-width: var(--right-dock-reserved-width);');
    expect(layoutSource).toContain('--main-body-content-max-width:');
    expect(layoutSource).toContain('padding-right: var(--right-dock-reserved-width) !important;');
    expect(layoutSource).not.toContain('var(--toc-extra-right');

    expect(cssSource).toContain('max-width: var(--main-body-content-max-width, var(--content-width-override, var(--content-width)))');
    expect(cssSource).toContain('.markdown-view-frame {');
    expect(cssSource).toContain('.markdown-view-frame--with-toc {');
    expect(tocExpandedBlock).toContain('grid-template-columns: minmax(0, 1fr) 212px;');
    expect(tocExpandedBlock).toContain('gap: 1.75rem;');
    expect(cssSource).toContain('.markdown-view-frame--toc-collapsed {');
    expect(tocCollapsedBlock).toContain('grid-template-columns: minmax(0, 1fr) 0;');
    expect(tocCollapsedBlock).toContain('gap: 0;');
    expect(cssSource).not.toContain('.toc-reserved-content');
    expect(cssSource).not.toContain('.view-header-actions-reserve');
    expect(cssSource).not.toContain('.view-header-actions {');
    expect(cssSource).not.toContain('--toc-width');
    expect(cssSource).not.toContain('--toc-extra-right');
    expect(cssSource).not.toContain('top: calc(var(--app-titlebar-h) + 0.4375rem);');
    expect(cssSource).not.toContain('right: calc(var(--right-panel-width, 0px) + var(--right-agent-detail-width, 0px) + 1.5rem);');
  });
});
