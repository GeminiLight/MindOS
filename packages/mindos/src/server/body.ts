export const MINDOS_DEFAULT_JSON_BODY_LIMIT = 1_000_000;

export class HttpBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

/**
 * Reads a Web-standard request body as JSON with a byte budget.
 *
 * Mirrors the legacy Node implementation: an empty body resolves to `{}`,
 * invalid JSON is a 400, and the first chunk that pushes the total over
 * `maxBytes` rejects with 413 immediately while the rest of the upload keeps
 * draining in the background (the equivalent of `req.resume()`), so the error
 * response is written on a live connection instead of a reset socket.
 */
export async function readJsonBody(request: Request, maxBytes = MINDOS_DEFAULT_JSON_BODY_LIMIT): Promise<unknown> {
  const raw = await readBodyText(request, maxBytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpBodyError('Invalid JSON body', 400);
  }
}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      chunks.length = 0;
      void drain(reader);
      throw new HttpBodyError('Request body too large', 413);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(concat(chunks, size));
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // The client may have gone away; nothing left to drain.
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
