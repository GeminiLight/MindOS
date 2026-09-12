import { ErrorCodes, MindOSError } from '@/lib/errors';

/** Enforce a byte budget during download, including peers that omit or lie about Content-Length. */
export async function readObsidianPackageText(response: Response, maxBytes: number, timeoutMs: number, label: string): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid package asset limit');
  const tooLarge = () => new MindOSError(ErrorCodes.INTERNAL_ERROR, `Obsidian plugin ${label} is too large to preflight.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  let timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new MindOSError(ErrorCodes.INTERNAL_ERROR, `Timed out fetching Obsidian plugin ${label} body.`);
      if (done) break;
      if (value.byteLength > maxBytes - length) throw tooLarge();
      bytes.set(value, length); length += value.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { clearTimeout(timer); cancel(); reader.releaseLock(); }
}
