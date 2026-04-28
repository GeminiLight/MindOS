/**
 * A2A-ACP Bridge — Translate between A2A protocol and ACP protocol.
 * Allows A2A agents to delegate to ACP agents transparently,
 * and ACP session results to be returned as A2A tasks.
 */

import type { A2AMessage, A2ATask, TaskState } from '@/lib/a2a/types';
import type { AcpPromptResponse, AcpSessionUpdate } from './types';
import { createSession, prompt, closeSession } from './session';

/* ── A2A → ACP ─────────────────────────────────────────────────────────── */

/**
 * Bridge an A2A SendMessage request to an ACP session/prompt.
 * Creates a session, sends the message, returns the result, then closes.
 */
export async function bridgeA2aToAcp(
  a2aMessage: A2AMessage,
  acpAgentId: string,
): Promise<A2ATask> {
  const taskId = `acp-bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Extract text from A2A message parts
  const text = a2aMessage.parts
    .map(p => p.text ?? '')
    .filter(Boolean)
    .join('\n');

  if (!text) {
    return makeFailedTask(taskId, 'No text content in A2A message');
  }

  let session;
  try {
    session = await createSession(acpAgentId);
  } catch (err) {
    return makeFailedTask(taskId, `Failed to create ACP session: ${(err as Error).message}`);
  }

  try {
    const response = await prompt(session.id, text);
    return bridgeAcpResponseToA2a(taskId, response);
  } catch (err) {
    return makeFailedTask(taskId, `ACP prompt failed: ${(err as Error).message}`);
  } finally {
    await closeSession(session.id).catch(() => {});
  }
}

/* ── ACP → A2A ─────────────────────────────────────────────────────────── */

/**
 * Convert a completed ACP prompt response to an A2A task result.
 */
export function bridgeAcpResponseToA2a(
  taskId: string,
  response: AcpPromptResponse,
): A2ATask {
  return {
    id: taskId,
    status: {
      state: 'TASK_STATE_COMPLETED',
      message: {
        role: 'ROLE_AGENT',
        parts: [{ text: response.text }],
      },
      timestamp: new Date().toISOString(),
    },
    artifacts: response.text ? [{
      artifactId: `${taskId}-artifact`,
      parts: [{ text: response.text }],
    }] : undefined,
  };
}

/**
 * Convert a stream of ACP session updates to A2A task updates.
 * Aggregates text updates and maps final state.
 */
export function bridgeAcpUpdatesToA2a(
  taskId: string,
  updates: AcpSessionUpdate[],
): A2ATask {
  let aggregatedText = '';
  let finalState: TaskState = 'TASK_STATE_WORKING';
  let errorMessage = '';

  for (const update of updates) {
    switch (update.type) {
      case 'text':
      case 'agent_message_chunk':
        aggregatedText += update.text ?? '';
        break;
      case 'agent_thought_chunk':
        // Include thought in output with label
        if (update.text) aggregatedText += update.text;
        break;
      case 'done':
        finalState = 'TASK_STATE_COMPLETED';
        break;
      case 'error':
        finalState = 'TASK_STATE_FAILED';
        errorMessage = update.error ?? 'Unknown error';
        break;
      // tool_call, tool_call_update, plan, etc. — pass through for now
    }
  }

  if (finalState === 'TASK_STATE_FAILED') {
    return makeFailedTask(taskId, errorMessage);
  }

  return {
    id: taskId,
    status: {
      state: finalState,
      message: aggregatedText ? {
        role: 'ROLE_AGENT',
        parts: [{ text: aggregatedText }],
      } : undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: aggregatedText ? [{
      artifactId: `${taskId}-artifact`,
      parts: [{ text: aggregatedText }],
    }] : undefined,
  };
}

/* ── Internal ──────────────────────────────────────────────────────────── */

function makeFailedTask(taskId: string, error: string): A2ATask {
  return {
    id: taskId,
    status: {
      state: 'TASK_STATE_FAILED',
      message: {
        role: 'ROLE_AGENT',
        parts: [{ text: error }],
      },
      timestamp: new Date().toISOString(),
    },
  };
}
