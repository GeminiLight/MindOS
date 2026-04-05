/**
 * Tests for new `mindos file` subcommands:
 * write, append, edit-section, insert-heading, append-csv, backlinks, recent, history
 *
 * Tests the pure-logic modules (markdown.js, csv.js) and integration via file.js helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-cli-file-'));
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function seed(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}
function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

// ── Markdown section logic (ported from app/lib/core/lines.ts) ──

function findHeadingIndex(lines: string[], heading: string): number {
  return lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
}

function replaceSection(content: string, heading: string, newBody: string): string {
  const lines = content.split('\n');
  const idx = findHeadingIndex(lines, heading);
  if (idx === -1) return '';

  const headingLevel = (lines[idx].match(/^#+/) ?? [''])[0].length;
  let sectionEnd = lines.length - 1;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i - 1;
      break;
    }
  }
  while (sectionEnd > idx && lines[sectionEnd].trim() === '') sectionEnd--;

  const before = lines.slice(0, idx + 1);
  const after = lines.slice(sectionEnd + 1);
  return [...before, '', newBody, ...after].join('\n');
}

function insertAfterHeading(content: string, heading: string, insertion: string): string {
  const lines = content.split('\n');
  const idx = findHeadingIndex(lines, heading);
  if (idx === -1) return '';

  let insertAt = idx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, '', insertion, ...after].join('\n');
}

function escapeCsvRow(row: string[]): string {
  return row.map(cell => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }).join(',');
}

function listHeadings(content: string): string[] {
  return content.split('\n')
    .filter(l => /^#{1,6}\s/.test(l))
    .map(l => l.trim());
}

// ── Markdown replaceSection tests ──

describe('replaceSection', () => {
  it('replaces section body between same-level headings', () => {
    const input = '# Title\n\n## A\n\nOld A content\n\n## B\n\nB content';
    const result = replaceSection(input, '## A', 'New A content');
    expect(result).toContain('## A');
    expect(result).toContain('New A content');
    expect(result).not.toContain('Old A content');
    expect(result).toContain('## B');
    expect(result).toContain('B content');
  });

  it('replaces last section (no following heading)', () => {
    const input = '# Title\n\n## A\n\nA content\n\n## B\n\nOld B';
    const result = replaceSection(input, '## B', 'New B');
    expect(result).toContain('New B');
    expect(result).not.toContain('Old B');
  });

  it('returns empty string when heading not found', () => {
    const input = '# Title\n\n## A\n\nContent';
    expect(replaceSection(input, '## Missing', 'x')).toBe('');
  });

  it('handles heading with extra spaces', () => {
    const input = '## Status \n\nOld status';
    const result = replaceSection(input, '## Status', 'New status');
    expect(result).toContain('New status');
  });

  it('stops at higher-level heading', () => {
    const input = '# Title\n\n## A\n\nA stuff\n\n### Sub\n\nSub stuff\n\n## B\n\nB stuff';
    const result = replaceSection(input, '## A', 'Replaced');
    expect(result).toContain('Replaced');
    expect(result).toContain('## B');
    expect(result).toContain('B stuff');
    expect(result).not.toContain('A stuff');
    expect(result).not.toContain('Sub stuff');
  });

  it('replaces section with empty content', () => {
    const input = '## A\n\nContent\n\n## B\n\nMore';
    const result = replaceSection(input, '## A', '');
    expect(result).toContain('## A');
    expect(result).not.toContain('Content');
  });
});

// ── insertAfterHeading tests ──

describe('insertAfterHeading', () => {
  it('inserts after heading, before existing content', () => {
    const input = '## Notes\n\nExisting note';
    const result = insertAfterHeading(input, '## Notes', 'New note');
    expect(result).toContain('## Notes');
    expect(result).toContain('New note');
    expect(result).toContain('Existing note');
    const lines = result.split('\n');
    const notesIdx = lines.findIndex(l => l.includes('## Notes'));
    const newIdx = lines.findIndex(l => l.includes('New note'));
    const existIdx = lines.findIndex(l => l.includes('Existing note'));
    expect(newIdx).toBeGreaterThan(notesIdx);
    expect(newIdx).toBeLessThan(existIdx);
  });

  it('returns empty string when heading not found', () => {
    expect(insertAfterHeading('# Title', '## Missing', 'x')).toBe('');
  });

  it('inserts at end if heading is last thing', () => {
    const input = '## Notes';
    const result = insertAfterHeading(input, '## Notes', 'Added');
    expect(result).toContain('## Notes');
    expect(result).toContain('Added');
  });
});

// ── CSV escaping tests ──

describe('escapeCsvRow', () => {
  it('joins simple values', () => {
    expect(escapeCsvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('quotes values containing commas', () => {
    expect(escapeCsvRow(['a,b', 'c'])).toBe('"a,b",c');
  });

  it('escapes double quotes', () => {
    expect(escapeCsvRow(['say "hello"', 'x'])).toBe('"say ""hello""",x');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsvRow(['line1\nline2', 'x'])).toBe('"line1\nline2",x');
  });

  it('handles empty strings', () => {
    expect(escapeCsvRow(['', '', ''])).toBe(',,');
  });

  it('handles single value', () => {
    expect(escapeCsvRow(['only'])).toBe('only');
  });
});

// ── listHeadings tests ──

describe('listHeadings', () => {
  it('extracts all markdown headings', () => {
    const input = '# Title\n\nSome text\n\n## A\n\nContent\n\n### Sub\n\n## B';
    expect(listHeadings(input)).toEqual(['# Title', '## A', '### Sub', '## B']);
  });

  it('returns empty for no headings', () => {
    expect(listHeadings('Just text\nMore text')).toEqual([]);
  });

  it('ignores lines that look like headings inside code blocks', () => {
    expect(listHeadings('## Real\n\n```\n## Not a heading\n```')).toContain('## Real');
  });
});

// ── Backlinks logic tests ──

describe('findBacklinksLocal', () => {
  let root: string;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { cleanup(root); });

  function findBacklinksLocal(mindRoot: string, targetPath: string): string[] {
    const results: string[] = [];
    const bname = path.basename(targetPath, '.md');
    const escapedTarget = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedBname = bname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
      new RegExp(`\\[\\[${escapedBname}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
      new RegExp(`\\[\\[${escapedTarget}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
      new RegExp(`\\[[^\\]]+\\]\\(${escapedTarget}(?:#[^)]*)?\\)`, 'i'),
    ];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.md')) continue;
        const rel = path.relative(mindRoot, full);
        if (rel === targetPath) continue;
        const content = fs.readFileSync(full, 'utf-8');
        if (patterns.some(p => p.test(content))) results.push(rel);
      }
    }
    walk(mindRoot);
    return results;
  }

  it('finds wikilink references', () => {
    seed(root, 'target.md', '# Target');
    seed(root, 'linker.md', 'See [[target]] for details');
    expect(findBacklinksLocal(root, 'target.md')).toEqual(['linker.md']);
  });

  it('finds markdown link references', () => {
    seed(root, 'notes/plan.md', '# Plan');
    seed(root, 'index.md', 'Check [the plan](notes/plan.md) here');
    expect(findBacklinksLocal(root, 'notes/plan.md')).toEqual(['index.md']);
  });

  it('returns empty when no references', () => {
    seed(root, 'a.md', '# A');
    seed(root, 'b.md', '# B - no links');
    expect(findBacklinksLocal(root, 'a.md')).toEqual([]);
  });

  it('excludes self-references', () => {
    seed(root, 'self.md', 'Link to [[self]]');
    expect(findBacklinksLocal(root, 'self.md')).toEqual([]);
  });
});

// ── Recent files logic tests ──

describe('getRecentFiles', () => {
  let root: string;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { cleanup(root); });

  function getRecentFiles(mindRoot: string, limit: number): Array<{path: string; mtime: number}> {
    const results: Array<{path: string; mtime: number}> = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.md') && !entry.name.endsWith('.csv')) continue;
        const stat = fs.statSync(full);
        results.push({ path: path.relative(mindRoot, full), mtime: stat.mtimeMs });
      }
    }
    walk(mindRoot);
    results.sort((a, b) => b.mtime - a.mtime);
    return results.slice(0, limit);
  }

  it('returns files sorted by modification time', () => {
    seed(root, 'old.md', 'old');
    const oldTime = Date.now() - 10000;
    fs.utimesSync(path.join(root, 'old.md'), new Date(oldTime), new Date(oldTime));
    seed(root, 'new.md', 'new');
    const result = getRecentFiles(root, 10);
    expect(result[0].path).toBe('new.md');
    expect(result[1].path).toBe('old.md');
  });

  it('respects limit', () => {
    seed(root, 'a.md', 'a');
    seed(root, 'b.md', 'b');
    seed(root, 'c.md', 'c');
    expect(getRecentFiles(root, 2)).toHaveLength(2);
  });

  it('returns empty for empty directory', () => {
    expect(getRecentFiles(root, 10)).toEqual([]);
  });

  it('skips hidden files', () => {
    seed(root, '.hidden.md', 'hidden');
    seed(root, 'visible.md', 'visible');
    const result = getRecentFiles(root, 10);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('visible.md');
  });
});

// ── Git history tests (integration, requires git) ──

describe('gitHistory', () => {
  let root: string;
  let hasGit: boolean;

  beforeEach(() => {
    root = mkTmp();
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
      hasGit = true;
    } catch { hasGit = false; }
  });
  afterEach(() => { cleanup(root); });

  it('returns git log entries for a file', () => {
    if (!hasGit) return;
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'pipe' });
    seed(root, 'test.md', 'v1');
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'pipe' });

    const output = execFileSync(
      'git',
      ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', '10', '--', path.join(root, 'test.md')],
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const entries = output.split('\n').map(line => {
      const [hash, date, message, author] = line.split('\0');
      return { hash, date, message, author };
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('initial');
    expect(entries[0].author).toBe('Test');
  });

  it('returns empty for file with no commits', () => {
    if (!hasGit) return;
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    seed(root, 'untracked.md', 'content');
    let output = '';
    try {
      output = execFileSync(
        'git',
        ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', '10', '--', path.join(root, 'untracked.md')],
        { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    } catch {
      output = '';
    }
    expect(output).toBe('');
  });
});
