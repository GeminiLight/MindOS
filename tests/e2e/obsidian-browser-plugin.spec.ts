import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page, type Frame } from '@playwright/test';
import { startObsidianFileFixture } from './fixtures/obsidian-file-server';

const webRoot = resolve(import.meta.dirname, '../../packages/web');
const fixtureDir = process.env.MINDOS_OBSIDIAN_ADVANCED_TABLES_DIR;
let runtimeSource: string;
let prepareObsidianPluginSession: typeof import('../../packages/desktop/src/obsidian-plugin-session')['prepareObsidianPluginSession'];

test.beforeAll(async () => {
  // Desktop is a CommonJS package; bundle its unchanged transport to ESM for this Node test coordinator.
  const desktop = await build({
    entryPoints: [resolve(webRoot, '../desktop/src/obsidian-plugin-session.ts')],
    bundle: true, platform: 'node', format: 'esm', write: false,
    footer: { js: '//# sourceURL=mindos-desktop-plugin-session.mjs' },
  });
  ({ prepareObsidianPluginSession } = await import(`data:text/javascript;base64,${Buffer.from(desktop.outputFiles[0].text).toString('base64')}`));
  const result = await build({
    stdin: { contents: `
      import {EditorState} from '@codemirror/state';
      import {EditorView} from '@codemirror/view';
      import {basicSetup} from 'codemirror';
      import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
      import * as state from '@codemirror/state';
      import * as view from '@codemirror/view';
      import * as hostModule from './lib/obsidian-compat/browser-host/plugin-host';
      window.createHost = (doc, lifecycleTimeoutMs, snapshot) => {
        if (typeof hostModule.BrowserPluginHost !== 'function') return false;
        const container = document.body.appendChild(document.createElement('main'));
        const editor = new EditorView({ parent: container, state: EditorState.create({doc, extensions: [
          basicSetup, markdown({base: markdownLanguage}), EditorState.lineSeparator.of('\\n'),
        ]}) });
        const hydrate = value => ({...value, files: value.files.map(file => ({...file, data: new Uint8Array(file.data)}))});
        const vault = snapshot ? hostModule.createBrowserVault(hydrate(snapshot)) : undefined;
        window.updateVault = value => vault.applySnapshot(hydrate(value));
        window.ownerVault = vault;
        window.makeVault = value => hostModule.createBrowserVault(hydrate(value));
        window.hostOptions = { editor, container, filePath: 'Tables.md', lifecycleTimeoutMs, vault };
        window.host = new hostModule.BrowserPluginHost(window.hostOptions);
        return true;
      };
      // Test harness only. Product enablement remains closed until an audited isolation broker exists.
      window.loadOriginal = async (manifest, source, styles = '') => {
        if (window.origin !== 'null' || window.parent === window) throw new Error('Opaque frame required');
        const modules = {'obsidian': window.host.api, '@codemirror/state': state, '@codemirror/view': view};
        const module = {exports: {}};
        new Function('require', 'module', 'exports', source)(id => {
          if (!Object.hasOwn(modules, id)) throw new Error('Unavailable browser module: ' + id);
          return modules[id];
        }, module, module.exports);
        await window.host.load(manifest, module.exports.default ?? module.exports, {styles});
      };
    `, resolveDir: webRoot, sourcefile: 'obsidian-browser-contract.ts' },
    bundle: true, platform: 'browser', format: 'iife', write: false,
  });
  runtimeSource = result.outputFiles[0].text;
});

async function frameHost(page: Page, doc: string, lifecycleTimeoutMs = 5000, snapshot?: unknown): Promise<Frame> {
  // Browser-wide network interception is an additional TEST boundary: iframe CSP alone
  // does not prevent every navigation-based exfiltration channel in all browsers.
  await page.context().route('**/*', route => route.abort('blockedbyclient'));
  await page.setContent('<!doctype html><title>Obsidian browser host contract</title><div id="parent-secret">parent only</div>');
  await page.evaluate(source => {
    const iframe = document.createElement('iframe');
    iframe.title = 'Isolated Obsidian plugin';
    iframe.width = '1000'; iframe.height = '700';
    iframe.sandbox.add('allow-scripts');
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><body><script>${source.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    document.body.appendChild(iframe);
  }, runtimeSource);
  const frame = await page.locator('iframe').elementHandle().then(handle => handle!.contentFrame());
  expect(frame).not.toBeNull();
  await frame!.waitForFunction(() => typeof (window as any).createHost === 'function');
  await page.waitForLoadState('networkidle');
  expect(await frame!.evaluate(({ doc, lifecycleTimeoutMs, snapshot }) => (window as any).createHost(doc, lifecycleTimeoutMs, snapshot), { doc, lifecycleTimeoutMs, snapshot }),
    'the browser must instantiate a real plugin host').toBe(true);
  return frame!;
}

const manifest = { id: 'browser-canary', name: 'Browser canary', version: '1.0.0', minAppVersion: '1.0.0' };
async function load(frame: Frame, source: string, meta = manifest, styles = '') {
  await frame.evaluate(({ source, meta, styles }) => (window as any).loadOriginal(meta, source, styles), { source, meta, styles });
}

test('original modules receive a functional debouncer and the mounted workspace layout', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,debounce}=require('obsidian'); module.exports=class extends Plugin {
    onload(){
      const task=debounce(value=>value.toUpperCase(),100);
      window.utilityResult={value:task('hello').run(),chain:task.cancel()===task,ready:this.app.workspace.layoutReady};
      this.app.workspace.onLayoutReady(()=>{window.utilityResult.mounted=!!this.app.workspace.getMostRecentLeaf().view.editor});
      const leaves=[];this.app.workspace.iterateAllLeaves(leaf=>leaves.push(leaf));window.utilityResult.leaves=leaves.length;
    }
  }`);
  expect(await frame.evaluate(() => (window as any).utilityResult)).toEqual({ value: 'HELLO', chain: true, ready: true, mounted: true, leaves: 1 });
});

test('legacy CodeMirror modes actually tokenize JavaScript while the live editor stays on CM6', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  const result = await frame.evaluate(() => {
    const cm = (window as any).CodeMirror;
    if (!cm) return { available: false };
    cm.defineMode('dataviewjs', (config: unknown) => cm.getMode(config, 'javascript'));
    const tokens: Array<[string, string | null]> = [];
    cm.runMode('const answer = 42;', 'dataviewjs', (text: string, style: string | null) => tokens.push([text, style]));
    const doc = new cm.Doc('original', 'javascript'); doc.replaceRange('changed', {line:0,ch:0}, {line:0,ch:8});
    const changed = doc.getValue(); doc.undo();
    return { available: true, version: cm.version, tokens, changed, restored: doc.getValue(), cm6: (window as any).host.editor.getValue() };
  });
  expect(result).toMatchObject({ available: true, version: '5.65.21', changed: 'changed', restored: 'original', cm6: 'hello' });
  expect(result.tokens).toContainEqual(['const', 'keyword']); expect(result.tokens).toContainEqual(['42', 'number']);
});

test('DOM query helpers return native nodes, include matching roots once and preserve invalid selector errors', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  const result = await frame.evaluate(() => {
    const root = document.createElement('section') as any; root.className = 'match';
    root.innerHTML = '<p class="match">真实 📚</p><div><p>nested</p></div>';
    const fragment = document.createDocumentFragment() as any; fragment.appendChild(root);
    let invalid = false; try { root.findAllSelf('['); } catch (error) { invalid = error instanceof DOMException; }
    const matches = root.findAllSelf('.match');
    return { self: matches[0] === root, count: matches.length, descendants: root.findAll('p').map((node: Element) => node.textContent),
      first: root.find('p') === root.firstChild, missing: root.find('.missing'), empty: root.findAllSelf('.missing'),
      fragment: fragment.find('section') === root, fragmentCount: fragment.findAll('p').length, invalid };
  });
  expect(result).toEqual({ self: true, count: 2, descendants: ['真实 📚', 'nested'], first: true, missing: null, empty: [], fragment: true, fragmentCount: 2, invalid: true });
  expect(await page.evaluate(() => typeof (Element.prototype as any).findAllSelf)).toBe('undefined');
});

test('DOM insertion subscriptions follow real attachment, can be cancelled and respect hidden ancestors', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  const result = await frame.evaluate(async () => {
    const parent = document.createElement('div'); document.body.appendChild(parent);
    const node = document.createElement('p') as any; node.textContent = 'visible';
    let count = 0; let once = 0; let cancelled = 0;
    const dispose = node.onNodeInserted(() => count++);
    node.onNodeInserted(() => once++, true);
    const cancel = node.onNodeInserted(() => cancelled++); cancel(); cancel();
    const detached = node.isShown(); parent.appendChild(node); await new Promise(requestAnimationFrame);
    const visible = node.isShown(); parent.hidden = true; const hidden = node.isShown(); parent.hidden = false;
    node.remove(); parent.appendChild(node); await new Promise(requestAnimationFrame);
    dispose(); node.remove(); parent.appendChild(node); await new Promise(requestAnimationFrame);
    let invalid = false; try { node.onNodeInserted(null); } catch { invalid = true; }
    parent.remove();
    return { count, once, cancelled, detached, visible, hidden, invalid };
  });
  expect(result).toEqual({ count: 2, once: 1, cancelled: 0, detached: false, visible: true, hidden: false, invalid: true });
});

test('disposing an old once-only subscription cannot retire a newer shared DOM observer', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  const result = await frame.evaluate(async () => {
    const NativeObserver = window.MutationObserver; const active = new Set<MutationObserver>();
    // Observe real native registrations; do not simulate mutation delivery.
    window.MutationObserver = class extends NativeObserver {
      override observe(target: Node, options?: MutationObserverInit) { if (target === document) active.add(this); super.observe(target, options); }
      override disconnect() { active.delete(this); super.disconnect(); }
    };
    try {
      const element = document.createElement('p') as any;
      const old = element.onNodeInserted(() => {}, true); document.body.appendChild(element); await new Promise(requestAnimationFrame);
      const current = element.onNodeInserted(() => {}); old();
      const next = element.onNodeInserted(() => {}); const count = active.size;
      current(); next(); element.remove(); return { count, remaining: active.size };
    } finally { window.MutationObserver = NativeObserver; }
  });
  expect(result).toEqual({ count: 1, remaining: 0 });
});

test('the public Markdown renderer renders real markup and rejects foreign ownership without leaking DOM', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,MarkdownRenderer,Component}=require('obsidian'); module.exports=class extends Plugin {
    async onload(){
      const owner=this.addChild(new Component()); window.nestedMarkdown=document.body.createDiv();
      await MarkdownRenderer.render(this.app,'**真实 📚**',window.nestedMarkdown,'Other.md',owner);
      window.nestedResult={strong:window.nestedMarkdown.querySelector('strong')?.textContent, contains:'📚.md'.contains('.'),empty:'x'.contains(''),missing:'abc'.contains('z')};
      try { await MarkdownRenderer.render({},'bad',window.nestedMarkdown,'Other.md',owner); } catch { window.nestedResult.foreign=true; }
      window.nestedOwner=owner;
    }
  }`);
  expect(await frame.evaluate(() => (window as any).nestedResult)).toEqual({ strong: '真实 📚', contains: true, empty: true, missing: false, foreign: true });
  await frame.evaluate(() => (window as any).nestedOwner.unload());
  expect(await frame.evaluate(() => (window as any).nestedMarkdown.childElementCount)).toBe(0);
});

test('plugin settings mount once in their panel, hide on close and retain session data on reopen', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab,Setting,TextComponent}=require('obsidian'); module.exports=class extends Plugin {
    onload(){ const plugin=this; this.addSettingTab(new class extends PluginSettingTab {
      display(){this.containerEl.empty(); new Setting(this.containerEl).setName('Name').addText(t=>t.setValue(plugin.app.hostValue||'').onChange(v=>plugin.app.hostValue=v));
        const text=new TextComponent(this.containerEl).setValue('standalone'); window.standaloneValue=text.getValue(); }
      hide(){window.hideCount=(window.hideCount||0)+1;}
    }(this.app,this)); }
  }`);
  const result = await frame.evaluate(() => {
    const host = (window as any).host; const panel = document.body.appendChild(document.createElement('section')); panel.id = 'settings-panel';
    return host.showSettings('browser-canary', panel);
  });
  expect(result).toBe(1);
  await frame.locator('#settings-panel').getByRole('textbox', { name: 'Name', exact: true }).fill('真实 📚');
  expect(await frame.evaluate(() => (window as any).standaloneValue)).toBe('standalone');
  await frame.evaluate(async () => { await (window as any).host.hideSettings('browser-canary'); await (window as any).host.hideSettings('browser-canary'); });
  await expect(frame.locator('#settings-panel .setting-item')).toHaveCount(0);
  expect(await frame.evaluate(() => (window as any).hideCount)).toBe(1);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary', document.getElementById('settings-panel')));
  await expect(frame.locator('#settings-panel').getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('真实 📚');
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  await expect(frame.locator('#settings-panel')).toBeEmpty();
  expect(await frame.evaluate(() => (window as any).hideCount)).toBe(2);
});

test('a setting hide failure cannot skip plugin cleanup or leave other setting tabs mounted', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){ for(let i=0;i<2;i++)this.addSettingTab(new class extends PluginSettingTab {
      display(){this.containerEl.empty();new Setting(this.containerEl).setName('tab-'+i);}
      hide(){if(i===0)throw Error('hide failed');window.secondTabHidden=true;}
    }(this.app,this)); }
    onunload(){window.settingPluginUnloaded=true;}
  }`);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await frame.evaluate(async () => { try { await (window as any).host.unload('browser-canary'); } catch(error) { (window as any).settingsFailure=String(error); } });
  expect(await frame.evaluate(() => ({ hidden: (window as any).secondTabHidden, unloaded: (window as any).settingPluginUnloaded, error: (window as any).settingsFailure })))
    .toEqual({ hidden: true, unloaded: true, error: expect.stringContaining('cleanup failed') });
  await expect(frame.locator('.setting-item')).toHaveCount(0);
});

test('a failed settings display removes partially rendered controls and allows a clean retry', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){this.addSettingTab(new class extends PluginSettingTab {
      display(){this.containerEl.empty();new Setting(this.containerEl).setName('Partial');if(!window.displayAttempt++){throw Error('display failed');}}
      hide(){window.partialHidden=true;}
    }(this.app,this));window.displayAttempt=0;}
  }`);
  await frame.evaluate(async () => { try {await (window as any).host.showSettings('browser-canary');} catch(error){(window as any).displayFailure=String(error);} });
  expect(await frame.evaluate(() => (window as any).displayFailure)).toContain('display failed');
  await expect(frame.locator('.setting-item')).toHaveCount(0);
  expect(await frame.evaluate(() => (window as any).partialHidden)).toBe(true);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await expect(frame.locator('.setting-item')).toHaveCount(1);
});

test('asynchronous settings display and hide are awaited, with rejected displays cleaned before retry', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){window.asyncDisplays=0;this.addSettingTab(new class extends PluginSettingTab {
      async display(){this.containerEl.empty();await Promise.resolve();new Setting(this.containerEl).setName('Async option');if(++window.asyncDisplays===1)throw Error('async display failed');}
      async hide(){await Promise.resolve();window.asyncHides=(window.asyncHides||0)+1;}
    }(this.app,this));}
  }`);
  await expect(frame.evaluate(() => (window as any).host.showSettings('browser-canary'))).rejects.toThrow('async display failed');
  await expect(frame.locator('.setting-item')).toHaveCount(0);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await expect(frame.locator('.setting-item')).toHaveCount(1);
  await frame.evaluate(() => (window as any).host.hideSettings('browser-canary'));
  expect(await frame.evaluate(() => (window as any).asyncHides)).toBe(2);
  await expect(frame.locator('.setting-item')).toHaveCount(0);
});

test('closing a pending settings display detaches it immediately and cancels late publication', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){window.pendingDisplays=0;this.addSettingTab(new class extends PluginSettingTab {
      async display(){this.containerEl.empty();new Setting(this.containerEl).setName('Pending');if(++window.pendingDisplays===1)await new Promise(r=>window.finishSettingsDisplay=r);new Setting(this.containerEl).setName('Done');}
    }(this.app,this));}
  }`);
  await frame.evaluate(() => { (window as any).openingSettings=Promise.resolve((window as any).host.showSettings('browser-canary')).catch(error => String(error)); });
  await expect(frame.getByText('Pending', { exact: true })).toBeVisible();
  await frame.evaluate(() => { (window as any).closingSettings=(window as any).host.hideSettings('browser-canary'); });
  await expect(frame.locator('.setting-item')).toHaveCount(0);
  await frame.evaluate(() => (window as any).finishSettingsDisplay());
  expect(await frame.evaluate(() => (window as any).openingSettings)).toMatch(/closed|replaced|cancel/i);
  await frame.evaluate(() => (window as any).closingSettings);
  await expect(frame.locator('.setting-item')).toHaveCount(0);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await expect(frame.getByText('Done', { exact: true })).toBeVisible();
});

test('a timed-out setting hook is bounded and requires plugin reload before reusing its live tab', async ({ page }) => {
  const frame = await frameHost(page, 'hello', 200);
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){this.addSettingTab(new class extends PluginSettingTab {async display(){new Setting(this.containerEl).setName('Stuck');await new Promise(()=>{});}}(this.app,this));}
  }`);
  await expect(frame.evaluate(() => (window as any).host.showSettings('browser-canary'))).rejects.toThrow(/timed out/i);
  await expect(frame.locator('.setting-item')).toHaveCount(0);
  await expect(frame.evaluate(() => (window as any).host.showSettings('browser-canary'))).rejects.toThrow(/reload/i);
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  await load(frame, `const {Plugin,PluginSettingTab,Setting}=require('obsidian'); module.exports=class extends Plugin {
    onload(){this.addSettingTab(new class extends PluginSettingTab {display(){new Setting(this.containerEl).setName('Reloaded');}}(this.app,this));}
  }`);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await expect(frame.getByText('Reloaded', { exact: true })).toBeVisible();
});

test('plugin unload waits for asynchronous settings cleanup before disposing plugin resources', async ({ page }) => {
  const frame = await frameHost(page, 'hello');
  await load(frame, `const {Plugin,PluginSettingTab}=require('obsidian'); module.exports=class extends Plugin {
    onload(){this.addSettingTab(new class extends PluginSettingTab {async hide(){await new Promise(r=>setTimeout(r,30));window.settingResourceReleased=true;}}(this.app,this));}
    onunload(){window.cleanupOrderCorrect=window.settingResourceReleased===true;}
  }`);
  await frame.evaluate(() => (window as any).host.showSettings('browser-canary'));
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  expect(await frame.evaluate(() => (window as any).cleanupOrderCorrect)).toBe(true);
});

test('CM6 plugins observe real editor information and source-mode state without replacing the editor', async ({ page }) => {
  const frame = await frameHost(page, 'original');
  await load(frame, `const {Plugin,editorInfoField,editorLivePreviewField,editorEditorField,editorViewField}=require('obsidian');
    const {ViewPlugin}=require('@codemirror/view'); module.exports=class extends Plugin {
      onload(){
        window.editorFields={editorInfoField,editorLivePreviewField,editorEditorField};
        this.registerEditorExtension(ViewPlugin.define(view=>{
          const capture=()=>{const info=view.state.field(editorInfoField);window.editorInformation={path:info.file.path,
            content:info.editor.getValue(),app:info.app===this.app,view:view.state.field(editorEditorField)===view,
            live:view.state.field(editorLivePreviewField),alias:editorInfoField===editorViewField}};
          capture();return {update:capture};
        }));
      }
    }`);
  await frame.evaluate(() => (window as any).host.editor.setValue('changed'));
  expect(await frame.evaluate(() => (window as any).editorInformation)).toEqual({path:'Tables.md',content:'changed',app:true,view:true,live:false,alias:true});
  const state = await frame.evaluate(async () => {
    const host = (window as any).host; const field = (window as any).editorFields.editorInfoField;
    await host.unload('browser-canary'); const retained = host.editor.cm.state.field(field).file.path;
    await host.destroy(); return {retained,removed:host.editor.cm.state.field(field,false)===undefined};
  });
  expect(state).toEqual({retained:'Tables.md',removed:true});
});

test('original-style Vault readers receive actual file bytes and metadata updates across several files', async ({ page }) => {
  const server = await startObsidianFileFixture();
  try {
    mkdirSync(resolve(server.root, 'Notes')); writeFileSync(resolve(server.root, 'Tables.md'), '# Index');
    writeFileSync(resolve(server.root, 'Notes/中文.md'), '---\npriority: 2\n---\n- [ ] task #work');
    const snapshot = (sequence: number) => ({ vaultId: createHash('sha256').update(server.root).digest('hex'), name: 'Fixture vault', sequence, folders: [],
      files: ['Tables.md', 'Notes/中文.md'].map(path => {
        const full = resolve(server.root, path); const stat = statSync(full);
        return { path, data: [...readFileSync(full)], stat: { ctime: stat.birthtimeMs, mtime: stat.mtimeMs, size: stat.size } };
      }) });
    const frame = await frameHost(page, '# unsaved editor draft', 5000, snapshot(0));
    await load(frame, `const {Plugin,TFile,TFolder}=require('obsidian'); module.exports=class extends Plugin {
      onload() {
        window.vaultShape = this.app.workspace.getActiveFile() instanceof TFile && this.app.vault.getRoot() instanceof TFolder;
        this.registerEvent(this.app.metadataCache.on('resolve', file => { window.resolvedPath=file.path; window.resolvedCache=this.app.metadataCache.getFileCache(file); }));
        this.addCommand({id:'read',name:'Read vault',callback:async()=> {
          window.fileReads=await Promise.all(this.app.vault.getMarkdownFiles().map(async file=>[file.path,await this.app.vault.cachedRead(file),file.stat.mtime]));
        }});
      }
    };`);
    expect(await frame.evaluate(() => (window as any).vaultShape)).toBe(true);
    await frame.evaluate(() => (window as any).host.runCommand('browser-canary:read'));
    const reads = await frame.evaluate(() => (window as any).fileReads);
    expect(reads.map((value: unknown[]) => value.slice(0, 2))).toEqual([
      ['Notes/中文.md', '---\npriority: 2\n---\n- [ ] task #work'], ['Tables.md', '# Index'],
    ]);
    expect(reads.every((value: unknown[]) => Number(value[2]) > 0)).toBe(true);
    writeFileSync(resolve(server.root, 'Notes/中文.md'), '---\npriority: 3\n---\n# changed');
    await frame.evaluate(value => (window as any).updateVault(value), snapshot(1));
    expect(await frame.evaluate(() => ({ path: (window as any).resolvedPath, priority: (window as any).resolvedCache.frontmatter.priority })))
      .toEqual({ path: 'Notes/中文.md', priority: 3 });
    await frame.evaluate(() => (window as any).host.destroy());
    expect(await frame.evaluate(() => { try { (window as any).host.app.vault.getFiles(); return false; } catch { return true; } })).toBe(true);
  } finally { await server.close(); }
});

const emptyVault = (path = 'Tables.md') => ({ vaultId: 'a'.repeat(64), name: 'Notes', sequence: 0, folders: [],
  files: [{ path, data: [], stat: { ctime: 1, mtime: 2, size: 0 } }],
});
test('host cleanup keeps its original Vault owner and does not expose its update controller to plugin code', async ({ page }) => {
  const frame = await frameHost(page, '', 5000, emptyVault());
  const result = await frame.evaluate(async value => {
    const host = (window as any).host; const original = (window as any).ownerVault;
    const replacement = (window as any).makeVault(value);
    (window as any).hostOptions.vault = replacement;
    const controllerExposed = host.options !== undefined || Object.values(host).includes(original);
    await host.destroy();
    const isClosed = (vault: any) => { try { vault.getFiles(); return false; } catch { return true; } };
    const result = { controllerExposed, originalClosed: isClosed(original.vault), replacementClosed: isClosed(replacement.vault) };
    original.close(); replacement.close(); return result;
  }, emptyVault());
  expect(result).toEqual({ controllerExposed: false, originalClosed: true, replacementClosed: false });
});

test('the host rejects an active document outside the approved Vault snapshot', async ({ page }) => {
  await expect(frameHost(page, '', 5000, emptyVault('other.md'))).rejects.toThrow(/outside.*approved/i);
});

test('original-style Markdown codeblock render children run in the opaque host and clean up on unload', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await load(frame, `const {Plugin, MarkdownRenderChild} = require('obsidian');
    module.exports = class extends Plugin { onload() {
      this.registerMarkdownCodeBlockProcessor('query-canary', (source, element, ctx) => {
        ctx.addChild(new class extends MarkdownRenderChild {
          onload() { this.containerEl.textContent = 'Rendered: '+source; window.childLoaded = true;
            this.registerDomEvent(document, 'preview-canary', () => { window.previewClicks = (window.previewClicks || 0) + 1; }); }
          onunload() { window.childUnloaded = true; }
        }(element));
      });
    }};`);
  await frame.evaluate(async () => {
    const preview = document.body.appendChild(document.createElement('section')); preview.id = 'preview';
    await (window as any).host.renderMarkdown('# Query\n\n```query-canary\n中文 📝\n```', preview);
    document.dispatchEvent(new Event('preview-canary'));
  });
  await expect(frame.locator('#preview')).toContainText('Rendered: 中文 📝');
  await page.screenshot({ path: '/tmp/obsidian-browser-markdown-preview.png', fullPage: true });
  await frame.evaluate(async () => { await (window as any).host.unload('browser-canary'); document.dispatchEvent(new Event('preview-canary')); });
  expect(await frame.evaluate(() => ({ loaded: (window as any).childLoaded, unloaded: (window as any).childUnloaded, clicks: (window as any).previewClicks })))
    .toEqual({ loaded: true, unloaded: true, clicks: 1 });
  await expect(frame.locator('#preview pre code')).toHaveText('中文 📝\n');
});

test('unloading an old instance does not remove editor extensions registered by its replacement', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await load(frame, `const {Plugin}=require('obsidian'); module.exports=class extends Plugin {};`);
  await frame.evaluate(async () => {
    const pending = (window as any).host.unload('browser-canary');
    await (window as any).loadOriginal({id:'browser-canary',name:'Replacement',version:'2'},
      `const {Plugin}=require('obsidian'); const {EditorView}=require('@codemirror/view');
      module.exports=class extends Plugin { constructor(...args){super(...args);this.registerEditorExtension(EditorView.editable.of(false));} };`);
    await pending;
  });
  await expect(frame.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
});

test('real extension, commands and DOM events unload without leaking into the parent', async ({ page }) => {
  const frame = await frameHost(page, 'alpha');
  await load(frame, `const {Plugin} = require('obsidian');
    const {EditorView} = require('@codemirror/view');
    module.exports = class extends Plugin { onload() {
      this.registerEditorExtension(EditorView.editable.of(false));
      this.addRibbonIcon('test', 'Canary action', () => { window.canaryClicks = (window.canaryClicks || 0) + 1; });
      this.registerDomEvent(document, 'canary-event', () => { window.canaryEvents = (window.canaryEvents || 0) + 1; });
      this.addCommand({ id: 'write', name: 'Write', editorCallback: editor => editor.replaceSelection('X') });
    }};`);
  expect(await frame.evaluate(() => {
    try { return window.parent.document.getElementById('parent-secret')?.textContent; } catch { return 'blocked'; }
  })).toBe('blocked');
  expect(await frame.evaluate(() => (window as any).host.runCommand('browser-canary:write'))).toBe(true);
  await frame.getByRole('button', { name: 'Canary action' }).click();
  expect(await frame.evaluate(() => (window as any).canaryClicks)).toBe(1);
  await frame.evaluate(() => document.dispatchEvent(new Event('canary-event')));
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  await expect(frame.getByRole('button', { name: 'Canary action' })).toHaveCount(0);
  await frame.evaluate(() => document.dispatchEvent(new Event('canary-event')));
  expect(await frame.evaluate(() => (window as any).canaryEvents)).toBe(1);
  expect(await frame.evaluate(() => (window as any).host.runCommand('browser-canary:write'))).toBe(false);
  expect(await frame.locator('.cm-content').getAttribute('contenteditable')).toBe('true');
  expect(await page.locator('#parent-secret').textContent()).toBe('parent only');
});

test('failed loads and unreturned asynchronous work cannot resurrect a disabled plugin', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await expect(load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() { this.addRibbonIcon('x','Remove on failure',()=>{}); throw new Error('load failed'); }
  };`)).rejects.toThrow('load failed');
  await expect(frame.getByRole('button', { name: 'Remove on failure' })).toHaveCount(0);
  await load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() { window.lateRegister = () => this.addCommand({id:'late', name:'Late', callback:()=>{}}); }
  };`);
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  expect(await frame.evaluate(() => {
    try { (window as any).lateRegister(); return false; } catch { return true; }
  })).toBe(true);
  expect(await frame.evaluate(() => (window as any).host.getCommands())).toEqual([]);
});

test('late DOM registrations do not install listeners and failed view cleanup still disposes the plugin', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await load(frame, `const {Plugin, ItemView} = require('obsidian'); module.exports = class extends Plugin {
    onload() {
      window.lateListener = () => this.registerDomEvent(document, 'late-event', () => { window.leaked = true; });
      this.registerDomEvent(document, 'existing-event', () => { window.existingLeaked = true; });
      this.registerView('failing-view', leaf => new class extends ItemView {
        getViewType() { return 'failing-view'; }
        onunload() { throw new Error('view cleanup failed'); }
      }(leaf));
      this.addCommand({id:'open-view', name:'Open view', callback: () => this.app.workspace.getRightLeaf().setViewState({type:'failing-view'})});
    }
  };`);
  await frame.evaluate(() => (window as any).host.runCommand('browser-canary:open-view'));
  await expect(frame.evaluate(() => (window as any).host.unload('browser-canary'))).rejects.toThrow(/cleanup/i);
  expect(await frame.evaluate(() => {
    try { (window as any).lateListener(); } catch { /* Explicitly rejected. */ }
    document.dispatchEvent(new Event('late-event'));
    document.dispatchEvent(new Event('existing-event'));
    return { late: !!(window as any).leaked, existing: !!(window as any).existingLeaked };
  })).toEqual({ late: false, existing: false });
});

test('late event and timer registrations are rejected and disposed immediately', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() {
      window.lateResources = () => {
        const ref = this.app.workspace.on('late-workspace', () => { window.eventLeaked = true; });
        const interval = setInterval(() => { window.timerLeaked = true; }, 1);
        let rejected = 0;
        try { this.registerEvent(ref); } catch { rejected++; }
        try { this.registerInterval(interval); } catch { rejected++; }
        return rejected;
      };
    }
  };`);
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  expect(await frame.evaluate(() => (window as any).lateResources())).toBe(2);
  expect(await frame.evaluate(async () => {
    (window as any).host.app.workspace.trigger('late-workspace');
    await new Promise(resolve => setTimeout(resolve, 25));
    return { event: !!(window as any).eventLeaked, timer: !!(window as any).timerLeaked };
  })).toEqual({ event: false, timer: false });
});

test('asynchronous lifecycle timeouts revoke entry points and allow a clean retry', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged', 200);
  await expect(load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() { this.addRibbonIcon('x','Pending startup',()=>{}); return new Promise(() => {}); }
  };`)).rejects.toThrow(/timed out/i);
  await expect(frame.getByRole('button', { name: 'Pending startup' })).toHaveCount(0);
  await load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() { this.addCommand({id:'ok',name:'Okay',callback:()=>{}}); }
    onunload() { return new Promise(() => {}); }
  };`);
  await expect(frame.evaluate(() => (window as any).host.unload('browser-canary'))).rejects.toThrow(/cleanup/i);
  expect(await frame.evaluate(() => (window as any).host.getCommands())).toEqual([]);
});

test('an old startup failure cannot unload a newer instance with the same plugin id', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await frame.evaluate(meta => {
    (window as any).oldLoad = (window as any).loadOriginal(meta, `const {Plugin} = require('obsidian');
      module.exports = class extends Plugin { onload() {
        return new Promise((resolve, reject) => { window.rejectOld = reject; });
      }};`).catch((error: Error) => error.message);
  }, manifest);
  await frame.waitForFunction(() => typeof (window as any).rejectOld === 'function');
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  await load(frame, `const {Plugin} = require('obsidian'); module.exports = class extends Plugin {
    onload() { this.addCommand({id:'new',name:'New instance',callback:()=>{}}); }
  };`);
  await frame.evaluate(() => (window as any).rejectOld(new Error('Old startup failed')));
  expect(await frame.evaluate(() => (window as any).oldLoad)).toBe('Old startup failed');
  expect(await frame.evaluate(() => (window as any).host.runCommand('browser-canary:new'))).toBe(true);
});

test('a view switch waiting for cleanup cannot remount a disabled plugin', async ({ page }) => {
  const frame = await frameHost(page, 'unchanged');
  await load(frame, `const {Plugin, ItemView} = require('obsidian'); module.exports = class extends Plugin {
    onload() {
      this.registerView('first-view', leaf => new class extends ItemView {
        getViewType() { return 'first-view'; }
        onunload() { return new Promise(resolve => { window.closeOld = resolve; }); }
      }(leaf));
      this.registerView('second-view', leaf => new class extends ItemView { getViewType() { return 'second-view'; } }(leaf));
      window.leaf = this.app.workspace.getRightLeaf();
    }
  };`);
  await frame.evaluate(() => (window as any).leaf.setViewState({type:'first-view'}));
  await frame.evaluate(() => {
    (window as any).viewSwitch = (window as any).leaf.setViewState({type:'second-view'})
      .then(() => 'mounted', (error: Error) => error.message);
  });
  await frame.waitForFunction(() => typeof (window as any).closeOld === 'function');
  await frame.evaluate(() => (window as any).host.unload('browser-canary'));
  await frame.evaluate(() => (window as any).closeOld());
  expect(await frame.evaluate(() => (window as any).viewSwitch)).toMatch(/unloaded/i);
  await expect(frame.locator('[data-type="second-view"]')).toHaveCount(0);
});

test.describe('unmodified Advanced Tables 0.23.2', () => {
  test.skip(!fixtureDir, 'Set MINDOS_OBSIDIAN_ADVANCED_TABLES_DIR to verified original release assets.');
  const doc = '| Name | Qty |\n| --- | --- |\n| Apple | 2 |\n| Pear | 10 |';
  let source: string;
  let styles: string;
  let meta: typeof manifest;
  test.beforeAll(() => {
    source = readFileSync(resolve(fixtureDir!, 'main.js'), 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe('cf5dd4ddbddebef68cc99cd93a883e33895c7f123d04bc5d1106ea6e338ba791');
    const manifestSource = readFileSync(resolve(fixtureDir!, 'manifest.json'), 'utf8');
    expect(createHash('sha256').update(manifestSource).digest('hex')).toBe('698b4f77445e07d887f33450eaf533a28e099b7b483f642fa883362ffbd8ffe9');
    meta = JSON.parse(manifestSource);
    styles = readFileSync(resolve(fixtureDir!, 'styles.css'), 'utf8');
    expect(createHash('sha256').update(styles).digest('hex')).toBe('23fa30d76f117fd3d1624c4c2e6ddedabf809923996b0534895f8254ea6a39f7');
    expect(meta.version).toBe('0.23.2');
  });

  test('formats tables, navigates cells with real keys, opens the toolbar and unloads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const frame = await frameHost(page, doc);
    await load(frame, source, meta, styles);
    await expect.poll(() => frame.evaluate(() => (window as any).host.getCommands().length)).toBe(22);
    await frame.evaluate(() => (window as any).host.editor.setCursor(2, 3));
    expect(await frame.evaluate(() => (window as any).host.runCommand('table-editor-obsidian:format-table'))).toBe(true);
    expect(await frame.evaluate(() => (window as any).host.editor.getValue())).toBe('| Name  | Qty |\n| ----- | --- |\n| Apple | 2   |\n| Pear  | 10  |');
    await frame.locator('.cm-content').focus();
    await page.keyboard.press('Tab');
    // Upstream nextCell selects the cell text (_selectFocus), not a caret at its start.
    expect(await frame.evaluate(() => (window as any).host.editor.getCursor())).toEqual({ line: 2, ch: 11 });
    expect(await frame.evaluate(() => (window as any).host.editor.getSelection())).toBe('2');
    await page.keyboard.press('Shift+Tab');
    expect(await frame.evaluate(() => (window as any).host.editor.getSelection())).toBe('Apple');
    await page.keyboard.press('Enter');
    expect(await frame.evaluate(() => (window as any).host.editor.getCursor().line)).toBe(3);
    await frame.getByRole('button', { name: 'Advanced Tables Toolbar' }).click();
    await expect(frame.locator('.advanced-tables-buttons')).toBeVisible();
    expect(await frame.locator('[data-type="advanced-tables-toolbar"]').count()).toBe(1);
    expect(await frame.locator('.widget-icon').first().evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(28);
    expect(await frame.locator('.nav-buttons-container').first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    await frame.locator('[title="insert row above"]').click();
    expect(await frame.evaluate(() => (window as any).host.editor.lineCount())).toBe(5);
    await page.screenshot({ path: '/tmp/obsidian-advanced-tables-browser-loaded.png', fullPage: true });
    await frame.evaluate(() => (window as any).host.unload('table-editor-obsidian'));
    await expect(frame.locator('.advanced-tables-buttons')).toHaveCount(0);
    await expect(frame.locator('style[data-obsidian-plugin="table-editor-obsidian"]')).toHaveCount(0);
    expect(await frame.evaluate(() => (window as any).host.getCommands())).toEqual([]);
    await page.screenshot({ path: '/tmp/obsidian-advanced-tables-browser-unloaded.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('respects code fences and settings changes survive plugin reload in the host session', async ({ page }) => {
    const frame = await frameHost(page, '```md\n' + doc + '\n```');
    await load(frame, source, meta, styles);
    await expect.poll(() => frame.evaluate(() => (window as any).host.getCommands().length)).toBe(22);
    await frame.evaluate(() => (window as any).host.editor.setCursor(3, 3));
    expect(await frame.evaluate(() => (window as any).host.runCommand('table-editor-obsidian:format-table'))).toBe(false);
    expect(await frame.evaluate(() => (window as any).host.editor.getValue())).toBe('```md\n' + doc + '\n```');
    await frame.evaluate(() => (window as any).host.showSettings('table-editor-obsidian'));
    await frame.getByRole('checkbox', { name: 'Pad cell width using spaces' }).uncheck();
    await frame.evaluate(() => (window as any).host.unload('table-editor-obsidian'));
    await load(frame, source, meta, styles);
    await expect.poll(() => frame.evaluate(() => (window as any).host.getCommands().length)).toBe(22);
    await frame.evaluate(() => (window as any).host.showSettings('table-editor-obsidian'));
    await expect(frame.getByRole('checkbox', { name: 'Pad cell width using spaces' })).not.toBeChecked();
    await page.screenshot({ path: '/tmp/obsidian-advanced-tables-browser-settings.png', fullPage: true });
  });

  test('loads fingerprint-approved original bytes, saves their edit, and preserves conflicts', async ({ page }) => {
    const server = await startObsidianFileFixture();
    const filePath = 'Tables.md';
    const diskPath = resolve(server.root, filePath);
    writeFileSync(diskPath, doc);
    const packageDir = resolve(server.root, '.mindos/plugins', meta.id);
    mkdirSync(packageDir, { recursive: true });
    for (const name of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(resolve(packageDir, name), readFileSync(resolve(fixtureDir!, name)));
    let session: Awaited<ReturnType<typeof prepareObsidianPluginSession>> = null;
    try {
      session = await prepareObsidianPluginSession({
        ...server, filePath, pluginId: meta.id, isCurrent: () => true, signal: new AbortController().signal,
        // Fixture-only owner approval; a real launch still needs native consent.
        approve: async request => request.filePath === filePath && request.pluginId === meta.id,
      });
      expect(session).not.toBeNull();
      expect(session!.binding.fingerprint).toBe('ca5771c1a61a259a9b7946f830e83ef7f3753a0e99a546504e744a149fae77a2');
      const frame = await frameHost(page, session!.snapshot.content);
      const captured = (path: string) => Buffer.from(session!.package.files.find(file => file.path === path)!.base64, 'base64').toString('utf8');
      expect(captured('main.js')).toBe(source);
      await load(frame, captured('main.js'), meta, captured('styles.css'));
      await expect.poll(() => frame.evaluate(() => (window as any).host.getCommands().length)).toBe(22);
      await frame.evaluate(() => (window as any).host.editor.setCursor(2, 3));
      expect(await frame.evaluate(() => (window as any).host.runCommand('table-editor-obsidian:format-table'))).toBe(true);
      const formatted = await frame.evaluate(() => (window as any).host.editor.getValue()) as string;
      session!.setDraft(formatted);
      await session!.save();
      expect(readFileSync(diskPath, 'utf8')).toBe(formatted);
      const audit = JSON.parse(readFileSync(resolve(server.root, '.mindos/change-log.json'), 'utf8'));
      expect(audit.events).toEqual(expect.arrayContaining([expect.objectContaining({ agentName: 'obsidian:table-editor-obsidian', after: formatted })]));
      expect(session!.snapshot.dirty).toBe(false);
      await frame.evaluate(() => (window as any).host.editor.replaceRange('Green apple', { line: 2, ch: 2 }, { line: 2, ch: 7 }));
      const draft = await frame.evaluate(() => (window as any).host.editor.getValue()) as string;
      const stat = statSync(diskPath);
      writeFileSync(diskPath, 'External editor owns this change.');
      utimesSync(diskPath, stat.atime, stat.mtime);
      session!.setDraft(draft);
      await expect(session!.save()).rejects.toThrow('conflict');
      expect(readFileSync(diskPath, 'utf8')).toBe('External editor owns this change.');
      expect(session!.snapshot).toMatchObject({ content: draft, dirty: true, status: 'conflict' });
      expect(JSON.parse(readFileSync(resolve(server.root, '.mindos/change-log.json'), 'utf8')).events).toEqual(audit.events);
      await expect(session!.save()).rejects.toThrow('conflict');
      await frame.evaluate(() => (window as any).host.destroy());
    } finally {
      session?.close();
      await server.close();
    }
  });
});
