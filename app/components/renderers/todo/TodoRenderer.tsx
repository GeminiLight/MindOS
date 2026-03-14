'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CheckSquare, Square, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Parser ──────────────────────────────────────────────────────────────────

interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  indent: number;
  lineIndex: number;
  section: string;
  children: TodoItem[];
}

interface SectionMeta {
  items: TodoItem[];
  lastLineIndex: number; // line index of the last todo in this section (for append)
}

const SECTION_RE = /^#{1,6}\s+(.+)/;
const TODO_RE = /^(\s*)- \[([ xX])\]\s+(.*)$/;

function parseMarkdownTodos(raw: string): {
  sections: Record<string, SectionMeta>;
  lines: string[];
} {
  const lines = raw.split('\n');
  let currentSection = 'General';
  const sections: Record<string, SectionMeta> = {};
  const stack: TodoItem[] = [];

  lines.forEach((line, lineIndex) => {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = sectionMatch[1].replace(/^[^\w\s]+\s*/, '').trim();
      return;
    }

    const todoMatch = line.match(TODO_RE);
    if (!todoMatch) return;

    const [, indentStr, checkChar, rawText] = todoMatch;
    const indent = Math.floor(indentStr.length / 2);
    const checked = checkChar.toLowerCase() === 'x';
    const text = rawText.replace(/\*\*(.*?)\*\*/g, '$1').trim();

    const item: TodoItem = {
      id: `${lineIndex}`,
      text,
      checked,
      indent,
      lineIndex,
      section: currentSection,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (!sections[currentSection]) {
      sections[currentSection] = { items: [], lastLineIndex: -1 };
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(item);
    } else {
      sections[currentSection].items.push(item);
    }

    // Track the furthest line in this section
    sections[currentSection].lastLineIndex = Math.max(
      sections[currentSection].lastLineIndex,
      lineIndex,
    );

    stack.push(item);
  });

  return { sections, lines };
}

function applyLines(lines: string[], ops: (l: string[]) => void): string {
  const next = [...lines];
  ops(next);
  return next.join('\n');
}

function toggleInLines(lines: string[], lineIndex: number, checked: boolean): string {
  return applyLines(lines, (l) => {
    l[lineIndex] = checked
      ? l[lineIndex].replace(/- \[ \]/, '- [x]')
      : l[lineIndex].replace(/- \[[xX]\]/, '- [ ]');
  });
}

function renameInLines(lines: string[], lineIndex: number, newText: string): string {
  return applyLines(lines, (l) => {
    l[lineIndex] = l[lineIndex].replace(/(- \[[ xX]\]\s*)(.*)$/, `$1${newText}`);
  });
}

function deleteInLines(lines: string[], lineIndex: number): string {
  return applyLines(lines, (l) => {
    l.splice(lineIndex, 1);
  });
}

function addInLines(lines: string[], afterLineIndex: number, text: string): string {
  return applyLines(lines, (l) => {
    const insertAt = afterLineIndex < 0 ? l.length : afterLineIndex + 1;
    l.splice(insertAt, 0, `- [ ] ${text}`);
  });
}

// ─── Components ──────────────────────────────────────────────────────────────

const SECTION_STYLES: Record<string, { dot: string; label: string }> = {
  'TODAY':       { dot: 'bg-red-400',    label: 'text-red-400' },
  'Workflows':   { dot: 'bg-amber-400',  label: 'text-amber-400' },
  'Backlog':     { dot: 'bg-blue-400',   label: 'text-blue-400' },
  'Maintenance': { dot: 'bg-zinc-400',   label: 'text-zinc-400' },
};

function sectionStyle(name: string) {
  const key = Object.keys(SECTION_STYLES).find(k => name.includes(k));
  return key ? SECTION_STYLES[key] : { dot: 'bg-zinc-500', label: 'text-zinc-400' };
}

function countDone(items: TodoItem[]): number {
  return items.reduce((n, item) => n + (item.checked ? 1 : 0) + countDone(item.children), 0);
}

function countTotal(items: TodoItem[]): number {
  return items.reduce((n, item) => n + 1 + countTotal(item.children), 0);
}

// ─── Inline editable text ────────────────────────────────────────────────────

function InlineText({
  text,
  checked,
  onRename,
}: {
  text: string;
  checked: boolean;
  onRename: (newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(text); }, [text]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== text) onRename(trimmed);
    else setValue(text);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setValue(text); setEditing(false); }
        }}
        className="flex-1 bg-transparent border-b text-sm leading-relaxed outline-none min-w-0"
        style={{ borderColor: 'var(--amber)', color: 'var(--foreground)' }}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={`flex-1 text-sm leading-relaxed cursor-text min-w-0 ${checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit"
    >
      {text}
    </span>
  );
}

// ─── Add item input ───────────────────────────────────────────────────────────

function AddItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  function commit() {
    const trimmed = value.trim();
    if (trimmed) onAdd(trimmed);
    setValue('');
    setActive(false);
  }

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-muted/60 mt-1"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <Plus size={12} />
        <span>Add item</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mt-1">
      <span className="w-[13px] shrink-0" />
      <span className="shrink-0" style={{ color: 'var(--muted-foreground)' }}>
        <Square size={15} />
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setValue(''); setActive(false); }
        }}
        placeholder="New item…"
        className="flex-1 bg-transparent border-b text-sm outline-none"
        style={{ borderColor: 'var(--amber)', color: 'var(--foreground)' }}
      />
    </div>
  );
}

// ─── Todo item row ────────────────────────────────────────────────────────────

function TodoItemRow({
  item,
  depth,
  onToggle,
  onRename,
  onDelete,
}: {
  item: TodoItem;
  depth: number;
  onToggle: (lineIndex: number, checked: boolean) => void;
  onRename: (lineIndex: number, newText: string) => void;
  onDelete: (lineIndex: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = item.children.length > 0;

  return (
    <div>
      <div
        className={`group flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors hover:bg-muted/60 ${item.checked ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen(v => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}

        <button
          onClick={() => onToggle(item.lineIndex, !item.checked)}
          className="shrink-0 transition-colors"
          style={{ color: item.checked ? 'var(--amber)' : 'var(--muted-foreground)' }}
        >
          {item.checked ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>

        <InlineText
          text={item.text}
          checked={item.checked}
          onRename={(newText) => onRename(item.lineIndex, newText)}
        />

        <button
          onClick={() => onDelete(item.lineIndex)}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10"
          style={{ color: 'var(--muted-foreground)' }}
          title="Delete item"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {hasChildren && open && (
        <div>
          {item.children.map(child => (
            <TodoItemRow
              key={child.id}
              item={child}
              depth={depth + 1}
              onToggle={onToggle}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  name,
  meta,
  onToggle,
  onRename,
  onDelete,
  onAdd,
}: {
  name: string;
  meta: SectionMeta;
  onToggle: (lineIndex: number, checked: boolean) => void;
  onRename: (lineIndex: number, newText: string) => void;
  onDelete: (lineIndex: number) => void;
  onAdd: (afterLineIndex: number, text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const style = sectionStyle(name);
  const { items, lastLineIndex } = meta;
  const done = countDone(items);
  const total = countTotal(items);

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${style.label} font-display`}>
            {name}
          </span>
          <span className="text-xs text-muted-foreground">{done}/{total}</span>
        </div>
        {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      <div className="h-0.5 bg-muted mx-4">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: total ? `${(done / total) * 100}%` : '0%', background: 'var(--amber)' }}
        />
      </div>

      {!collapsed && (
        <div className="px-2 py-2">
          {items.map(item => (
            <TodoItemRow
              key={item.id}
              item={item}
              depth={0}
              onToggle={onToggle}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-2">No items</p>
          )}
          <AddItemRow onAdd={(text) => onAdd(lastLineIndex, text)} />
        </div>
      )}
    </div>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function TodoRenderer({ content, saveAction }: RendererContext) {
  const [localContent, setLocalContent] = useState(content);

  const { sections, lines } = useMemo(
    () => parseMarkdownTodos(localContent),
    [localContent],
  );

  const totalDone = useMemo(
    () => Object.values(sections).reduce((n, m) => n + countDone(m.items), 0),
    [sections],
  );
  const totalItems = useMemo(
    () => Object.values(sections).reduce((n, m) => n + countTotal(m.items), 0),
    [sections],
  );

  const persist = useCallback(async (next: string) => {
    setLocalContent(next);
    await saveAction(next);
  }, [saveAction]);

  const handleToggle = useCallback(async (lineIndex: number, checked: boolean) => {
    await persist(toggleInLines(lines, lineIndex, checked));
  }, [lines, persist]);

  const handleRename = useCallback(async (lineIndex: number, newText: string) => {
    await persist(renameInLines(lines, lineIndex, newText));
  }, [lines, persist]);

  const handleDelete = useCallback(async (lineIndex: number) => {
    await persist(deleteInLines(lines, lineIndex));
  }, [lines, persist]);

  const handleAdd = useCallback(async (afterLineIndex: number, text: string) => {
    await persist(addInLines(lines, afterLineIndex, text));
  }, [lines, persist]);

  const sectionEntries = Object.entries(sections);

  return (
    <div className="max-w-[900px] mx-auto xl:mr-[220px] px-0 py-2">
      {/* Summary header */}
      <div className="mb-6">
        <p className="text-xs text-muted-foreground font-display">
          {totalDone} / {totalItems} completed
        </p>
        <div className="mt-1.5 w-48 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: totalItems ? `${(totalDone / totalItems) * 100}%` : '0%', background: 'var(--amber)' }}
          />
        </div>
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {sectionEntries.map(([name, meta]) => (
          <SectionCard
            key={name}
            name={name}
            meta={meta}
            onToggle={handleToggle}
            onRename={handleRename}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        ))}
        {sectionEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">No TODO items found in this file.</p>
        )}
      </div>
    </div>
  );
}
