'use client';

import { useState, useCallback, useRef } from 'react';
import { X, Download, FileText, Globe, Archive, Check, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { toast } from '@/lib/toast';

type ExportFormat = 'md' | 'html' | 'zip' | 'zip-html';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  isDirectory: boolean;
  fileName: string;
}

export default function ExportModal({ open, onClose, filePath, isDirectory, fileName }: ExportModalProps) {
  const { t } = useLocale();
  const [format, setFormat] = useState<ExportFormat>(isDirectory ? 'zip' : 'md');
  const [state, setState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleExport = useCallback(() => {
    setState('exporting');
    setError('');

    const controller = new AbortController();
    abortRef.current = controller;

    const url = `/api/export?path=${encodeURIComponent(filePath)}&format=${format}`;

    fetch(url, { signal: controller.signal })
      .then(res => {
        if (!res.ok) {
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('json')) {
            return res.json().then((data: { error?: string }) => { throw new Error(data.error || 'Export failed'); });
          }
          throw new Error(`Export failed (${res.status})`);
        }
        return res.blob().then(blob => ({ blob, res }));
      })
      .then(({ blob, res }) => {
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const downloadName = match ? decodeURIComponent(match[1]) : fileName;

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = downloadName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        setState('done');
        toast.success(t.export?.downloaded ?? 'Downloaded');
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return; // user cancelled
        setState('error');
        setError(err.message ?? 'Export failed');
      })
      .finally(() => { abortRef.current = null; });
  }, [filePath, format, fileName, t]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState('idle');
    setError('');
  }, []);

  const handleRetry = useCallback(() => {
    setState('idle');
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setState('idle');
    setError('');
    onClose();
  }, [onClose]);

  if (!open) return null;

  const formats: { value: ExportFormat; label: string; desc: string; icon: React.ReactNode; disabled?: boolean }[] = isDirectory
    ? [
        { value: 'zip', label: t.export?.formatZipMd ?? 'Markdown ZIP', desc: t.export?.formatZipMdDesc ?? 'All files in original format', icon: <Archive size={14} /> },
        { value: 'zip-html', label: t.export?.formatZipHtml ?? 'HTML ZIP', desc: t.export?.formatZipHtmlDesc ?? 'All files as webpages', icon: <Globe size={14} /> },
      ]
    : [
        { value: 'md', label: t.export?.formatMd ?? 'Markdown (.md)', desc: t.export?.formatMdDesc ?? 'Original format, editable', icon: <FileText size={14} /> },
        { value: 'html', label: t.export?.formatHtml ?? 'HTML (.html)', desc: t.export?.formatHtmlDesc ?? 'Static webpage, shareable', icon: <Globe size={14} /> },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={state === 'exporting' ? undefined : handleClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full mx-4 animate-in fade-in-0 zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Download size={15} className="text-[var(--amber)]" />
            <h3 className="text-sm font-semibold font-display">
              {isDirectory ? (t.export?.exportSpace ?? 'Export Space') : (t.export?.exportFile ?? 'Export File')}
            </h3>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label={t.export?.cancel ?? 'Close'}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {state === 'done' ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                <Check size={20} className="text-success" />
              </div>
              <p className="text-sm font-medium font-display">{t.export?.done ?? 'Export Complete'}</p>
              <p className="text-xs text-muted-foreground mt-1">{fileName}</p>
            </div>
          ) : state === 'error' ? (
            <div className="text-center py-6">
              <p className="text-sm font-medium text-error">{t.export?.error ?? 'Export failed'}</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3 truncate" title={filePath}>{filePath}</p>
              <p className="text-xs font-medium font-display text-foreground mb-2">{t.export?.chooseFormat ?? 'Choose format'}</p>
              <div className="space-y-1.5">
                {formats.map(f => (
                  <label
                    key={f.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      format === f.value
                        ? 'border-[var(--amber)]/40 bg-[var(--amber-dim)]'
                        : 'border-border hover:border-border/80 hover:bg-muted/30'
                    } ${f.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={f.value}
                      checked={format === f.value}
                      onChange={() => !f.disabled && setFormat(f.value)}
                      disabled={f.disabled}
                      className="sr-only"
                    />
                    <span className={`mt-0.5 ${format === f.value ? 'text-[var(--amber)]' : 'text-muted-foreground'}`}>
                      {f.icon}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-foreground">{f.label}</span>
                      <span className="text-xs text-muted-foreground block mt-0.5">{f.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          {state === 'done' ? (
            <>
              <button onClick={handleRetry} className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {t.export?.downloadAgain ?? 'Download Again'}
              </button>
              <button onClick={handleClose} className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--amber-dim)] text-[var(--amber-text)] hover:opacity-80 transition-colors">
                {t.export?.close ?? 'Done'}
              </button>
            </>
          ) : state === 'error' ? (
            <>
              <button onClick={handleClose} className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {t.export?.cancel ?? 'Cancel'}
              </button>
              <button onClick={handleRetry} className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--amber-dim)] text-[var(--amber-text)] hover:opacity-80 transition-colors">
                {t.export?.retry ?? 'Retry'}
              </button>
            </>
          ) : state === 'exporting' ? (
            <>
              <button onClick={handleCancel} className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {t.export?.cancel ?? 'Cancel'}
              </button>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--amber-text)] opacity-70">
                <Loader2 size={12} className="animate-spin" /> {t.export?.exporting ?? 'Exporting...'}
              </span>
            </>
          ) : (
            <>
              <button onClick={handleClose} className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {t.export?.cancel ?? 'Cancel'}
              </button>
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--amber-dim)] text-[var(--amber-text)] hover:opacity-80 transition-colors"
              >
                <Download size={12} /> {t.export?.exportButton ?? 'Export'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
