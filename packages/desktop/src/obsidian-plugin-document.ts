import type { Session } from 'electron';
import { randomUUID } from 'node:crypto';

/** An in-memory HTTPS response, never a server, filesystem mapping or network proxy.
 * The unique standard origin enables native browser storage and Blob workers while
 * staying cross-origin from its own trusted shell. Never use the app's session.
 */
export function installObsidianPluginDocument(session: Session, runtimeSource: string, renderShell: (frameOrigin: string) => string) {
  const origin = `https://${randomUUID()}.obsidian.mindos.invalid`;
  const url = `${origin}/frame`;
  const shellUrl = `https://shell.${new URL(origin).hostname}/editor`;
  const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  let html: string | undefined = `<!doctype html><meta charset="utf-8"><body><script>${runtimeSource.replace(/<\/script/gi, '<\\/script')}</script>`;
  let shell: string | undefined = renderShell(origin);
  let cleanup: Promise<void> | undefined;
  session.protocol.handle('https', request => {
    const content = request.url === url ? html : request.url === shellUrl ? shell : undefined;
    if (!content || request.method !== 'GET') return new Response('Unavailable', { status: 403 });
    const contentPolicy = request.url === url ? policy
      : policy.replace("worker-src blob:; frame-src 'none'", `worker-src 'none'; frame-src ${origin}`);
    return new Response(content, { headers: {
      'content-type': 'text/html; charset=utf-8', 'content-security-policy': contentPolicy,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } });
  });
  return { origin, url, shellUrl, revoke() {
    // Keep the deny-only protocol handler: unhandle could fall back to Chromium
    // networking during teardown. Drop source bytes and clear this one partition.
    html = undefined; shell = undefined;
    return cleanup ??= Promise.resolve().then(() => session.clearStorageData());
  } };
}
