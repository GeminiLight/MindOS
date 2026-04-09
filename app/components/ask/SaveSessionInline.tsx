'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { FolderInput, ChevronRight, ChevronDown, AlertCircle, Check, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Message } from '@/lib/types';
import {
  generateSessionPath,
  formatSessionContent,
  sessionPreviewStats,
  type SessionSaveFormat,
} from './save-insight-utils';

/* ── Trigger Button (for AskHeader) ── */

export function SaveSessionButton({ messages, disabled }: {
  messages: Message[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasContent = messages.some((m) => m.role === 'assistant' && m.content.trim());

  if (!hasContent) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={disabled}
        className={`p-2 rounded-lg transition-colors ${
          open
            ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        } disabled:opacity-40`}
        title="Save session"
      >
        <FolderInput size={14} />
      </button>
      {open && (
        <SaveSessionForm
          messages={messages}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ── Inline Form ── */

type SaveMode = 'create' | 'append';

function SaveSessionForm({ messages, onClose }: {
  messages: Message[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const ask = t.ask;
  const [path, setPath] = useState(() => generateSessionPath());
  const [format, setFormat] = useState<SessionSaveFormat>('full');
  const [mode, setMode] = useState<SaveMode>('create');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  const stats = sessionPreviewStats(messages, format);
  const charLabel = stats.charCount > 1000
    ? `~${(stats.charCount / 1000).toFixed(1)}k chars`
    : `${stats.charCount} chars`;

  const handleSave = useCallback(async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    const safePath = trimmedPath.endsWith('.md') ? trimmedPath : `${trimmedPath}.md`;
    setSaving(true);
    setErrorMsg('');

    try {
      const body = formatSessionContent(messages, format);
      const content = mode === 'create' ? body : `\n\n---\n\n${body}`;

      await apiFetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: safePath,
          op: mode === 'create' ? 'create_file' : 'append_to_file',
          content,
          source: 'user',
        }),
      });

      setSaved(true);
      const filename = safePath.split('/').pop() ?? safePath;
      toast.success(ask.savedToKB?.replace('{path}', filename) ?? `Saved to ${filename}`);
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      const msg = err?.message ?? 'Save failed';
      if (msg.includes('exists') || msg.includes('EEXIST')) {
        setMode('append');
        setErrorMsg(ask.fileExistsSwitch ?? 'File exists — switched to append mode');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [path, format, mode, messages, ask, onClose]);

  const previewText = formatSessionContent(messages, format).slice(0, 500);

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 right-0 z-40 mx-3 mt-1 rounded-xl border border-border bg-card shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150"
    >
      <div className="px-3 pt-3 pb-1.5">
        <div className="flex items-center gap-1.5 mb-2">
          <FolderInput size={12} className="text-[var(--amber)]" />
          <span className="text-xs font-semibold text-foreground">
            {ask.saveSession ?? 'Save Session'}
          </span>
        </div>

        {/* Path input */}
        <input
          ref={inputRef}
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
          placeholder="Inbox/session-2026-04-10.md"
          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-[var(--amber)]/50 transition-colors"
        />

        {/* Format selector */}
        <div className="flex items-center gap-3 mt-2">
          <span className="text-2xs text-muted-foreground">Format:</span>
          {(['full', 'ai-only'] as const).map((f) => (
            <label key={f} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="session-format"
                checked={format === f}
                onChange={() => setFormat(f)}
                className="w-3 h-3 accent-[var(--amber)]"
              />
              <span className="text-2xs text-foreground">
                {f === 'full' ? (ask.formatFull ?? 'Full conversation') : (ask.formatAiOnly ?? 'AI only')}
              </span>
            </label>
          ))}
        </div>

        {/* Save mode */}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-2xs text-muted-foreground">Mode:</span>
          {(['create', 'append'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="session-save-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="w-3 h-3 accent-[var(--amber)]"
              />
              <span className="text-2xs text-foreground">
                {m === 'create' ? (ask.saveNew ?? 'New file') : (ask.saveAppend ?? 'Append')}
              </span>
            </label>
          ))}
        </div>

        {/* Preview toggle */}
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="flex items-center gap-1 mt-2 text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPreview ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {ask.previewContent ?? 'Preview'} ({stats.msgCount} messages, {charLabel})
        </button>
        {showPreview && (
          <pre className="mt-1 px-2 py-1.5 text-2xs text-muted-foreground bg-muted/30 border border-border/50 rounded-lg max-h-32 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
            {previewText}{previewText.length >= 500 ? '\n...' : ''}
          </pre>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="flex items-center gap-1.5 mt-2 text-2xs text-[var(--amber-text)]">
            <AlertCircle size={11} />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/50">
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 text-2xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {ask.cancelSave ?? 'Cancel'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved || !path.trim()}
          className={`flex items-center gap-1 px-3 py-1 text-2xs font-medium rounded-md transition-colors ${
            saved
              ? 'bg-success/10 text-success'
              : 'bg-[var(--amber)] text-[var(--on-amber)] hover:bg-[var(--amber)]/90'
          } disabled:opacity-50`}
        >
          {saving && <Loader2 size={10} className="animate-spin" />}
          {saved && <Check size={10} />}
          {saved ? (ask.confirmSave ?? 'Saved') : (ask.confirmSave ?? 'Save')}
        </button>
      </div>
    </div>
  );
}
