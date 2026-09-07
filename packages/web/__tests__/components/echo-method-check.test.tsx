// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  startLearningCorrection,
  updateLearningLoop,
  listMethodChecks,
  prepareMethodCheck,
} from '@geminilight/mindos/knowledge';
import {
  startAgentRun,
  completeAgentRun,
  resetAgentRunsForTest,
} from '@geminilight/mindos/agent';
import { writeRetrievalReceipt } from '@geminilight/mindos/retrieval';
import { testMindRoot } from '../setup';
import { GET, POST, PATCH } from '@/app/api/echo/method-checks/route';
import EchoMethodCheck from '@/components/echo/learning/EchoMethodCheck';
import { openAskModal } from '@/hooks/useAskModal';
import { GET as runtimesGET } from '@/app/api/agent-runtimes/route';
vi.mock('@/app/api/agent-runtimes/route', () => ({
  GET: vi.fn(async () =>
    Response.json({
      runtimes: [
        {
          id: 'claude',
          kind: 'claude',
          name: 'Claude Code',
          status: 'available',
        },
      ],
    }),
  ),
}));
vi.mock('@/hooks/useAskModal', () => ({ openAskModal: vi.fn() }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' }),
}));
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let home: string;
let host: HTMLDivElement;
let renderer: ReturnType<typeof createRoot>;
let fail: boolean;
let loop: ReturnType<typeof startLearningCorrection>;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ui-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  resetAgentRunsForTest();
  host = document.createElement('div');
  document.body.append(host);
  renderer = createRoot(host);
  fail = false;
  loop = startLearningCorrection(
    testMindRoot,
    {
      cardId: 'check-ui',
      title: 'Evidence',
      content: 'Design',
      sessions: [
        {
          id: 's',
          messageRefs: [
            {
              messageIndex: 0,
              role: 'assistant',
              quote: 'A comparison proves cause.',
            },
          ],
        },
      ],
    },
    {
      behavior: 'Inspect design',
      scope: 'Research',
      check: 'Explain limitations',
    },
  );
  loop = updateLearningLoop(testMindRoot, loop.id, {
    action: 'approve-agent',
    attemptIndex: -1,
    version: loop.version,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/agent-runtimes')
        return runtimesGET(new Request('http://localhost' + url));
      if (
        fail &&
        (init?.method === 'POST' ||
          (init?.body && JSON.parse(String(init.body)).action === 'handoff'))
      )
        return Response.json({ code: 'storage' }, { status: 500 });
      const req = new NextRequest('http://localhost' + url, {
        method: init?.method ?? 'GET',
        ...(init?.body ? { body: init.body } : {}),
      });
      return init?.method === 'POST'
        ? POST(req)
        : init?.method === 'PATCH'
          ? PATCH(req)
          : GET(req);
    }),
  );
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  host.remove();
  resetAgentRunsForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(name: string, value: string) {
  const element = host.querySelector(`[name=${name}]`) as HTMLTextAreaElement;
  expect(element, name).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('keeps failed case drafts, freezes criteria and prepares only the selected task in a new conversation', async () => {
  await act(async () =>
    renderer.render(
      <EchoMethodCheck
        loop={loop}
        attemptIndex={-1}
        revisionIndex={0}
        disabled={false}
      />,
    ),
  );
  await act(async () => {
    const details = host.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  for (const [key, value] of Object.entries({
    useTask: 'An observational comparison',
    useExpected: 'Private standard A',
    exceptionTask: 'A randomized experiment',
    exceptionExpected: 'Private standard B',
  }))
    await fill('check-' + key, value);
  fail = true;
  await click('Save these cases and criteria');
  expect(
    (host.querySelector('[name=check-useTask]') as HTMLTextAreaElement).value,
  ).toBe('An observational comparison');
  fail = false;
  await click('Save these cases and criteria');
  expect(listMethodChecks(testMindRoot, loop.id, -1, 0).checks).toHaveLength(1);
  await click('Prepare this case');
  const args = vi.mocked(openAskModal).mock.calls.at(-1)!;
  expect(args[0]).toContain('observational');
  expect(args[0]).not.toContain('Private standard');
  expect(args[3]?.newSession).toBe(true);
  expect(args[3]?.context?.path).toBeTruthy();
  await click('Create another check');
  await fill('check-useTask', 'Another unfinished situation');
  await click('Back to the saved check');
  await click('Create another check');
  expect(
    (host.querySelector('[name=check-useTask]') as HTMLTextAreaElement).value,
  ).toBe('Another unfinished situation');
});

it('retains a rejected quote, then saves and revises the judgment with both assessments visible', async () => {
  await act(async () =>
    renderer.render(
      <EchoMethodCheck
        loop={loop}
        attemptIndex={-1}
        revisionIndex={0}
        disabled={false}
      />,
    ),
  );
  await act(async () => {
    const details = host.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  for (const [key, value] of Object.entries({
    useTask: 'Observation',
    useExpected: 'Explain uncertainty',
    exceptionTask: 'Experiment',
    exceptionExpected: 'Inspect design',
  }))
    await fill('check-' + key, value);
  await click('Save these cases and criteria');
  await click('Prepare this case');
  const check = listMethodChecks(testMindRoot, loop.id, -1, 0).checks[0];
  const prepared = prepareMethodCheck(testMindRoot, check.id, {
    version: check.version,
    kind: 'use',
  });
  const method = check.method;
  const now = new Date().toISOString();
  writeRetrievalReceipt(testMindRoot, {
    id: 'ui-fixture-receipt',
    query: prepared.draft.prompt,
    strategy: 'explicit-approved-method-context-v1',
    outcome: 'selected',
    startedAt: now,
    completedAt: now,
    budget: { maxTokens: 1000, maxFiles: 1, minScore: 0, timeoutMs: 0 },
    scope: { preferredPaths: [method.path], excludePaths: [] },
    candidates: [],
    selections: [
      {
        assetId: method.assetId,
        path: method.path,
        contentHash: method.contentHash,
        sourceContentHash: method.contentHash,
        assetVersion: prepared.draft.assetVersion,
        truncated: false,
        estimatedTokens: 100,
        score: 1,
        reason: 'Attached method',
      },
    ],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 100 },
  });
  const run = startAgentRun({
    runtimeId: 'fixture',
    displayName: 'UI test fixture',
    agentKind: 'native-runtime',
    permissionMode: 'read',
    metadata: { retrievalReceiptIds: ['ui-fixture-receipt'] },
  });
  completeAgentRun(run.id, {
    outputSummary: 'The observational comparison may be confounded.',
  });
  await click('Read and save matching runs');
  const select = host.querySelector('[name=checkRun]') as HTMLSelectElement;
  await act(async () => {
    select.value = run.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await fill('checkQuote', 'invented quote');
  await fill('checkReason', 'Initial judgment');
  await click('Save my assessment');
  expect(
    (host.querySelector('[name=checkQuote]') as HTMLTextAreaElement).value,
  ).toBe('invented quote');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  await fill('checkQuote', 'may be confounded');
  await click('Save my assessment');
  await fill('checkReason', 'Reconsidered after inspecting the design');
  await click('Save a revised assessment');
  const saved = listMethodChecks(testMindRoot, loop.id, -1, 0).checks[0];
  expect(saved.assessments).toHaveLength(2);
  expect(saved.assessments[1].supersedes).toBe(0);
  expect(host.textContent).toContain('Initial judgment');
  expect(host.textContent).toContain(
    'Reconsidered after inspecting the design',
  );
  const handoff = [...host.querySelectorAll('details')].find(
    (item) =>
      item.querySelector('summary')?.textContent ===
      'Hand this method to another Agent',
  );
  expect(handoff).toBeDefined();
  await act(async () => {
    handoff!.open = true;
    handoff!.dispatchEvent(new Event('toggle'));
  });
  for (const [name, value] of [
    ['handoffSource', run.id],
    ['handoffTarget', 'claude'],
  ]) {
    const field = host.querySelector(`[name=${name}]`) as HTMLSelectElement;
    await act(async () => {
      field.value = value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  await fill('handoffRationale', 'Continue checking evidence in another Agent');
  fail = true;
  await click('Save this handoff');
  expect(
    (host.querySelector('[name=handoffRationale]') as HTMLTextAreaElement)
      .value,
  ).toBe('Continue checking evidence in another Agent');
  expect(
    listMethodChecks(testMindRoot, loop.id, -1, 0).checks[0].handoffs ?? [],
  ).toHaveLength(0);
  fail = false;
  await click('Save this handoff');
  expect(
    listMethodChecks(testMindRoot, loop.id, -1, 0).checks[0].handoffs,
  ).toHaveLength(1);
  await click('Prepare the applicable case');
  const preparedArgs = vi.mocked(openAskModal).mock.calls.at(-1)!;
  expect(preparedArgs[2]).toEqual({
    id: 'claude',
    kind: 'claude',
    name: 'Claude Code',
  });
  expect(preparedArgs[3]?.newSession).toBe(true);
  expect(preparedArgs[0]).toContain('Continue checking evidence');
  expect(preparedArgs[0]).not.toContain(
    'The observational comparison may be confounded.',
  );
});
