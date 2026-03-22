/**
 * Typed fetch wrapper with error handling and optional timeout.
 *
 * - Checks `res.ok` and throws on non-2xx status.
 * - Extracts `{ error }` from JSON error responses when available.
 * - Supports AbortController timeout (default 30s).
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'signal'> {
  /** Timeout in ms (default 30000). Set to 0 to disable. */
  timeout?: number;
  /** External AbortSignal (merged with timeout signal). */
  signal?: AbortSignal;
}

export async function apiFetch<T>(url: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { timeout = 30_000, signal: externalSignal, ...fetchOpts } = opts;

  let controller: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;

  if (timeout > 0 || externalSignal) {
    controller = new AbortController();
  }

  if (timeout > 0 && controller) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  // Bridge caller-provided AbortSignal so both timeout and external cancel work.
  if (externalSignal && controller) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller?.abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      removeExternalAbortListener = () => {
        externalSignal.removeEventListener('abort', onAbort);
      };
    }
  }

  const signal = controller?.signal ?? externalSignal;

  try {
    const res = await fetch(url, { ...fetchOpts, signal });

    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      let code: string | undefined;
      try {
        const body = await res.json();
        // Support structured { ok: false, error: { code, message } } envelope
        if (body?.error?.code && body?.error?.message) {
          msg = body.error.message;
          code = body.error.code;
        } else if (body?.error) {
          msg = typeof body.error === 'string' ? body.error : body.error.message ?? msg;
        }
      } catch { /* non-JSON error body */ }
      throw new ApiError(msg, res.status, code);
    }

    return (await res.json()) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (removeExternalAbortListener) removeExternalAbortListener();
  }
}
