// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n';
// Isolate the runtime identity API from the queue/write failure scenarios below.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiFetch: (url: string, options?: Parameters<typeof actual.apiFetch>[1]) => url === '/api/connect'
    ? Promise.resolve({ rootId: document.documentElement.dataset.mindRootId }) : actual.apiFetch(url, options) };
});
import { getCaptureDraftController } from '@/lib/capture-draft-controller';
import { captureDraftStorage, CaptureDraftConflictError } from '@/lib/capture-draft-storage';

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: messages.en }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/capture' }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (data: unknown) => ({ ok: true, json: async () => data });
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
async function render() {
  const InboxView = (await import('@/components/InboxView')).default;
  await act(async () => { root.render(<InboxView />); await tick(); });
}
async function type(text: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/capture');
  document.documentElement.dataset.mindRootId = crypto.randomUUID();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock = vi.fn(async () => json({ files: [] }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  const controller = getCaptureDraftController(document.documentElement.dataset.mindRootId!);
  controller.clear();
  await controller.flush();
  host.remove();
  delete document.documentElement.dataset.mindRootId;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label || b.getAttribute('aria-label') === label);
  expect(button, `Missing action: ${label}`).toBeTruthy();
  await act(async () => { button!.click(); await tick(); });
}
async function attach(file: File) {
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await tick(); });
}
function holdSave() {
  let finish!: () => void;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return json({ files: [] });
    const body = JSON.parse(String(init.body));
    await new Promise<void>(resolve => { finish = resolve; });
    return json({ saved: body.files.map((f: { name: string }) => ({ original: f.name, path: `Inbox/${f.name}` })), skipped: [] });
  });
  return async () => { await vi.waitFor(() => expect(finish).toBeTypeOf('function')); await act(async () => { finish(); await tick(); }); };
}

describe('capture draft recovery', () => {
  it('keeps the input node, focus and selection through a same-library window focus check', async () => {
    await render(); await type('Keep the caret here');
    const input = host.querySelector('textarea')!; input.focus(); input.setSelectionRange(5, 10);
    await act(async () => { window.dispatchEvent(new Event('focus')); await tick(); });
    expect(host.querySelector('textarea')).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(5); expect(input.selectionEnd).toBe(10);
  });
  it('stages equal text in the current library after returning to an already loaded library', async () => {
    const a = document.documentElement.dataset.mindRootId!;
    await render(); await type('same text');
    document.documentElement.dataset.mindRootId = `${a}-b`;
    await act(async () => { window.dispatchEvent(new Event('mindos:settings-changed')); await tick(); });
    await type('same text');
    document.documentElement.dataset.mindRootId = a;
    await act(async () => { window.dispatchEvent(new Event('mindos:settings-changed')); await tick(); });
    await click('Add to batch');
    expect(getCaptureDraftController(a).getSnapshot().value.stagedNotes).toHaveLength(1);
    expect(getCaptureDraftController(`${a}-b`).getSnapshot().value.draftText).toBe('same text');
    expect(getCaptureDraftController(`${a}-b`).getSnapshot().value.stagedNotes).toHaveLength(0);
  });
  it('rejects oversized files before the local draft attempts to persist them', async () => {
    await render();
    const oversized = new File(['large'], 'too-large.bin'); Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    await attach(oversized);
    expect(getCaptureDraftController(document.documentElement.dataset.mindRootId!).getSnapshot().value.pendingFiles).toEqual([]);
  });
  it('keeps the composer usable while the saved queue is still loading', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    await render();
    expect(host.querySelector('textarea')).not.toBeNull();
    await type('An idea should not wait for the queue');
    expect(host.querySelector('textarea')?.value).toBe('An idea should not wait for the queue');
    expect(host.textContent).toContain('Loading Inbox...');
    expect(host.textContent).not.toContain('Nothing waiting');
  });

  it('does not display empty previews or repeat plain-text metadata', async () => {
    await render();
    expect(host.querySelector('[data-inbox-source-preview]')).toBeNull();
    expect(host.querySelector('[data-inbox-queue-preview-action]')).toBeNull();
    await type('The actual note is already visible here');
    expect(host.querySelector('[data-inbox-source-preview]')).toBeNull();
    expect(host.querySelector('[data-inbox-primary-actions]')?.textContent).not.toContain('Organize');
  });

  it('preserves current input while a failed queue read is retried', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Queue is unavailable' }) });
    await render(); await type('Keep writing through a queue failure');
    expect(host.textContent).toContain('Queue is unavailable');
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await click('Retry');
    expect(host.querySelector('textarea')?.value).toBe('Keep writing through a queue failure');
    await type('Still editable during retry');
    await act(async () => { finish(json({ files: [] })); await tick(); });
    expect(host.querySelector('textarea')?.value).toBe('Still editable during retry');
    expect(host.textContent).not.toContain('Queue is unavailable');
  });

  it('places save before the growing batch list so attachments do not push it away', async () => {
    await render(); await type('First'); await click('Add to batch');
    await attach(new File(['content'], 'attachment.txt'));
    const save = host.querySelector('[data-inbox-primary-actions]')!;
    const staged = host.querySelector('button[aria-label="Edit First"]')!;
    expect(save.compareDocumentPosition(staged) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(host.querySelector('textarea')?.className).toContain('max-h-72');
  });

  it('can undo clearing notes and attachments without overwriting new input', async () => {
    await render(); await type('First staged note'); await click('Add to batch');
    const attachment = new File(['Retain these bytes'], '记录 🌱.txt');
    await attach(attachment); await type('Original draft'); await click('Clear');
    expect(host.querySelector('textarea')?.value).toBe('');
    expect(host.textContent).not.toContain('First staged note');
    await type('New idea after clearing'); await click('Undo clear');
    expect(host.querySelector('textarea')?.value).toBe('Original draft');
    expect(host.textContent).toContain('First staged note');
    expect(host.textContent).toContain('New idea after clearing');
    expect(getCaptureDraftController(document.documentElement.dataset.mindRootId!).getSnapshot().value.pendingFiles).toEqual([attachment]);
    expect(host.textContent).not.toContain('Undo clear');
  });

  it('does not offer to clear a batch while its save is in flight', async () => {
    const finish = holdSave();
    await render(); await type('Awaiting save'); await click('Save to Inbox');
    const clear = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Clear')!;
    expect(clear.disabled).toBe(true);
    await click('Clear');
    expect(host.querySelector('textarea')?.value).toBe('Awaiting save');
    await finish();
  });

  it('keeps the undo snapshot if Clear is activated twice before a render', async () => {
    await render(); await type('Recover after double click');
    await act(async () => {
      const clear = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Clear')!;
      clear.click(); clear.click();
    });
    await click('Undo clear');
    expect(host.querySelector('textarea')?.value).toBe('Recover after double click');
  });

  it('keeps source metadata behind an accessible disclosure instead of another open card', async () => {
    await render(); await attach(new File(['file'], 'file.txt'));
    const source = host.querySelector('[data-inbox-source-preview]')!;
    expect(source.tagName).toBe('DETAILS');
    expect((source as HTMLDetailsElement).open).toBe(false);
    expect(source.querySelector('summary')?.textContent).toBe('Source details');
    expect(source.querySelector('summary')?.className).toContain('min-h-11');
    expect(host.textContent).not.toContain('Review pending');
    expect(host.querySelector('[data-inbox-main-layout]')?.className).not.toContain('2xl:grid-cols');
  });

  it('keeps a new note when the cleared batch had only an attachment and whitespace', async () => {
    await render(); await attach(new File(['file'], 'file.txt')); await type('   '); await click('Clear');
    await type('Keep this new note'); await click('Undo clear');
    expect(host.querySelector('textarea')?.value).toBe('Keep this new note');
    expect(host.textContent).toContain('file.txt');
  });

  it('does not expose another library’s cleared batch after changing libraries', async () => {
    await render(); await type('Library A private note'); await click('Clear');
    expect(host.textContent).toContain('Undo clear');
    document.documentElement.dataset.mindRootId = crypto.randomUUID();
    await act(async () => { window.dispatchEvent(new Event('mindos:settings-changed')); await tick(); });
    await render();
    expect(host.textContent).not.toContain('Undo clear');
    expect(host.querySelector('textarea')?.value).toBe('');
  });

  it('keeps mobile navigation compact without making it another primary action', async () => {
    await render();
    const nav = host.querySelector(`nav[aria-label="${messages.en.inbox.title}"]`)!;
    expect(nav.className).toContain('grid-cols-4');
    expect(nav.querySelectorAll('button')).toHaveLength(4);
    for (const button of nav.querySelectorAll('button')) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).not.toContain('bg-[var(--amber)]');
    }
    await click('Pending');
    expect(host.querySelector('nav button[aria-current="page"]')?.textContent).toContain('Pending');
  });
  it('distinguishes adding to the batch from saving, with an accessible primary action', async () => {
    await render(); await type('Readable capture');
    expect(host.querySelector('[data-stage-note-action]')?.textContent).toBe('Add to batch');
    const save = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Save to Inbox')!;
    expect(save.getAttribute('data-slot')).toBe('button');
    expect(save.className).toContain('[--amber:var(--amber-action)]');
    expect(save.className).toContain('min-h-11');
    expect(host.querySelector('textarea')?.className).toContain('focus-visible:ring-2');
    expect(host.querySelector('[data-stage-note-action]')?.className).toContain('min-h-11');
    expect(host.querySelector('[data-inbox-attach-action]')?.className).toContain('min-h-11');
  });

  it('uses the first line to identify a multiline note and gives removal a full touch target', async () => {
    await render(); await type('A clear title\nA longer second line');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-stage-note-action]')!.click());
    expect(host.querySelector('button[aria-label="Edit A clear title"]')).not.toBeNull();
    const remove = host.querySelector('button[aria-label="Remove A clear title"]');
    expect(remove?.className).toContain('h-11');
    expect(remove?.className).toContain('w-11');
  });
  it('preserves a link pasted while an earlier text capture is saving', async () => {
    const finish = holdSave();
    await render(); await type('Old capture'); await click('Save to Inbox'); await type('');
    await act(async () => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { files: [], getData: () => 'https://example.com/new-link' } });
      host.querySelector('textarea')!.dispatchEvent(paste);
    });
    expect(host.textContent).toContain('example.com/new-link');
    await finish();
    expect(host.textContent).toContain('example.com/new-link');
    await remount();
    expect(host.textContent).toContain('example.com/new-link');
  });

  it('submits only once when save is triggered twice before a render', async () => {
    const finish = holdSave();
    await render(); await type('One capture');
    await act(async () => {
      const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Save to Inbox')!;
      button.click(); button.click(); await tick();
    });
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')).toHaveLength(1);
    await finish();
  });

  it('does not remove a new same-name attachment when an older upload completes', async () => {
    const finish = holdSave();
    await render();
    await attach(new File(['old'], 'notes.txt', { lastModified: 1 }));
    await click('Save to Inbox');
    await click('Remove File');
    const replacement = new File(['new attachment contents'], 'notes.txt', { lastModified: 2 });
    await attach(replacement); await finish();
    expect(getCaptureDraftController(document.documentElement.dataset.mindRootId!).getSnapshot().value.pendingFiles).toEqual([replacement]);
    expect(host.textContent).toContain('notes.txt');
  });

  it('explains a failed draft write and offers an explicit retry', async () => {
    await render(); await type('Keep this draft');
    const controller = getCaptureDraftController(document.documentElement.dataset.mindRootId!);
    await act(async () => controller.flush());
    expect(host.querySelector('[data-capture-draft-status]')?.textContent).toContain('only in this window');
    vi.spyOn(captureDraftStorage, 'write').mockResolvedValue('saved-revision');
    await click('Retry draft save');
    expect(host.querySelector('[data-capture-draft-status]')?.textContent).toContain('Draft saved on this device');
    expect(host.querySelector('textarea')?.value).toBe('Keep this draft');
  });

  it('explains a newer draft in another window without offering an overwrite retry', async () => {
    await render(); await type('My separate changes');
    vi.spyOn(captureDraftStorage, 'write').mockRejectedValue(new CaptureDraftConflictError());
    await act(async () => getCaptureDraftController(document.documentElement.dataset.mindRootId!).flush());
    expect(host.querySelector('[data-capture-draft-status]')?.textContent).toContain('Another window updated this draft');
    expect(host.textContent).not.toContain('Retry draft save');
    expect(host.querySelector('textarea')?.value).toBe('My separate changes');
  });

  it('can edit a staged note without losing the text currently being composed', async () => {
    await render(); await type('First note');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-stage-note-action]')!.click());
    await type('Second note still being written');
    await click('Edit First note');
    expect(host.querySelector('textarea')?.value).toBe('First note');
    expect(host.textContent).toContain('Second note still being written');
  });
  it('restores current text and staged notes after leaving and returning', async () => {
    await render();
    await type('第一条记录 🌱');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-stage-note-action]')!.click());
    await type('仍在编辑的第二条');
    await remount();
    expect(host.querySelector('textarea')?.value).toBe('仍在编辑的第二条');
    expect(host.textContent).toContain('第一条记录 🌱');
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')).toHaveLength(0);
  });

  it('keeps text typed while an older capture is saving', async () => {
    let finish!: (data: unknown) => void;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return json({ files: [] });
      const body = JSON.parse(String(init.body));
      await new Promise(resolve => { finish = resolve; });
      return json({ saved: body.files.map((file: { name: string }) => ({ original: file.name, path: `Inbox/${file.name}` })), skipped: [] });
    });
    await render();
    await type('First capture');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save to Inbox')!.click(); });
    await type('New text written while saving');
    await act(async () => { finish({}); await tick(); });
    expect(host.querySelector('textarea')?.value).toBe('New text written while saving');
    await remount();
    expect(host.querySelector('textarea')?.value).toBe('New text written while saving');
  });

  it('keeps restored drafts isolated by knowledge library', async () => {
    const firstLibrary = document.documentElement.dataset.mindRootId;
    await render();
    await type('Only library A');
    document.documentElement.dataset.mindRootId = 'library-b';
    await remount();
    expect(host.querySelector('textarea')?.value).toBe('');
    document.documentElement.dataset.mindRootId = firstLibrary;
    await remount();
    expect(host.querySelector('textarea')?.value).toBe('Only library A');
  });
});
