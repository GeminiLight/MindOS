// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { en } from '@/lib/i18n';
import type { AgentInfo } from '@/components/settings/types';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiFetch: api }));
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ t: en }) }));
vi.mock('@/lib/mcp-token', () => ({ revealMcpAuthToken: async () => 'fixture-secret' }));
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: async () => true }));
import AgentConnectionWorkbench from '@/components/agents/AgentConnectionWorkbench';
const agent: AgentInfo = {
  key: 'codex', name: 'Codex', installed: true, present: true, format: 'toml', entryStyle: 'codex',
  hasGlobalScope: true, hasProjectScope: true, preferredTransport: 'stdio', configKey: 'mcp_servers',
  globalPath: '~/.codex/config.toml', projectPath: '.codex/config.toml', projectRoot: '/workspace/notes',
};

let root: Root;
let host: HTMLDivElement;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function renderAgent(value = agent) {
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); }
  await act(async () => root.render(<AgentConnectionWorkbench agent={value} status={null} onRefresh={async () => {}} />));
}
function choice(name: string): HTMLInputElement { return host.querySelector(`input[aria-label="${name}"]`)!; }
function button(name: string): HTMLButtonElement { return [...host.querySelectorAll('button')].find(b => b.textContent === name)!; }
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); host = undefined!; api.mockReset(); });
describe('Agent connection workbench', () => {
  it('previews the selected scope and saves the actual selection', async () => {
    api.mockResolvedValue({ results: [{ status: 'ok', path: '.codex/config.toml', verified: false, verifyError: 'HTTP 401' }] });
    await renderAgent();
    await click(choice('This project'));
    await click(choice('HTTP'));
    expect(host.textContent).toContain('/workspace/notes/.codex/config.toml');
    await click(button('Save configuration'));
    expect(JSON.parse(api.mock.calls[0]![1].body)).toMatchObject({ agents: [{ key: 'codex', scope: 'project', transport: 'http' }] });
    expect(host.textContent).toContain('HTTP 401');
    expect(host.textContent).toContain(en.agentsContent.connection.savedUnverified);
  });
  it('keeps edits across background refresh and keeps errors actionable', async () => {
    await renderAgent();
    await click(choice('HTTP'));
    await renderAgent({ ...agent });
    expect(choice('HTTP').checked).toBe(true);
    api.mockRejectedValue(new Error('Permission denied'));
    await click(button('Save configuration'));
    expect(host.textContent).toContain('Permission denied');
    expect(button('Save configuration').disabled).toBe(false);
  });
  it('starts from the saved stdio connection even when HTTP is preferred', async () => {
    await renderAgent({ ...agent, preferredTransport: 'http', transport: 'stdio' });
    expect(choice('Local process').checked).toBe(true);
  });
  it('disables project scope without a known project folder', async () => {
    await renderAgent({ ...agent, projectRoot: undefined });
    expect(choice('This project').disabled).toBe(true);
    expect(host.textContent).not.toContain('Connected');
  });
});
