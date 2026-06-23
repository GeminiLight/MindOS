import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Repo-wide geometry contract for the fixed titlebar row (spec-titlebar-row,
 * 实现调整记录 12/13).
 *
 * #main-content gets `padding-top: var(--app-titlebar-h)` (42px on desktop),
 * and `.titlebar-row` is `fixed top-0 z-30`. Two recurring bug classes follow:
 *
 *  A. Any element in normal document flow sized with a bare full-viewport
 *     height (min-h-screen / h-[100dvh] / ...) makes the document a titlebar row taller
 *     than the window. Scrolling that slack slides content underneath the
 *     fixed row, which then swallows its clicks (user-reported three times:
 *     chat focus-mode header, /view breadcrumb, Edit/Source/View toggle).
 *
 *  B. Any element that sticks to the *document* scroll with `top-0` on
 *     desktop pins itself at viewport y=0 — underneath the fixed row.
 *
 * These tests scan the full source tree so a new offender fails CI instead of
 * shipping. If you genuinely need a full-viewport element (fixed overlay that
 * is *supposed* to cover the row, or a border-box container whose padding
 * already absorbs the offset), add it to the allowlist with a reason.
 */

const webRoot = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks'];

// Bare full-viewport heights. calc(100vh - var(--app-titlebar-h)) and
// max-h-* variants do not match.
const BARE_VIEWPORT_HEIGHT =
  /(?<![-\w])(?:min-h-screen|h-screen|min-h-\[100[ds]?vh\]|h-\[100[ds]?vh\]|min-h-dvh|h-dvh|min-h-svh|h-svh)(?![-\w])/;

// file (relative to packages/web) -> why a bare viewport height is legal there
const VIEWPORT_HEIGHT_ALLOWLIST: Record<string, string> = {
  'components/ActivityBar.tsx':
    'fixed rail intentionally spans the full viewport — its logo row lives inside the titlebar row',
  'components/SidebarLayout.tsx':
    '#main-content is border-box, so min-h-screen already includes its titlebar padding; the mobile drawer is a fixed overlay',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function scanSources(): { file: string; rel: string; lines: string[] }[] {
  return SCAN_DIRS.flatMap(dir =>
    walk(path.join(webRoot, dir)).map(file => ({
      file,
      rel: path.relative(webRoot, file).split(path.sep).join('/'),
      lines: readFileSync(file, 'utf-8').split('\n'),
    })),
  );
}

describe('titlebar geometry contract (no content may slide under the fixed row)', () => {
  const sources = scanSources();

  it('no bare full-viewport heights outside the allowlist', () => {
    const violations: string[] = [];
    for (const { rel, lines } of sources) {
      if (rel in VIEWPORT_HEIGHT_ALLOWLIST) continue;
      lines.forEach((line, i) => {
        if (BARE_VIEWPORT_HEIGHT.test(line)) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      violations,
      `Bare full-viewport heights overflow the document by var(--app-titlebar-h) and let ` +
        `content scroll under the fixed titlebar row. Use ` +
        `h-[calc(100dvh-var(--app-titlebar-h))] / min-h-[calc(100vh-var(--app-titlebar-h))] ` +
        `instead, or add an allowlist entry with a reason:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('allowlist entries still exist (no stale exemptions)', () => {
    for (const rel of Object.keys(VIEWPORT_HEIGHT_ALLOWLIST)) {
      const found = sources.find(s => s.rel === rel);
      expect(found, `${rel} is allowlisted but no longer exists — remove the entry`).toBeDefined();
      expect(
        found!.lines.some(line => BARE_VIEWPORT_HEIGHT.test(line)),
        `${rel} is allowlisted but no longer uses a bare viewport height — remove the entry`,
      ).toBe(true);
    }
  });

  it('no document-scroll sticky pins itself at md:top-0 (underneath the fixed row)', () => {
    const violations: string[] = [];
    for (const { rel, lines } of sources) {
      lines.forEach((line, i) => {
        if (line.includes('sticky') && /(?:md|lg|xl):top-0(?![-\w.])/.test(line)) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      violations,
      `On desktop the titlebar row occupies viewport y 0–var(--app-titlebar-h); a responsive sticky ` +
        `top-0 sticks underneath it and its top edge becomes unclickable. ` +
        `Use top-[var(--app-titlebar-h)] (plus any extra offset) instead:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('known document-scroll sticky headers offset by var(--app-titlebar-h)', () => {
    // These stick against the *document* scroll (no overflow ancestor), so
    // their top value is in viewport coordinates and must clear the fixed row.
    // Sticky top-0 inside inner overflow-y-auto containers is fine and not listed.
    const registry: Record<string, string[]> = {
      'app/view/[...path]/ViewPageClient.tsx': ['sticky top-[52px] md:top-[var(--app-titlebar-h)]'],
      'components/DirView.tsx': ['sticky top-[52px] md:top-[var(--app-titlebar-h)]'],
      // floats just below the shared /view header
      'components/FindInPage.tsx': ['sticky top-[calc(52px+var(--workspace-header-h))] md:top-[calc(var(--app-titlebar-h)+var(--workspace-header-h))]'],
      // 24px breathing room below the row (was top-[70px] pre-titlebar)
      'components/InboxView.tsx': ['lg:sticky lg:top-[calc(var(--app-titlebar-h)+24px)]'],
      // help TOC (was top-24 = 96px)
      'components/help/HelpContent.tsx': ['sticky top-[calc(var(--app-titlebar-h)+50px)]'],
    };
    for (const [rel, expectedSnippets] of Object.entries(registry)) {
      const src = readFileSync(path.join(webRoot, rel), 'utf-8');
      for (const snippet of expectedSnippets) {
        expect(src, `${rel} must contain "${snippet}"`).toContain(snippet);
      }
    }
  });

  it('floating changes banner clears and layers above the fixed titlebar row', () => {
    const src = readFileSync(path.join(webRoot, 'components/changes/ChangesBanner.tsx'), 'utf-8');

    expect(src).toContain('top-[calc(var(--app-titlebar-h)+60px)]');
    expect(src).toContain('md:top-[calc(var(--app-titlebar-h)+12px)]');
    expect(src).toContain('z-app-popover');
    expect(src).not.toContain('md:top-4 z-30');
  });
});
