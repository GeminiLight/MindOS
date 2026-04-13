'use client';

import { useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Search, FolderOpen, BookOpen, Pencil, FilePlus, FileText, Pin, Trash2,
  ArrowRightLeft, Link2, History, Clock, Table, Globe, Wrench as WrenchIcon,
} from 'lucide-react';
import type { ToolCallPart } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'move_file', 'rename_file', 'write_file']);

const DIFF_TOOLS = new Set([
  'write_file', 'create_file', 'update_section',
  'insert_after_heading', 'edit_lines', 'append_to_file',
]);

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Globe,
  search: Search,
  list_files: FolderOpen,
  read_file: BookOpen,
  write_file: Pencil,
  create_file: FilePlus,
  append_to_file: FileText,
  insert_after_heading: Pin,
  update_section: Pencil,
  delete_file: Trash2,
  rename_file: FileText,
  move_file: ArrowRightLeft,
  get_backlinks: Link2,
  get_history: History,
  get_file_at_version: History,
  get_recent: Clock,
  append_csv: Table,
};

function formatInput(input: unknown): string {
  if (!input || typeof input !== 'object') return String(input ?? '');
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const val of Object.values(obj)) {
    if (typeof val === 'string') {
      parts.push(val.length > 60 ? `${val.slice(0, 60)}…` : val);
    } else if (Array.isArray(val)) {
      parts.push(`[${val.length} items]`);
    } else if (val !== undefined && val !== null) {
      parts.push(String(val));
    }
  }
  return parts.join(', ');
}

const CHANGES_SEPARATOR = '--- changes ---';

/** Parse tool output: extract header line (before separator) and diff lines (after separator) */
function parseToolOutput(output: string | undefined): { header: string; stats: string; diffLines: { prefix: string; text: string }[] } {
  if (!output) return { header: '', stats: '', diffLines: [] };
  const sepIdx = output.indexOf(CHANGES_SEPARATOR);
  if (sepIdx === -1) return { header: output, stats: '', diffLines: [] };

  const header = output.slice(0, sepIdx).trim();
  const diffText = output.slice(sepIdx + CHANGES_SEPARATOR.length).trim();

  // Extract stats from header, e.g. "File written: foo.md (+3 −1)"
  const statsMatch = header.match(/\((\+\d+\s*−\d+)\)/);
  const stats = statsMatch ? statsMatch[1] : '';

  const diffLines = diffText.split('\n').map(line => {
    if (line.startsWith('+ ')) return { prefix: '+', text: line.slice(2) };
    if (line.startsWith('- ')) return { prefix: '-', text: line.slice(2) };
    if (line.startsWith('  ')) return { prefix: ' ', text: line.slice(2) };
    // gap or other
    return { prefix: ' ', text: line };
  });

  return { header, stats, diffLines };
}

export default function ToolCallBlock({ part }: { part: ToolCallPart }) {
  const hasDiff = DIFF_TOOLS.has(part.toolName);
  const isDone = part.state === 'done';
  // Auto-expand diff tools when completed
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle ?? (hasDiff && isDone);

  const IconComponent = TOOL_ICONS[part.toolName] ?? WrenchIcon;
  const isDestructive = DESTRUCTIVE_TOOLS.has(part.toolName);

  const parsed = useMemo(() => parseToolOutput(part.output), [part.output]);

  // For collapsed header: show file path from input + stats
  const filePath = useMemo(() => {
    if (!part.input || typeof part.input !== 'object') return '';
    const obj = part.input as Record<string, unknown>;
    return (obj.path as string) ?? '';
  }, [part.input]);

  const headerLabel = filePath
    ? `${filePath.split('/').pop() ?? filePath}${parsed.stats ? ` (${parsed.stats})` : ''}`
    : formatInput(part.input);

  return (
    <div className={`my-1.5 rounded-lg border text-xs font-mono ${
      isDestructive
        ? 'border-[var(--amber)]/30 bg-background/60'
        : 'border-border/40 bg-background/50'
    }`}>
      <button
        type="button"
        onClick={() => setManualToggle(v => v === null ? !expanded : !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-muted/30 transition-colors rounded-lg"
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
        {isDestructive && <AlertTriangle size={11} className="shrink-0 text-[var(--amber)]" />}
        <IconComponent size={12} className={`shrink-0 ${isDestructive ? 'text-[var(--amber)]' : 'text-muted-foreground'}`} />
        <span className={`font-medium ${isDestructive ? 'text-[var(--amber)]' : 'text-foreground'}`}>{part.toolName}</span>
        <span className="text-muted-foreground truncate flex-1">{headerLabel}</span>
        <span className="shrink-0 ml-auto">
          {part.state === 'pending' || part.state === 'running' ? (
            <Loader2 size={12} className="animate-spin text-[var(--amber)]" />
          ) : part.state === 'done' ? (
            <CheckCircle2 size={12} className="text-success" />
          ) : (
            <XCircle size={12} className="text-error" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/30">
          {/* Diff view for file-mutating tools — only when done and has diff */}
          {hasDiff && isDone && parsed.diffLines.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {parsed.diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`px-2 py-px flex items-start gap-1.5 ${
                    line.prefix === '+'
                      ? 'bg-success/8'
                      : line.prefix === '-'
                        ? 'bg-error/8'
                        : ''
                  }`}
                >
                  <span
                    className={`select-none w-3 shrink-0 text-right ${
                      line.prefix === '+' ? 'text-success' : line.prefix === '-' ? 'text-error' : 'text-muted-foreground/50'
                    }`}
                  >
                    {line.prefix}
                  </span>
                  <span
                    className={`whitespace-pre-wrap break-all flex-1 ${
                      line.prefix === '+' ? 'text-success' : line.prefix === '-' ? 'text-error' : 'text-muted-foreground'
                    }`}
                  >
                    {line.text || '\u00A0'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: show input (always), output when available */
            <div className="px-2.5 pb-2.5 pt-1.5 space-y-1.5">
              {part.state === 'running' && (
                <div className="text-muted-foreground/60 text-2xs flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" /> Running...
                </div>
              )}
              <div className="text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground/70">Input: </span>
                <span className="break-all whitespace-pre-wrap">{JSON.stringify(part.input, null, 2)}</span>
              </div>
              {part.output !== undefined && part.output !== '' && (
                <div className="text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground/70">Output: </span>
                  <span className="break-all whitespace-pre-wrap">{part.output.length > 500 ? part.output.slice(0, 500) + '…' : part.output}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
