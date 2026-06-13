export function createSearchResultDragPreview(path: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const fileName = path.split('/').filter(Boolean).pop() ?? path;
  const preview = document.createElement('div');
  preview.textContent = fileName;
  preview.dataset.searchDragPreview = 'true';
  preview.style.position = 'fixed';
  preview.style.top = '-1000px';
  preview.style.left = '-1000px';
  preview.style.maxWidth = '240px';
  preview.style.padding = '6px 10px';
  preview.style.border = '1px solid var(--border)';
  preview.style.borderRadius = '8px';
  preview.style.background = 'var(--card)';
  preview.style.color = 'var(--foreground)';
  preview.style.boxShadow = '0 8px 24px color-mix(in_srgb, var(--foreground) 14%, transparent)';
  preview.style.font = '500 12px var(--font-sans)';
  preview.style.whiteSpace = 'nowrap';
  preview.style.overflow = 'hidden';
  preview.style.textOverflow = 'ellipsis';
  preview.style.pointerEvents = 'none';
  document.body.appendChild(preview);
  return preview;
}

export function scheduleSearchResultDragPreviewCleanup(preview: HTMLElement | null): void {
  if (!preview) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);
  schedule(() => preview.remove());
}
