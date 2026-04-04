'use client';

/**
 * Shared types and helpers for Agent Activity UI components.
 * Used by both AgentActivitySection (full audit log) and RecentActivityFeed (compact list).
 */

import { Terminal, FileEdit, FilePlus, Trash2, Search, Clock } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentOp {
  id?: string;
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  agentName?: string;
}

export type OpKind = 'read' | 'write' | 'create' | 'delete' | 'search' | 'other';

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function opKind(tool: string): OpKind {
  if (/search/.test(tool)) return 'search';
  if (/read|list|get/.test(tool)) return 'read';
  if (/create/.test(tool)) return 'create';
  if (/delete/.test(tool)) return 'delete';
  if (/write|update|insert|append/.test(tool)) return 'write';
  return 'other';
}

export const KIND_STYLE: Record<OpKind, { bg: string; text: string; border: string }> = {
  read:   { bg: 'rgba(138,180,216,0.10)', text: '#8ab4d8', border: 'rgba(138,180,216,0.25)' },
  write:  { bg: 'rgba(200,135,58,0.10)',  text: 'var(--amber)', border: 'rgba(200,135,58,0.25)' },
  create: { bg: 'rgba(122,173,128,0.10)', text: 'var(--success)', border: 'rgba(122,173,128,0.25)' },
  delete: { bg: 'rgba(200,80,80,0.10)',   text: 'var(--error)', border: 'rgba(200,80,80,0.25)' },
  search: { bg: 'rgba(200,160,216,0.10)', text: '#c8a0d8', border: 'rgba(200,160,216,0.25)' },
  other:  { bg: 'var(--muted)', text: 'var(--muted-foreground)', border: 'var(--border)' },
};

export const KIND_COLOR: Record<OpKind, string> = {
  read: 'text-blue-400',
  write: 'text-[var(--amber)]',
  create: 'text-[var(--success)]',
  delete: 'text-[var(--error)]',
  search: 'text-purple-400',
  other: 'text-muted-foreground',
};

export function OpIcon({ kind, size = 13 }: { kind: OpKind; size?: number }) {
  if (kind === 'read')   return <Clock size={size} />;
  if (kind === 'write')  return <FileEdit size={size} />;
  if (kind === 'create') return <FilePlus size={size} />;
  if (kind === 'delete') return <Trash2 size={size} />;
  if (kind === 'search') return <Search size={size} />;
  return <Terminal size={size} />;
}

export function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

export function relativeTs(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${d}d`;
}

export function getFilePath(params: Record<string, unknown>): string | null {
  return typeof params.path === 'string' ? params.path : null;
}
