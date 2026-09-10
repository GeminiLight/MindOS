// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PendingAgentActions from '@/components/ask/PendingAgentActions';
import { resetServerEventsForTests } from '@/lib/server-events';

/**
 * Rendering contract of the cross-process pending list
 * (spec-cross-process-run-events H): permission / question / automation rows,
 * excludeRunIds de-duplication against the inline message-stream controls,
 * and correct POST bodies through the existing decision endpoints.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();

const PERMISSION = {
  kind: 'runtime-permission',
  runId: 'run-perm',
  requestId: 'req-1',
  runtime: 'codex',
  toolCallId: 'tool-1',
  toolName: 'Bash',
  action: 'command',
  resource: 'pnpm test',
  options: [
    { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
    { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
  ],
  risk: { level: 'medium', summary: 'Runs a command.' },
  createdAt: NOW,
  expiresAt: NOW + 600_000,
};

const QUESTION = {
  kind: 'user-question',
  runId: 'run-question',
  toolCallId: 'question-1',
  questions: [{
    header: 'Release',
    question: 'Ship now?',
    options: [{ label: 'Yes', description: 'Publish.' }, { label: 'No', description: 'Hold.' }],
  }],
  createdAt: NOW + 1,
  expiresAt: NOW + 600_000,
};

const APPROVAL = {
  kind: 'automation-approval',
  approvalId: 'approval-1',
  jobId: 'job-1',
  jobTitle: 'Release observer',
  runtime: 'claude',
  toolName: 'apply_patch',
  resource: 'wiki/90-changelog.md',
  createdAt: NOW + 2,
};

function fullPayload() {
  return {
    permissions: [PERMISSION],
    questions: [QUESTION],
    automationApprovals: [APPROVAL],
  };
}

describe('PendingAgentActions', () => {
  let host: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    resetServerEventsForTests();
    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent/pending-actions')) {
        return { ok: true, status: 200, json: async () => fullPayload() };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    host?.remove();
  });

  async function render(props: React.ComponentProps<typeof PendingAgentActions> = {}) {
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PendingAgentActions {...props} />);
    });
    return {
      root,
      cleanup: async () => {
        await act(async () => root.unmount());
      },
      buttons: () => Array.from(host.querySelectorAll('button')),
      click: async (label: string) => {
        const button = Array.from(host.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.includes(label));
        expect(button, `button "${label}" not found`).toBeTruthy();
        await act(async () => {
          button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      },
      posts: () => fetchMock.mock.calls
        .filter((call) => !String(call[0]).startsWith('/api/agent/pending-actions'))
        .map((call) => ({ url: String(call[0]), body: JSON.parse(String((call[1] as { body?: string })?.body ?? '{}')) })),
    };
  }

  it('renders permission, question and automation rows from the shared payload', async () => {
    const view = await render();
    expect(host.textContent).toContain('Pending agent actions');
    expect(host.textContent).toContain('Codex permission · command');
    expect(host.textContent).toContain('Bash · pnpm test');
    expect(host.textContent).toContain('Runs a command.');
    expect(host.textContent).toContain('Allow once');
    expect(host.textContent).toContain('Agent question');
    expect(host.textContent).toContain('Ship now?');
    expect(host.textContent).toContain('Automation approval · Claude Code');
    expect(host.textContent).toContain('Release observer');
    expect(host.textContent).toContain('Approve');
    expect(host.textContent).toContain('Deny');
    expect(host.querySelector('[data-testid="pending-agent-actions"]')).toBeTruthy();
    await view.cleanup();
  });

  it('renders nothing when every action is excluded or the list is empty', async () => {
    const view = await render({ excludeRunIds: new Set(['run-perm', 'run-question']) });
    // The automation approval has no runId and stays visible.
    expect(host.textContent).not.toContain('Codex permission');
    expect(host.textContent).not.toContain('Agent question');
    expect(host.textContent).toContain('Automation approval');
    await view.cleanup();

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/agent/pending-actions')) {
        return { ok: true, status: 200, json: async () => ({ permissions: [], questions: [], automationApprovals: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    const empty = await render();
    expect(host.querySelector('[data-testid="pending-agent-actions"]')).toBeNull();
    await empty.cleanup();
  });

  it('sends the permission decision through the existing endpoint', async () => {
    const view = await render();
    await view.click('Allow once');
    expect(view.posts()).toEqual([{
      url: '/api/agent/runtime-permission',
      body: { runId: 'run-perm', requestId: 'req-1', decision: 'allow-once' },
    }]);
    await view.cleanup();
  });

  it('sends an automation approval decision', async () => {
    const view = await render();
    await view.click('Approve');
    expect(view.posts()).toEqual([{
      url: '/api/agent/automation-approval',
      body: { approvalId: 'approval-1', decision: 'allow' },
    }]);
    await view.cleanup();
  });

  it('answers a question after selecting an option and refuses incomplete drafts', async () => {
    const view = await render();
    // Answering without a selection shows the draft error and posts nothing.
    await view.click('Answer');
    expect(host.textContent).toContain('Answer every question before submitting.');
    expect(view.posts()).toEqual([]);

    await view.click('Yes');
    await view.click('Answer');
    expect(view.posts()).toEqual([{
      url: '/api/agent/user-question',
      body: {
        runId: 'run-question',
        toolCallId: 'question-1',
        action: 'answer',
        answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Yes' }],
      },
    }]);
    await view.cleanup();
  });

  it('cancels a question through the cancel action', async () => {
    const view = await render();
    await view.click('Cancel');
    expect(view.posts()).toEqual([{
      url: '/api/agent/user-question',
      body: { runId: 'run-question', toolCallId: 'question-1', action: 'cancel', reason: 'user_cancelled' },
    }]);
    await view.cleanup();
  });
});
