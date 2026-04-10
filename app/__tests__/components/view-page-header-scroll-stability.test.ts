import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ViewPageClient header scroll stability', () => {
  it('applies responsive right padding to Header for scrollbar width compensation', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Header must include right-panel-width, right-agent-detail-width, toc-extra-right CSS variables
    // to prevent horizontal shift when scrollbar appears/disappears during TOC scroll
    const headerStyleWithRightPadding = source.includes(
      "paddingRight: 'calc(var(--right-panel-width, 0px) + var(--right-agent-detail-width, 0px) + var(--toc-extra-right, 0px))'"
    );

    expect(headerStyleWithRightPadding).toBe(true);
  });

  it('does not have hardcoded px-6 on Header right padding', () => {
    const filePath = path.resolve(process.cwd(), 'app/view/[...path]/ViewPageClient.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Ensure no hardcoded 1.5rem on header padding right (would defeat CSS var sync)
    const lines = source.split('\n');
    const headerLine = lines.find(
      l => l.includes('sticky') && l.includes('px-4') && l.includes('TopBar') || 
           l.includes('sticky') && l.includes('px-4') && l.includes('top-[52px]')
    );

    if (headerLine && headerLine.includes('paddingRight')) {
      expect(headerLine).not.toMatch(/paddingRight:\s*['"].*1\.5rem.*['"]|paddingRight:\s*['"].*24px.*['"]/);
    }
  });
});
