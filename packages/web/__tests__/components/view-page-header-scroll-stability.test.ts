import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header scroll stability', () => {
  it('does not duplicate right-side panel compensation already applied by main-content', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // #main-content already compensates for Ask panel / agent detail.
    // The header itself should not duplicate those offsets.
    expect(source).not.toContain('var(--right-panel-width, 0px)');
    expect(source).not.toContain('var(--right-agent-detail-width, 0px)');
  });

  it('keeps TOC reserve out of the topbar so header actions do not jump', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Ensure no hardcoded 1.5rem on header padding right (would defeat CSS var sync)
    const lines = source.split('\n');
    const headerLine = lines.find(
      l => l.includes('sticky') && l.includes('px-4') && l.includes('TopBar') || 
           l.includes('sticky') && l.includes('px-4') && l.includes('top-[52px]')
    );

    expect(source).toContain('className="view-page-topbar sticky top-[52px] md:top-0 z-20 border-b border-border');
    expect(source).toContain('className={markdownFrameClassName}');
    expect(source).toContain('markdown-view-frame--with-toc');
    expect(source).toContain('markdown-view-frame--toc-collapsed');
    expect(source).not.toContain('toc-reserved-content');
    expect(source).not.toContain("width: 'calc(100% + var(--toc-extra-right, 0px))'");
    expect(source).not.toContain("marginRight: 'calc(var(--toc-extra-right, 0px) * -1)'");
    expect(source).not.toContain('view-topbar-border-extension');
    expect(source).not.toMatch(/paddingRight:\s*['\"`][^'\"`]*toc-extra-right/);
    expect(source).not.toContain('transition-[width]');

    if (headerLine) {
      expect(headerLine).not.toContain('paddingRight');
      expect(headerLine).not.toMatch(/paddingRight:\s*['"].*1\.5rem.*['"]|paddingRight:\s*['"].*24px.*['"]/);
    }
  });

  it('does not refresh the current view for content saves emitted by itself', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('const selfSavedPathsRef = useRef<Set<string>>(new Set());');
    expect(source).toContain('const notifySelfSavedFile = useCallback((targetPath = filePath) => {');
    expect(source).toContain('selfSavedPathsRef.current.add(targetPath);');
    expect(source).toContain('if (paths && isPathAffected(paths, filePath) && selfSavedPathsRef.current.delete(filePath)) return;');
  });

  it('preserves reading scroll when a generic files-changed event refreshes the current view', () => {
    const viewPath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const sidebarPath = path.resolve(process.cwd(), 'components/SidebarLayout.tsx');
    const viewSource = fs.readFileSync(viewPath, 'utf8');
    const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');

    expect(viewSource).toContain("import { refreshPreservingDocumentScroll } from '@/lib/scroll-preservation';");
    expect(viewSource).toContain('refreshCurrentView({ preserveScroll: paths === undefined });');
    expect(sidebarSource).toContain("import { refreshPreservingDocumentScroll } from '@/lib/scroll-preservation';");
    expect(sidebarSource).toContain('refreshPreservingDocumentScroll(() => router.refresh());');
  });
});
