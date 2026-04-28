'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, Sparkles, ChevronRight, ChevronDown, AlertCircle, Check, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import DirPicker from '@/components/DirPicker';
import type { Message } from '@/lib/types';
import {
  cleanInsightContent,
  formatInsightMarkdown,
  formatSessionContent,
  sessionPreviewStats,
  type SessionSaveFormat,
} from './save-insight-utils';

const PANEL_WIDTH = 300;

/* ── Save Single Message Button (for message action bar) ── */

export function SaveMessageButton({ text }: { text: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cleaned = cleanInsightContent(text);

  if (!cleaned) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`p-1 rounded-md border transition-colors ${
          open
            ? 'border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]'
            : 'border-border/60 bg-card text-muted-foreground hover:text-[var(--amber)] shadow-sm'
        }`}
        title={t.ask?.saveToKB ?? 'Save to knowledge base'}
      >
        <FolderInput size={11} />
      </button>
      {open && (
        <SaveMessagePopover
          anchorRef={btnRef}
          content={cleaned}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SaveMessagePopover({ anchorRef, content, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  content: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const ask = t.ask;
  const [intent, setIntent] = useState<'select' | 'archive' | 'digest'>('select');

  const [dirPaths, setDirPaths] = useState<string[]>([]);
  useEffect(() => { apiFetch<{ dirs: string[] }>('/api/file?op=dirs').then(d => setDirPaths(d.dirs ?? [])).catch(() => {}); }, []);

  // Wrap content as a single assistant message for format functions
  const asMessages: Message[] = [{ role: 'assistant', content }];

  return (
    <PopoverShell anchorRef={anchorRef} onClose={onClose}>
      {intent === 'select' && (
        <MessageIntentCards content={content} onSelect={setIntent} onClose={onClose} ask={ask} />
      )}
      {intent === 'archive' && (
        <SingleSaveForm content={content} defaultFilenamePrefix="insight" dirPaths={dirPaths} onClose={onClose} ask={ask} />
      )}
      {intent === 'digest' && (
        <DigestForm messages={asMessages} onClose={onClose} ask={ask} />
      )}
    </PopoverShell>
  );
}

function MessageIntentCards({ content, onSelect, onClose, ask }: {
  content: string;
  onSelect: (intent: 'archive' | 'digest') => void;
  onClose: () => void;
  ask: Record<string, any>;
}) {
  const charLabel = content.length > 1000 ? `~${(content.length / 1000).toFixed(1)}k` : `${content.length}`;
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <FolderInput size={11} className="text-[var(--amber)]" />
          <span className="text-xs font-semibold text-foreground">{ask?.saveToKBTitle ?? 'Save to KB'}</span>
          <span className="text-2xs text-muted-foreground">({charLabel} chars)</span>
        </div>
        <button type="button" onClick={onClose} className="text-2xs text-muted-foreground hover:text-foreground">
          {ask?.cancelSave ?? 'Cancel'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onSelect('archive')}
          className="flex flex-col items-center gap-1 p-2.5 border border-[var(--amber)]/30 rounded-lg hover:border-[var(--amber)]/60 hover:shadow-sm active:scale-[0.98] transition-all">
          <FolderInput size={16} className="text-[var(--amber)]" />
          <span className="text-2xs font-medium text-foreground">{ask?.saveDirectly ?? 'Save directly'}</span>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{ask?.saveDirectlyDesc ?? 'Save as-is'}</span>
        </button>
        <button type="button" onClick={() => onSelect('digest')}
          className="flex flex-col items-center gap-1 p-2.5 border border-border rounded-lg hover:border-[var(--amber)]/50 hover:shadow-sm active:scale-[0.98] transition-all">
          <Sparkles size={16} className="text-[var(--amber)]" />
          <span className="text-2xs font-medium text-foreground">{ask?.organizeToNote ?? 'Organize to note'}</span>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{ask?.organizeToNoteDesc ?? 'AI organizes'}</span>
        </button>
      </div>
    </div>
  );
}

/* ── Trigger Button (for AskHeader) ── */

export function SaveSessionButton({ messages, disabled }: {
  messages: Message[];
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hasContent = messages.some((m) => m.role === 'assistant' && m.content.trim());

  if (!hasContent) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={disabled}
        className={`h-9 w-9 inline-flex items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        } disabled:opacity-40`}
        title={t.ask?.saveSession ?? 'Save session'}
      >
        <FolderInput size={14} />
      </button>
      {open && (
        <SaveSessionPopover
          anchorRef={btnRef}
          messages={messages}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ── Popover Panel (portal, fixed position below button) ── */

/* Shared popover shell — calculates position, handles outside click + Escape */
function PopoverShell({ anchorRef, onClose, children }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const calcPos = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }, [anchorRef]);

  useEffect(() => { calcPos(); window.addEventListener('resize', calcPos); return () => window.removeEventListener('resize', calcPos); }, [calcPos]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handleClick); };
  }, [anchorRef, onClose]);

  if (!pos || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={panelRef} className="fixed z-50 rounded-xl border border-border bg-card shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-100"
      style={{ top: pos.top, right: pos.right, width: PANEL_WIDTH }}>
      {children}
    </div>,
    document.body,
  );
}

/* ── Save single content string (for individual messages) ── */

function SaveContentPopover({ anchorRef, content, defaultFilenamePrefix, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  content: string;
  defaultFilenamePrefix: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const ask = t.ask;
  const [dirPaths, setDirPaths] = useState<string[]>([]);
  useEffect(() => { apiFetch<{ dirs: string[] }>('/api/file?op=dirs').then(d => setDirPaths(d.dirs ?? [])).catch(() => {}); }, []);

  return (
    <PopoverShell anchorRef={anchorRef} onClose={onClose}>
      <SingleSaveForm content={content} defaultFilenamePrefix={defaultFilenamePrefix} dirPaths={dirPaths} onClose={onClose} ask={ask} />
    </PopoverShell>
  );
}

function SingleSaveForm({ content, defaultFilenamePrefix, dirPaths, onClose, ask }: {
  content: string;
  defaultFilenamePrefix: string;
  dirPaths: string[];
  onClose: () => void;
  ask: Record<string, any>;
}) {
  const now = new Date();
  const defaultFn = `${defaultFilenamePrefix}-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.md`;
  const [targetDir, setTargetDir] = useState('');
  const [filename, setFilename] = useState(defaultFn);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fnRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      fnRef.current?.focus();
      fnRef.current?.select();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const safePath = (() => {
    const fn = filename.trim() || defaultFn;
    const ext = fn.endsWith('.md') ? fn : `${fn}.md`;
    return targetDir ? `${targetDir}/${ext}` : ext;
  })();

  const handleSave = useCallback(async () => {
    setSaving(true); setErrorMsg('');
    try {
      await apiFetch('/api/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: safePath, op: 'create_file', content: formatInsightMarkdown(content), source: 'user' }),
      });
      setSaved(true);
      toast.success(ask?.savedToKB?.replace('{path}', safePath.split('/').pop()) ?? 'Saved');
      setTimeout(onClose, 1000);
    } catch (err: any) {
      setErrorMsg(err?.message?.includes('exist') ? (ask?.fileExistsSwitch ?? 'File exists') : (err?.message ?? 'Failed'));
    } finally { setSaving(false); }
  }, [content, safePath, ask, onClose]);

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <FolderInput size={11} className="text-[var(--amber)]" />
        <span className="text-xs font-semibold">{ask?.saveToKBTitle ?? 'Save to KB'}</span>
      </div>

      <div>
        <label className="text-2xs text-muted-foreground mb-0.5 block">{ask?.targetFolder ?? 'Folder'}</label>
        <DirPicker dirPaths={dirPaths} value={targetDir} onChange={setTargetDir} rootLabel="Root" />
      </div>
      <div>
        <label className="text-2xs text-muted-foreground mb-0.5 block">{ask?.fileName ?? 'Filename'}</label>
        <input ref={fnRef} type="text" value={filename} onChange={(e) => setFilename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
          className="w-full px-2 py-1 text-xs font-mono rounded-md border border-border bg-background text-foreground outline-none focus-visible:border-[var(--amber)]/50" />
      </div>
      <div className="text-[10px] text-muted-foreground/60 font-mono truncate">{safePath}</div>

      {errorMsg && <div className="flex items-center gap-1 text-2xs text-error"><AlertCircle size={10} />{errorMsg}</div>}

      <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
        <button type="button" onClick={onClose} className="px-2 py-0.5 text-2xs rounded text-muted-foreground hover:bg-muted">{ask?.cancelSave ?? 'Cancel'}</button>
        <button type="button" onClick={handleSave} disabled={saving || saved || !filename.trim()}
          className={`flex items-center gap-1 px-2.5 py-0.5 text-2xs font-medium rounded transition-colors ${saved ? 'bg-success/10 text-success' : 'bg-[var(--amber)] text-[var(--amber-foreground)]'} disabled:opacity-50`}>
          {saving && <Loader2 size={9} className="animate-spin" />}
          {saved && <Check size={9} />}
          {ask?.confirmSave ?? 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── Session Popover (uses shared shell) ── */

function SaveSessionPopover({ anchorRef, messages, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  messages: Message[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const ask = t.ask;
  const [intent, setIntent] = useState<'select' | 'archive' | 'digest'>('select');

  const [dirPaths, setDirPaths] = useState<string[]>([]);
  useEffect(() => { apiFetch<{ dirs: string[] }>('/api/file?op=dirs').then(d => setDirPaths(d.dirs ?? [])).catch(() => {}); }, []);

  return (
    <PopoverShell anchorRef={anchorRef} onClose={onClose}>
      {intent === 'select' && (
        <IntentCards messages={messages} onSelect={setIntent} onClose={onClose} ask={ask} />
      )}
      {intent === 'archive' && (
        <ArchiveForm messages={messages} dirPaths={dirPaths} onBack={() => setIntent('select')} onClose={onClose} ask={ask} />
      )}
      {intent === 'digest' && (
        <DigestForm messages={messages} onClose={onClose} ask={ask} />
      )}
    </PopoverShell>
  );
}

/* ── Step 1: Intent Cards ── */

function IntentCards({ messages, onSelect, onClose, ask }: {
  messages: Message[];
  onSelect: (intent: 'archive' | 'digest') => void;
  onClose: () => void;
  ask: Record<string, any>;
}) {
  const stats = sessionPreviewStats(messages, 'full');

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <FolderInput size={11} className="text-[var(--amber)]" />
          <span className="text-xs font-semibold text-foreground">{ask?.saveSession ?? 'Save Session'}</span>
          <span className="text-2xs text-muted-foreground">({stats.msgCount})</span>
        </div>
        <button type="button" onClick={onClose} className="text-2xs text-muted-foreground hover:text-foreground">
          {ask?.cancelSave ?? 'Cancel'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onSelect('archive')}
          className="flex flex-col items-center gap-1 p-2.5 border border-[var(--amber)]/30 rounded-lg hover:border-[var(--amber)]/60 hover:shadow-sm active:scale-[0.98] transition-all">
          <FolderInput size={16} className="text-[var(--amber)]" />
          <span className="text-2xs font-medium text-foreground">{ask?.saveDirectly ?? 'Save directly'}</span>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{ask?.saveDirectlyDesc ?? 'Save as-is'}</span>
        </button>
        <button type="button" onClick={() => onSelect('digest')}
          className="flex flex-col items-center gap-1 p-2.5 border border-border rounded-lg hover:border-[var(--amber)]/50 hover:shadow-sm active:scale-[0.98] transition-all">
          <Sparkles size={16} className="text-[var(--amber)]" />
          <span className="text-2xs font-medium text-foreground">{ask?.organizeToNote ?? 'Organize to note'}</span>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{ask?.organizeToNoteDesc ?? 'AI extracts insights'}</span>
        </button>
      </div>
    </div>
  );
}

/* ── Step 2a: Archive Form ── */

function ArchiveForm({ messages, dirPaths, onBack, onClose, ask }: {
  messages: Message[];
  dirPaths: string[];
  onBack: () => void;
  onClose: () => void;
  ask: Record<string, any>;
}) {
  const now = new Date();
  const defaultFn = `session-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.md`;
  const [targetDir, setTargetDir] = useState('');
  const [filename, setFilename] = useState(defaultFn);
  const [format, setFormat] = useState<SessionSaveFormat>('full');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fnRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      fnRef.current?.focus();
      fnRef.current?.select();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const safePath = (() => {
    const fn = filename.trim() || defaultFn;
    const ext = fn.endsWith('.md') ? fn : `${fn}.md`;
    return targetDir ? `${targetDir}/${ext}` : ext;
  })();

  const stats = sessionPreviewStats(messages, format);

  const handleSave = useCallback(async () => {
    setSaving(true); setErrorMsg('');
    try {
      await apiFetch('/api/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: safePath, op: 'create_file', content: formatSessionContent(messages, format), source: 'user' }),
      });
      setSaved(true);
      toast.success(ask?.savedToKB?.replace('{path}', safePath.split('/').pop()) ?? `Saved`);
      setTimeout(onClose, 1000);
    } catch (err: any) {
      setErrorMsg(err?.message?.includes('exist') ? (ask?.fileExistsSwitch ?? 'File exists') : (err?.message ?? 'Failed'));
    } finally { setSaving(false); }
  }, [messages, format, safePath, ask, onClose]);

  const previewText = formatSessionContent(messages, format).slice(0, 300);

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground"><ChevronRight size={11} className="rotate-180" /></button>
        <FolderInput size={11} className="text-[var(--amber)]" />
        <span className="text-xs font-semibold">{ask?.saveDirectly ?? 'Save directly'}</span>
      </div>

      <div>
        <label className="text-2xs text-muted-foreground mb-0.5 block">{ask?.targetFolder ?? 'Folder'}</label>
        <DirPicker dirPaths={dirPaths} value={targetDir} onChange={setTargetDir} rootLabel="Root" />
      </div>

      <div>
        <label className="text-2xs text-muted-foreground mb-0.5 block">{ask?.fileName ?? 'Filename'}</label>
        <input ref={fnRef} type="text" value={filename} onChange={(e) => setFilename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
          className="w-full px-2 py-1 text-xs font-mono rounded-md border border-border bg-background text-foreground outline-none focus-visible:border-[var(--amber)]/50" />
      </div>

      <div className="flex items-center gap-2.5">
        {(['full', 'ai-only'] as const).map((f) => (
          <label key={f} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} className="w-2.5 h-2.5 accent-[var(--amber)]" />
            <span className="text-2xs">{f === 'full' ? (ask?.formatFull ?? 'Full') : (ask?.formatAiOnly ?? 'AI only')}</span>
          </label>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">{stats.msgCount} msgs</span>
      </div>

      <button type="button" onClick={() => setShowPreview(v => !v)} className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
        {showPreview ? <ChevronDown size={9} /> : <ChevronRight size={9} />} Preview
      </button>
      {showPreview && (
        <pre className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 rounded-md max-h-24 overflow-auto whitespace-pre-wrap font-mono">
          {previewText}{previewText.length >= 300 ? '...' : ''}
        </pre>
      )}

      <div className="text-[10px] text-muted-foreground/60 font-mono truncate">{safePath}</div>

      {errorMsg && <div className="flex items-center gap-1 text-2xs text-error"><AlertCircle size={10} />{errorMsg}</div>}

      <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
        <button type="button" onClick={onClose} className="px-2 py-0.5 text-2xs rounded text-muted-foreground hover:bg-muted">{ask?.cancelSave ?? 'Cancel'}</button>
        <button type="button" onClick={handleSave} disabled={saving || saved || !filename.trim()}
          className={`flex items-center gap-1 px-2.5 py-0.5 text-2xs font-medium rounded transition-colors ${saved ? 'bg-success/10 text-success' : 'bg-[var(--amber)] text-[var(--amber-foreground)]'} disabled:opacity-50`}>
          {saving && <Loader2 size={9} className="animate-spin" />}
          {saved && <Check size={9} />}
          {ask?.confirmSave ?? 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── Step 2b: Digest — dispatch to OrganizeToast and close ── */

function DigestForm({ messages, onClose, ask }: {
  messages: Message[];
  onClose: () => void;
  ask: Record<string, any>;
}) {
  const handleOrganize = useCallback(() => {
    const content = formatSessionContent(messages, 'full');
    window.dispatchEvent(new CustomEvent('mindos:session-organize', {
      detail: { content, name: 'conversation.md' },
    }));
    onClose();
    toast.success(ask?.organizing ?? 'AI is organizing...');
  }, [messages, onClose, ask]);

  // Auto-dispatch on mount
  useEffect(() => { handleOrganize(); }, [handleOrganize]);

  return null;
}
