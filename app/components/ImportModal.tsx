'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, FolderInput, FolderOpen, Sparkles, FileText, AlertCircle,
  AlertTriangle, Loader2, Check, ChevronDown,
} from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useFileImport, type ImportIntent, type ConflictMode } from '@/hooks/useFileImport';
import type { useAiOrganize } from '@/hooks/useAiOrganize';
import { ALLOWED_IMPORT_EXTENSIONS } from '@/lib/core/file-convert';
import type { LocalAttachment } from '@/lib/types';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import DirPicker from './DirPicker';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  defaultSpace?: string;
  initialFiles?: File[];
  /** Lifted AI organize hook from SidebarLayout (shared with OrganizeToast) */
  aiOrganize: ReturnType<typeof useAiOrganize>;
  /** Flat list of directory paths for the DirPicker */
  dirPaths: string[];
}

const ACCEPT = Array.from(ALLOWED_IMPORT_EXTENSIONS).join(',');


export default function ImportModal({ open, onClose, defaultSpace, initialFiles, aiOrganize, dirPaths }: ImportModalProps) {
  const { t } = useLocale();
  const im = useFileImport();
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [showConflictOptions, setShowConflictOptions] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [recommendedSpace, setRecommendedSpace] = useState('');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    im.reset();
    setConflictFiles([]);
    setShowConflictOptions(false);
    if (defaultSpace) im.setTargetSpace(defaultSpace);
    if (initialFiles && initialFiles.length > 0) {
      im.addFiles(initialFiles);
    }
  }, [open, defaultSpace, initialFiles, im]);

  const doClose = useCallback(() => {
    setShowDiscard(false);
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); im.reset(); setConflictFiles([]); setShowConflictOptions(false); setRecommendedSpace(''); }, 150);
  }, [im, onClose]);

  const handleClose = useCallback(() => {
    if (im.files.length > 0 && im.step !== 'done') {
      setShowDiscard(true);
      return;
    }
    doClose();
  }, [im, doClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showDiscard) {
        e.stopPropagation();
        setShowDiscard(false);
        return;
      }
      e.stopPropagation();
      handleClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, handleClose, showDiscard]);

  const checkConflicts = useCallback(async (fileNames: string[], space: string) => {
    try {
      const names = fileNames.map(encodeURIComponent).join(',');
      const spaceParam = space ? `&space=${encodeURIComponent(space)}` : '';
      const res = await fetch(`/api/file?op=check_conflicts&names=${names}${spaceParam}`);
      if (res.ok) {
        const data = await res.json();
        setConflictFiles(data.conflicts ?? []);
        setShowConflictOptions((data.conflicts ?? []).length > 0);
      }
    } catch { /* best-effort */ }
  }, []);

  const handleIntentSelect = useCallback((intent: ImportIntent) => {
    im.setIntent(intent);
    if (intent === 'archive') {
      im.setStep('archive_config');
      const names = im.validFiles.map(f => f.name);
      checkConflicts(names, im.targetSpace);
    } else {
      const attachments: LocalAttachment[] = im.validFiles.map(f => ({
        name: f.name,
        content: f.content!,
      }));
      const space = im.targetSpace || undefined;
      const prompt = attachments.length === 1
        ? (t.fileImport.digestPromptSingle as (name: string, space?: string) => string)(attachments[0].name, space)
        : (t.fileImport.digestPromptMulti as (n: number, space?: string) => string)(attachments.length, space);
      // Start AI organize and immediately close modal — toast takes over
      aiOrganize.start(attachments, prompt);
      onClose();
      im.reset();
    }
  }, [im, t, aiOrganize, onClose]);

  const handleArchiveSubmit = useCallback(async () => {
    await im.doArchive();
    if (im.result && im.result.created.length > 0) {
      setShowSuccess(true);
      setTimeout(() => {
        setClosing(true);
        setTimeout(() => {
          setClosing(false);
          onClose();
          im.reset();
          setShowSuccess(false);
          window.dispatchEvent(new Event('mindos:files-changed'));
        }, 150);
      }, 600);
    }
  }, [im, onClose]);

  useEffect(() => {
    if (im.step === 'archive_config') {
      const names = im.validFiles.map(f => f.name);
      checkConflicts(names, im.targetSpace);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [im.targetSpace]);

  // V1: keyword-based space recommendation when entering archive_config
  useEffect(() => {
    if (im.step !== 'archive_config' || dirPaths.length === 0 || im.validFiles.length === 0) return;
    if (defaultSpace) return;

    const fileTokens = im.validFiles
      .flatMap(f => f.name.replace(/\.[^.]+$/, '').toLowerCase().split(/[\s_\-/\\]+/))
      .filter(w => w.length >= 2);

    let bestPath = '';
    let bestScore = 0;
    for (const dp of dirPaths) {
      const name = dp.split('/').pop() || dp;
      const spaceTokens = name.toLowerCase().split(/[\s_\-/\\]+/).filter(w => w.length >= 2);
      let score = 0;
      for (const ft of fileTokens) {
        for (const st of spaceTokens) {
          if (ft.includes(st) || st.includes(ft)) score += Math.min(ft.length, st.length);
        }
      }
      if (score > bestScore) { bestScore = score; bestPath = dp; }
    }
    if (bestPath && bestScore >= 2) {
      im.setTargetSpace(bestPath);
      setRecommendedSpace(bestPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [im.step, dirPaths.length, im.validFiles.length]);


  useEffect(() => {
    if (im.step === 'done' && im.result) {
      if (im.result.created.length > 0) {
        setShowSuccess(true);
        const timer = setTimeout(() => {
          setClosing(true);
          setTimeout(() => {
            setClosing(false);
            onClose();
            im.reset();
            setShowSuccess(false);
            window.dispatchEvent(new Event('mindos:files-changed'));
          }, 150);
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [im.step, im.result, onClose, im]);

  const hasFiles = im.files.length > 0;
  const isSelectStep = im.step === 'select';
  const isArchiveConfig = im.step === 'archive_config';
  const isImporting = im.step === 'importing';

  if (!open && !closing) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className={`fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 transition-opacity duration-200 ${closing ? 'opacity-0' : 'opacity-100'}`}
        onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
      >
        <div
          className={`w-full max-w-lg max-h-[80vh] flex flex-col bg-card rounded-xl shadow-xl border border-border transition-all duration-200 ${closing ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}
          role="dialog"
          aria-modal="true"
          aria-label={t.fileImport.title}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-2 shrink-0">
            <div>
              {isArchiveConfig && (
                <button
                  onClick={() => im.setStep('select')}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                >
                  {t.fileImport.back}
                </button>
              )}
              <h2 className="text-base font-semibold text-foreground">
                {isArchiveConfig ? t.fileImport.archiveConfigTitle : t.fileImport.title}
              </h2>
              {isSelectStep && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.fileImport.subtitle}</p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-5 overflow-y-auto min-h-0">
            {/* DropZone */}
            {isSelectStep && (
              <div
                className={`border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
                  hasFiles
                    ? 'border-border py-3 px-4'
                    : 'border-[var(--amber)]/30 hover:border-[var(--amber)]/60 py-8 px-4'
                }`}
                role="button"
                tabIndex={0}
                aria-label={t.fileImport.dropzoneButton}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files.length > 0) im.addFiles(e.dataTransfer.files);
                }}
              >
                {hasFiles ? (
                  <p className="text-xs text-muted-foreground text-center">
                    {t.fileImport.dropzoneCompact}{' '}
                    <span className="text-[var(--amber)] hover:underline">{t.fileImport.dropzoneCompactButton}</span>
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <FolderInput size={28} className="text-[var(--amber)]/40" />
                    <p className="text-sm text-muted-foreground">
                      <span className="hidden md:inline">{t.fileImport.dropzoneText}{' '}</span>
                      <span className="md:hidden">{t.fileImport.dropzoneMobile}</span>
                      <span className="hidden md:inline text-[var(--amber)] hover:underline">{t.fileImport.dropzoneButton}</span>
                    </p>
                    <p className="text-2xs text-muted-foreground/60">{t.fileImport.dropOverlayFormats}</p>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={ACCEPT}
              onChange={(e) => {
                if (e.target.files) im.addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {/* File list */}
            {hasFiles && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{t.fileImport.fileCount(im.files.length)}</span>
                  {isSelectStep && (
                    <button
                      onClick={im.clearFiles}
                      className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t.fileImport.clearAll}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                  {im.files.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                        f.error ? 'bg-error/5' : 'bg-muted/50'
                      }`}
                    >
                      {f.loading ? (
                        <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />
                      ) : f.error ? (
                        <AlertCircle size={14} className="text-error shrink-0" />
                      ) : (
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate flex-1 text-foreground">{f.name}</span>
                      {f.error ? (
                        <span className="text-xs text-error shrink-0">
                          {f.error === 'unsupported' ? t.fileImport.unsupported
                            : f.error === 'tooLarge' ? t.fileImport.tooLarge('5MB')
                            : f.error}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {im.formatSize(f.size)}
                        </span>
                      )}
                      {isSelectStep && !isArchiveConfig && (
                        <button
                          onClick={(e) => { e.stopPropagation(); im.removeFile(idx); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`${t.fileImport.remove} ${f.name}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Archive config: target path preview — only shown when path differs from source */}
                {isArchiveConfig && (() => {
                  const previews = im.validFiles.map((f) => {
                    const ext = f.name.split('.').pop()?.toLowerCase();
                    const targetExt = (ext === 'txt' || ext === 'html' || ext === 'htm' || ext === 'yaml' || ext === 'yml' || ext === 'xml')
                      ? 'md' : ext;
                    const stem = f.name.replace(/\.[^.]+$/, '');
                    const targetName = `${stem}.${targetExt}`;
                    const targetPath = im.targetSpace ? `${im.targetSpace}/${targetName}` : targetName;
                    const hasConflict = conflictFiles.includes(f.name);
                    const changed = targetName !== f.name || !!im.targetSpace;
                    return { f, targetPath, hasConflict, changed };
                  });
                  const anyChanged = previews.some(p => p.changed || p.hasConflict);
                  if (!anyChanged) return null;
                  return (
                    <div className="flex flex-col gap-1 mt-2 max-h-[120px] overflow-y-auto">
                      {previews.filter(p => p.changed || p.hasConflict).map((p, idx) => (
                        <div key={`preview-${idx}`} className="flex items-center gap-1.5 text-xs text-muted-foreground px-3">
                          <span className="truncate">{p.f.name}</span>
                          <span className="text-muted-foreground/50 shrink-0">{t.fileImport.arrowTo}</span>
                          <FolderOpen size={12} className="text-muted-foreground/60 shrink-0" />
                          <span className={`truncate ${p.hasConflict ? 'text-[var(--amber)]' : ''}`}>{p.targetPath}</span>
                          {p.hasConflict && <AlertTriangle size={11} className="text-[var(--amber)] shrink-0" />}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Intent cards (Step 1) */}
            {isSelectStep && hasFiles && im.allReady && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => handleIntentSelect('archive')}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg cursor-pointer transition-all duration-150 border-[var(--amber)]/30 bg-card hover:border-[var(--amber)]/60 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0}
                  title={im.validFiles.length === 0 ? "No valid files selected" : undefined}
                >
                  <FolderInput size={24} className="text-[var(--amber)]" />
                  <span className="text-sm font-medium text-foreground">{t.fileImport.archiveTitle}</span>
                  <span className="text-xs text-muted-foreground text-center">{t.fileImport.archiveDesc}</span>
                </button>
                <button
                  onClick={() => handleIntentSelect('digest')}
                  className="flex flex-col items-center gap-2 p-4 border border-border rounded-lg cursor-pointer transition-all duration-150 bg-card hover:border-[var(--amber)]/50 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0 || aiOrganize.phase === 'organizing'}
                  title={im.validFiles.length === 0 ? "No valid files selected" : aiOrganize.phase === 'organizing' ? "AI is organizing" : undefined}
                >
                  <Sparkles size={24} className="text-[var(--amber)]" />
                  <span className="text-sm font-medium text-foreground">{t.fileImport.digestTitle}</span>
                  <span className="text-xs text-muted-foreground text-center">{t.fileImport.digestDesc}</span>
                </button>
              </div>
            )}

            {/* Archive config (Step 2a) */}
            {isArchiveConfig && (
              <div className="mt-4 space-y-4">
                {/* Space selector */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">{t.fileImport.targetSpace}</label>
                  <DirPicker
                    dirPaths={dirPaths}
                    value={im.targetSpace}
                    onChange={(val) => { im.setTargetSpace(val); setRecommendedSpace(''); }}
                    rootLabel={t.fileImport.rootDir}
                  />
                  {recommendedSpace && im.targetSpace === recommendedSpace && (
                    <p className="text-2xs text-muted-foreground/70 mt-1 flex items-center gap-1">
                      <Sparkles size={10} className="text-[var(--amber)]" />
                      {t.fileImport.aiRecommendedHint}
                    </p>
                  )}
                </div>

                {/* Conflict strategy — progressive disclosure */}
                {conflictFiles.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowConflictOptions(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-colors"
                    >
                      <AlertTriangle size={12} className="shrink-0" />
                      {t.fileImport.conflictsFound(conflictFiles.length)}
                      <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${showConflictOptions ? 'rotate-180' : ''}`} />
                    </button>
                    {showConflictOptions && (
                      <div className="flex flex-col gap-1.5 mt-2 pl-0.5">
                        {([
                          { value: 'rename' as ConflictMode, label: t.fileImport.conflictRename },
                          { value: 'skip' as ConflictMode, label: t.fileImport.conflictSkip },
                          { value: 'overwrite' as ConflictMode, label: t.fileImport.conflictOverwrite },
                        ]).map(opt => (
                          <label
                            key={opt.value}
                            className={`flex items-center gap-2 py-0.5 text-xs cursor-pointer ${
                              opt.value === 'overwrite' ? 'text-error' : 'text-foreground'
                            }`}
                          >
                            <input
                              type="radio"
                              name="conflict"
                              value={opt.value}
                              checked={im.conflict === opt.value}
                              onChange={() => im.setConflict(opt.value)}
                              className="form-radio"
                            />
                            {opt.label}
                            {opt.value === 'overwrite' && (
                              <AlertTriangle size={11} className="text-error shrink-0" />
                            )}
                          </label>
                        ))}
                        {im.conflict === 'overwrite' && (
                          <p className="text-2xs text-error/80 pl-5">{t.fileImport.overwriteWarn}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1.5"
                  >
                    {t.fileImport.cancel}
                  </button>
                  <button
                    onClick={handleArchiveSubmit}
                    disabled={isImporting || im.validFiles.length === 0}
                    title={isImporting ? "Import in progress" : im.validFiles.length === 0 ? "No valid files selected" : undefined}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      showSuccess
                        ? 'bg-success text-success-foreground'
                        : 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
                    } disabled:opacity-50`}
                  >
                    {showSuccess ? (
                      <><Check size={14} /> {t.fileImport.importButton(im.validFiles.length)}</>
                    ) : isImporting ? (
                      <><Loader2 size={14} className="animate-spin" /> {t.fileImport.importing}</>
                    ) : !im.allReady ? (
                      t.fileImport.preparing
                    ) : (
                      t.fileImport.importButton(im.validFiles.length)
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      <ConfirmDialog
        open={showDiscard}
        title={t.fileImport.discardTitle}
        message={t.fileImport.discardMessage(im.files.length)}
        confirmLabel={t.fileImport.discardConfirm}
        cancelLabel={t.fileImport.discardCancel}
        onConfirm={doClose}
        onCancel={() => setShowDiscard(false)}
      />
    </>
  );
}
