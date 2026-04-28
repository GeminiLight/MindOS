/**
 * Todo markdown parser and line-level operations.
 * Pure functions — no React, no side effects.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type TodoStatus = 'todo' | 'in-progress' | 'done';
export type Priority = 'P0' | 'P1' | 'P2' | null;
export type DateUrgency = 'overdue' | 'today' | 'soon' | 'future' | null;

export interface TodoMeta {
  priority: Priority;
  dueDate: string | null;
  tags: string[];
}

export interface TodoItem {
  id: string;
  text: string;
  rawText: string;
  status: TodoStatus;
  indent: number;
  lineIndex: number;
  section: string;
  children: TodoItem[];
  meta: TodoMeta;
}

export interface SectionMeta {
  items: TodoItem[];
  lastLineIndex: number;
  headingLineIndex: number;
}

export interface FilterState {
  priority: Priority | 'all';
  tag: string | 'all';
  status: TodoStatus | 'all';
}

// ─── Regex constants ─────────────────────────────────────────────────────────

const H2_SECTION_RE = /^##\s+(.+)/;
const H1_RE = /^#\s+/;
const H3_PLUS_RE = /^#{3,6}\s+(.+)/;
const TODO_RE = /^(\s*)- \[([ xX~])\]\s+(.*)$/;
const PRIORITY_RE = /`(P[012])`/;
const DATE_RE = /`(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})`/;
const TAG_RE = /#([a-zA-Z\u4e00-\u9fff][\w\u4e00-\u9fff-]*)/g;

// ─── Metadata extraction ─────────────────────────────────────────────────────

export function extractMeta(rawText: string): { cleanText: string; meta: TodoMeta } {
  let text = rawText;
  let priority: Priority = null;
  let dueDate: string | null = null;
  const tags: string[] = [];

  const pMatch = text.match(PRIORITY_RE);
  if (pMatch) {
    priority = pMatch[1] as Priority;
    text = text.replace(PRIORITY_RE, '').trim();
  }

  const dMatch = text.match(DATE_RE);
  if (dMatch) {
    dueDate = dMatch[1];
    text = text.replace(DATE_RE, '').trim();
  }

  let tMatch: RegExpExecArray | null;
  const tagRe = new RegExp(TAG_RE.source, 'g');
  while ((tMatch = tagRe.exec(text)) !== null) {
    tags.push(tMatch[1]);
  }
  if (tags.length > 0) {
    text = text.replace(/#[a-zA-Z\u4e00-\u9fff][\w\u4e00-\u9fff-]*/g, '').trim();
  }

  text = text.replace(/\*\*(.*?)\*\*/g, '$1').trim();

  return { cleanText: text, meta: { priority, dueDate, tags } };
}

// ─── Status parsing ──────────────────────────────────────────────────────────

export function parseStatus(checkChar: string): TodoStatus {
  if (checkChar === '~') return 'in-progress';
  if (checkChar.toLowerCase() === 'x') return 'done';
  return 'todo';
}

// ─── Core parser ─────────────────────────────────────────────────────────────

export function parseMarkdownTodos(raw: string): {
  sections: Record<string, SectionMeta>;
  lines: string[];
  sectionOrder: string[];
} {
  const lines = raw.split('\n');
  let currentSection = 'General';
  const sections: Record<string, SectionMeta> = {};
  const sectionOrder: string[] = [];
  const stack: TodoItem[] = [];

  let inFrontmatter = false;
  let frontmatterDone = false;

  lines.forEach((line, lineIndex) => {
    if (!frontmatterDone) {
      if (lineIndex === 0 && line.trim() === '---') { inFrontmatter = true; return; }
      if (inFrontmatter) {
        if (line.trim() === '---') { inFrontmatter = false; frontmatterDone = true; }
        return;
      }
      frontmatterDone = true;
    }

    if (H1_RE.test(line)) return;

    const h2Match = line.match(H2_SECTION_RE);
    if (h2Match) {
      currentSection = h2Match[1].replace(/^[^\w\s\u4e00-\u9fff]+\s*/, '').trim();
      if (!sections[currentSection]) {
        sections[currentSection] = { items: [], lastLineIndex: -1, headingLineIndex: lineIndex };
        sectionOrder.push(currentSection);
      }
      return;
    }

    if (H3_PLUS_RE.test(line)) return;

    const todoMatch = line.match(TODO_RE);
    if (!todoMatch) return;

    const [, indentStr, checkChar, rawText] = todoMatch;
    const indent = Math.floor(indentStr.length / 2);
    const status = parseStatus(checkChar);
    const { cleanText, meta } = extractMeta(rawText);

    const item: TodoItem = {
      id: `${lineIndex}`,
      text: cleanText,
      rawText,
      status,
      indent,
      lineIndex,
      section: currentSection,
      children: [],
      meta,
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (!sections[currentSection]) {
      sections[currentSection] = { items: [], lastLineIndex: -1, headingLineIndex: -1 };
      sectionOrder.push(currentSection);
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(item);
    } else {
      sections[currentSection].items.push(item);
    }

    sections[currentSection].lastLineIndex = Math.max(
      sections[currentSection].lastLineIndex,
      lineIndex,
    );

    stack.push(item);
  });

  return { sections, lines, sectionOrder };
}

// ─── Line operations ─────────────────────────────────────────────────────────

function applyLines(lines: string[], ops: (l: string[]) => void): string {
  const next = [...lines];
  ops(next);
  return next.join('\n');
}

function statusChar(s: TodoStatus): string {
  if (s === 'done') return 'x';
  if (s === 'in-progress') return '~';
  return ' ';
}

export function setStatusInLines(lines: string[], lineIndex: number, status: TodoStatus): string {
  return applyLines(lines, (l) => {
    l[lineIndex] = l[lineIndex].replace(/- \[[ xX~]\]/, `- [${statusChar(status)}]`);
  });
}

export function renameInLines(lines: string[], lineIndex: number, newText: string): string {
  return applyLines(lines, (l) => {
    l[lineIndex] = l[lineIndex].replace(/(- \[[ xX~]\]\s*)(.*)$/, `$1${newText}`);
  });
}

export function deleteInLines(lines: string[], lineIndex: number): string {
  return applyLines(lines, (l) => {
    l.splice(lineIndex, 1);
  });
}

export function addInLines(lines: string[], afterLineIndex: number, text: string): string {
  return applyLines(lines, (l) => {
    const insertAt = afterLineIndex < 0 ? l.length : afterLineIndex + 1;
    l.splice(insertAt, 0, `- [ ] ${text}`);
  });
}

export function cycleStatus(current: TodoStatus): TodoStatus {
  if (current === 'todo') return 'in-progress';
  if (current === 'in-progress') return 'done';
  return 'todo';
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export function resolveDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const now = new Date();
  if (/^\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${now.getFullYear()}-${dateStr}`);
  }
  return new Date(dateStr);
}

export function dateUrgency(dateStr: string | null): DateUrgency {
  const d = resolveDate(dateStr);
  if (!d || isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'future';
}

// ─── Counting ────────────────────────────────────────────────────────────────

export function countByStatus(items: TodoItem[], status: TodoStatus): number {
  return items.reduce((n, item) => n + (item.status === status ? 1 : 0) + countByStatus(item.children, status), 0);
}

export function countTotal(items: TodoItem[]): number {
  return items.reduce((n, item) => n + 1 + countTotal(item.children), 0);
}

export function collectAllTags(sections: Record<string, SectionMeta>): string[] {
  const tagSet = new Set<string>();
  function walk(items: TodoItem[]) {
    for (const item of items) {
      for (const tag of item.meta.tags) tagSet.add(tag);
      walk(item.children);
    }
  }
  for (const meta of Object.values(sections)) walk(meta.items);
  return [...tagSet].sort();
}

export function collectAllPriorities(sections: Record<string, SectionMeta>): Priority[] {
  const pSet = new Set<Priority>();
  function walk(items: TodoItem[]) {
    for (const item of items) {
      if (item.meta.priority) pSet.add(item.meta.priority);
      walk(item.children);
    }
  }
  for (const meta of Object.values(sections)) walk(meta.items);
  const order: Priority[] = ['P0', 'P1', 'P2'];
  return order.filter(p => pSet.has(p));
}

// ─── Filter helpers ──────────────────────────────────────────────────────────

export function matchesFilter(item: TodoItem, filters: FilterState): boolean {
  if (filters.status !== 'all' && item.status !== filters.status) return false;
  if (filters.priority !== 'all' && item.meta.priority !== filters.priority) return false;
  if (filters.tag !== 'all' && !item.meta.tags.includes(filters.tag)) return false;
  return true;
}

export function hasMatchingDescendant(item: TodoItem, filters: FilterState): boolean {
  if (matchesFilter(item, filters)) return true;
  return item.children.some(c => hasMatchingDescendant(c, filters));
}

// ─── Style constants ─────────────────────────────────────────────────────────

export const PRIORITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  P0: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' },
  P1: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' },
  P2: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' },
};

export const DATE_STYLES: Record<string, { text: string; bg: string }> = {
  overdue: { text: 'text-red-500', bg: 'bg-red-500/10' },
  today:   { text: 'text-amber-500', bg: 'bg-amber-500/10' },
  soon:    { text: 'text-amber-400', bg: 'bg-amber-400/5' },
  future:  { text: 'text-muted-foreground', bg: '' },
};

const SECTION_STYLES: Record<string, { dot: string; label: string }> = {
  'TODAY':       { dot: 'bg-red-400',    label: 'text-red-400' },
  'This Week':   { dot: 'bg-orange-400', label: 'text-orange-400' },
  'Workflows':   { dot: 'bg-amber-400',  label: 'text-amber-400' },
  'Backlog':     { dot: 'bg-blue-400',   label: 'text-blue-400' },
  'Done':        { dot: 'bg-emerald-400', label: 'text-emerald-400' },
  'Maintenance': { dot: 'bg-zinc-400',   label: 'text-zinc-400' },
};

export function sectionStyle(name: string) {
  const key = Object.keys(SECTION_STYLES).find(k => name.includes(k));
  return key ? SECTION_STYLES[key] : { dot: 'bg-zinc-500', label: 'text-zinc-400' };
}
