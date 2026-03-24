export type AgentsPanelAgentDetailStatus = 'connected' | 'detected' | 'notFound';

export function resolveAgentDetailStatus(
  key: string,
  connected: { key: string }[],
  detected: { key: string }[],
  notFound: { key: string }[],
): AgentsPanelAgentDetailStatus | null {
  if (connected.some(a => a.key === key)) return 'connected';
  if (detected.some(a => a.key === key)) return 'detected';
  if (notFound.some(a => a.key === key)) return 'notFound';
  return null;
}
