import { apiFetch } from '@/lib/api';

export type McpTokenRevealResult = {
  authConfigured: boolean;
  authToken?: string;
};

export async function revealMcpAuthToken(): Promise<string> {
  const result = await apiFetch<McpTokenRevealResult>('/api/mcp/token/reveal', {
    method: 'POST',
  });
  return result.authToken ?? '';
}
