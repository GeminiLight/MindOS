// @vitest-environment jsdom
import React, { act } from 'react';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/echo/research/route';
import { ResearchWorkspace } from '@/components/echo/research/ResearchWorkspace';
import { getStudy, updateStudyDraft, listStudies, enrollStudy } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
vi.mock('@/lib/runtime-auth-config', () => ({ readRuntimeAuthConfig: () => ({ webSessionSecret: '' }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let home: string; let host: HTMLDivElement; let renderer: ReturnType<typeof createRoot>; let fail = false; let loseCreationResponse = false;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'research-ui-')); vi.spyOn(os, 'homedir').mockReturnValue(home); fail = false; loseCreationResponse = false;
  host = document.createElement('div'); document.body.append(host); renderer = createRoot(host);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (fail && init?.method === 'PATCH') return Response.json({ code: 'storage' }, { status: 500 });
    const request = new NextRequest('http://localhost' + url, { method: init?.method ?? 'GET', body: init?.body, headers: init?.headers });
    const response = await (init?.method === 'POST' ? POST(request) : init?.method === 'PATCH' ? PATCH(request) : GET(request));
    if (loseCreationResponse && init?.method === 'POST') { loseCreationResponse = false; throw new Error('Connection lost after creation'); }
    return response;
  }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => { await act(async () => renderer.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); window.history.replaceState({}, '', '/'); });
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(e => e.textContent?.trim() === label); expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(name: string, value: string) {
  const field = host.querySelector(`[name="${name}"]`) as HTMLInputElement;
  expect(field, name).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('preserves failed drafts, guards leaving, and resumes the saved version from the study list', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); await click('New study draft');
  await fill('title', 'A careful study'); await fill('hypothesis', 'Independent judgment after a changed situation.');
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  fail = true; await click('Save draft'); expect(host.querySelector('[role=alert]')?.textContent).toContain('not confirmed');
  expect((host.querySelector('[name=title]') as HTMLInputElement).value).toBe('A careful study');
  await click('All study drafts'); expect(host.querySelector('[name=title]')).not.toBeNull();
  fail = false; await click('Save draft'); expect(host.textContent).toContain('Saved locally');
  const savedLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedLeave); expect(savedLeave.defaultPrevented).toBe(false);
  await click('All study drafts'); await click('A careful study');
  expect((host.querySelector('[name=title]') as HTMLInputElement).value).toBe('A careful study');
  await click('5 Review'); expect(host.textContent).toContain('Complete these fields');
  const freeze = [...host.querySelectorAll('button')].find(e => e.textContent?.trim() === 'Freeze reviewed materials'); expect(freeze?.disabled).toBe(true);
});
it('keeps local edits on a version conflict and reloads only after explicit discard', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); await click('New study draft');
  await fill('title', 'Local unsent title');
  const id = new URLSearchParams(window.location.search).get('study')!; const saved = getStudy(testMindRoot, id)!;
  updateStudyDraft(testMindRoot, id, { version: saved.version, protocol: { ...saved.protocol, title: 'Title from another tab' } });
  await click('Save draft'); expect(host.querySelector('[role=alert]')?.textContent).toContain('saved version changed');
  await click('Reload saved version'); expect((host.querySelector('[name=title]') as HTMLInputElement).value).toBe('Local unsent title');
  vi.mocked(window.confirm).mockReturnValue(true); await click('Reload saved version');
  expect((host.querySelector('[name=title]') as HTMLInputElement).value).toBe('Title from another tab');
});
it('recovers a creation whose response was lost without creating a duplicate study', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); loseCreationResponse = true;
  await click('New study draft'); expect(host.querySelector('[role=alert]')?.textContent).toContain('not confirmed');
  expect(listStudies(testMindRoot).studies).toHaveLength(1);
  await click('New study draft'); expect(host.querySelector('[name=title]')).not.toBeNull();
  expect(listStudies(testMindRoot).studies).toHaveLength(1);
});
it('keeps invalid numeric fields visible when switching tasks and respects the condition capacity', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); await click('New study draft');
  await fill('capacity', '2'); await click('2 Conditions');
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Add condition')?.disabled).toBe(true);
  expect(host.textContent).toContain('increase the enrollment limit');
  await click('3 Tasks'); await fill('tasks.0.budgetSeconds', '0'); await click('New situation');
  expect(host.querySelector('[name="tasks.0.budgetSeconds"]')).not.toBeNull();
  await fill('tasks.0.budgetSeconds', '60'); await click('New situation');
  expect(host.querySelector('[name="tasks.2.budgetSeconds"]')).not.toBeNull();
});
it('freezes only complete saved materials after explicit review, then presents an immutable summary', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); await click('New study draft');
  for (const name of ['title', 'hypothesis', 'consent', 'withdrawal']) await fill(name, 'Synthetic ' + name);
  await click('2 Conditions');
  for (let i = 0; i < 2; i++) {
    await click('Condition ' + (i + 1));
    for (const name of ['label', 'instructions', 'expectedRuntime.provider', 'expectedRuntime.model', 'expectedRuntime.context']) await fill(`conditions.${i}.${name}`, 'Synthetic ' + name);
  }
  await click('3 Tasks');
  for (const [i, label] of ['Initial judgment', 'Practice with help', 'New situation', 'Delayed situation'].entries()) {
    await click(label); await fill(`tasks.${i}.prompt`, 'Synthetic task ' + i); await fill(`tasks.${i}.reference`, 'Private scoring note ' + i);
  }
  await click('4 Scoring'); await fill('rubric.0.label', 'Reasoning'); await fill('rubric.0.description', 'Check evidence and alternatives.');
  await click('Save draft'); await click('5 Review');
  await fill('reviewedBy', 'qa-reviewer'); await fill('reviewNote', 'Checked synthetic materials.');
  expect(host.querySelector('footer [role=status]')?.textContent).toBe('Review notes are saved when materials are frozen');
  await act(async () => (host.querySelector('[name=confirmed]') as HTMLInputElement).click());
  await click('Freeze reviewed materials');
  expect(host.textContent).toContain('Materials frozen'); expect(host.querySelector('[name=title]')).toBeNull();
  expect(host.textContent).toContain('Participant access supports workflow pilots');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Save draft')).toBe(false);
  expect(host.textContent).toContain('Checked synthetic materials.');
  const originalId = new URLSearchParams(window.location.search).get('study')!;
  const original = getStudy(testMindRoot, originalId)!;
  enrollStudy(testMindRoot, originalId, { enrollmentKey: 'synthetic-participant', protocolHash: original.protocolHash, consentAccepted: true });
  await click('Copy materials to a new draft');
  const copyId = new URLSearchParams(window.location.search).get('study')!;
  expect(copyId).not.toBe(originalId); expect(getStudy(testMindRoot, copyId)?.status).toBe('draft');
  expect(getStudy(testMindRoot, copyId)?.enrolledCount).toBe(0); expect(getStudy(testMindRoot, originalId)?.enrolledCount).toBe(1);
  expect(getStudy(testMindRoot, originalId)?.status).toBe('frozen');
  expect((host.querySelector('[name=title]') as HTMLInputElement).value).toContain('Copy');
  await click('All study drafts'); await click('Synthetic title'); loseCreationResponse = true;
  await click('Copy materials to a new draft'); expect(host.querySelector('[role=alert]')).not.toBeNull();
  await click('All study drafts'); await click('New study draft');
  expect((host.querySelector('[name=title]') as HTMLInputElement).value).toBe('');
});
it('makes isolated execution an explicit frozen choice and requires each endpoint in review', async () => {
  await act(async () => renderer.render(<ResearchWorkspace locale="en" />)); await click('New study draft');
  await click('2 Conditions');
  const mode = host.querySelector('[name="executionEnabled"]') as HTMLInputElement;
  expect(mode).not.toBeNull(); expect(mode.checked).toBe(false);
  await act(async () => mode.click());
  expect(host.textContent).toContain('No tools or knowledge retrieval');
  await fill('conditions.0.expectedRuntime.endpoint', 'http://localhost:9876/v1/chat/completions');
  await click('Save draft');
  const id = new URLSearchParams(window.location.search).get('study')!;
  expect(getStudy(testMindRoot, id)?.protocol.execution).toEqual({ adapter: 'isolated-chat-v1', maxTurns: 2 });
  await click('5 Review');
  expect(host.textContent).toContain('Condition 2 · Exact chat endpoint');
});
it('loads the study list after a development effect replay instead of remaining busy forever', async () => {
  await act(async () => renderer.render(<React.StrictMode><ResearchWorkspace locale="en" /></React.StrictMode>));
  expect(host.textContent).not.toContain('Loading saved materials…');
  const create = [...host.querySelectorAll('button')].find(b => b.textContent === 'New study draft');
  expect(create).toBeDefined(); expect(create?.disabled).toBe(false);
});
