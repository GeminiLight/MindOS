'use client';

import { useState, useCallback } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';

/**
 * PDF Renderer — embeds the browser's native PDF viewer via iframe.
 * Fetches the PDF binary from /api/file/raw and displays inline.
 * Read-only: no editing capability (PDF editing is out of scope).
 */
export function PdfRenderer({ filePath }: RendererContext) {
  const src = `/api/file/raw?path=${encodeURIComponent(filePath)}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Increment key to force iframe remount on retry
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    setRetryKey(k => k + 1);
  }, []);

  return (
    <div className="w-full h-full min-h-[80vh] flex flex-col relative">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)] rounded-lg z-10">
          <span className="text-sm text-[var(--text-tertiary)] animate-pulse">
            Loading PDF...
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-secondary)] rounded-lg z-10 gap-2">
          <span className="text-sm text-[var(--text-secondary)]">
            Failed to load PDF
          </span>
          <button
            onClick={handleRetry}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      <iframe
        key={retryKey}
        src={src}
        className="w-full flex-1 min-h-[80vh] border-0 rounded-lg bg-[var(--bg-secondary)]"
        title={filePath.split('/').pop() ?? 'PDF'}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
        style={{ display: error ? 'none' : 'block' }}
      />
    </div>
  );
}
