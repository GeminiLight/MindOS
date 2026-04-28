import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header scroll stability', () => {
  it('does not duplicate right-side panel compensation already applied by main-content', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // #main-content already compensates for Ask panel / agent detail / TOC.
    // Header must not apply a second right-padding, or breadcrumb/actions get squeezed.
    expect(source).not.toContain('var(--right-panel-width, 0px)');
    expect(source).not.toContain('var(--right-agent-detail-width, 0px)');
  });

  it('does not depend on TOC width or any inline Header right padding', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Ensure no hardcoded 1.5rem on header padding right (would defeat CSS var sync)
    const lines = source.split('\n');
    const headerLine = lines.find(
      l => l.includes('sticky') && l.includes('px-4') && l.includes('TopBar') || 
           l.includes('sticky') && l.includes('px-4') && l.includes('top-[52px]')
    );

    expect(source).not.toContain('var(--toc-extra-right, 0px)');

    if (headerLine) {
      expect(headerLine).not.toContain('paddingRight');
      expect(headerLine).not.toMatch(/paddingRight:\s*['"].*1\.5rem.*['"]|paddingRight:\s*['"].*24px.*['"]/);
    }
  });
});
