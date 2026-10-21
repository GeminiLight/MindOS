// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateDialog from '@/components/studio/views/TemplateDialog';
import ManageDialog from '@/components/studio/views/ManageDialog';
import PersonEditor from '@/components/studio/views/PersonEditor';
import { viewsCopy } from '@/lib/views/copy';
import { readViewDraft } from '@/lib/views/drafts';
import {
  ViewsApiError,
  type PersonDocument,
  type ViewIndex,
  type ViewSummary,
} from '@/lib/views/api';
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/views/api', async (original) => ({
  ...(await original<typeof import('@/lib/views/api')>()),
  mutateView: mocks.mutate,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
}));
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const c = viewsCopy('zh');
const index: ViewIndex = { rootId: 'library-a', folders: [], views: [] };
const view: ViewSummary = {
  id: 'v-12345678',
  name: '重要的人',
  folder: '人脉',
  template: 'people',
  version: 1,
  createdAt: '2026-10-12',
  updatedAt: '2026-10-12',
  availability: 'ready',
};
const person: PersonDocument = {
  id: 'p-12345678',
  path: '人脉/人物/叶.md',
  name: '叶遥',
  background: '原资料',
  focus: '',
  revision: 'a'.repeat(64),
  followup: { text: '', date: '', completed: false },
  interactions: [],
  interactionCount: 0,
  sources: '',
  managed: true,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function fill(label: string, value: string) {
  const l = [...host.querySelectorAll('label')].find(
    (l) => l.textContent === label,
  )!;
  const input = document.getElementById(l.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
describe('an open view operation stays in its original knowledge library', () => {
  it('preserves the template draft in the old library and refuses submission after a switch', async () => {
    mocks.mutate.mockResolvedValue({ rootId: 'library-b', view });
    const render = (data: ViewIndex) => (
      <TemplateDialog index={data} c={c} close={vi.fn()} />
    );
    await act(async () => root.render(render(index)));
    await fill(c.viewName, '旧库的视图');
    await fill(c.folder, '旧库/人物');
    await act(async () =>
      root.render(render({ ...index, rootId: 'library-b' })),
    );
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(host.textContent).toContain(c.rootChanged);
    expect(
      readViewDraft({
        rootId: 'library-a',
        viewId: 'new',
        personId: '',
        kind: 'template',
      })?.values.folder,
    ).toBe('旧库/人物');
    expect(
      readViewDraft({
        rootId: 'library-b',
        viewId: 'new',
        personId: '',
        kind: 'template',
      }),
    ).toBeNull();
    expect(
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === c.cancel,
      )!.disabled,
    ).toBe(false);
  });
  it('does not rename a copied view id in the new library using old input', async () => {
    mocks.mutate.mockResolvedValue({ rootId: 'library-b', view });
    const render = (rootId: string) => (
      <ManageDialog
        rootId={rootId}
        view={view}
        c={c}
        close={vi.fn()}
        changed={vi.fn()}
      />
    );
    await act(async () => root.render(render('library-a')));
    await fill(c.viewName, '旧库的新名称');
    await act(async () => root.render(render('library-b')));
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((b) => b.textContent === c.rename)!
        .click();
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(host.textContent).toContain(c.rootChanged);
    expect(
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === c.close,
      )!.disabled,
    ).toBe(false);
  });
  it('does not navigate from a delayed template creation into the newly selected library', async () => {
    let resolve!: (v: unknown) => void;
    mocks.mutate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const close = vi.fn();
    const render = (data: ViewIndex) => (
      <TemplateDialog index={data} c={c} close={close} />
    );
    await act(async () => root.render(render(index)));
    await fill(c.folder, '旧库/人物');
    await submit();
    await act(async () =>
      root.render(render({ ...index, rootId: 'library-b' })),
    );
    await act(async () => resolve({ rootId: 'library-a', view }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain(c.rootChanged);
    expect(
      readViewDraft({
        rootId: 'library-a',
        viewId: 'new',
        personId: '',
        kind: 'template',
      }),
    ).not.toBeNull();
  });
  it('keeps the configuration version from when editing began', async () => {
    mocks.mutate.mockRejectedValue(new ViewsApiError('VIEW_CONFLICT', 409));
    const changed = vi.fn();
    const render = (v: ViewSummary) => (
      <ManageDialog
        rootId="library-a"
        view={v}
        c={c}
        close={vi.fn()}
        changed={changed}
      />
    );
    await act(async () => root.render(render(view)));
    await fill(c.viewName, '我的修改');
    await act(async () =>
      root.render(render({ ...view, version: 2, name: '外部新名称' })),
    );
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((b) => b.textContent === c.rename)!
        .click();
    });
    expect(mocks.mutate.mock.calls[0][1].expectedVersion).toBe(1);
    expect(changed).not.toHaveBeenCalled();
  });
  it('ignores a late person-save result after leaving that editor', async () => {
    let resolve!: (v: unknown) => void;
    mocks.mutate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const saved = vi.fn(),
      close = vi.fn();
    await act(async () =>
      root.render(
        <PersonEditor
          rootId="library-a"
          viewId={view.id}
          person={person}
          kind="person"
          c={c}
          close={close}
          saved={saved}
        />,
      ),
    );
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<p>当前知识库 B</p>));
    await act(async () => resolve({ rootId: 'library-a', person }));
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
