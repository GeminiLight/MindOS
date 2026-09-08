import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron, test, expect, type ElectronApplication } from '@playwright/test';
import { buildObsidianDesktopRuntime } from '../../scripts/build-obsidian-desktop-runtime.mjs';
import { startObsidianFileFixture } from './fixtures/obsidian-file-server';

const executablePath = process.env.MINDOS_ELECTRON_EXECUTABLE;
const original = process.env.MINDOS_OBSIDIAN_ADVANCED_TABLES_DIR;
test.skip(!executablePath || !original, 'Requires local Electron and verified original Advanced Tables assets.');
const desktop = resolve(import.meta.dirname, '../../packages/desktop');
const web = resolve(desktop, '../web');
let directory: string; let dataDirectory: string; let application: ElectronApplication | undefined;
let server: Awaited<ReturnType<typeof startObsidianFileFixture>>;

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'obsidian-native-launch-'));
  await buildObsidianDesktopRuntime(directory);
  await build({ entryPoints: [join(desktop, 'src/preload.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'owner-preload.js') });
  await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DesktopObsidianEditor} from './components/settings/DesktopObsidianEditor';
    createRoot(document.getElementById('root')).render(<DesktopObsidianEditor plugins={[{id:'table-editor-obsidian',name:'Advanced Tables'}]}/>);`,
    loader: 'tsx', resolveDir: web }, tsconfig: join(web, 'tsconfig.json'), bundle: true, platform: 'browser', format: 'iife', outfile: join(directory, 'ui.js') });
  const require = createRequire(join(web, 'package.json'));
  const postcss = require('postcss'); const tailwind = require('@tailwindcss/postcss');
  const css = await postcss([tailwind({ base: web })]).process(readFileSync(join(web, 'app/globals.css'), 'utf8'), { from: join(web, 'app/globals.css') });
  writeFileSync(join(directory, 'ui.css'), css.css);
  await build({ stdin: { contents: `
    import {app,BrowserWindow,ipcMain,dialog} from 'electron'; import {readFileSync} from 'node:fs';
    import {createObsidianEditorLauncher} from ${JSON.stringify(join(desktop, 'src/obsidian-editor-launcher.ts'))};
    const dir=process.env.MINDOS_LAUNCH_FIXTURE_DIR;
    const data=process.env.MINDOS_LAUNCH_DATA_DIR;
    app.setPath('userData',data); app.on('window-all-closed',()=>{});
    app.whenReady().then(async()=>{
      const owner=new BrowserWindow({width:900,height:680,webPreferences:{preload:dir+'/owner-preload.js',sandbox:true,contextIsolation:true,nodeIntegration:false}});
      let current=true;
      const launcher=createObsidianEditorLauncher(()=>({window:owner,baseUrl:process.env.MINDOS_LAUNCH_BASE_URL,
        token:process.env.MINDOS_LAUNCH_TOKEN,isCurrent:()=>current}),dir,data+'/drafts');
      // Only native dialog response is substituted; real approval/package/owner/window code runs.
      globalThis.dialogSubjects=[];
      dialog.showMessageBox=async(_owner,subject)=>{globalThis.approvalSubject=subject;globalThis.dialogSubjects.push(subject);
        return {response:subject.title==='MindOS' ? (globalThis.closeDecision??0) : subject.buttons.includes('恢复草稿') ? 1
          : subject.title==='MindOS · 草稿恢复' ? 0 : 1,checkboxChecked:globalThis.allowVault===true}};
      ipcMain.handle('get-app-info',()=>({mode:'local'}));
      ipcMain.handle('obsidian:open-editor',(event,request)=>launcher.open(event,request));
      globalThis.launchFixture={owner,revoke:()=>{current=false}};
      await owner.loadURL(process.env.MINDOS_LAUNCH_BASE_URL+'/_fixture-owner');
      await owner.webContents.insertCSS(readFileSync(dir+'/ui.css','utf8'));
      await owner.webContents.executeJavaScript(readFileSync(dir+'/ui.js','utf8'));
    });
  `, resolveDir: desktop }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'main.cjs') });
});
// Each test owns its journals; crash/relaunch within one test keeps the same directory.
test.beforeEach(() => { dataDirectory = mkdtempSync(join(directory, 'user-data-')); });
test.afterEach(async () => {
  if (application) {
    await application.evaluate(({ app, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      setImmediate(() => app.exit(0));
    });
    await application.close(); application = undefined;
  }
  await server?.close();
});
test.afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function prepareVault() {
  server = await startObsidianFileFixture({ ownerPage: '<!doctype html><meta charset="utf-8"><title>Settings entry fixture</title><main class="p-6 max-w-xl mx-auto"><h1 class="text-xl mb-6">插件设置</h1><div id="root"></div></main>' });
  writeFileSync(join(server.root, 'Tables.md'), '| A | B |\n| --- | --- |\n| a | b |');
  const plugin = join(server.root, '.mindos/plugins/table-editor-obsidian'); mkdirSync(plugin, { recursive: true });
  for (const name of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(plugin, name), readFileSync(join(original!, name)));
}
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await _electron.launch({ executablePath, args: [join(directory, 'main.cjs')], env: { ...env,
    MINDOS_LAUNCH_FIXTURE_DIR: directory, MINDOS_LAUNCH_DATA_DIR: dataDirectory, MINDOS_LAUNCH_BASE_URL: server.baseUrl, MINDOS_LAUNCH_TOKEN: server.token } });
  const owner = await application.firstWindow();
  await owner.getByText('桌面隔离编辑器（实验）', { exact: true }).click();
  await owner.getByLabel('笔记路径', { exact: true }).fill('Tables.md');
  return owner;
}
const backups = () => {
  try { return readdirSync(join(dataDirectory, 'drafts')).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(dataDirectory, 'drafts', name), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
};

test('settings entry uses production preload and native coordinator to open an original plugin, then owner revocation closes it', async () => {
  await prepareVault(); const owner = await launch();
  await owner.screenshot({ path: '/tmp/obsidian-desktop-launch-light.png', fullPage: true });
  await owner.evaluate(() => document.documentElement.classList.add('dark'));
  const expectedAmber = await owner.evaluate(() => {
    const swatch = document.body.appendChild(document.createElement('span'));
    swatch.style.color = 'var(--amber)'; const color = getComputedStyle(swatch).color; swatch.remove(); return color;
  });
  await expect(owner.getByRole('button', { name: '请求桌面运行' })).toHaveCSS('background-color', expectedAmber);
  await owner.screenshot({ path: '/tmp/obsidian-desktop-launch-dark.png', fullPage: true });
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  await expect.poll(() => application!.windows().length).toBe(2);
  const editor = application.windows().find(page => page !== owner)!;
  await expect(editor.getByRole('button', { name: '刷新知识库' })).toBeHidden();
  await expect(editor.frameLocator('iframe').getByLabel('Plugin command').locator('option')).toHaveCount(22);
  const subject = await application.evaluate(() => (globalThis as any).approvalSubject);
  expect(subject.detail).toContain('Tables.md'); expect(subject.detail).toContain('SHA-256:');
  expect(await owner.evaluate(() => JSON.stringify((window as any).mindos))).not.toContain(server.token);
  await application.evaluate(() => (globalThis as any).launchFixture.revoke());
  await expect.poll(() => application!.windows().length).toBe(1);
});

test('explicit native read grant supplies real files and refresh events without granting extra writes or credentials', async () => {
  await prepareVault();
  writeFileSync(join(server.root, 'Other.md'), '---\ntopic: first\n---\n真实笔记');
  writeFileSync(join(server.root, 'asset.bin'), Buffer.from([0, 255, 128]));
  writeFileSync(join(server.root, '.env'), 'not-for-plugins');
  // Purpose-built API canary, not an assertion that this is an original community plugin.
  writeFileSync(join(server.root, '.mindos/plugins/table-editor-obsidian/main.js'), `
    const {Plugin,TFile}=require('obsidian'); module.exports=class extends Plugin {
      onload(){
        this.registerEvent(this.app.vault.on('modify',file=>{document.body.dataset.refreshed=file.path}));
        this.registerDomEvent(document,'register-read-command',()=>this.addCommand({id:'read-other',name:'Read other note',editorCallback:async editor=>{
          const file=this.app.vault.getFileByPath('Other.md');
          const bytes=new Uint8Array(await this.app.vault.adapter.readBinary('asset.bin'));
          let denied=false;try{await this.app.vault.modify(file,'bad write')}catch{denied=true}
          editor.setValue(JSON.stringify({text:await this.app.vault.read(file),topic:this.app.metadataCache.getFileCache(file).frontmatter.topic,
            actualFile:file instanceof TFile,bytes:[...bytes],denied,private:!this.app.vault.getFiles().some(f=>f.path.startsWith('.')),
            bridge:typeof window.mindos,node:typeof require('obsidian').ipcRenderer}));
        }}));
      }
    };`);
  const owner = await launch(); await application!.evaluate(() => { (globalThis as any).allowVault = true; });
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  const editor = application!.windows().find(page => page !== owner)!;
  const frame = editor.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Run command', exact: true })).toBeDisabled();
  await frame.locator('body').evaluate(() => document.dispatchEvent(new Event('register-read-command')));
  await expect(frame.getByLabel('Plugin command').locator('option')).toHaveCount(1);
  await frame.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(frame.locator('.cm-content')).toContainText('真实笔记');
  const result = JSON.parse(await frame.locator('.cm-content').innerText());
  expect(result).toMatchObject({ topic: 'first', actualFile: true, bytes: [0,255,128], denied: true, private: true, bridge: 'undefined', node: 'undefined' });
  expect(JSON.stringify(result)).not.toContain(server.token);
  expect(readFileSync(join(server.root, 'Other.md'), 'utf8')).toContain('真实笔记');
  writeFileSync(join(server.root, 'Other.md'), '---\ntopic: second\n---\n外部更新');
  await editor.getByRole('button', { name: '刷新知识库' }).click();
  await expect(frame.locator('body')).toHaveAttribute('data-refreshed', 'Other.md');
  await frame.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(frame.locator('.cm-content')).toContainText('外部更新');
  expect(JSON.parse(await frame.locator('.cm-content').innerText()).topic).toBe('second');
  await editor.screenshot({ path: '/tmp/obsidian-desktop-vault-refresh.png' });
  // Updating installed code cannot inherit the session's read grant.
  writeFileSync(join(server.root, '.mindos/plugins/table-editor-obsidian/main.js'), 'changed');
  await editor.getByRole('button', { name: '刷新知识库' }).click();
  await expect.poll(() => application!.windows().length).toBe(1);
});

test('a persisted original-plugin draft survives main-process crash and explicit recovery, without writing the vault', async () => {
  await prepareVault(); let owner = await launch();
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  let editor = application!.windows().find(page => page !== owner)!;
  const content = '崩溃后恢复 📝';
  await editor.frameLocator('iframe').locator('.cm-content').fill(content);
  await expect.poll(() => backups().some(record => record.content === content)).toBe(true);
  const diskBefore = readFileSync(join(server.root, 'Tables.md'), 'utf8');
  const crashed = application!; const exit = new Promise<void>(resolve => crashed.process().once('exit', () => resolve()));
  // Kill only the exact test Electron process. No graceful close/flush callback runs.
  crashed.process().kill('SIGKILL'); await exit; application = undefined;
  owner = await launch();
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  editor = application!.windows().find(page => page !== owner)!;
  await expect(editor.frameLocator('iframe').locator('.cm-content')).toHaveText(content);
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(diskBefore);
  const dialogs = await application!.evaluate(() => (globalThis as any).dialogSubjects);
  expect(dialogs.some((item: any) => item.buttons.includes('恢复草稿'))).toBe(true);
  await editor.screenshot({ path: '/tmp/obsidian-desktop-draft-recovered.png' });
  await editor.getByRole('button', { name: '保存笔记' }).click();
  await expect.poll(() => readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe(content);
  await expect.poll(() => backups().length).toBe(0);
});

test('explicit discard removes the current recovery backup and normal window cleanup cannot resurrect it', async () => {
  await prepareVault(); const owner = await launch();
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  const editor = application!.windows().find(page => page !== owner)!;
  await editor.frameLocator('iframe').locator('.cm-content').fill('discard this draft');
  await expect.poll(() => backups().some(record => record.content === 'discard this draft')).toBe(true);
  await application!.evaluate(({ BrowserWindow }) => {
    (globalThis as any).closeDecision = 2;
    BrowserWindow.getAllWindows().find(window => window !== (globalThis as any).launchFixture.owner)!.close();
  });
  await expect.poll(() => application!.windows().length).toBe(1);
  expect(backups().some(record => record.content === 'discard this draft')).toBe(false);
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).not.toContain('discard this draft');
});

test('a changed note refuses automatic recovery and keeps the backup for manual reconciliation', async () => {
  await prepareVault(); const owner = await launch();
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已打开独立编辑窗口。');
  const editor = application!.windows().find(page => page !== owner)!;
  await editor.frameLocator('iframe').locator('.cm-content').fill('old draft');
  await expect.poll(() => backups().some(record => record.content === 'old draft')).toBe(true);
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window !== (globalThis as any).launchFixture.owner)!.destroy());
  await expect.poll(() => application!.windows().length).toBe(1);
  writeFileSync(join(server.root, 'Tables.md'), 'external newer note');
  await owner.getByRole('button', { name: '请求桌面运行' }).click();
  await expect(owner.getByRole('status')).toHaveText('已取消，未运行插件。');
  expect(readFileSync(join(server.root, 'Tables.md'), 'utf8')).toBe('external newer note');
  expect(backups().some(record => record.content === 'old draft')).toBe(true);
  expect((await application!.evaluate(() => (globalThis as any).approvalSubject)).buttons).toEqual(['取消', '查看备份文件']);
});
