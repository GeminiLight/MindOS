import { toast } from '@/lib/toast';
import type { useLocale } from '@/lib/stores/locale-store';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file

/**
 * Convert ArrayBuffer to base64 string.
 * For large buffers (>512KB), offloads to a Web Worker to avoid freezing the UI.
 * For small buffers, runs synchronously on the main thread (worker overhead not worth it).
 */
function arrayBufferToBase64Sync(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

const WORKER_THRESHOLD = 512 * 1024; // 512 KB

async function arrayBufferToBase64(buf: ArrayBuffer): Promise<string> {
  if (buf.byteLength < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return arrayBufferToBase64Sync(buf);
  }

  // Clone before transfer — the original buf becomes detached after postMessage with transfer
  const syncFallbackBuf = buf.slice(0);

  return new Promise<string>((resolve) => {
    const workerCode = `
      self.onmessage = function(e) {
        try {
          var bytes = new Uint8Array(e.data);
          var chunks = [];
          for (var i = 0; i < bytes.length; i += 8192) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
          }
          self.postMessage(btoa(chunks.join('')));
        } catch (err) {
          self.postMessage({ error: err.message || 'base64 encoding failed' });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(arrayBufferToBase64Sync(syncFallbackBuf));
    }, 10_000);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      cleanup();
      if (typeof e.data === 'string') {
        resolve(e.data);
      } else {
        resolve(arrayBufferToBase64Sync(syncFallbackBuf));
      }
    };

    worker.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve(arrayBufferToBase64Sync(syncFallbackBuf));
    };

    // Transfer the buffer to avoid copying (original buf is now detached)
    worker.postMessage(buf, [buf]);
  });
}

function showQuickDropToast(
  saved: number,
  formatSkipped: number,
  oversized: number,
  t: ReturnType<typeof useLocale>['t'],
) {
  if (saved > 0 && oversized > 0 && formatSkipped === 0) {
    toast.success(t.inbox.savedWithOversized(saved, oversized), 4000);
  } else if (saved > 0 && (formatSkipped + oversized) > 0) {
    toast.success(t.inbox.savedWithSkipped(saved, formatSkipped + oversized), 4000);
  } else if (saved > 0) {
    toast.success(t.inbox.savedToast(saved), 3000);
  } else {
    if (oversized > 0) toast.error(t.inbox.tooLarge(oversized), 4000);
    if (formatSkipped > 0) toast.error(t.inbox.savedWithSkipped(0, formatSkipped), 4000);
    if (oversized === 0 && formatSkipped === 0) toast.error(t.inbox.saveFailed, 4000);
  }
}

export async function quickDropToInbox(
  files: File[],
  t: ReturnType<typeof useLocale>['t'],
) {
  const payload: Array<{ name: string; content: string; encoding?: string }> = [];
  let oversizedCount = 0;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      oversizedCount++;
      continue;
    }
    try {
      const lowerName = file.name.toLowerCase();
      const isWord = lowerName.endsWith('.doc') || lowerName.endsWith('.docx') || lowerName.endsWith('.docm');
      if (lowerName.endsWith('.pdf') || isWord) {
        const buf = await file.arrayBuffer();
        payload.push({ name: file.name, content: await arrayBufferToBase64(buf), encoding: 'base64' });
      } else {
        const text = await file.text();
        payload.push({ name: file.name, content: text });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  if (payload.length === 0) {
    if (oversizedCount > 0) {
      toast.error(t.inbox.tooLarge(oversizedCount), 4000);
    } else if (files.length > 0) {
      toast.error(t.inbox.saveFailed, 4000);
    }
    return;
  }

  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payload }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[QuickDrop] Save failed:', data.error);
      toast.error(t.inbox.saveFailed, 4000);
      return;
    }

    const result = await res.json();
    const saved = result.saved?.length ?? 0;
    const formatSkipped = result.skipped?.length ?? 0;

    showQuickDropToast(saved, formatSkipped, oversizedCount, t);
    window.dispatchEvent(new Event('mindos:files-changed'));
    window.dispatchEvent(new Event('mindos:inbox-updated'));
  } catch (err) {
    console.error('[QuickDrop] Network error:', err);
    toast.error(t.inbox.saveFailed, 4000);
  }
}

/**
 * Clip a web page URL to the Inbox.
 * Fetches the page server-side, converts HTML→Markdown via Readability + Turndown,
 * and saves the result to the Inbox directory.
 */
export async function clipUrlToInbox(
  url: string,
  t: ReturnType<typeof useLocale>['t'],
): Promise<{ ok: boolean; title?: string }> {
  try {
    const res = await fetch('/api/inbox/clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.error || t.inbox.clipFailed;
      toast.error(msg, 4000);
      return { ok: false };
    }

    toast.success(t.inbox.clipSuccess(data.title || url), 3000);
    window.dispatchEvent(new Event('mindos:files-changed'));
    window.dispatchEvent(new Event('mindos:inbox-updated'));
    return { ok: true, title: data.title };
  } catch (err) {
    console.error('[ClipURL] Network error:', err);
    toast.error(t.inbox.clipFailed, 4000);
    return { ok: false };
  }
}

/**
 * Detects if a string looks like a URL (http:// or https://).
 */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts a URL from a DragEvent's dataTransfer.
 * Checks text/uri-list first, then text/plain.
 * Returns null if no valid URL found (or if files are present).
 */
export function extractUrlFromDrop(e: DragEvent): string | null {
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) return null;

  const uriList = e.dataTransfer?.getData('text/uri-list');
  if (uriList) {
    const firstUrl = uriList.split(/[\r\n]+/).find(
      line => !line.startsWith('#') && line.trim().length > 0,
    );
    if (firstUrl && looksLikeUrl(firstUrl)) return firstUrl.trim();
  }

  const plainText = e.dataTransfer?.getData('text/plain');
  if (plainText && looksLikeUrl(plainText)) return plainText.trim();

  return null;
}

/**
 * Checks whether a DragEvent likely contains a URL (not files).
 * Used during dragenter/dragover to show the appropriate drop overlay.
 */
export function dragContainsUrl(e: DragEvent): boolean {
  const types = e.dataTransfer?.types ?? [];
  if (types.includes('Files')) return false;
  return types.includes('text/uri-list') || types.includes('text/plain');
}

/**
 * Drop files into a specific directory via /api/file/import.
 * Used when user drags external files onto a directory in the file tree.
 */
export async function quickDropToDirectory(
  files: File[],
  targetDir: string,
  t: ReturnType<typeof useLocale>['t'],
) {
  const payload: Array<{ name: string; content: string; encoding?: string }> = [];
  let oversizedCount = 0;

  const BINARY_EXTS = new Set([
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
    'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'mp4', 'webm', 'mov', 'mkv',
    'doc', 'docx', 'docm',
  ]);

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      oversizedCount++;
      continue;
    }
    try {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (BINARY_EXTS.has(ext)) {
        const buf = await file.arrayBuffer();
        payload.push({ name: file.name, content: await arrayBufferToBase64(buf), encoding: 'base64' });
      } else {
        const text = await file.text();
        payload.push({ name: file.name, content: text });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  if (payload.length === 0) {
    if (oversizedCount > 0) {
      toast.error(t.inbox.tooLarge(oversizedCount), 4000);
    } else if (files.length > 0) {
      toast.error(t.inbox.saveFailed, 4000);
    }
    return;
  }

  const dirName = targetDir.split('/').pop() || targetDir;

  try {
    const res = await fetch('/api/file/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: payload,
        targetSpace: targetDir,
        organize: false,
        conflict: 'rename',
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[TreeDrop] Save failed:', data.error);
      toast.error(t.inbox.saveFailed, 4000);
      return;
    }

    const result = await res.json();
    const saved = result.created?.length ?? 0;
    const skipped = result.skipped?.length ?? 0;

    if (saved > 0 && (skipped + oversizedCount) > 0) {
      toast.success(t.inbox.savedWithSkipped(saved, skipped + oversizedCount), 4000);
    } else if (saved > 0) {
      toast.success(t.inbox.savedToDir(saved, dirName), 3000);
    } else {
      if (oversizedCount > 0) toast.error(t.inbox.tooLarge(oversizedCount), 4000);
      if (skipped > 0) toast.error(t.inbox.savedWithSkipped(0, skipped), 4000);
    }

    window.dispatchEvent(new Event('mindos:files-changed'));
  } catch (err) {
    console.error('[TreeDrop] Network error:', err);
    toast.error(t.inbox.saveFailed, 4000);
  }
}
