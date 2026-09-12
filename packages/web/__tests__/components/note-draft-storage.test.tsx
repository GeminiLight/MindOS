// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNoteDraft, type NoteDraft } from '@/lib/hooks/useNoteDraft';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useNoteDraft>;
let update: (v: NoteDraft) => void;
const empty = { content: '', name: 'Untitled.md', directory: '' };
function Harness({ scope }: { scope: string }) {
  const [value, setValue] = useState(empty);
  update = setValue;
  state = useNoteDraft(true, scope, value, setValue);
  return <div>{value.content}|{value.name}|{value.directory}</div>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('restores content, filename and directory after leaving and returning to the draft', async () => {
  await act(async () => root.render(<Harness scope="vault-a" />));
  await act(async () => update({content:'想法 🌱',name:'新笔记.md',directory:'研究'}));
  act(() => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Harness scope="vault-a" />));
  expect(host.textContent).toBe('想法 🌱|新笔记.md|研究');
  expect(state.recovered).toBe(true);
});
it('keeps vaults separate and removes a completed draft without resurrecting it', async () => {
  await act(async () => root.render(<Harness scope="vault-a" />));
  await act(async () => update({ ...empty, content: 'a' }));
  act(() => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Harness scope="vault-b" />));
  expect(host.textContent).toBe('|Untitled.md|');
  await act(async () => update({ ...empty, content: 'b' }));
  await act(async () => state.clear());
  await act(async () => update({ ...empty, content: 'after save' }));
  act(() => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Harness scope="vault-b" />));
  expect(host.textContent).toBe('|Untitled.md|');
});
it('reports unavailable browser storage while retaining the editor value', async () => {
  vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => root.render(<Harness scope="vault-a" />));
  await act(async () => update({ ...empty, content: 'do not lose' }));
  expect(state.error).toBe(true);
  expect(host.textContent).toContain('do not lose');
});

it('switches vaults without carrying old content into the new vault in the same component', async () => {
  await act(async () => root.render(<Harness scope="vault-a" />));
  await act(async () => update({ ...empty, content: 'Private A' }));
  await act(async () => root.render(<Harness scope="vault-b" />));
  expect(host.textContent).toBe('|Untitled.md|');
  expect(sessionStorage.getItem('mindos:note-draft:vault-b')).not.toContain('Private A');
  await act(async () => root.render(<Harness scope="vault-a" />));
  expect(host.textContent).toContain('Private A');
});
