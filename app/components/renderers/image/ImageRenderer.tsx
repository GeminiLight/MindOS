'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RendererContext } from '@/lib/renderers/registry';

/** Zoom presets — "fit" means object-fit: contain */
type ZoomMode = 'fit' | number;

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Image Renderer — professional image viewer with:
 * - Fit-to-view / actual-size toggle
 * - Zoom in/out with presets
 * - Checkerboard background for transparent images
 * - Natural dimensions + file size display
 * - Loading / error states with retry
 */
export function ImageRenderer({ filePath }: RendererContext) {
  const src = `/api/file/raw?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split('/').pop() ?? 'image';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isTransparent = ['png', 'svg', 'webp', 'ico', 'gif'].includes(ext);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLoad = useCallback(() => {
    setLoading(false);
    const img = imgRef.current;
    if (img) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError(true);
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    setRetryKey(k => k + 1);
  }, []);

  // Fetch file size — only once after image loads successfully
  useEffect(() => {
    if (loading || error || fileSize !== null) return;
    fetch(src, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('Content-Length');
        if (cl) setFileSize(parseInt(cl, 10));
      })
      .catch(() => {});
  }, [src, loading, error, fileSize]);

  const zoomIn = useCallback(() => {
    setZoom(prev => {
      const current = prev === 'fit' ? 1 : prev;
      const next = ZOOM_STEPS.find(s => s > current);
      return next ?? current;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(prev => {
      const current = prev === 'fit' ? 1 : prev;
      const next = [...ZOOM_STEPS].reverse().find(s => s < current);
      return next ?? current;
    });
  }, []);

  const toggleFit = useCallback(() => {
    setZoom(prev => prev === 'fit' ? 1 : 'fit');
  }, []);

  // Keyboard shortcuts — only active when container is focused or page body is active
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Only respond when the image viewer area has focus or body is active
      if (document.activeElement !== document.body && !container.contains(document.activeElement)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
      if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
      if (e.key === '1') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut]);

  const zoomPercent = zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`;
  // Only use pixel dimensions when we know the natural size (avoids layout jump)
  const zoomStyle = zoom === 'fit'
    ? { maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' as const }
    : naturalSize
      ? { width: naturalSize.w * zoom, height: 'auto' }
      : { maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' as const }; // fallback to fit while loading

  return (
    <div className="w-full flex flex-col gap-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-3">
          {naturalSize && (
            <span>{naturalSize.w} x {naturalSize.h}</span>
          )}
          {fileSize !== null && (
            <span>{formatBytes(fileSize)}</span>
          )}
          <span className="uppercase opacity-60">{ext}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={!naturalSize}
            className="px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-30"
            title="Zoom out (-)"
          >
            -
          </button>
          <button
            onClick={toggleFit}
            disabled={!naturalSize}
            className="px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors min-w-[48px] text-center disabled:opacity-30"
            title={zoom === 'fit' ? 'Actual size (1)' : 'Fit to view (0)'}
          >
            {zoomPercent}
          </button>
          <button
            onClick={zoomIn}
            disabled={!naturalSize}
            className="px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-30"
            title="Zoom in (+)"
          >
            +
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        tabIndex={-1}
        className={`relative flex-1 min-h-[70vh] overflow-auto flex items-center justify-center outline-none ${
          isTransparent ? 'bg-checkerboard' : 'bg-[var(--bg-secondary)]'
        }`}
      >
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <span className="text-sm text-[var(--text-tertiary)] animate-pulse">
              Loading...
            </span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2">
            <span className="text-sm text-[var(--text-secondary)]">
              Failed to load image
            </span>
            <button
              onClick={handleRetry}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={retryKey}
          ref={imgRef}
          src={src}
          alt={fileName}
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
          className="select-none"
          style={{
            display: error ? 'none' : 'block',
            ...zoomStyle,
          }}
        />
      </div>
    </div>
  );
}
