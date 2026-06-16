/**
 * kbExtension — the registered tool set must come from the request's own
 * permission policy, not from module-level shared state.
 *
 * Two concurrent /api/ask requests with different permission policies used
 * to race on setKbMode(): whichever request set the module-level policy last
 * decided the tools for BOTH reloads — a readonly request could get agent write
 * tools (privilege escalation) or an agent request could lose its tools.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import kbExtension, {
  runWithKbPermissionPolicy,
  setKbPermissionPolicy,
} from '@/lib/agent/kb-extension';
import { registerWebKbExtensionHost } from '@/lib/agent/kb-extension-host';
import { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/tool/permission-policy';
import { getToolsForMindosAgentPolicy } from '@/lib/agent/tools';

function registeredToolNames(run: (register: (def: { name: string }) => void) => void): string[] {
  const names: string[] = [];
  run((def) => names.push(def.name));
  return names.sort();
}

function expectedToolNames(mode: 'readonly' | 'agent' | 'organize'): string[] {
  return getToolsForMindosAgentPolicy(createMindosAgentPermissionPolicy(mode))
    .map((tool) => tool.name)
    .sort();
}

describe('kbExtension permission policy scoping', () => {
  // The entry resolves the web toolkit from the process-global host slot
  // (jiti-loadable entry graph); production registers it in
  // getMindosWebPiRuntimePaths() before every reload().
  beforeAll(() => {
    registerWebKbExtensionHost();
  });

  it('registers the policy-scoped tool set even when another request flips the global policy', () => {
    const readonlyPolicy = createMindosAgentPermissionPolicy('readonly');
    const agentPolicy = createMindosAgentPermissionPolicy('agent');
    // The two modes must actually differ for this test to mean anything.
    expect(expectedToolNames('readonly')).not.toEqual(expectedToolNames('agent'));

    const names = registeredToolNames((register) => {
      runWithKbPermissionPolicy(readonlyPolicy, () => {
        // A concurrent agent-mode request mutates the module-level policy
        // between this request's setKbMode() and its reload().
        setKbPermissionPolicy(agentPolicy);
        kbExtension({ registerTool: register } as never);
      });
    });

    expect(names).toEqual(expectedToolNames('readonly'));
  });

  it('returns the callback result and supports async callbacks', async () => {
    const policy = createMindosAgentPermissionPolicy('agent');
    expect(runWithKbPermissionPolicy(policy, () => 'sync-result')).toBe('sync-result');
    await expect(runWithKbPermissionPolicy(policy, async () => 'async-result')).resolves.toBe('async-result');
  });

  it('falls back to the module-level policy outside a scoped run', () => {
    setKbPermissionPolicy(createMindosAgentPermissionPolicy('organize'));
    const names = registeredToolNames((register) => {
      kbExtension({ registerTool: register } as never);
    });
    expect(names).toEqual(expectedToolNames('organize'));
    // Restore the default so other suites see the historical baseline.
    setKbPermissionPolicy(createMindosAgentPermissionPolicy('agent'));
  });
});
