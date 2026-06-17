/**
 * Tests for the KB pi-extension factory (Wave 3, spec-agent-core-consolidation).
 * Migrated from packages/web/__tests__/agent/kb-extension-policy.test.ts and
 * extended with write-protection + audit coverage. Policy state is process-
 * global (Symbol.for) — every test restores the 'agent' fallback afterwards.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  createMindosAgentPermissionPolicy,
  type MindosAgentPermissionPolicy,
} from '../../tool/permission-policy.js';
import {
  createMindosKbExtension,
  createMindosKbExtensionFromRegisteredHost,
  getEffectiveKbPermissionPolicy,
  getMindosKbExtensionHost,
  registerMindosKbExtensionHost,
  runWithKbPermissionPolicy,
  setKbMode,
  setKbPermissionPolicy,
  type MindosKbAuditEntry,
} from './kb-extension.js';
import { deleteProcessGlobal, KB_EXTENSION_HOST_KEY } from '../../global-state.js';
import type { MindosAgentTool } from '../../tool/kb-tools.js';

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
};

function createFakePi() {
  const registered: RegisteredTool[] = [];
  const pi = {
    registerTool: (definition: RegisteredTool) => {
      registered.push(definition);
    },
  } as unknown as ExtensionAPI;
  return { pi, registered };
}

function makeTool(name: string, outputText = `${name} ok`): MindosAgentTool {
  return {
    name,
    label: name,
    description: `fake ${name}`,
    parameters: {},
    execute: async () => ({ content: [{ type: 'text', text: outputText }], details: undefined }),
  };
}

afterEach(() => {
  // Policy fallback is process-global state — restore the default.
  setKbMode('agent');
});

describe('KB permission policy resolution', () => {
  it('prefers the request-scoped policy over the process fallback', () => {
    setKbMode('readonly');
    const agentPolicy = createMindosAgentPermissionPolicy('agent');

    const observed = runWithKbPermissionPolicy(agentPolicy, () => getEffectiveKbPermissionPolicy());

    expect(observed).toBe(agentPolicy);
    expect(getEffectiveKbPermissionPolicy().mode).toBe('readonly');
  });

  it('returns sync and async results from runWithKbPermissionPolicy', async () => {
    const policy = createMindosAgentPermissionPolicy('organize');
    expect(runWithKbPermissionPolicy(policy, () => 42)).toBe(42);
    await expect(runWithKbPermissionPolicy(policy, async () => 'done')).resolves.toBe('done');
  });

  it('uses the fallback policy set via setKbPermissionPolicy outside any scope', () => {
    const custom = createMindosAgentPermissionPolicy('organize');
    setKbPermissionPolicy(custom);
    expect(getEffectiveKbPermissionPolicy()).toBe(custom);
  });
});

describe('createMindosKbExtension', () => {
  it('registers the tools the host returns for the effective policy', () => {
    const seenPolicies: MindosAgentPermissionPolicy[] = [];
    const extension = createMindosKbExtension({
      getToolsForPolicy: (policy) => {
        seenPolicies.push(policy);
        return [makeTool('read_file'), makeTool('search')];
      },
    });
    const { pi, registered } = createFakePi();
    const readonlyPolicy = createMindosAgentPermissionPolicy('readonly');

    runWithKbPermissionPolicy(readonlyPolicy, () => extension(pi));

    expect(seenPolicies).toEqual([readonlyPolicy]);
    expect(registered.map((tool) => tool.name)).toEqual(['read_file', 'search']);
  });

  it('blocks write tools targeting protected files before executing them', async () => {
    let executed = false;
    const writeTool: MindosAgentTool = {
      ...makeTool('write_file'),
      execute: async () => {
        executed = true;
        return { content: [{ type: 'text', text: 'File written' }], details: undefined };
      },
    };
    const extension = createMindosKbExtension({ getToolsForPolicy: () => [writeTool] });
    const { pi, registered } = createFakePi();
    extension(pi);

    const result = await registered[0]!.execute('call-1', { path: 'INSTRUCTION.md', content: 'x' });
    const text = result.content[0]?.text ?? '';

    expect(executed).toBe(false);
    expect(text).toContain('Write-protection error');
    expect(text).toContain('INSTRUCTION.md');

    // Read tools are never blocked, even on protected paths.
    const readExtension = createMindosKbExtension({ getToolsForPolicy: () => [makeTool('read_file')] });
    const { pi: pi2, registered: registered2 } = createFakePi();
    readExtension(pi2);
    const readResult = await registered2[0]!.execute('call-2', { path: 'INSTRUCTION.md' });
    expect(readResult.content[0]?.text).toBe('read_file ok');
  });

  it('audits executed calls and marks Error: outputs as errors', async () => {
    const entries: MindosKbAuditEntry[] = [];
    const extension = createMindosKbExtension({
      getToolsForPolicy: () => [
        makeTool('read_file', 'all good'),
        makeTool('search', 'Error: index unavailable'),
      ],
      logAgentOp: (entry) => entries.push(entry),
    });
    const { pi, registered } = createFakePi();
    extension(pi);

    await registered[0]!.execute('call-1', { path: 'Note.md' });
    await registered[1]!.execute('call-2', { query: 'foo' });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ tool: 'read_file', result: 'ok', agentName: 'MindOS' });
    expect(entries[1]).toMatchObject({ tool: 'search', result: 'error' });
    expect(entries[1]?.message).toContain('Error: index unavailable');
  });

  it('never lets a throwing audit sink break the tool result', async () => {
    const extension = createMindosKbExtension({
      getToolsForPolicy: () => [makeTool('read_file')],
      logAgentOp: () => {
        throw new Error('audit disk full');
      },
    });
    const { pi, registered } = createFakePi();
    extension(pi);

    const result = await registered[0]!.execute('call-1', { path: 'Note.md' });
    expect(result.content[0]?.text).toBe('read_file ok');
  });
});

describe('KB extension host registration bridge', () => {
  afterEach(() => {
    deleteProcessGlobal(KB_EXTENSION_HOST_KEY);
  });

  it('resolves the registered host at execution time', () => {
    const extension = createMindosKbExtensionFromRegisteredHost();
    // Registration may happen after the factory is created (entry files build
    // the extension at import time, the host registers per request).
    registerMindosKbExtensionHost({ getToolsForPolicy: () => [makeTool('read_file')] });

    const { pi, registered } = createFakePi();
    extension(pi);

    expect(getMindosKbExtensionHost()).toBeDefined();
    expect(registered.map((tool) => tool.name)).toEqual(['read_file']);
  });

  it('re-registration replaces the previous host', () => {
    registerMindosKbExtensionHost({ getToolsForPolicy: () => [makeTool('read_file')] });
    registerMindosKbExtensionHost({ getToolsForPolicy: () => [makeTool('search')] });

    const { pi, registered } = createFakePi();
    createMindosKbExtensionFromRegisteredHost()(pi);

    expect(registered.map((tool) => tool.name)).toEqual(['search']);
  });

  it('fails loudly with an actionable message when no host is registered', () => {
    const { pi } = createFakePi();
    expect(() => createMindosKbExtensionFromRegisteredHost()(pi)).toThrowError(
      /registerMindosKbExtensionHost\(\).*before resourceLoader\.reload\(\)/s,
    );
  });
});
