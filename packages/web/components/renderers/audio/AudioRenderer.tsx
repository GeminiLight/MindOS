'use client';

import { useState, useCallback, useEffect } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Audio Renderer — native HTML5 audio player with file info.
 * Uses browser built-in controls (play/pause, seek, volume, speed).
 * Supports Range requests for seeking in large files.
 */
export function AudioRenderer({ filePath }: RendererContext) {
  const src = `/api/file/raw?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split('/').pop() ?? 'audio';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [fileSize, setFileSize] = useState<number | null>(null);

  useEffect(() => {
    fetch(src, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('Content-Length');
        if (cl) setFileSize(parseInt(cl, 10));
      })
      .catch(() => {});
  }, [src]);

  const handleRetry = useCallback(() => {
    setError(false);
    setRetryKey(k => k + 1);
  }, []);

  return (
    <div className="w-full flex flex-col items-center gap-6 py-12 px-4">
      {/* File info */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
        <span className="text-4xl opacity-40">🎵</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">{fileName}</span>
          <div className="flex items-center gap-2">
            <span className="uppercase opacity-60">{ext}</span>
            {fileSize !== null && <span>{formatBytes(fileSize)}</span>}
          </div>
        </div>
      </div>

      {/* Player */}
      {error ? (
        <div className="flex flex-col items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)]">Failed to load audio</span>
          <button
            onClick={handleRetry}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <audio
          key={retryKey}
          controls
          preload="metadata"
          className="w-full max-w-lg"
          onError={() => setError(true)}
        >
          <source src={src} />
        </audio>
      )}
    </div>
  );
}
