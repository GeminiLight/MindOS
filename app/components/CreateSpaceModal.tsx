'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Loader2, X, Sparkles, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath } from '@/lib/utils';
import { createSpaceAction } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import DirPicker from './DirPicker';

/* ── Create Space Modal ── */

export default function CreateSpaceModal({ t, dirPaths }: { t: ReturnType<typeof useLocale>['t']; dirPaths: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameHint, setNameHint] = useState('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null); // null = loading
  const [useAi, setUseAi] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setError('');
      setNameHint('');
      setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener('mindos:create-space', handler);
    return () => window.removeEventListener('mindos:create-space', handler);
  }, []);

  // Check AI availability when modal opens
  useEffect(() => {
    if (!open || aiAvailable !== null) return;
    apiFetch<{ ai?: { provider?: string; providers?: Record<string, { apiKey?: string }> } }>('/api/settings')
      .then(data => {
        const provider = data.ai?.provider ?? '';
        const providers = data.ai?.providers ?? {};
        const activeProvider = providers[provider as keyof typeof providers];
        const hasKey = !!(activeProvider?.apiKey);
        setAiAvailable(hasKey);
        setUseAi(hasKey);
      })
      .catch(() => {
        setAiAvailable(false);
        setUseAi(false);
      });
  }, [open, aiAvailable]);

  const close = useCallback(() => {
    setOpen(false);
    setName('');
    setDescription('');
    setParent('');
    setError('');
    setNameHint('');
    setAiAvailable(null); // re-check on next open
  }, []);

  const validateName = useCallback((val: string) => {
    if (val.includes('/') || val.includes('\\')) {
      setNameHint(t.home.spaceNameNoSlash ?? 'Name cannot contain / or \\');
      return false;
    }
    setNameHint('');
    return true;
  }, [t]);

  const fullPathPreview = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    return (parent ? parent + '/' : '') + trimmed + '/';
  }, [name, parent]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || loading) return;
    if (!validateName(name)) return;
    setLoading(true);
    setError('');
    const trimmed = name.trim();
    const result = await createSpaceAction(trimmed, description, parent);
    if (result.success) {
      const createdPath = result.path ?? trimmed;

      // If AI is enabled, trigger AI initialization in background
      if (useAi && aiAvailable) {
        const isZh = document.documentElement.lang === 'zh';
        const prompt = isZh
          ? `初始化新建的心智空间「${trimmed}」，路径为「${createdPath}/」。${description ? `描述：「${description}」。` : ''}两个文件均已存在模板，用 write_file 覆盖：\n1. 「${createdPath}/README.md」— 写入空间用途、结构概览、使用指南\n2. 「${createdPath}/INSTRUCTION.md」— 写入 AI Agent 在此空间中的行为规则和操作约定\n\n内容简洁实用，直接使用工具写入。`
          : `Initialize the new Mind Space "${trimmed}" at "${createdPath}/". ${description ? `Description: "${description}". ` : ''}Both files already exist with templates — use write_file to overwrite:\n1. "${createdPath}/README.md" — write purpose, structure overview, usage guidelines\n2. "${createdPath}/INSTRUCTION.md" — write rules for AI agents operating in this space\n\nKeep content concise and actionable. Write files directly using tools.`;

        window.dispatchEvent(new CustomEvent('mindos:ai-init', {
          detail: { spaceName: trimmed, spacePath: createdPath, description, state: 'working' },
        }));

        // /api/ask returns SSE — use raw fetch and consume the stream
        // so the server-side agent runs to completion.
        fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            currentFile: createdPath + '/INSTRUCTION.md',
          }),
        }).then(async (res) => {
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock();
          }
          window.dispatchEvent(new CustomEvent('mindos:ai-init', {
            detail: { spacePath: createdPath, state: 'done' },
          }));
          window.dispatchEvent(new Event('mindos:files-changed'));
        }).catch(() => {
          window.dispatchEvent(new CustomEvent('mindos:ai-init', {
            detail: { spacePath: createdPath, state: 'error' },
          }));
        });
      }

      close();
      router.refresh();
      window.dispatchEvent(new Event('mindos:files-changed'));
      router.push(`/view/${encodePath(createdPath + '/')}`);
    } else {
      const msg = result.error ?? '';
      if (msg.includes('already exists')) {
        setError(t.home.spaceExists ?? 'A space with this name already exists');
      } else {
        setError(t.home.spaceCreateFailed ?? 'Failed to create space');
      }
    }
    setLoading(false);
  }, [name, description, parent, loading, close, router, t, validateName, useAi, aiAvailable]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !e.shiftKey && e.target instanceof HTMLInputElement) { e.preventDefault(); handleCreate(); }
  }, [close, handleCreate]);

  if (!open) return null;

  const h = t.home;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={close} />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={h.newSpace}
        className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold font-display text-foreground">{h.newSpace}</h3>
          <button onClick={close} className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <X size={14} />
          </button>
        </div>
        {/* Body */}
        <div className="px-5 pb-5 flex flex-col gap-3">
          {/* Location */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{h.spaceLocation ?? 'Location'}</label>
            <DirPicker
              dirPaths={dirPaths}
              value={parent}
              onChange={setParent}
              rootLabel={h.rootLevel ?? 'Root'}
            />
          </div>
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{h.spaceName}</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); validateName(e.target.value); }}
              placeholder="e.g. 📝 Notes"
              maxLength={80}
              aria-invalid={!!nameHint}
              aria-describedby={nameHint ? 'space-name-hint' : undefined}
              className={`w-full px-3 py-2 text-sm rounded-lg border bg-background outline-none transition-colors ${
                nameHint ? 'border-error focus:border-error' : 'border-border focus-visible:ring-1 focus-visible:ring-ring'
              }`}
            />
            {nameHint && <span id="space-name-hint" className="text-xs text-error">{nameHint}</span>}
          </div>
          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {h.spaceDescription} <span className="opacity-50">({h.optional ?? 'optional'})</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={h.spaceDescPlaceholder ?? 'Describe the purpose of this space'}
              maxLength={200}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            />
          </div>
          {/* AI initialization toggle */}
          <div className="flex items-start gap-2.5 px-1 py-1">
            <button
              type="button"
              role="switch"
              aria-checked={useAi}
              disabled={!aiAvailable}
              onClick={() => setUseAi(v => !v)}
              className={`relative mt-0.5 inline-flex shrink-0 h-4 w-7 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                useAi ? 'bg-[var(--amber)]' : 'bg-muted'
              }`}
            >
              <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${useAi ? 'translate-x-3' : 'translate-x-0'}`} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-[var(--amber)] shrink-0" />
                <span className="text-xs font-medium text-foreground">{h.aiInit ?? 'AI initialize content'}</span>
              </div>
              {aiAvailable === false && (
                <p className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <AlertTriangle size={10} className="text-[var(--amber)] shrink-0" />
                  {h.aiInitNoKey ?? 'Configure an API key in Settings → AI to enable'}
                </p>
              )}
              {aiAvailable && useAi && (
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {h.aiInitHint ?? 'AI will generate README and INSTRUCTION for this space'}
                </p>
              )}
            </div>
          </div>
          {/* Path preview */}
          {fullPathPreview && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono px-1">
              <Folder size={12} className="shrink-0 text-[var(--amber)]" />
              <span className="truncate">{fullPathPreview}</span>
            </div>
          )}
          {error && <span role="alert" className="text-xs text-error px-1">{error}</span>}
          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={close}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              {h.cancelCreate}
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading || !!nameHint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-white transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {h.createSpace}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
