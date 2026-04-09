'use client';

import { useState, useRef, useEffect } from 'react';
import {
  CheckSquare, Square, ChevronDown, ChevronRight, Plus, Trash2,
  Circle, Clock, Calendar,
} from 'lucide-react';
import type { TodoStatus, Priority, TodoItem, SectionMeta, FilterState } from '@/lib/parsing/parse-todos';
import {
  cycleStatus, dateUrgency, countByStatus, countTotal,
  sectionStyle, matchesFilter, hasMatchingDescendant,
  PRIORITY_STYLES, DATE_STYLES,
} from '@/lib/parsing/parse-todos';

// ─── Badge & icon components ─────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Priority }) {
  if (!priority) return null;
  const s = PRIORITY_STYLES[priority];
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-mono font-semibold leading-4 border shrink-0 ${s.bg} ${s.text} ${s.border}`}>
      {priority}
    </span>
  );
}

function DueDateBadge({ dateStr, status }: { dateStr: string | null; status: TodoStatus }) {
  if (!dateStr || status === 'done') return null;
  const urgency = dateUrgency(dateStr);
  if (!urgency) return null;
  const s = DATE_STYLES[urgency];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] leading-4 shrink-0 ${s.text} ${s.bg}`}>
      <Calendar size={9} />
      {dateStr}
    </span>
  );
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] leading-4 text-muted-foreground bg-muted/60 shrink-0">
      #{tag}
    </span>
  );
}

function StatusIcon({ status, onClick }: { status: TodoStatus; onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 transition-colors" title="Click to cycle status">
      {status === 'done' && (
        <CheckSquare size={15} style={{ color: 'var(--amber)' }} />
      )}
      {status === 'in-progress' && (
        <Circle size={15} className="text-amber-500 fill-amber-500/20" />
      )}
      {status === 'todo' && (
        <Square size={15} style={{ color: 'var(--muted-foreground)' }} />
      )}
    </button>
  );
}

// ─── Inline editable text ────────────────────────────────────────────────────

function InlineText({
  text,
  status,
  onRename,
}: {
  text: string;
  status: TodoStatus;
  onRename: (newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(text); }, [text]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

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
      className={`flex-1 text-sm leading-relaxed cursor-text min-w-0 ${
        status === 'done'
          ? 'line-through text-muted-foreground'
          : 'text-foreground'
      }`}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit"
    >
      {text}
    </span>
  );
}

// ─── Add item input ──────────────────────────────────────────────────────────

function AddItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

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
        placeholder="New item… (supports `P0` `03-28` #tag)"
        className="flex-1 bg-transparent border-b text-sm outline-none"
        style={{ borderColor: 'var(--amber)', color: 'var(--foreground)' }}
      />
    </div>
  );
}

// ─── Todo item row (recursive) ───────────────────────────────────────────────

function TodoItemRow({
  item,
  depth,
  filters,
  onCycleStatus,
  onRename,
  onDelete,
}: {
  item: TodoItem;
  depth: number;
  filters: FilterState;
  onCycleStatus: (lineIndex: number, newStatus: TodoStatus) => void;
  onRename: (lineIndex: number, newText: string) => void;
  onDelete: (lineIndex: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = item.children.length > 0;
  const selfMatch = matchesFilter(item, filters);
  const childMatch = item.children.some(c => hasMatchingDescendant(c, filters));
  const noFilter = filters.status === 'all' && filters.priority === 'all' && filters.tag === 'all';

  if (!noFilter && !selfMatch && !childMatch) return null;

  const urgency = dateUrgency(item.meta.dueDate);

  return (
    <div>
      <div
        className={`group flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors hover:bg-muted/60 ${
          item.status === 'done' ? 'opacity-45' : ''
        } ${urgency === 'overdue' && item.status !== 'done' ? 'bg-red-500/[0.03]' : ''}`}
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

        <StatusIcon
          status={item.status}
          onClick={() => onCycleStatus(item.lineIndex, cycleStatus(item.status))}
        />

        <InlineText
          text={item.text}
          status={item.status}
          onRename={(newText) => onRename(item.lineIndex, newText)}
        />

        <div className="flex items-center gap-1 shrink-0">
          <PriorityBadge priority={item.meta.priority} />
          <DueDateBadge dateStr={item.meta.dueDate} status={item.status} />
          {item.meta.tags.map(tag => <TagBadge key={tag} tag={tag} />)}
        </div>

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
              filters={filters}
              onCycleStatus={onCycleStatus}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section card ────────────────────────────────────────────────────────────

export default function SectionCard({
  name,
  meta,
  filters,
  defaultCollapsed,
  onCycleStatus,
  onRename,
  onDelete,
  onAdd,
}: {
  name: string;
  meta: SectionMeta;
  filters: FilterState;
  defaultCollapsed?: boolean;
  onCycleStatus: (lineIndex: number, newStatus: TodoStatus) => void;
  onRename: (lineIndex: number, newText: string) => void;
  onDelete: (lineIndex: number) => void;
  onAdd: (afterLineIndex: number, text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const style = sectionStyle(name);
  const { items, lastLineIndex } = meta;
  const done = countByStatus(items, 'done');
  const inProgress = countByStatus(items, 'in-progress');
  const total = countTotal(items);
  const isDoneSection = name.includes('Done');

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
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{total}
          </span>
          {inProgress > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
              <Clock size={9} /> {inProgress}
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronRight size={14} className="text-muted-foreground" />
          : <ChevronDown size={14} className="text-muted-foreground" />
        }
      </button>

      <div className="h-0.5 bg-muted mx-4">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: total ? `${(done / total) * 100}%` : '0%',
            background: isDoneSection ? 'var(--success, #22c55e)' : 'var(--amber)',
          }}
        />
      </div>

      {!collapsed && (
        <div className="px-2 py-2">
          {items.map(item => (
            <TodoItemRow
              key={item.id}
              item={item}
              depth={0}
              filters={filters}
              onCycleStatus={onCycleStatus}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-2">No items</p>
          )}
          {!isDoneSection && (
            <AddItemRow onAdd={(text) => onAdd(lastLineIndex, text)} />
          )}
        </div>
      )}
    </div>
  );
}
