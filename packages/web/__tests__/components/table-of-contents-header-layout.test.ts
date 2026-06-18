import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TableOfContents header layout', () => {
  it('removes the label header so the TOC starts as a quiet edge rail', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("const VIEW_HEADER_CSS_VAR = 'var(--workspace-header-h)';");
    expect(source).toContain('const VIEW_HEADER_FALLBACK_H = 40;');
    expect(source).toContain('className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pt-3 pb-5 pl-2 pr-3 border-l border-border"');
    expect(source).not.toContain('className="flex items-center h-[46px] px-4 border-l border-b border-border"');
    expect(source).not.toContain('font-semibold uppercase tracking-wider');
    expect(source).not.toContain('py-5 pl-2 pr-3 border-l border-border');
  });

  it('keeps collapse state global without publishing layout width to the app shell', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('export function hasTableOfContents(content: string): boolean');
    expect(source).toContain("const TOC_COLLAPSED_KEY = 'mindos.toc.collapsed';");
    expect(source).toContain("const TOC_COLLAPSED_EVENT = 'mindos:toc-collapsed-change';");
    expect(source).toContain('parseHeadings(content)');
    expect(source).toContain('const handleCollapsedToggle = useCallback(() => {');
    expect(source).toContain('onClick={handleCollapsedToggle}');
    expect(source).not.toContain('useLayoutEffect');
    expect(source).not.toContain("setProperty('--toc-width'");
    expect(source).not.toContain("setProperty('--toc-margin'");
    expect(source).not.toContain('removeProperty(\'--toc-width\')');
    expect(source).not.toContain('setCollapsed(value => {');
    expect(source).not.toContain('useDeferredValue');
  });

  it('keeps the TOC handle anchored to a stable right-side lane', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('right: `calc(var(--right-panel-width, 0px) + ${NAV_W}px)`');
    expect(source).not.toContain('right: `calc(var(--right-panel-width, 0px) + ${collapsed ? 0 : NAV_W}px)`');
  });

  it('does not swallow anchor navigation when rendered headings are not yet available', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('findHeadingElementById(headings[idx])');
    expect(source).toContain('if (!el) {\n      setActiveIdx(idx);\n      return;\n    }\n    e.preventDefault();');
    expect(source).not.toContain('const handleClick = (e: React.MouseEvent, idx: number) => {\n    e.preventDefault();');
  });
});
