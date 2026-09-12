// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Form, { blankProtocol, type ProtocolDraft } from '@/components/echo/longitudinal/LongitudinalProtocolForm';
import { longitudinalCopy } from '@/components/echo/longitudinal/longitudinal-copy';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const freeze = vi.fn();
const runtime = { adapter: 'isolated-chat-v1' as const, provider: 'openai' as const, model: 'test', endpoint: 'https://example.test', temperature: 1, maxOutputTokens: 4096, tools: [] };
function Harness({ initial = blankProtocol() }: { initial?: ProtocolDraft }) {
  const [draft, setDraft] = useState(initial);
  return <Form draft={draft} setDraft={setDraft} runtime={runtime} busy={false} onFreeze={freeze} p={longitudinalCopy.en.form} />;
}
const button = (label: string) => [...host.querySelectorAll('button')].find(x => x.textContent === label)!;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); freeze.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('opens a collapsed round before focusing a missing field', async () => {
  await act(async () => root.render(<Harness />));
  const field = host.querySelector('[name="round-1-before"]') as HTMLTextAreaElement;
  expect(field.closest('details')?.open).toBe(false);
  await act(async () => button('Round 2 · Independent task before help').click());
  expect(field.closest('details')?.open).toBe(true);
  expect(document.activeElement).toBe(field);
});
it('requires confirmation again after adding and then removing a round', async () => {
  const initial = blankProtocol();
  for (const key of ['title','hypothesis','consent','withdrawal','reviewedBy','reviewNote','baselineMethod','rubric'] as const) initial[key] = 'Reviewed material';
  initial.rounds = initial.rounds.map(r => ({ ...r, before: 'B', coaching: 'C', after: 'A', reference: 'R' }));
  await act(async () => root.render(<Harness initial={initial} />));
  await act(async () => (host.querySelector('[name="confirm-freeze"]') as HTMLInputElement).click());
  expect(button('Freeze study').disabled).toBe(false);
  await act(async () => button('Add round').click());
  await act(async () => button('Remove last round').click());
  expect((host.querySelector('[name="confirm-freeze"]') as HTMLInputElement).checked).toBe(false);
  expect(button('Freeze study').disabled).toBe(true);
  expect(freeze).not.toHaveBeenCalled();
});
it('requires a new confirmation when the configured model changes before freezing', async () => {
  const draft=blankProtocol();
  for (const key of ['title','hypothesis','consent','withdrawal','reviewedBy','reviewNote','baselineMethod','rubric'] as const) draft[key]='Reviewed';
  draft.rounds=draft.rounds.map(r=>({...r,before:'B',coaching:'C',after:'A',reference:'R'}));
  await act(async()=>root.render(<Form draft={draft} setDraft={()=>{}} runtime={runtime} busy={false} onFreeze={freeze} p={longitudinalCopy.en.form} />));
  await act(async()=>(host.querySelector('[name="confirm-freeze"]') as HTMLInputElement).click());
  expect(button('Freeze study').disabled).toBe(false);
  await act(async()=>root.render(<Form draft={draft} setDraft={()=>{}} runtime={{...runtime,model:'different-model'}} busy={false} onFreeze={freeze} p={longitudinalCopy.en.form} />));
  expect(button('Freeze study').disabled).toBe(true);
});
