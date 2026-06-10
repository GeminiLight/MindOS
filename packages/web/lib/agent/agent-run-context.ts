import { AsyncLocalStorage } from 'async_hooks';

export interface AgentRunContext {
  chatSessionId?: string;
  rootRunId?: string;
  parentRunId?: string;
}

const agentRunContext = new AsyncLocalStorage<AgentRunContext>();

export function runWithAgentRunContext<T>(
  context: AgentRunContext,
  fn: () => T,
): T {
  return agentRunContext.run(context, fn);
}

export function getCurrentAgentRunContext(): AgentRunContext | undefined {
  return agentRunContext.getStore();
}
