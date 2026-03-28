'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Code2,
  Copy,
  Check,
  FileText,
  Loader2,
  Zap,
  Search,
  Server,
  ToggleLeft,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import type { SkillInfo } from '@/components/settings/types';
import { Toggle } from '@/components/settings/Primitives';
import { AgentAvatar, ConfirmDialog } from './AgentsPrimitives';
import { capabilityFromText, type SkillCapability } from './agents-content-model';

/* ────────── Types ────────── */

export interface SkillDetailPopoverCopy {
  close: string;
  source: string;
  sourceBuiltin: string;
  sourceUser: string;
  sourceNative: string;
  capability: string;
  path: string;
  enabled: string;
  disabled: string;
  agents: string;
  noAgents: string;
  content: string;
  loading: string;
  loadFailed: string;
  retry: string;
  copyContent: string;
  copied: string;
  noDescription: string;
  deleteSkill: string;
  confirmDeleteTitle: string;
  confirmDeleteMessage: (name: string) => string;
  confirmDeleteAction: string;
  cancelAction: string;
  deleted: string;
  deleteFailed: string;
}

interface SkillDetailPopoverProps {
  open: boolean;
  skillName: string | null;
  skill?: SkillInfo | null;
  agentNames?: string[];
  isNative?: boolean;
  nativeSourcePath?: string;
  copy: SkillDetailPopoverCopy;
  onClose: () => void;
  onToggle?: (name: string, enabled: boolean) => Promise<boolean>;
  onDelete?: (name: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

/* ────────── Capability Icon ────────── */

const CAPABILITY_ICONS: Record<SkillCapability, React.ComponentType<{ size?: number; className?: string }>> = {
  research: Search,
  coding: Code2,
  docs: FileText,
  ops: Server,
  memory: BookOpen,
};

/* ────────── Component ────────── */

export default function SkillDetailPopover({
  open,
  skillName,
  skill,
  agentNames = [],
  isNative = false,
  nativeSourcePath,
  copy,
  onClose,
  onToggle,
  onDelete,
  onRefresh,
}: SkillDetailPopoverProps) {
  const [content, setContent] = useState<string | null>(null);
  const [nativeDesc, setNativeDesc] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const fetchContent = useCallback(async () => {
    if (!skillName) return;
    setLoading(true);
    setLoadError(false);
    try {
      if (isNative && nativeSourcePath) {
        const res = await apiFetch<{ content: string; description?: string }>('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'read-native', name: skillName, sourcePath: nativeSourcePath }),
        });
        setContent(res.content);
        setNativeDesc(res.description || '');
      } else if (!isNative) {
        const res = await apiFetch<{ content: string }>('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'read', name: skillName }),
        });
        setContent(res.content);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [skillName, isNative, nativeSourcePath]);

  useEffect(() => {
    if (open && skillName) {
      setContent(null);
      setNativeDesc('');
      setLoadError(false);
      setCopied(false);
      setDeleteMsg(null);
      setDeleting(false);
      setToggleBusy(false);
      fetchContent();
    }
  }, [open, skillName, fetchContent]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [content]);

  const handleToggle = useCallback(async (enabled: boolean) => {
    if (!skillName || !onToggle) return;
    setToggleBusy(true);
    try {
      await onToggle(skillName, enabled);
    } finally {
      setToggleBusy(false);
    }
  }, [skillName, onToggle]);

  const handleDelete = useCallback(async () => {
    if (!skillName || !onDelete) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await onDelete(skillName);
      setDeleteMsg(copy.deleted);
      await onRefresh?.();
      setTimeout(() => onClose(), 800);
    } catch {
      setDeleteMsg(copy.deleteFailed);
      setDeleting(false);
    }
  }, [skillName, onDelete, onRefresh, onClose, copy.deleted, copy.deleteFailed]);

  if (!open || !skillName) return null;

  const capability = skill
    ? capabilityFromText(`${skill.name} ${skill.description}`)
    : capabilityFromText(skillName);
  const CapIcon = CAPABILITY_ICONS[capability] ?? Zap;
  const isUserSkill = skill?.source === 'user';
  const sourceLabel = isNative
    ? copy.sourceNative
    : skill?.source === 'builtin'
      ? copy.sourceBuiltin
      : copy.sourceUser;
  const description = skill?.description || nativeDesc || '';
  const skillPath = skill?.path || (isNative && nativeSourcePath ? `${nativeSourcePath}/${skillName}/SKILL.md` : '');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={skillName}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-border bg-card shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* ─── Header ─── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-gradient-to-r from-card to-card/80 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--amber)]/[0.08] flex items-center justify-center text-[var(--amber)] shrink-0">
            <CapIcon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">{skillName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-2xs px-2 py-0.5 rounded-full font-medium select-none ${
                isNative
                  ? 'bg-muted text-muted-foreground'
                  : skill?.source === 'builtin'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-[var(--amber-dim)] text-[var(--amber-text)]'
              }`}>
                {sourceLabel}
              </span>
              <span className="text-2xs text-muted-foreground/60 capitalize">{capability}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={copy.close}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body (scrollable) ─── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Description */}
          {description ? (
            <p className="text-sm text-foreground leading-relaxed">{description}</p>
          ) : !isNative ? (
            <p className="text-sm text-muted-foreground italic">{copy.noDescription}</p>
          ) : null}

          {/* Quick meta */}
          <div className="grid grid-cols-2 gap-3">
            {!isNative && skill && (
              <MetaCard label={copy.enabled} value={skill.enabled ? '✓' : '—'} tone={skill.enabled ? 'ok' : 'muted'} />
            )}
            <MetaCard label={copy.capability} value={capability} />
            <MetaCard label={copy.source} value={sourceLabel} />
            <MetaCard label={copy.agents} value={String(agentNames.length)} />
          </div>

          {/* Path */}
          {skillPath && (
            <div className="rounded-xl border border-border/50 bg-muted/[0.03] p-3.5">
              <span className="text-2xs text-muted-foreground/60 block mb-1.5 uppercase tracking-wider">{copy.path}</span>
              <code className="text-xs text-foreground/80 font-mono break-all leading-relaxed">{skillPath}</code>
            </div>
          )}

          {/* Agents */}
          {agentNames.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">{copy.agents}</h3>
              <div className="flex flex-wrap gap-2">
                {agentNames.map((name) => (
                  <AgentAvatar key={name} name={name} size="sm" />
                ))}
              </div>
            </div>
          )}
          {agentNames.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-center">
              <p className="text-xs text-muted-foreground">{copy.noAgents}</p>
            </div>
          )}

          {/* Content */}
          {(content !== null || loading || loadError) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-muted-foreground">{copy.content}</h3>
                {content && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1.5 py-0.5"
                    aria-label={copy.copyContent}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? copy.copied : copy.copyContent}
                  </button>
                )}
              </div>

              {loading && (
                <div className="rounded-lg border border-border bg-background p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  {copy.loading}
                </div>
              )}

              {loadError && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-4 text-center space-y-2">
                  <p className="text-sm text-destructive">{copy.loadFailed}</p>
                  <button
                    type="button"
                    onClick={fetchContent}
                    className="text-xs text-foreground underline hover:no-underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {copy.retry}
                  </button>
                </div>
              )}

              {content && !loading && !loadError && (
                <pre className="rounded-lg border border-border bg-background p-3 text-xs text-foreground font-mono overflow-x-auto max-h-80 leading-relaxed whitespace-pre-wrap break-words">
                  {content}
                </pre>
              )}
            </div>
          )}

          {/* Delete message */}
          {deleteMsg && (
            <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
              {deleteMsg}
            </div>
          )}
        </div>

        {/* ─── Footer actions ─── */}
        {!isNative && skill && (
          <div className="shrink-0 border-t border-border px-5 py-3 flex items-center gap-2">
            {/* Toggle */}
            {onToggle && (
              <div className="flex items-center gap-2 mr-auto">
                <ToggleLeft size={14} className="text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">
                  {skill.enabled ? copy.enabled : copy.disabled}
                </span>
                <Toggle
                  size="sm"
                  checked={skill.enabled}
                  onChange={(v) => void handleToggle(v)}
                  disabled={toggleBusy}
                />
              </div>
            )}

            {/* Delete */}
            {isUserSkill && onDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[32px] text-xs rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 cursor-pointer disabled:opacity-50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {copy.deleteSkill}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        title={copy.confirmDeleteTitle}
        message={skillName ? copy.confirmDeleteMessage(skillName) : ''}
        confirmLabel={copy.confirmDeleteAction}
        cancelLabel={copy.cancelAction}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
        variant="destructive"
      />
    </>
  );
}

/* ────────── Meta Card ────────── */

function MetaCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'muted' | 'default';
}) {
  const valueColor =
    tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'muted' ? 'text-muted-foreground'
        : 'text-foreground';
  return (
    <div className="rounded-xl border border-border/50 bg-muted/[0.03] px-3.5 py-3 hover:bg-muted/[0.06] transition-colors duration-100">
      <span className="text-2xs text-muted-foreground/60 block mb-1 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-semibold capitalize ${valueColor}`}>{value}</span>
    </div>
  );
}
