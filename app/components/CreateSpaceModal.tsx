'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath } from '@/lib/utils';
import { createSpaceAction } from '@/lib/actions';
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

  const close = useCallback(() => {
    setOpen(false);
    setName('');
    setDescription('');
    setParent('');
    setError('');
    setNameHint('');
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
    setLoading(false);
    if (result.success) {
      const createdPath = result.path ?? trimmed;
      close();
      router.refresh();
      router.push(`/view/${encodePath(createdPath + '/')}`);
    } else {
      const msg = result.error ?? '';
      if (msg.includes('already exists')) {
        setError(t.home.spaceExists ?? 'A space with this name already exists');
      } else {
        setError(t.home.spaceCreateFailed ?? 'Failed to create space');
      }
    }
  }, [name, description, parent, loading, close, router, t, validateName]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !e.shiftKey && e.target instanceof HTMLInputElement) { e.preventDefault(); handleCreate(); }
  }, [close, handleCreate]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={close} />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.home.newSpace}
        className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold font-display text-foreground">{t.home.newSpace}</h3>
          <button onClick={close} className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <X size={14} />
          </button>
        </div>
        {/* Body */}
        <div className="px-5 pb-5 flex flex-col gap-3">
          {/* Location — hierarchical browser */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t.home.spaceLocation ?? 'Location'}</label>
            <DirPicker
              dirPaths={dirPaths}
              value={parent}
              onChange={setParent}
              rootLabel={t.home.rootLevel ?? 'Root'}
            />
          </div>
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t.home.spaceName}</label>
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
              {t.home.spaceDescription} <span className="opacity-50">({t.home.optional ?? 'optional'})</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t.home.spaceDescPlaceholder ?? 'Describe the purpose of this space'}
              maxLength={200}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            />
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
              {t.home.cancelCreate}
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading || !!nameHint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-white transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {t.home.createSpace}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
