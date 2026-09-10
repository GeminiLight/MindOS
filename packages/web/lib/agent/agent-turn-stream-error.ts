/**
 * Terminal error surfaced by the stream consumer
 * (`message.status === 'error'`, spec-runtime-lane-correctness item 5).
 *
 * The run already ended on the server with an `error` frame, so the hook must
 * neither treat the turn as a success nor re-enter the reattach loop: the
 * error is terminal and rendered through the same failed-turn path that
 * transport exceptions use.
 */
import type { Message } from '@/lib/types';

export const DEFAULT_AGENT_TURN_STREAM_ERROR_MESSAGE = 'The agent runtime reported an error.';

export class AgentTurnStreamError extends Error {
  readonly terminal = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'AgentTurnStreamError';
  }
}

/** Convert a consumed message into a terminal error when its stream failed. */
export function agentTurnStreamErrorFromMessage(message: Pick<Message, 'status' | 'error'>): AgentTurnStreamError | null {
  if (message.status !== 'error') return null;
  const text = typeof message.error === 'string' ? message.error.trim() : '';
  return new AgentTurnStreamError(text || DEFAULT_AGENT_TURN_STREAM_ERROR_MESSAGE);
}

/** True for errors that must end the turn immediately instead of retrying or reattaching. */
export function isTerminalAgentTurnError(error: unknown): error is AgentTurnStreamError {
  return error instanceof AgentTurnStreamError
    || (error instanceof Error && (error as { terminal?: unknown }).terminal === true);
}
