/// <reference lib="dom" />
import { ipcRenderer } from 'electron';

const CHANNEL = 'obsidian-editor';
let initialized = false;
let loaded = false;
let latestDraft = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let pluginFrame: HTMLIFrameElement | undefined;
let pluginOrigin = '';
const send = (kind: string, content?: string) => ipcRenderer.send(CHANNEL, { kind, content });

// All trusted chrome lives in the isolated preload world. Nothing is exposed via
// contextBridge, and the untrusted iframe cannot reach this document or ipcRenderer.
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector<HTMLButtonElement>('#save')!;
  const refresh = document.querySelector<HTMLButtonElement>('#refresh-vault')!;
  const status = document.querySelector<HTMLOutputElement>('#status')!;
  const flush = () => { clearTimeout(timer); timer = undefined; send('draft', latestDraft); };
  button.addEventListener('click', () => { if (!button.disabled) { flush(); send('save'); } });
  refresh.addEventListener('click', () => { if (!refresh.hidden && !refresh.disabled) send('read-vault'); });
  ipcRenderer.on(CHANNEL, (_event, message) => {
    if (message.kind === 'init' && !initialized) {
      initialized = true; latestDraft = message.document.content;
      refresh.hidden = !message.vault;
      document.querySelector('#title')!.textContent = `${message.package.manifest.name} · ${message.document.filePath}`;
      const frame = document.createElement('iframe'); frame.title = 'Obsidian plugin'; frame.sandbox.add('allow-scripts', 'allow-same-origin');
      pluginOrigin = new URL(message.frameUrl).origin;
      pluginFrame = frame;
      window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow || event.origin !== pluginOrigin) return;
        const data = event.data;
        if (data?.kind === 'draft' && typeof data.content === 'string' && data.content.length <= 2 * 1024 * 1024) {
          latestDraft = data.content; status.textContent = '未保存';
          if (!timer) timer = setTimeout(flush, 50);
        } else if (data?.kind === 'captured' && typeof data.id === 'string' && typeof data.content === 'string' && data.content.length <= 2 * 1024 * 1024) {
          clearTimeout(timer); timer = undefined; latestDraft = data.content;
          ipcRenderer.send(CHANNEL, { kind: 'captured', id: data.id, content: data.content });
        } else if (data?.kind === 'plugin-data' && typeof data.id === 'string' && /^[a-f0-9-]{36}$/.test(data.id)
          && (data.operation === 'read' || data.operation === 'write')) {
          const json = JSON.stringify(data.data);
          if (data.operation === 'write' && (json === undefined || new TextEncoder().encode(json).length > 1024 * 1024)) return;
          ipcRenderer.send(CHANNEL, { kind: 'plugin-data', id: data.id, operation: data.operation, ...(data.operation === 'write' ? { data: data.data } : {}) });
        } else if (data?.kind === 'loaded') { loaded = true; button.disabled = false; refresh.disabled = false; send('loaded'); }
        else if (data?.kind === 'heartbeat') send('heartbeat');
        else if (data?.kind === 'error') send('error', String(data.content).slice(0, 500));
      });
      frame.addEventListener('load', () => frame.contentWindow!.postMessage({ kind: 'start', payload: { package: message.package, document: message.document, vault: message.vault } }, pluginOrigin), { once: true });
      frame.src = message.frameUrl;
      document.querySelector('#host')!.appendChild(frame);
    } else if (message.kind === 'plugin-data-result') {
      pluginFrame?.contentWindow?.postMessage({ kind: 'plugin-data-result', id: message.id, data: message.data, error: message.error }, pluginOrigin);
    } else if (message.kind === 'capture') {
      pluginFrame?.contentWindow?.postMessage({ kind: 'capture', id: message.id }, pluginOrigin);
    } else if (message.kind === 'vault' && !refresh.hidden) {
      pluginFrame?.contentWindow?.postMessage({ kind: 'vault', vault: message.vault }, pluginOrigin);
    } else if (message.kind === 'state') {
      const snapshot = message.snapshot;
      button.disabled = !loaded || message.saving || message.refreshing || snapshot.status === 'closed' || snapshot.status === 'conflict';
      refresh.disabled = !loaded || message.saving || message.refreshing || snapshot.status === 'closed';
      status.textContent = message.error || (snapshot.status === 'conflict' ? '保存冲突，请保留草稿并重新打开' : message.saving ? '保存中…'
        : message.refreshing ? '刷新知识库中…' : snapshot.dirty || latestDraft !== snapshot.content ? '未保存' : '已保存');
    }
  });
  send('ready');
});
