import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LearningError } from '@geminilight/mindos/knowledge';
import { handleAgentSessionsGet } from '@geminilight/mindos/server';
import { listAgentRuns } from '@geminilight/mindos/agent';
export const completedSourceSelection = z.object({
  sessionId: z.string().min(1).max(200),
  messageIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  messageHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const sourceHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function readCompletedReply(
  input: z.infer<typeof completedSourceSelection>,
) {
  const session = handleAgentSessionsGet().body?.find(
    (item) => item.id === input.sessionId,
  );
  if (!session)
    throw new LearningError(
      'not-found',
      'The source conversation is unavailable.',
    );
  if (
    listAgentRuns({ chatSessionId: input.sessionId, limit: 100 }).some((run) =>
      ['queued', 'running', 'streaming', 'waiting_approval'].includes(
        run.status,
      ),
    )
  )
    throw new LearningError(
      'conflict',
      'Wait for the conversation to finish before saving its source.',
    );
  const message = session.messages[input.messageIndex] as
    | { role?: unknown; content?: unknown }
    | undefined;
  if (
    message?.role !== 'assistant' ||
    typeof message.content !== 'string' ||
    !message.content.trim() ||
    message.content.startsWith('__error__') ||
    sourceHash(message.content) !== input.messageHash
  )
    throw new LearningError(
      'conflict',
      'The selected reply changed or is unavailable.',
    );
  const preceding = session.messages
    .slice(0, input.messageIndex)
    .reverse()
    .map((m) => m as { role?: unknown; content?: unknown } | null)
    .find(
      (m) =>
        m?.role === 'user' && typeof m.content === 'string' && m.content.trim(),
    );
  return {
    session,
    text: message.content,
    question:
      typeof preceding?.content === 'string' ? preceding.content.trim() : null,
  };
}
