/**
 * HTTPS fetch and download for Core updates.
 *
 * Split out of core-updater.ts (1104 lines). This is the network half of the
 * trust chain: the manifest carries the tarball's sha256, and the tarball is
 * code we are about to run, so every hop must stay on https, redirects are
 * bounded and re-checked, and every request has a timeout and an abort path.
 */
import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import { createWriteStream, type WriteStream } from 'fs';
import type { CoreUpdateProgress } from './core-updater';

const MAX_REDIRECTS = 5;
/** Per-request timeout for manifest fetches and each download attempt. */
export const URL_TIMEOUT = 8_000;

/**
 * Only canonical `https://` URLs may be fetched. The manifest is the trust
 * root for the tarball sha256, and the tarball itself is executed code, so a
 * plain-http hop anywhere in the chain would let a network attacker swap both.
 */
export function isHttpsUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('https://');
}

/**
 * Resolve an HTTP redirect Location against the current URL.
 * Rejects unbounded chains and any downgrade away from https — the manifest
 * fetched through this layer is the trust root for tarball sha256 integrity.
 */
function resolveRedirectTarget(baseUrl: string, location: string | string[] | undefined, redirectsLeft: number): string | Error {
  if (redirectsLeft <= 0) return new Error(`Too many redirects from ${baseUrl}`);
  const loc = Array.isArray(location) ? location[0] : location;
  if (!loc) return new Error(`Redirect without Location from ${baseUrl}`);
  let next: string;
  try {
    next = new URL(loc, baseUrl).toString();
  } catch {
    return new Error(`Invalid redirect location from ${baseUrl}`);
  }
  if (!next.startsWith('https:')) return new Error(`Refusing insecure redirect to ${next}`);
  return next;
}

/** Fetch a URL with timeout. Returns the body as string. */
export function fetchUrl(url: string, timeoutMs: number, signal?: AbortSignal, redirectsLeft = MAX_REDIRECTS): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    if (!isHttpsUrl(url)) return reject(new Error(`Refusing non-https URL: ${url}`));

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        // Follow redirect
        res.resume();
        const next = resolveRedirectTarget(url, res.headers.location, redirectsLeft);
        if (next instanceof Error) return reject(next);
        fetchUrl(next, timeoutMs, signal, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${url}`)); });
    if (signal) {
      const onAbort = () => { req.destroy(); reject(new Error('aborted')); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Try URLs in order, return first success. */
export async function fetchWithFallback(urls: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  let lastErr: Error | undefined;
  for (const url of urls) {
    try {
      return await fetchUrl(url, timeoutMs, signal);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw lastErr;
    }
  }
  throw lastErr || new Error('No URLs provided');
}

/** Download a file with progress reporting. Tries URLs in order. */
export function downloadFile(
  urls: readonly string[],
  destPath: string,
  expectedSize: number,
  signal: AbortSignal,
  onProgress: (p: CoreUpdateProgress) => void,
): Promise<void> {
  // Work on a copy to avoid mutating the caller's array (redirect insertions)
  const urlQueue: Array<{ url: string; redirectsLeft: number }> = urls.map((url) => ({ url, redirectsLeft: MAX_REDIRECTS }));
  return new Promise((resolve, reject) => {
    let urlIdx = 0;
    let settled = false;
    let lastErr: Error | undefined; // Track last error for better diagnostics
    let activeReq: ClientRequest | null = null;
    let activeRes: IncomingMessage | null = null;
    let activeFile: WriteStream | null = null;
    let activeAbortHandler: (() => void) | null = null;

    const cleanupAttempt = (destroyActive: boolean) => {
      if (activeAbortHandler) {
        signal.removeEventListener('abort', activeAbortHandler);
        activeAbortHandler = null;
      }
      if (destroyActive) {
        if (activeRes && !activeRes.destroyed) activeRes.destroy();
        if (activeReq && !activeReq.destroyed) activeReq.destroy();
        if (activeFile && !activeFile.destroyed) activeFile.destroy();
      }
      activeReq = null;
      activeRes = null;
      activeFile = null;
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupAttempt(true);
      reject(err);
    };

    const retryAfterAttemptFailure = (url: string, err: Error, req?: ClientRequest) => {
      if (req && activeReq !== req) return;
      lastErr = err;
      console.warn(`[CoreUpdater] ${url} → ${err.message}, trying next`);
      cleanupAttempt(true);
      tryNext();
    };

    const tryNext = () => {
      if (settled) return;
      if (urlIdx >= urlQueue.length) { 
        settled = true; 
        const msg = lastErr 
          ? `All download URLs failed: ${lastErr.message}` 
          : 'All download URLs failed';
        return reject(new Error(msg)); 
      }
      if (signal.aborted) { settled = true; return reject(new Error('aborted')); }

      const { url, redirectsLeft } = urlQueue[urlIdx++];
      if (!isHttpsUrl(url)) {
        // Treat like any other failed mirror: record, then try the next URL.
        retryAfterAttemptFailure(url, new Error(`Refusing non-https download URL: ${url}`));
        return;
      }

      // The callback only runs after https.get returns, so `req` is set by then.
      const req: ClientRequest = https.get(url, { timeout: URL_TIMEOUT }, (res) => {
        activeRes = res;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          // Follow redirect — a refused/overlong redirect counts as this
          // URL's failure and falls through to the next fallback URL.
          res.resume();
          const next = resolveRedirectTarget(url, res.headers.location, redirectsLeft);
          if (next instanceof Error) {
            retryAfterAttemptFailure(url, next, req);
            return;
          }
          urlQueue.splice(urlIdx, 0, { url: next, redirectsLeft: redirectsLeft - 1 });
          cleanupAttempt(true);
          tryNext();
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          const msg = `HTTP ${res.statusCode}`;
          retryAfterAttemptFailure(url, new Error(msg), req);
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || expectedSize;
        let transferred = 0;
        const file = createWriteStream(destPath);
        activeFile = file;

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          onProgress({
            percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total,
          });
        });

        res.pipe(file);
        file.on('finish', () => {
          if (activeFile !== file) return;
          file.close();
          if (!settled) {
            settled = true;
            cleanupAttempt(false);
            resolve();
          }
        });
        file.on('error', (err) => { 
          if (activeFile !== file) return;
          file.close(); 
          fail(err);
        });
        res.on('error', (err) => { 
          if (activeRes !== res) return;
          file.close(); 
          fail(err);
        });
      });
      activeReq = req;

      req.on('error', (err) => {
        retryAfterAttemptFailure(url, err instanceof Error ? err : new Error(String(err)), req);
      });
      req.on('timeout', () => {
        retryAfterAttemptFailure(url, new Error('timeout'), req);
      });

      activeAbortHandler = () => { fail(new Error('aborted')); };
      signal.addEventListener('abort', activeAbortHandler, { once: true });
    };

    tryNext();
  });
}

export const _downloadFile_forTest = downloadFile;
export const _fetchUrl_forTest = fetchUrl;
