'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, FolderInput, Sparkles, FileText, AlertCircle,
  AlertTriangle, Loader2, Check, FilePlus, FileEdit, Undo2,
} from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useFileImport, type ImportIntent, type ConflictMode } from '@/hooks/useFileImport';
import { useAiOrganize } from '@/hooks/useAiOrganize';
import { ALLOWED_IMPORT_EXTENSIONS } from '@/lib/core/file-convert';
import type { LocalAttachment } from '@/lib/types';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  defaultSpace?: string;
  initialFiles?: File[];
}

const ACCEPT = Array.from(ALLOWED_IMPORT_EXTENSIONS).join(',');

export default function ImportModal({ open, onClose, defaultSpace, initialFiles }: ImportModalProps) {
  const { t } = useLocale();
  const im = useFileImport();
  const aiOrganize = useAiOrganize();
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [spaces, setSpaces] = useState<Array<{ name: string; path: string }>>([]);
  const [closing, setClosing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    im.reset();
    aiOrganize.reset();
    setUndoing(false);
    if (defaultSpace) im.setTargetSpace(defaultSpace);
    if (initialFiles && initialFiles.length > 0) {
      im.addFiles(initialFiles);
    }
    fetch('/api/file?op=list_spaces')
      .then(r => r.json())
      .then(d => { if (d.spaces) setSpaces(d.spaces); })
      .catch(() => {});
  }, [open, defaultSpace, initialFiles, im]);

  const handleClose = useCallback(() => {
    if (im.step === 'organizing') {
      aiOrganize.abort();
    }
    if (im.files.length > 0 && im.step !== 'done' && im.step !== 'organize_review') {
      if (!confirm(t.fileImport.discardMessage(im.files.length))) return;
    }
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); im.reset(); aiOrganize.reset(); setUndoing(false); }, 150);
  }, [im, onClose, t, aiOrganize]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); handleClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, handleClose]);

  const handleIntentSelect = useCallback((intent: ImportIntent) => {
    im.setIntent(intent);
    if (intent === 'archive') {
      im.setStep('archive_config');
    } else {
      const attachments: LocalAttachment[] = im.validFiles.map(f => ({
        name: f.name,
        content: f.content!,
      }));
      const prompt = attachments.length === 1
        ? t.fileImport.digestPromptSingle(attachments[0].name)
        : t.fileImport.digestPromptMulti(attachments.length);
      im.setStep('organizing');
      aiOrganize.start(attachments, prompt);
    }
  }, [im, t, aiOrganize]);

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
    if (im.step === 'organizing' && (aiOrganize.phase === 'done' || aiOrganize.phase === 'error')) {
      im.setStep('organize_review');
    }
  }, [im.step, aiOrganize.phase, im]);

  const handleOrganizeDone = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      im.reset();
      aiOrganize.reset();
      setUndoing(false);
      window.dispatchEvent(new Event('mindos:files-changed'));
    }, 150);
  }, [onClose, im, aiOrganize]);

  const handleOrganizeUndo = useCallback(async () => {
    setUndoing(true);
    const reverted = await aiOrganize.undoAll();
    setUndoing(false);
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      im.reset();
      aiOrganize.reset();
      if (reverted > 0) {
        window.dispatchEvent(new Event('mindos:files-changed'));
      }
    }, 150);
  }, [onClose, im, aiOrganize]);

  const handleOrganizeRetry = useCallback(() => {
    const attachments: LocalAttachment[] = im.validFiles.map(f => ({
      name: f.name,
      content: f.content!,
    }));
    const prompt = attachments.length === 1
      ? t.fileImport.digestPromptSingle(attachments[0].name)
      : t.fileImport.digestPromptMulti(attachments.length);
    aiOrganize.reset();
    im.setStep('organizing');
    aiOrganize.start(attachments, prompt);
  }, [im, t, aiOrganize]);

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

  if (!open && !closing) return null;

  const hasFiles = im.files.length > 0;
  const isSelectStep = im.step === 'select';
  const isArchiveConfig = im.step === 'archive_config';
  const isImporting = im.step === 'importing';
  const isOrganizing = im.step === 'organizing';
  const isOrganizeReview = im.step === 'organize_review';

  return (
    <>
      <div
        ref={overlayRef}
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${closing ? 'opacity-0' : 'opacity-100'}`}
        onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
      >
        <div
          className={`w-full max-w-lg bg-card rounded-xl shadow-xl border border-border transition-all duration-200 ${closing ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}
          role="dialog"
          aria-modal="true"
          aria-label={t.fileImport.title}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-2">
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
                {isOrganizing ? t.fileImport.organizeTitle
                  : isOrganizeReview ? t.fileImport.organizeReviewTitle
                  : isArchiveConfig ? t.fileImport.archiveConfigTitle
                  : t.fileImport.title}
              </h2>
              {isSelectStep && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.fileImport.subtitle}</p>
              )}
              {isOrganizeReview && aiOrganize.phase === 'done' && aiOrganize.changes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.fileImport.organizeReviewDesc(aiOrganize.changes.filter(c => c.ok).length)}
                </p>
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

          <div className="px-5 pb-5">
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
            {hasFiles && !isOrganizing && !isOrganizeReview && (
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

                {/* Archive config: target path preview */}
                {isArchiveConfig && (
                  <div className="flex flex-col gap-1 mt-2 max-h-[120px] overflow-y-auto">
                    {im.validFiles.map((f, idx) => {
                      const ext = f.name.split('.').pop()?.toLowerCase();
                      const targetExt = (ext === 'txt' || ext === 'html' || ext === 'htm' || ext === 'yaml' || ext === 'yml' || ext === 'xml')
                        ? 'md' : ext;
                      const stem = f.name.replace(/\.[^.]+$/, '');
                      const targetName = `${stem}.${targetExt}`;
                      const targetPath = im.targetSpace ? `${im.targetSpace}/${targetName}` : targetName;
                      return (
                        <div key={`preview-${idx}`} className="text-xs text-muted-foreground px-3">
                          {f.name} <span className="text-muted-foreground/50">{t.fileImport.arrowTo}</span> {targetPath}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Intent cards (Step 1) */}
            {isSelectStep && hasFiles && im.allReady && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => handleIntentSelect('archive')}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg cursor-pointer transition-all duration-150 border-[var(--amber)]/30 bg-card hover:border-[var(--amber)]/60 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0}
                >
                  <FolderInput size={24} className="text-[var(--amber)]" />
                  <span className="text-sm font-medium text-foreground">{t.fileImport.archiveTitle}</span>
                  <span className="text-xs text-muted-foreground text-center">{t.fileImport.archiveDesc}</span>
                </button>
                <button
                  onClick={() => handleIntentSelect('digest')}
                  className="flex flex-col items-center gap-2 p-4 border border-border rounded-lg cursor-pointer transition-all duration-150 bg-card hover:border-[var(--amber)]/50 hover:shadow-sm active:scale-[0.98] text-left"
                  disabled={im.validFiles.length === 0}
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
                  <select
                    value={im.targetSpace}
                    onChange={(e) => im.setTargetSpace(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">{t.fileImport.rootDir}</option>
                    {spaces.map(s => (
                      <option key={s.path} value={s.path}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Conflict strategy */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">{t.fileImport.conflictLabel}</label>
                  <div className="flex flex-col gap-1.5">
                    {([
                      { value: 'rename' as ConflictMode, label: t.fileImport.conflictRename },
                      { value: 'skip' as ConflictMode, label: t.fileImport.conflictSkip },
                      { value: 'overwrite' as ConflictMode, label: t.fileImport.conflictOverwrite },
                    ]).map(opt => (
                      <label
                        key={opt.value}
                        className={`flex items-center gap-2 py-1 text-sm cursor-pointer ${
                          opt.value === 'overwrite' ? 'text-error' : 'text-foreground'
                        }`}
                      >
                        <input
                          type="radio"
                          name="conflict"
                          value={opt.value}
                          checked={im.conflict === opt.value}
                          onChange={() => im.setConflict(opt.value)}
                          className="accent-[var(--amber)]"
                        />
                        {opt.label}
                        {opt.value === 'overwrite' && (
                          <AlertTriangle size={13} className="text-error shrink-0" />
                        )}
                      </label>
                    ))}
                    {im.conflict === 'overwrite' && (
                      <p className="text-2xs text-error/80 pl-6">{t.fileImport.overwriteWarn}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                  >
                    {t.fileImport.cancel}
                  </button>
                  <button
                    onClick={handleArchiveSubmit}
                    disabled={isImporting || im.validFiles.length === 0}
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

            {/* AI Organizing (progress) */}
            {isOrganizing && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="relative">
                    <Sparkles size={28} className="text-[var(--amber)]" />
                    <Loader2 size={16} className="absolute -bottom-1 -right-1 text-[var(--amber)] animate-spin" />
                  </div>
                  <p className="text-sm text-foreground font-medium">{t.fileImport.organizeProcessing}</p>
                  {aiOrganize.currentTool && (
                    <p className="text-xs text-muted-foreground animate-pulse">
                      {aiOrganize.currentTool.name.startsWith('create')
                        ? t.fileImport.organizeCreating(aiOrganize.currentTool.path)
                        : t.fileImport.organizeUpdating(aiOrganize.currentTool.path)}
                    </p>
                  )}
                  {aiOrganize.changes.length > 0 && (
                    <div className="w-full max-h-[120px] overflow-y-auto space-y-1 mt-2">
                      {aiOrganize.changes.map((c, idx) => (
                        <div key={`${c.path}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md text-xs">
                          {c.action === 'create' ? (
                            <FilePlus size={13} className="text-success shrink-0" />
                          ) : (
                            <FileEdit size={13} className="text-[var(--amber)] shrink-0" />
                          )}
                          <span className="truncate text-foreground">{c.path}</span>
                          <Check size={12} className="text-success shrink-0 ml-auto" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI Organize review */}
            {isOrganizeReview && (
              <div className="mt-4 space-y-4">
                {aiOrganize.phase === 'error' ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <AlertCircle size={28} className="text-error" />
                    <p className="text-sm text-error font-medium">{t.fileImport.organizeError}</p>
                    <p className="text-xs text-muted-foreground text-center max-w-[300px]">{aiOrganize.error}</p>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={handleClose}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                      >
                        {t.fileImport.cancel}
                      </button>
                      <button
                        onClick={handleOrganizeRetry}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
                      >
                        {t.fileImport.organizeRetry}
                      </button>
                    </div>
                  </div>
                ) : aiOrganize.changes.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <Sparkles size={28} className="text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t.fileImport.organizeNoChanges}</p>
                    {aiOrganize.summary && (
                      <p className="text-xs text-muted-foreground text-center max-w-[300px] whitespace-pre-wrap">{aiOrganize.summary.slice(0, 300)}</p>
                    )}
                    <button
                      onClick={handleOrganizeDone}
                      className="mt-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
                    >
                      {t.fileImport.organizeDone}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="max-h-[200px] overflow-y-auto space-y-1">
                      {aiOrganize.changes.map((c, idx) => (
                        <div key={`${c.path}-${idx}`} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md text-sm">
                          {c.action === 'create' ? (
                            <FilePlus size={14} className="text-success shrink-0" />
                          ) : (
                            <FileEdit size={14} className="text-[var(--amber)] shrink-0" />
                          )}
                          <span className="truncate flex-1 text-foreground">{c.path}</span>
                          <span className={`text-xs shrink-0 ${c.ok ? 'text-muted-foreground' : 'text-error'}`}>
                            {!c.ok ? t.fileImport.organizeFailed
                              : c.action === 'create' ? t.fileImport.organizeCreated
                              : t.fileImport.organizeUpdated}
                          </span>
                        </div>
                      ))}
                    </div>
                    {aiOrganize.summary && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{aiOrganize.summary.slice(0, 300)}</p>
                    )}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      {aiOrganize.changes.some(c => c.action === 'create' && c.ok) && (
                        <button
                          onClick={handleOrganizeUndo}
                          disabled={undoing}
                          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 disabled:opacity-50"
                        >
                          {undoing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Undo2 size={14} />
                          )}
                          {t.fileImport.organizeUndoAll}
                        </button>
                      )}
                      <button
                        onClick={handleOrganizeDone}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-all duration-200"
                      >
                        <Check size={14} />
                        {t.fileImport.organizeDone}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
