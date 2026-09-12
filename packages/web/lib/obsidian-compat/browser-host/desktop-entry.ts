import { createPluginDataBridge } from './data-bridge';
import { createBrowserModuleRegistry } from './modules';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { BrowserPluginHost } from './plugin-host';
import { createBrowserVault, type BrowserFileStat } from './vault';
import { assertIsolatedPluginRealm } from './realm';
import { createPluginSettingsPanel } from './settings-panel';

type VaultPayload = { vaultId: string; name: string; folders: string[]; files: { path: string; base64: string; stat: BrowserFileStat }[] };

type Startup = {
  package: { manifest: { id: string; name: string; version: string }; files: Array<{ path: string; base64: string }> };
  document: { content: string; filePath: string };
  vault?: VaultPayload;
};
const send = (kind: string, content?: string) => window.parent.postMessage({ kind, content }, '*');
let started = false;

// This bundle is only embedded in a sandboxed, cross-origin plugin frame. It
// contains no Electron bridge or credentials, and executes the captured bytes only.
window.addEventListener('message', async event => {
  if (started || event.source !== window.parent || event.data?.kind !== 'start') return;
  assertIsolatedPluginRealm();
  started = true;
  const payload = event.data.payload as Startup;
  try {
    const container = document.body.appendChild(document.createElement('main'));
    const toolbar = container.appendChild(document.createElement('div'));
    const select = toolbar.appendChild(document.createElement('select'));
    select.setAttribute('aria-label', 'Plugin command');
    const run = toolbar.appendChild(document.createElement('button'));
    run.textContent = 'Run command'; run.type = 'button'; run.disabled = true;
    const renderPreview = toolbar.appendChild(document.createElement('button'));
    renderPreview.textContent = 'Render preview'; renderPreview.type = 'button'; renderPreview.disabled = true;
    const preview = document.createElement('section');
    preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', 'Markdown preview'); preview.hidden = true;
    let generation = 0;
    let invalidatePreview = () => { preview.hidden = true; };
    let scheduled = false;
    const editor = new EditorView({ parent: container, state: EditorState.create({ doc: payload.document.content, extensions: [
      basicSetup, markdown({ base: markdownLanguage }), EditorState.lineSeparator.of('\n'),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        generation++; invalidatePreview();
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; send('draft', editor.state.doc.toString()); });
      }),
    ] }) });
    window.addEventListener('message', event => {
      if (event.source === window.parent && event.data?.kind === 'capture' && typeof event.data.id === 'string') {
        window.parent.postMessage({ kind: 'captured', id: event.data.id, content: editor.state.doc.toString() }, '*');
      }
    });
    let sequence = 0;
    const decodeVault = (vault: VaultPayload) => ({ vaultId: vault.vaultId, name: vault.name, folders: vault.folders, sequence: sequence++,
      files: vault.files.map(file => ({ path: file.path, stat: file.stat,
        data: Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)) })) });
    const vault = payload.vault ? createBrowserVault(decodeVault(payload.vault)) : undefined;
    const dataBridge = createPluginDataBridge();
    window.addEventListener('pagehide', () => dataBridge.close(), { once: true });
    const host = new BrowserPluginHost({ editor, container, filePath: payload.document.filePath, vault,
      dataAdapter: {
        load: id => { if (id !== payload.package.manifest.id) throw new Error('Foreign plugin configuration.'); return dataBridge.load(); },
        save: (id, data) => { if (id !== payload.package.manifest.id) throw new Error('Foreign plugin configuration.'); return dataBridge.save(data); },
      },
    });
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.data?.kind !== 'vault' || !vault) return;
      try { vault.applySnapshot(decodeVault(event.data.vault)); invalidatePreview(); }
      catch (error) { send('error', error instanceof Error ? error.message : String(error)); }
    });
    container.appendChild(preview);
    invalidatePreview = () => {
      preview.hidden = true;
      void host.markdown.clear(preview).catch(error => send('error', String(error)));
    };
    const modules: Record<string, unknown> = createBrowserModuleRegistry(host.api);
    const text = (path: string) => {
      const file = payload.package.files.find(file => file.path === path);
      if (!file) return '';
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)));
    };
    const module = { exports: {} as unknown };
    new Function('require', 'module', 'exports', text('main.js'))((id: string) => {
      if (!Object.hasOwn(modules, id)) throw new Error(`Unavailable isolated browser module: ${id}`);
      return modules[id];
    }, module, module.exports);
    type Constructor = Parameters<BrowserPluginHost['load']>[1];
    await host.load(payload.package.manifest, ((module.exports as { default?: Constructor }).default ?? module.exports) as Constructor, { styles: text('styles.css') });
    createPluginSettingsPanel(host, payload.package.manifest.id, toolbar, invalidatePreview);
    renderPreview.disabled = false;
    renderPreview.addEventListener('click', async () => {
      const startedAt = generation; renderPreview.disabled = true; preview.hidden = false;
      try { await host.renderMarkdown(editor.state.doc.toString(), preview); }
      catch (error) { if (startedAt === generation) send('error', String(error)); }
      finally { renderPreview.disabled = false; }
    });
    run.addEventListener('click', () => {
      if (run.disabled || !select.value) return;
      Promise.resolve(host.runCommand(select.value)).catch(error => send('error', String(error)));
    });
    let previous = '';
    // Some original plugins start async setup without returning its promise.
    setInterval(() => {
      const entries = host.getCommands(); const signature = JSON.stringify(entries.map(command => [command.id, command.name]));
      if (signature !== previous) {
        previous = signature; const selected = select.value; select.replaceChildren();
        for (const command of entries) { const option = select.appendChild(document.createElement('option')); option.value = command.id; option.textContent = command.name; }
        if (entries.some(command => command.id === selected)) select.value = selected;
        run.disabled = entries.length === 0;
      }
      send('heartbeat');
    }, 500);
    send('loaded');
  } catch (error) { send('error', error instanceof Error ? error.message : String(error)); }
});
