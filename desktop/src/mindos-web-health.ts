/**
 * Probe bundled/CLI MindOS web server without assuming the process in mindos.pid is healthy.
 */

/** Single GET /api/health with timeout. */
export async function verifyMindOsWebHealth(port: number, timeoutMs = 2500): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: ac.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Retries for "CLI just started, Next not listening yet" without blocking too long on total failure.
 */
export async function verifyMindOsWebListening(
  port: number,
  opts?: { attempts?: number; attemptTimeoutMs?: number; betweenMs?: number },
): Promise<boolean> {
  const attempts = opts?.attempts ?? 4;
  const attemptTimeoutMs = opts?.attemptTimeoutMs ?? 2500;
  const betweenMs = opts?.betweenMs ?? 400;
  for (let i = 0; i < attempts; i++) {
    if (await verifyMindOsWebHealth(port, attemptTimeoutMs)) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, betweenMs));
  }
  return false;
}
