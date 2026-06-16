import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TableOfContents header layout', () => {
  it('removes the label header so the TOC starts as a quiet edge rail', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('const TOPBAR_H = 46;');
    expect(source).toContain('className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pt-3 pb-5 pl-2 pr-3 border-l border-border"');
    expect(source).not.toContain('className="flex items-center h-[46px] px-4 border-l border-b border-border"');
    expect(source).not.toContain('font-semibold uppercase tracking-wider');
    expect(source).not.toContain('py-5 pl-2 pr-3 border-l border-border');
  });

  it('syncs TOC width before paint and persists collapse state globally', () => {
    const filePath = path.resolve(process.cwd(), 'components/TableOfContents.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useLayoutEffect');
    expect(source).toContain("const TOC_COLLAPSED_KEY = 'mindos.toc.collapsed';");
    expect(source).toContain("const TOC_COLLAPSED_EVENT = 'mindos:toc-collapsed-change';");
    expect(source).toContain('parseHeadings(content)');
    expect(source).toContain('const handleCollapsedToggle = useCallback(() => {');
    expect(source).toContain('onClick={handleCollapsedToggle}');
    expect(source).not.toContain('setCollapsed(value => {');
    expect(source).not.toContain('useDeferredValue');
  });
});
