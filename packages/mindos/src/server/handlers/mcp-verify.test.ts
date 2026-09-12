import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleMcpVerifyPost, handleMcpServerCopyPost } from './mcp-install.js';
import { DEFAULT_MCP_AGENTS } from '../../agent/config/registry.js';
const homes: string[] = [];
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'agent-verify-'));
  homes.push(home);
  mkdirSync(join(home, '.codex'));
  const path = join(home, '.codex/config.toml');
  const content = '[mcp_servers.mindos]\nurl = "https://example.com/mcp"\n[mcp_servers.mindos.http_headers]\nAuthorization = "Bearer fixture"\n';
  writeFileSync(path, content);
  const fetcher = vi.fn(async () => new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{},"serverInfo":{"name":"test","version":"1"}}}'));
  return { home, path, content, fetcher, services: { homeDir: home, agents: DEFAULT_MCP_AGENTS, fetcher } };
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
describe('test saved connection without changing it', () => {
  it('uses native headers for verification without exposing them or rewriting the file', async () => {
    const { path, content, fetcher, services } = setup();
    const response = await handleMcpVerifyPost({ key: 'codex', scope: 'global' }, services);
    expect(response.body).toEqual({ transport: 'http', verified: true });
    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(fetcher).toHaveBeenCalledWith('https://example.com/mcp', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fixture' }) }));
    expect(JSON.stringify(response)).not.toContain('Bearer fixture');
  });
  it('does not spawn stdio commands', async () => {
    const { path, fetcher, services } = setup();
    writeFileSync(path, '[mcp_servers.mindos]\ncommand = "do-not-run"\n');
    expect((await handleMcpVerifyPost({ key: 'codex' }, services)).body).toMatchObject({ transport: 'stdio', verified: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports an unknown agent and missing project configuration', async () => {
    const { services, home } = setup();
    expect((await handleMcpVerifyPost({ key: 'missing' }, services)).status).toBe(404);
    expect((await handleMcpVerifyPost({ key: 'codex', scope: 'project', projectRoot: join(home, 'project') }, services)).status).toBe(404);
    expect((await handleMcpVerifyPost({ key: 'codex', projectRoot: 'relative' }, services)).status).toBe(400);
  });
  it('rejects client-owned authentication during a cross-agent copy without creating a target file', async () => {
    const { services, home, path } = setup();
    writeFileSync(path, '[mcp_servers.other]\nurl = "https://example.com"\nbearer_token_env_var = "TOKEN"\n');
    const response = await handleMcpServerCopyPost({ serverName: 'other', sourceAgentKey: 'codex', targets: [{ key: 'cursor' }] }, services);
    expect(response.body).toMatchObject({ results: [{ status: 'error', message: expect.stringContaining('bearer_token_env_var') }] });
    expect(existsSync(join(home, '.cursor/mcp.json'))).toBe(false);
  });
});
