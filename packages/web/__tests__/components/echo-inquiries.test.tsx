// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import os from 'node:os';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  inquiryMethodOptions,
  startLearningCorrection,
  updateLearningLoop,
  getLearningLoop,
  createInquiry,
  getInquiry,
  updateInquiry,
  prepareInquiry,
} from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import QuestionsPage, {
  InquiryWorkspace,
} from '@/components/echo/inquiries/InquiryWorkspace';
import { openAskModal } from '@/hooks/useAskModal';
import EchoLearningJoint from '@/components/echo/learning/EchoLearningJoint';
import { messages } from '@/lib/i18n';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/hooks/useAskModal', () => ({ openAskModal: vi.fn() }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' }),
}));
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let home: string;
let id: string;
let fail: boolean;
let requests: Record<string, unknown>[];
beforeEach(() => {
  home = fs.mkdtempSync('/tmp/inquiry-ui-');
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  const q = createInquiry(testMindRoot, {
    requestId: 'ui',
    locale: 'en',
    source: {
      sessionId: 's',
      messageIndex: 1,
      messageHash: 'a'.repeat(64),
      questionHash: 'b'.repeat(64),
      quote: 'A competing explanation',
      question: 'Why did this happen?',
    },
  });
  id = q.id;
  window.history.replaceState({}, '', '/echo/questions?inquiry=' + id);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  fail = false;
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (String(_url).endsWith('/methods'))
        return Response.json({ methods: inquiryMethodOptions(testMindRoot) });
      if (!options?.body)
        return Response.json({
          inquiry: getInquiry(testMindRoot, id),
          runs: [],
        });
      const { id: _id, ...body } = JSON.parse(options.body);
      requests.push(body);
      if (fail) return Response.json({ code: 'storage' }, { status: 500 });
      try {
        if (body.action === 'prepare') {
          const { action: _action, ...c } = body;
          return Response.json({
            ...prepareInquiry(testMindRoot, id, c),
            runs: [],
          });
        }
        return Response.json({
          inquiry: updateInquiry(testMindRoot, id, body),
          runs: [],
        });
      } catch (error) {
        return Response.json(
          { code: (error as { code: string }).code },
          { status: 409 },
        );
      }
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});
async function click(label: string) {
  const b = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(b, label).toBeDefined();
  await act(async () => {
    b!.focus();
    b!.click();
  });
}
async function fill(name: string, value: string) {
  const el = host.querySelector(`[name="${name}"]`) as HTMLTextAreaElement;
  expect(el, name).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('keeps an incomplete draft through failure, retries the same write and commits before staging help', async () => {
  await act(async () => root.render(<InquiryWorkspace locale="en" />));
  expect(host.textContent).toContain('Why did this happen?');
  expect(host.textContent).not.toContain('Prepare a challenge');
  await fill('explanationA', 'A cause');
  fail = true;
  await click('Save draft');
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
  expect(
    (host.querySelector('[name="explanationA"]') as HTMLTextAreaElement).value,
  ).toBe('A cause');
  fail = false;
  await click('Retry saved request');
  expect(requests[0]).toEqual(requests[1]);
  await fill('explanationB', 'A confounder');
  await fill('distinction', 'A controlled comparison');
  await fill('capability', 'Distinguish causes');
  await click('Save draft');
  expect(document.activeElement?.textContent).toBe('Save draft');
  await click('Commit my framing');
  expect(getInquiry(testMindRoot, id)?.frames).toHaveLength(1);
  await click('Prepare a challenge');
  expect(openAskModal).toHaveBeenCalledWith(
    expect.stringContaining('A confounder'),
    'user',
    null,
    { newSession: true },
  );
  expect(host.textContent).toContain('Review and send');
  await click('Revise my framing');
  await fill('question', 'A better question');
  await click('Save draft');
  expect(document.activeElement?.textContent).toBe('Save draft');
  await click('Commit my framing');
  expect(getInquiry(testMindRoot, id)?.frames.map((f) => f.question)).toEqual([
    'Why did this happen?',
    'A better question',
  ]);
  await click('Revise from this framing');
  expect(
    (host.querySelector('[name=question]') as HTMLTextAreaElement).value,
  ).toBe('Why did this happen?');
});
it('leaves an unsupported question open without inventing observations', async () => {
  let q = getInquiry(testMindRoot, id)!;
  q = updateInquiry(testMindRoot, id, {
    action: 'save-draft',
    version: q.version,
    requestId: 'draft',
    draft: {
      question: 'Why?',
      explanationA: 'A',
      explanationB: 'B',
      distinction: 'Measure',
      capability: 'Reason',
    },
  });
  updateInquiry(testMindRoot, id, {
    action: 'commit-frame',
    version: q.version,
    requestId: 'commit',
  });
  await act(async () => root.render(<InquiryWorkspace locale="en" />));
  await click('Record a decision');
  await fill('reason', 'No discriminating evidence yet');
  await click('Save decision');
  expect(getInquiry(testMindRoot, id)?.decisions[0]).toMatchObject({
    outcome: 'open',
    evidenceIds: [],
  });
  expect(host.textContent).toContain('No discriminating evidence yet');
  expect(host.textContent).not.toContain('Save method proposal');
});
it('links an observation to a reframing decision and creates an unapproved method proposal', async () => {
  let q = getInquiry(testMindRoot, id)!;
  q = updateInquiry(testMindRoot, id, {
    action: 'save-draft',
    version: q.version,
    requestId: 'draft',
    draft: {
      question: 'Why?',
      explanationA: 'A',
      explanationB: 'B',
      distinction: 'Measure',
      capability: 'Reason',
    },
  });
  updateInquiry(testMindRoot, id, {
    action: 'commit-frame',
    version: q.version,
    requestId: 'commit',
  });
  await act(async () => root.render(<InquiryWorkspace locale="en" />));
  await click('Design a test');
  expect(document.activeElement?.getAttribute('name')).toBe('task');
  for (const [key, value] of Object.entries({
    task: 'Compare both cases',
    supportsA: 'Same',
    supportsB: 'Different',
    inconclusive: 'Too little evidence',
    scope: 'Synthetic fixture',
    budget: 'Five minutes',
  }))
    await fill(key, value);
  await click('Save test plan');
  expect(document.activeElement?.textContent).toBe('Design a test');
  await click('Record an observation');
  await fill('sourceLabel', 'Synthetic fixture');
  await fill('quote', 'Different in condition B');
  await fill('interpretation', 'Condition changes the result');
  await click('Save observation');
  await click('Record a decision');
  const select = host.querySelector('[name=outcome]') as HTMLSelectElement;
  await act(async () => {
    select.value = 'reframe';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(
    [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save decision',
    )?.disabled,
  ).toBe(true);
  await act(async () =>
    (host.querySelector('input[type=checkbox]') as HTMLInputElement).click(),
  );
  await fill('reason', 'Find the condition that explains the difference');
  await fill('nextQuestion', 'When does B matter?');
  await click('Save decision');
  expect(getInquiry(testMindRoot, id)?.decisions[0]).toMatchObject({
    outcome: 'reframe',
    nextQuestion: 'When does B matter?',
    evidenceIds: ['observation-1'],
  });
  await click('Turn this decision into a method proposal');
  await fill('behavior', 'Check relevant conditions');
  await fill('scope', 'Comparisons');
  await fill('check', 'Names conditions before comparing');
  await click('Save method proposal');
  expect(
    host.querySelector('a[href^="/echo/growth?learning=learn-"]'),
  ).toBeTruthy();
});

it('opens the selected question when only the URL query changes', async () => {
  await act(async () => root.render(<QuestionsPage />));
  expect(
    (host.querySelector('[name=question]') as HTMLTextAreaElement).value,
  ).toBe('Why did this happen?');
  const next = createInquiry(testMindRoot, {
    requestId: 'second-question',
    locale: 'en',
    source: {
      sessionId: 's',
      messageIndex: 1,
      messageHash: 'a'.repeat(64),
      questionHash: 'b'.repeat(64),
      quote: 'Another source',
      question: 'A second question',
    },
  });
  id = next.id;
  window.history.replaceState({}, '', '/echo/questions?inquiry=' + id);
  await act(async () => root.render(<QuestionsPage />));
  expect(
    (host.querySelector('[name=question]') as HTMLTextAreaElement).value,
  ).toBe('A second question');
});

async function selectValue(name: string, value: string) {
  const el = host.querySelector(`[name="${name}"]`) as HTMLSelectElement;
  expect(el, name).toBeTruthy();
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('explicitly binds a test to an approved method and proposes a revision in the same family', async () => {
  let method = startLearningCorrection(
    testMindRoot,
    {
      cardId: 'linked-ui',
      title: 'Compare conditions',
      content: 'Check conditions',
      sessions: [
        {
          id: 's',
          messageRefs: [{ messageIndex: 1, role: 'assistant', quote: 'Use A' }],
        },
      ],
    },
    { behavior: 'Use A', scope: 'Comparisons', check: 'Names the choice' },
  );
  method = updateLearningLoop(testMindRoot, method.id, {
    action: 'approve-agent',
    version: method.version,
    attemptIndex: -1,
  });
  let q = getInquiry(testMindRoot, id)!;
  q = updateInquiry(testMindRoot, id, {
    action: 'save-draft',
    version: q.version,
    requestId: 'draft',
    draft: {
      question: 'Why?',
      explanationA: 'A',
      explanationB: 'B',
      distinction: 'Measure',
      capability: 'Reason',
    },
  });
  updateInquiry(testMindRoot, id, {
    action: 'commit-frame',
    version: q.version,
    requestId: 'commit',
  });
  await act(async () => root.render(<InquiryWorkspace locale="en" />));
  await click('Link an existing method');
  await selectValue('methodSelection', method.id + ':-1:0');
  expect(host.textContent).toContain('Names the choice');
  fail = true;
  await click('Save method link');
  expect(host.querySelector('[role=alert]')).toBeTruthy();
  expect(
    (host.querySelector('[name=methodSelection]') as HTMLSelectElement).value,
  ).toBe(method.id + ':-1:0');
  fail = false;
  await click('Retry saved request');
  expect(requests.at(-1)).toEqual(requests.at(-2));
  expect(getInquiry(testMindRoot, id)?.methodLinks).toHaveLength(1);
  await click('Design a test');
  await selectValue('methodLinkId', 'method-1');
  for (const [key, value] of Object.entries({
    task: 'Compare conditions',
    supportsA: 'Same',
    supportsB: 'Different',
    inconclusive: 'Not enough',
    scope: 'Synthetic',
    budget: 'Five minutes',
  }))
    await fill(key, value);
  await click('Save test plan');
  await click('Prepare this test');
  expect(openAskModal).toHaveBeenLastCalledWith(
    expect.any(String),
    'user',
    null,
    {
      newSession: true,
      context: {
        path: method.directMethod!.review!.targetPath,
        type: 'file',
        label: expect.any(String),
      },
    },
  );
  await click('Record an observation');
  await fill('sourceLabel', 'Synthetic manual check');
  await fill('quote', 'Different under B');
  await fill('interpretation', 'A depends on the conditions');
  await click('Save observation');
  await click('Record a decision');
  await selectValue('outcome', 'keep-b');
  await act(async () =>
    (host.querySelector('input[type=checkbox]') as HTMLInputElement).click(),
  );
  await fill('reason', 'Consider conditions');
  await click('Save decision');
  await click('Revise a linked method');
  await selectValue('methodLinkId', 'method-1');
  expect(host.textContent).toContain('Approved version');
  await fill('reason', 'Observed a condition-dependent difference');
  await fill('behavior', 'Compare A and B under stated conditions');
  await fill('scope', 'Comparisons');
  await fill('check', 'Names conditions before choosing');
  await click('Save pending revision');
  expect(getInquiry(testMindRoot, id)?.decisions[0]).toMatchObject({
    methodDraftId: method.id,
    methodRevision: { methodLinkId: 'method-1', revisionIndex: 1 },
  });
  expect(
    getLearningLoop(testMindRoot, method.id)?.directMethod?.revisions?.[0]
      .review,
  ).toBeUndefined();
  expect(
    host.querySelector(`a[href="/echo/growth?learning=${method.id}"]`),
  ).toBeTruthy();
  expect(document.activeElement?.getAttribute('href')).toBe(
    `/echo/growth?learning=${method.id}`,
  );
  await act(async () => root.render(<EchoLearningJoint loop={getLearningLoop(testMindRoot, method.id)!} p={messages.en.echoLearning} busy={false} save={async () => {}} />));
  const reverse = host.querySelector(`a[href="/echo/questions?inquiry=${id}#decision-1"]`);
  expect(reverse?.textContent).toBe('View revision evidence');
});

it('opens an older decision from a revision link and preserves focus during later saves', async () => {
  let q = getInquiry(testMindRoot, id)!;
  const update = (body: Record<string, unknown>) => { q = updateInquiry(testMindRoot, id, { version: q.version, requestId: crypto.randomUUID(), ...body }); };
  update({ action: 'save-draft', draft: { question: 'Original framing', explanationA: 'A', explanationB: 'B', distinction: 'Compare', capability: 'Reason' } });
  update({ action: 'commit-frame' });
  update({ action: 'decide', frameId: 'frame-1', outcome: 'open', reason: 'Keep this uncertainty visible', evidenceIds: [] });
  update({ action: 'revise', frameId: 'frame-1' });
  update({ action: 'commit-frame' });
  window.history.replaceState({}, '', `/echo/questions?inquiry=${id}#decision-1`);
  await act(async () => root.render(<InquiryWorkspace locale="en" />));
  const decision = host.querySelector('#decision-1')!;
  expect(decision).toBeTruthy(); expect(decision.closest('details')?.open).toBe(true);
  expect(document.activeElement).toBe(decision);
  await click('Revise my framing');
  await fill('question', 'Another draft'); await click('Save draft');
  expect(document.activeElement?.textContent).toBe('Save draft');
  await act(async () => { window.history.replaceState({}, '', `/echo/questions?inquiry=${id}#decision-999`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  expect(host.textContent).toContain('This decision could not be found');
  expect(document.activeElement?.tagName).toBe('H1');
});
