import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('packages/web/lib/capture-draft-storage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('persists real files on ordinary HTTP, enforces revisions, and retains corrupted originals', async ({ page }) => {
  await page.route('http://mindos-storage.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Isolated draft storage</title>' }));
  await page.goto('http://mindos-storage.invalid/');
  const result = await page.evaluate(async code => {
    const exports: Record<string, any> = {};
    new Function('exports', code)(exports);
    const storage = exports.captureDraftStorage;
    const value = { draftText: '你好 👋', stagedNotes: [], pendingUrls: ['https://example.com'], pendingFiles: [new File(['attachment body'], '附件.md', { type: 'text/markdown' })] };
    const revision = await storage.write('vault-a', null, value);
    const restored = await storage.read('vault-a');
    let conflict = false;
    try { await storage.write('vault-a', null, { ...value, draftText: 'stale' }); } catch { conflict = true; }
    const empty = { draftText: '', stagedNotes: [], pendingUrls: [], pendingFiles: [] };
    const tombstone = await storage.write('vault-a', revision, empty);
    let resurrectionBlocked = false;
    try { await storage.write('vault-a', revision, value); } catch { resurrectionBlocked = true; }
    const otherVault = await storage.read('vault-b');
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mindos-capture-drafts', 1);
      req.onsuccess = () => {
        const db = req.result; const tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({ broken: 'original' }, 'broken-vault');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    let invalidRead = false, invalidWrite = false;
    try { await storage.read('broken-vault'); } catch { invalidRead = true; }
    try { await storage.write('broken-vault', null, value); } catch { invalidWrite = true; }
    return { secure: isSecureContext, hasUuid: typeof crypto.randomUUID, text: restored.value.draftText,
      fileName: restored.value.pendingFiles[0].name, fileText: await restored.value.pendingFiles[0].text(),
      conflict, resurrectionBlocked, empty: (await storage.read('vault-a')).value.draftText,
      newRevision: tombstone !== revision, otherVault, invalidRead, invalidWrite };
  }, source);
  expect(result).toEqual({ secure: false, hasUuid: 'undefined', text: '你好 👋', fileName: '附件.md', fileText: 'attachment body',
    conflict: true, resurrectionBlocked: true, empty: '', newRevision: true, otherVault: null, invalidRead: true, invalidWrite: true });
});
