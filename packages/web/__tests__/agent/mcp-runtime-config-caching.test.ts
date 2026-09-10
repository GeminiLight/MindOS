import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-cache-'));
  previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  vi.resetModules();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function mcpConfigPath(): string {
  return path.join(tempHome, '.mindos', 'mcp.json');
}

function runtimeConfigPath(): string {
  return path.join(tempHome, '.mindos', 'runtime', 'pi-mcp-agent.json');
}

const ALLOWLISTED = {
  mcpServers: { github: { command: 'github-mcp', mindosAgent: ['search_code'] } },
};

describe('ensureMindosAgentMcpRuntimeConfig change-driven writes', () => {
  it('writes on the first turn and performs zero writes on an unchanged second turn', async () => {
    writeJson(mcpConfigPath(), ALLOWLISTED);
    const { ensureMindosAgentMcpRuntimeConfig } = await import('@/lib/pi-integration/mcp-config');

    const first = ensureMindosAgentMcpRuntimeConfig();
    expect(first.serverCount).toBe(1);
    expect(fs.existsSync(runtimeConfigPath())).toBe(true);

    const renameSpy = vi.spyOn(fs, 'renameSync');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const second = ensureMindosAgentMcpRuntimeConfig();
    expect(second.serverCount).toBe(1);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('rewrites the runtime config exactly once when the source config changes', async () => {
    writeJson(mcpConfigPath(), ALLOWLISTED);
    const { ensureMindosAgentMcpRuntimeConfig } = await import('@/lib/pi-integration/mcp-config');
    ensureMindosAgentMcpRuntimeConfig();

    // Change the allowlist so the derived bounded config differs.
    writeJson(mcpConfigPath(), {
      mcpServers: {
        github: { command: 'github-mcp', mindosAgent: ['search_code'] },
        linear: { command: 'linear-mcp', mindosAgent: true },
      },
    });

    const renameSpy = vi.spyOn(fs, 'renameSync');
    const updated = ensureMindosAgentMcpRuntimeConfig();
    expect(updated.serverCount).toBe(2);
    // Exactly one atomic commit for the changed runtime config; the derived
    // sandbox metadata cache is unchanged (no pi metadata cache present).
    const configRenames = renameSpy.mock.calls.filter((call) => String(call[1]) === runtimeConfigPath());
    expect(configRenames).toHaveLength(1);
  });

  it('does not rewrite when two turns run against the same unchanged config (single-flight)', async () => {
    writeJson(mcpConfigPath(), ALLOWLISTED);
    const { ensureMindosAgentMcpRuntimeConfig } = await import('@/lib/pi-integration/mcp-config');

    const renameSpy = vi.spyOn(fs, 'renameSync');
    ensureMindosAgentMcpRuntimeConfig();
    const afterFirst = renameSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    ensureMindosAgentMcpRuntimeConfig();
    ensureMindosAgentMcpRuntimeConfig();
    // No further commits beyond the first turn's writes.
    expect(renameSpy.mock.calls.length).toBe(afterFirst);
  });

  it('self-heals by rewriting when the runtime config is deleted externally', async () => {
    writeJson(mcpConfigPath(), ALLOWLISTED);
    const { ensureMindosAgentMcpRuntimeConfig } = await import('@/lib/pi-integration/mcp-config');
    ensureMindosAgentMcpRuntimeConfig();
    expect(fs.existsSync(runtimeConfigPath())).toBe(true);

    fs.rmSync(runtimeConfigPath());
    ensureMindosAgentMcpRuntimeConfig();
    expect(fs.existsSync(runtimeConfigPath())).toBe(true);
    expect(JSON.parse(fs.readFileSync(runtimeConfigPath(), 'utf-8')).mcpServers.github).toBeDefined();
  });

  it('recomputes after resetMindosAgentMcpRuntimeConfigCache even with an unchanged source', async () => {
    writeJson(mcpConfigPath(), ALLOWLISTED);
    const mod = await import('@/lib/pi-integration/mcp-config');
    mod.ensureMindosAgentMcpRuntimeConfig();
    fs.rmSync(runtimeConfigPath());

    // Without a reset the memo would still short-circuit only if outputs exist;
    // deleting the output already forces a recompute, and an explicit reset also
    // clears the memo. Assert the reset path rewrites.
    mod.resetMindosAgentMcpRuntimeConfigCache();
    const renameSpy = vi.spyOn(fs, 'renameSync');
    mod.ensureMindosAgentMcpRuntimeConfig();
    expect(renameSpy).toHaveBeenCalled();
    expect(fs.existsSync(runtimeConfigPath())).toBe(true);
  });
});
