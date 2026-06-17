import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header scroll stability', () => {
  it('does not duplicate right-side panel compensation already applied by main-content', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // #main-content already compensates for Ask panel / agent detail.
    // Header may reclaim only the TOC reserve so the breadcrumb/action row spans
    // above both the markdown body and TOC, without sliding under right panels.
    expect(source).not.toContain('var(--right-panel-width, 0px)');
    expect(source).not.toContain('var(--right-agent-detail-width, 0px)');
  });

  it('uses TOC width only to extend the topbar over the TOC reserve', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Ensure no hardcoded 1.5rem on header padding right (would defeat CSS var sync)
    const lines = source.split('\n');
    const headerLine = lines.find(
      l => l.includes('sticky') && l.includes('px-4') && l.includes('TopBar') || 
           l.includes('sticky') && l.includes('px-4') && l.includes('top-[52px]')
    );

    expect(source).toContain("width: 'calc(100% + var(--toc-extra-right, 0px))'");
    expect(source).not.toContain("marginRight: 'calc(var(--toc-extra-right, 0px) * -1)'");
    expect(source).not.toContain('view-topbar-border-extension');
    expect(source).not.toMatch(/paddingRight:\s*['\"`][^'\"`]*toc-extra-right/);

    if (headerLine) {
      expect(headerLine).not.toContain('paddingRight');
      expect(headerLine).not.toMatch(/paddingRight:\s*['"].*1\.5rem.*['"]|paddingRight:\s*['"].*24px.*['"]/);
    }
  });
});
