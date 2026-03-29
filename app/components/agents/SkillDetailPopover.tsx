'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Code2,
  Copy,
  Check,
  FileText,
  Loader2,
  Plus,
  Zap,
  Search,
  Server,
  ToggleLeft,
  Trash2,
  X,
  ChevronDown,
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
  allAgentNames?: string[];
  isNative?: boolean;
  nativeSourcePath?: string;
  copy: SkillDetailPopoverCopy;
  onClose: () => void;
  onToggle?: (name: string, enabled: boolean) => Promise<boolean>;
  onDelete?: (name: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onAddAgent?: (skillName: string, agentName: string) => void;
  onRemoveAgent?: (skillName: string, agentName: string) => void;
}

/* ────────── Capability Icon ────────── */

const CAPABILITY_ICONS: Record<SkillCapability, React.ComponentType<{ size?: number; className?: string }>> = {
  research: Search,
  coding: Code2,
  docs: FileText,
  ops: Server,
  memory: BookOpen,
};

/* ────────── Content Parser ────────── */

interface ParsedContent {
  triggerConditions: string;
  instructions: string;
}

function parseSkillContent(raw: string, description: string): ParsedContent {
  // Strip YAML frontmatter
  let body = raw;
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) body = raw.slice(fmMatch[0].length).trim();

  // Extract trigger conditions from description
  // The description field usually contains trigger/usage info
  const triggerConditions = description || '';

  return { triggerConditions, instructions: body };
}

/* ────────── Simple Markdown Renderer ────────── */

function MarkdownContent({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={`prose prose-sm prose-invert max-w-none
        prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
        prose-h1:text-sm prose-h2:text-xs prose-h3:text-xs
        prose-p:text-xs prose-p:text-foreground/80 prose-p:leading-relaxed prose-p:my-1.5
        prose-li:text-xs prose-li:text-foreground/80 prose-li:my-0.5
        prose-strong:text-foreground prose-strong:font-semibold
        prose-code:text-[var(--amber)] prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-2xs prose-code:font-mono
        prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border/50 prose-pre:rounded-lg prose-pre:p-3 prose-pre:text-2xs prose-pre:overflow-x-auto
        prose-ul:my-1 prose-ol:my-1
        prose-hr:border-border/30 prose-hr:my-3
        ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Minimal markdown to HTML — no external deps */
function renderMarkdown(md: string): string {
  let html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre><code>${escHtml(code.trimEnd())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // HR
    .replace(/^---$/gm, '<hr/>')
    // List items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: lines not wrapped in a block tag
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^<(h[1-4]|ul|ol|li|pre|hr|div|p|blockquote)/.test(trimmed)) return line;
    return `<p>${trimmed}</p>`;
  }).join('\n');

  return html;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ────────── Component ────────── */

export default function SkillDetailPopover({
  open,
  skillName,
  skill,
  agentNames = [],
  allAgentNames = [],
  isNative = false,
  nativeSourcePath,
  copy,
  onClose,
  onToggle,
  onDelete,
  onRefresh,
  onAddAgent,
  onRemoveAgent,
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
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);

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
      setShowAddAgent(false);
      setContentExpanded(false);
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

  // Parse content into structured sections
  const parsed = content ? parseSkillContent(content, description) : null;

  // Available agents to add (not already assigned)
  const availableAgents = allAgentNames.filter(a => !agentNames.includes(a));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 overlay-backdrop"
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

          {/* ── Section: Trigger Conditions ── */}
          {description && (
            <section>
              <SectionTitle label="Trigger Conditions" />
              <div className="rounded-lg border border-border/40 bg-muted/[0.03] p-3.5">
                <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {description}
                </p>
              </div>
            </section>
          )}
          {!description && !isNative && (
            <p className="text-sm text-muted-foreground italic">{copy.noDescription}</p>
          )}

          {/* ── Section: Quick Meta ── */}
          <section>
            <div className="grid grid-cols-2 gap-3">
              {!isNative && skill && (
                <MetaCard label={copy.enabled} value={skill.enabled ? '✓' : '—'} tone={skill.enabled ? 'ok' : 'muted'} />
              )}
              <MetaCard label={copy.capability} value={capability} />
              <MetaCard label={copy.source} value={sourceLabel} />
              <MetaCard label={copy.agents} value={String(agentNames.length)} />
            </div>
          </section>

          {/* ── Section: Connected Agents ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle label={copy.agents} noMargin />
              {onAddAgent && availableAgents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddAgent(!showAddAgent)}
                  className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity cursor-pointer"
                >
                  <Plus size={12} />
                  <span>Add</span>
                </button>
              )}
            </div>

            {/* Add agent picker */}
            {showAddAgent && availableAgents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 p-2 rounded-lg border border-dashed border-[var(--amber)]/30 bg-[var(--amber)]/[0.03]">
                {availableAgents.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { onAddAgent?.(skillName, name); setShowAddAgent(false); }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-2xs rounded-md border border-border bg-card hover:bg-muted cursor-pointer transition-colors"
                  >
                    <Plus size={10} className="text-[var(--amber)]" />
                    <span className="text-foreground/80">{name}</span>
                  </button>
                ))}
              </div>
            )}

            {agentNames.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {agentNames.map((name) => (
                  <AgentAvatar
                    key={name}
                    name={name}
                    size="sm"
                    onRemove={onRemoveAgent ? () => onRemoveAgent(skillName, name) : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">{copy.noAgents}</p>
              </div>
            )}
          </section>

          {/* ── Section: Skill Instructions (markdown) ── */}
          {(content !== null || loading || loadError) && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <SectionTitle label="Instructions" noMargin />
                <div className="flex items-center gap-2">
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

              {parsed && !loading && !loadError && (
                <div className={`rounded-lg border border-border/50 bg-muted/[0.02] p-4 overflow-hidden transition-all duration-200 ${!contentExpanded ? 'max-h-60' : ''}`}>
                  <MarkdownContent text={parsed.instructions} />
                </div>
              )}
              {parsed && !loading && !loadError && parsed.instructions.split('\n').length > 15 && (
                <button
                  type="button"
                  onClick={() => setContentExpanded(!contentExpanded)}
                  className="inline-flex items-center gap-1 mt-2 text-2xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity cursor-pointer"
                >
                  <ChevronDown size={12} className={`transition-transform duration-200 ${contentExpanded ? 'rotate-180' : ''}`} />
                  <span>{contentExpanded ? 'Collapse' : 'View All'}</span>
                </button>
              )}
            </section>
          )}

          {/* ── Section: File Path ── */}
          {skillPath && (
            <section>
              <SectionTitle label={copy.path} />
              <div className="rounded-lg border border-border/50 bg-muted/[0.03] p-3">
                <code className="text-2xs text-foreground/60 font-mono break-all leading-relaxed">{skillPath}</code>
              </div>
            </section>
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

/* ────────── Section Title ────────── */

function SectionTitle({ label, noMargin }: { label: string; noMargin?: boolean }) {
  return (
    <h3 className={`text-xs font-semibold text-muted-foreground uppercase tracking-wider ${noMargin ? '' : 'mb-2'}`}>
      {label}
    </h3>
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
    tone === 'ok' ? 'text-[var(--success)]'
      : tone === 'muted' ? 'text-muted-foreground'
        : 'text-foreground';
  return (
    <div className="rounded-xl border border-border/50 bg-muted/[0.03] px-3.5 py-3 hover:bg-muted/[0.06] transition-colors duration-100">
      <span className="text-2xs text-muted-foreground/60 block mb-1 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-semibold capitalize ${valueColor}`}>{value}</span>
    </div>
  );
}
