import { BrowserWindow, dialog, session as electronSession, type IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import type { prepareNativeObsidianPluginSession } from './obsidian-native-session';
import { untilAbort } from './obsidian-response';
import { installObsidianPluginDocument } from './obsidian-plugin-document';

type ApprovedSession = NonNullable<Awaited<ReturnType<typeof prepareNativeObsidianPluginSession>>>;
type Options = { session: ApprovedSession; runtimeSource: string; preloadPath: string; timeoutMs?: number;
  recovery?: { readonly error: string; flush(): Promise<void>; discard(): Promise<void> } };
const CHANNEL = 'obsidian-editor';
class DraftCaptureError extends Error {}
const shell = (frameOrigin: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; frame-src ${frameOrigin}; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'"><title>MindOS · 隔离插件编辑器</title>
<style>:root{color-scheme:light dark}body{margin:0;background:var(--background,Canvas);color:var(--foreground,CanvasText)}.font-sans{font-family:var(--font-sans,system-ui),sans-serif}header{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border,GrayText)}strong{flex:1}button{padding:6px 12px;border-radius:6px}button:focus-visible{outline:2px solid var(--ring,var(--amber,Highlight))}iframe{border:0;width:100%;height:calc(100vh - 64px)}output{max-width:40%;font-size:13px}</style>
<body class="font-sans"><header><strong id="title">隔离插件编辑器</strong><button id="refresh-vault" hidden disabled>刷新知识库</button><button id="save" disabled>保存笔记</button><output id="status" role="status">准备中…</output></header><main id="host"></main>`;

/** Runs captured original plugin bytes only inside an offline cross-origin frame. */
export async function createObsidianEditorWindow(options: Options) {
  const { session: approved, runtimeSource, preloadPath } = options;
  const approvalClosed = () => approved.snapshot.status === 'closed';
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000 || !isAbsolute(preloadPath)
    || typeof runtimeSource !== 'string' || !runtimeSource || runtimeSource.length > 8 * 1024 * 1024) throw new Error('Invalid isolated editor configuration.');
  if (approvalClosed()) throw new Error('Plugin approval session is closed.');
  const partition = electronSession.fromPartition(`obsidian-editor-${randomUUID()}`, { cache: false });
  // WebRTC is not covered by webRequest/CSP. Force its TCP fallback through an
  // owned loopback sink, with no DIRECT or implicit loopback bypass. Never use a
  // supposedly unused port that another local process could claim.
  const sink = createServer(socket => socket.destroy());
  sink.maxConnections = 16;
  let createdWindow: BrowserWindow | undefined;
  let pluginDocument: ReturnType<typeof installObsidianPluginDocument> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const setup = new AbortController();
  const setupTimer = setTimeout(() => setup.abort(new Error('Plugin editor setup timed out.')), timeoutMs);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(watchdog);
    clearTimeout(setupTimer);
    sink.close();
    // Never reopen networking on a partition that has executed untrusted code.
    partition.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (_details, callback) => callback({ cancel: true }));
    void pluginDocument?.revoke().catch(error => console.warn('Could not clear isolated plugin storage:', error));
    partition.removeAllListeners('will-download');
    approved.close();
  };
  try {
    await untilAbort(new Promise<void>((resolve, reject) => { sink.once('error', reject); sink.listen(0, '127.0.0.1', resolve); }), setup.signal);
    await untilAbort(partition.setProxy({ mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${(sink.address() as { port: number }).port}`, proxyBypassRules: '<-loopback>' }), setup.signal);
    clearTimeout(setupTimer);
    if (approvalClosed()) throw new Error('Plugin approval session is closed.');
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on('will-download', event => event.preventDefault());
    pluginDocument = installObsidianPluginDocument(partition, runtimeSource, shell);
    const frameUrl = pluginDocument.url;
    const url = pluginDocument.shellUrl;
    let frameRequested = false;
    partition.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const initialFrame = !frameRequested && details.resourceType === 'subFrame' && details.url === frameUrl && details.method === 'GET';
      if (initialFrame) frameRequested = true;
      callback({ cancel: !(initialFrame || (details.resourceType === 'mainFrame' && details.url === url)) });
    });
    const window = new BrowserWindow({ width: 1100, height: 780, show: false, titleBarStyle: 'default', webPreferences: {
      session: partition, preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webviewTag: false, navigateOnDragDrop: false, backgroundThrottling: false,
    } });
    createdWindow = window;
    window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    let ready = false; let closed = false; let saving = false; let closing = false; let error = '';
    let refreshing = false; let configurationRequests = 0;
    const lifetime = new AbortController();
    let capture: { id: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
    let initialized = false; let mainNavigations = 0; let frameNavigation = false;
    let lastActivity = Date.now(); let messageCount = 0; let messageEpoch = Date.now();
    let resolveReady!: () => void; let rejectReady!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const stop = (reason = new Error('Plugin editor closed.')) => {
      if (closed) return;
      closed = true; clearInterval(watchdog); approved.close();
      lifetime.abort(reason);
      if (capture) { clearTimeout(capture.timer); capture.reject(reason); capture = undefined; }
      if (!ready) rejectReady(reason);
      if (!window.isDestroyed()) window.destroy();
    };
    const sendState = () => { if (!window.isDestroyed()) window.webContents.send(CHANNEL, { kind: 'state', snapshot: approved.snapshot, saving: saving || closing, refreshing, error: error || options.recovery?.error }); };
    const captureDraft = () => new Promise<void>((resolve, reject) => {
      if (closed || capture) { reject(new Error('Cannot capture the editor draft right now.')); return; }
      const id = randomUUID();
      const timer = setTimeout(() => { capture = undefined; reject(new DraftCaptureError('Cannot read the latest draft. Keep this window open and try again.')); }, 2000);
      capture = { id, timer, resolve, reject };
      window.webContents.send(CHANNEL, { kind: 'capture', id });
    });
    watchdog = setInterval(() => {
      if (options.recovery?.error) sendState();
      if (approved.snapshot.status === 'closed') stop();
      else if (Date.now() - lastActivity > (ready ? Math.max(timeoutMs, 2000) : timeoutMs)) {
        // Main remains responsive even if plugin evaluation never yields.
        stop(new Error('Plugin editor timed out.'));
      }
    }, 250);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => {
      if (!event.isMainFrame && !frameNavigation && event.url === frameUrl) frameNavigation = true;
      else event.preventDefault();
    });
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame && ++mainNavigations > 1) stop(); });
    window.webContents.on('render-process-gone', () => stop(new Error('Plugin editor renderer stopped.')));
    window.on('unresponsive', () => stop(new Error('Plugin editor is unresponsive.')));
    window.on('close', event => {
      if (closed || !ready) return;
      event.preventDefault();
      if (closing || saving || refreshing || configurationRequests) return;
      closing = true; error = ''; sendState();
      void (async () => {
        try {
          await captureDraft();
          if (approved.snapshot.dirty) {
            const decision = await dialog.showMessageBox(window, {
              type: 'warning', title: 'MindOS', message: '笔记有未保存的修改',
              detail: '关闭前保存，或继续编辑。放弃修改后无法恢复。',
              buttons: ['继续编辑', '保存并关闭', '放弃修改'], defaultId: 0, cancelId: 0, noLink: true,
              signal: lifetime.signal,
            });
            if (closed || decision.response === 0) return;
            if (decision.response === 1) {
              await captureDraft();
              await approved.save();
              await captureDraft();
              // A newer plugin edit arriving during save must keep its window.
              if (approved.snapshot.dirty) return;
            } else if (decision.response === 2) await options.recovery?.discard();
            else return;
          }
          await options.recovery?.flush();
          stop();
        } catch (failure) {
          error = (failure as Error).message;
          if (failure instanceof DraftCaptureError && !closed) {
            try {
              const decision = await dialog.showMessageBox(window, {
                type: 'warning', title: 'MindOS', message: '插件没有返回最新草稿',
                detail: '可以继续等待，或强制关闭此插件窗口。强制关闭会丢失未保存的修改。',
                buttons: ['继续编辑', '强制关闭'], defaultId: 0, cancelId: 0, noLink: true, signal: lifetime.signal,
              });
              if (!closed && decision.response === 1) stop();
            } catch (dialogError) { error = (dialogError as Error).message; }
          }
        }
        finally { closing = false; sendState(); }
      })();
    });
    window.on('closed', () => { stop(); release(); });
    window.webContents.on('ipc-message', async (event: IpcMainEvent, channel: string, message: unknown) => {
      if (closed || channel !== CHANNEL || event.senderFrame !== window.webContents.mainFrame || !message || typeof message !== 'object') return;
      if (Date.now() - messageEpoch >= 1000) { messageEpoch = Date.now(); messageCount = 0; }
      if (++messageCount > 100) { stop(new Error('Plugin editor message rate exceeded.')); return; }
      const data = message as { kind?: string; content?: unknown; id?: unknown; operation?: unknown; data?: unknown };
      if (data.kind === 'ready' && !initialized) {
        initialized = true;
        window.webContents.send(CHANNEL, { kind: 'init', frameUrl, package: approved.package, document: approved.snapshot, vault: approved.vault });
      } else if (data.kind === 'plugin-data' && initialized && !closing && typeof data.id === 'string' && /^[a-f0-9-]{36}$/.test(data.id)) {
        const id = data.id;
        if (configurationRequests >= 32) { stop(new Error('Plugin configuration request limit exceeded.')); return; }
        configurationRequests++;
        try {
          let value: unknown;
          if (data.operation === 'read') value = await approved.readPluginData();
          else if (data.operation === 'write') {
            const json = JSON.stringify(data.data);
            if (json === undefined || Buffer.byteLength(json) > 1024 * 1024) throw new Error('Plugin configuration size limit exceeded.');
            await approved.savePluginData(data.data); value = null;
          } else throw new Error('Invalid plugin configuration operation.');
          if (!closed) window.webContents.send(CHANNEL, { kind: 'plugin-data-result', id, data: value });
        } catch (failure) {
          if (!closed) window.webContents.send(CHANNEL, { kind: 'plugin-data-result', id, error: (failure as Error).message.slice(0, 300) });
        } finally { configurationRequests--; }
      } else if (data.kind === 'loaded' && initialized) {
        lastActivity = Date.now(); ready = true; sendState(); window.show(); resolveReady();
      } else if (data.kind === 'heartbeat' && ready) lastActivity = Date.now();
      else if (data.kind === 'captured' && capture && data.id === capture.id) {
        const pending = capture; capture = undefined; clearTimeout(pending.timer);
        try { approved.setDraft(data.content as string); pending.resolve(); }
        catch (failure) { pending.reject(failure as Error); }
      }
      else if (data.kind === 'error') stop(new Error(`Plugin failed: ${String(data.content).slice(0, 500)}`));
      else if (data.kind === 'draft' && ready) {
        try { approved.setDraft(data.content as string); error = ''; } catch (failure) { error = (failure as Error).message; }
        sendState();
      } else if (data.kind === 'read-vault' && ready && !saving && !closing && !refreshing && approved.vault) {
        refreshing = true; error = ''; sendState();
        try {
          const vault = await approved.readVault();
          if (!closed && !window.isDestroyed()) window.webContents.send(CHANNEL, { kind: 'vault', vault });
        } catch (failure) { error = (failure as Error).message; }
        finally { refreshing = false; sendState(); }
      } else if (data.kind === 'save' && ready && !saving && !closing && !refreshing) {
        saving = true; error = ''; sendState();
        try { await captureDraft(); await approved.save(); } catch (failure) { error = (failure as Error).message; }
        finally { saving = false; sendState(); }
      }
    });
    void window.loadURL(url).catch(failure => stop(failure));
    await started;
    return Object.freeze({ window, close: () => stop(), get snapshot() { return approved.snapshot; } });
  } catch (failure) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    release();
    throw failure;
  }
}
