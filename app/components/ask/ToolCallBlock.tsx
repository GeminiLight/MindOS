'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { ToolCallPart } from '@/lib/types';

const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'move_file', 'rename_file', 'write_file']);

const TOOL_ICONS: Record<string, string> = {
  search: '🔍',
  list_files: '📂',
  read_file: '📖',
  write_file: '✏️',
  create_file: '📄',
  append_to_file: '📝',
  insert_after_heading: '📌',
  update_section: '✏️',
  delete_file: '🗑️',
  rename_file: '📝',
  move_file: '📦',
  get_backlinks: '🔗',
  get_history: '📜',
  get_file_at_version: '⏪',
  get_recent: '🕐',
  append_csv: '📊',
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

function truncateOutput(output: string, maxLen = 200): string {
  if (output.length <= maxLen) return output;
  return output.slice(0, maxLen) + '…';
}

export default function ToolCallBlock({ part }: { part: ToolCallPart }) {
  const [expanded, setExpanded] = useState(false);
  const icon = TOOL_ICONS[part.toolName] ?? '🔧';
  const inputSummary = formatInput(part.input);
  const isDestructive = DESTRUCTIVE_TOOLS.has(part.toolName);

  return (
    <div className={`my-1 rounded-md border text-xs font-mono ${
      isDestructive
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-border/50 bg-muted/30'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors rounded-md"
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
        {isDestructive && <AlertTriangle size={11} className="shrink-0 text-amber-500" />}
        <span>{icon}</span>
        <span className={`font-medium ${isDestructive ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>{part.toolName}</span>
        <span className="text-muted-foreground truncate flex-1">({inputSummary})</span>
        <span className="shrink-0 ml-auto">
          {part.state === 'pending' || part.state === 'running' ? (
            <Loader2 size={12} className="animate-spin text-amber-500" />
          ) : part.state === 'done' ? (
            <CheckCircle2 size={12} className="text-success" />
          ) : (
            <XCircle size={12} className="text-error" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-0.5 border-t border-border/30 space-y-1">
          <div className="text-muted-foreground">
            <span className="font-semibold">Input: </span>
            <span className="break-all whitespace-pre-wrap">{JSON.stringify(part.input, null, 2)}</span>
          </div>
          {part.output !== undefined && (
            <div className="text-muted-foreground">
              <span className="font-semibold">Output: </span>
              <span className="break-all whitespace-pre-wrap">{truncateOutput(part.output)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
