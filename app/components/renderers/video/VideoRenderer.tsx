'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Video Renderer — native HTML5 video player with file info bar.
 * Uses browser built-in controls (play/pause, seek, volume, fullscreen, PiP).
 * Supports Range requests for seeking without downloading entire file.
 */
export function VideoRenderer({ filePath }: RendererContext) {
  const src = `/api/file/raw?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split('/').pop() ?? 'video';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(src, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('Content-Length');
        if (cl) setFileSize(parseInt(cl, 10));
      })
      .catch(() => {});
  }, [src]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setResolution({ w: video.videoWidth, h: video.videoHeight });
    }
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setRetryKey(k => k + 1);
  }, []);

  return (
    <div className="w-full flex flex-col gap-0">
      {/* Info bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border text-xs text-[var(--text-secondary)]">
        {resolution && (
          <span>{resolution.w} x {resolution.h}</span>
        )}
        {fileSize !== null && (
          <span>{formatBytes(fileSize)}</span>
        )}
        <span className="uppercase opacity-60">{ext}</span>
      </div>

      {/* Player area */}
      <div className="flex-1 min-h-[50vh] flex items-center justify-center bg-black rounded-b-lg overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-neutral-400">Failed to load video</span>
            <button
              onClick={handleRetry}
              className="text-xs px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video
            key={retryKey}
            ref={videoRef}
            controls
            preload="metadata"
            className="max-w-full max-h-[70vh]"
            onLoadedMetadata={handleLoadedMetadata}
            onError={() => setError(true)}
          >
            <source src={src} />
          </video>
        )}
      </div>
    </div>
  );
}
