import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/ask/user-question/request/route';
import {
  answerAskUserQuestion,
  runWithAskUserQuestionBridge,
} from '@geminilight/mindos/agent/bridges/user-question-bridge';

function postJson(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/ask/user-question/request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/ask/user-question/request', () => {
  it('registers an external Claude Code question request and returns the UI answer', async () => {
    const send = vi.fn();

    const result = await runWithAskUserQuestionBridge({ runId: 'run-api-question', send }, async () => {
      const responsePromise = POST(postJson({
        runId: 'run-api-question',
        toolCallId: 'claude-question-api',
        params: {
          questions: [{
            question: 'Delete this review note?',
            header: 'Delete confirmation',
            options: [
              { label: 'Delete', description: 'Remove the note.' },
              { label: 'Keep', description: 'Leave it unchanged.' },
            ],
          }],
        },
      }));

      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
          type: 'user_question_start',
          runId: 'run-api-question',
          toolCallId: 'claude-question-api',
        }));
      });
      expect(answerAskUserQuestion({
        runId: 'run-api-question',
        toolCallId: 'claude-question-api',
        answers: [{
          questionIndex: 0,
          question: 'Delete this review note?',
          kind: 'option',
          answer: 'Delete',
        }],
      })).toEqual({ ok: true });

      const response = await responsePromise;
      return response.json();
    });

    expect(result).toEqual({
      answers: [{
        questionIndex: 0,
        question: 'Delete this review note?',
        kind: 'option',
        answer: 'Delete',
      }],
      cancelled: false,
    });
  });

  it('returns a cancelled result when the run is not active', async () => {
    const response = await POST(postJson({
      runId: 'missing-run',
      toolCallId: 'claude-question-missing',
      params: { questions: [] },
    }));

    await expect(response.json()).resolves.toEqual({ answers: [], cancelled: true, error: 'no_bridge' });
  });
});
