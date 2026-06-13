// Sunk from packages/web/lib/agent/kb-extension.ts (Wave 3, spec-agent-core-consolidation).
//
// Knowledge Base Extension — registers the MindOS KB tools via the Pi
// Extension API, wrapping them with write-protection and audit logging.
// Hosts keep a real extension entry file (the pi DefaultResourceLoader loads
// it by file path) that wires their toolkit into createMindosKbExtension().
//
// Mode-based filtering (chat/organize/agent) is controlled by
// runWithKbPermissionPolicy() (request-scoped) or setKbMode()/
// setKbPermissionPolicy() (process fallback), evaluated at reload() time.
//
// All policy state lives behind Symbol.for keys (global-state.ts): the pi
// loader imports the host's extension entry in its own module graph, so
// module-level state here would fork between the route's copy and the
// loader's copy.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import { assertNotProtected } from '../foundation/security/index.js';
import {
  createMindosAgentPermissionPolicy,
  type MindosAgentPermissionPolicy,
} from './permission-policy.js';
import {
  getProcessGlobal,
  KB_EXTENSION_HOST_KEY,
  KB_PERMISSION_POLICY_FALLBACK_KEY,
  KB_PERMISSION_POLICY_STORAGE_KEY,
} from './global-state.js';
import { WRITE_TOOLS, type MindosAgentTool } from './kb-tools.js';

// ─── Mode-based tool filtering ───────────────────────────────────────────────

export type KbMode = 'agent' | 'chat' | 'organize';

function getPolicyStorage(): AsyncLocalStorage<MindosAgentPermissionPolicy> {
  return getProcessGlobal(
    KB_PERMISSION_POLICY_STORAGE_KEY,
    () => new AsyncLocalStorage<MindosAgentPermissionPolicy>(),
  );
}

function getPolicyFallback(): { policy: MindosAgentPermissionPolicy } {
  return getProcessGlobal(
    KB_PERMISSION_POLICY_FALLBACK_KEY,
    () => ({ policy: createMindosAgentPermissionPolicy('agent') }),
  );
}

/** Run fn with a request-scoped policy; the kb extension reads it during reload(). */
export function runWithKbPermissionPolicy<T>(policy: MindosAgentPermissionPolicy, fn: () => T): T {
  return getPolicyStorage().run(policy, fn);
}

/** Set the mode before resourceLoader.reload(). Determines which tools get registered. */
export function setKbMode(mode: KbMode): void {
  getPolicyFallback().policy = createMindosAgentPermissionPolicy(mode);
}

export function setKbPermissionPolicy(policy: MindosAgentPermissionPolicy): void {
  getPolicyFallback().policy = policy;
}

/** The policy the extension will register tools for: request-scoped, else fallback. */
export function getEffectiveKbPermissionPolicy(): MindosAgentPermissionPolicy {
  return getPolicyStorage().getStore() ?? getPolicyFallback().policy;
}

// ─── Audit hook ───────────────────────────────────────────────────────────────

export interface MindosKbAuditEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}

function getProtectedPaths(toolName: string, args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  if (toolName === 'batch_create_files' && Array.isArray(args.files)) {
    (args.files as Array<{ path?: string }>).forEach((f) => { if (f.path) paths.push(f.path); });
  } else {
    const p = (args.path ?? args.from_path) as string | undefined;
    if (typeof p === 'string') paths.push(p);
  }
  return paths;
}

// ─── Extension Factory ────────────────────────────────────────────────────────

export interface MindosKbExtensionHost {
  /** Toolkit lookup for the effective policy — typically MindosKbToolkit.getToolsForPolicy. */
  getToolsForPolicy(policy: MindosAgentPermissionPolicy): MindosAgentTool[];
  /** Audit sink for executed tool calls. Write path is a host concern; must never throw. */
  logAgentOp?(entry: MindosKbAuditEntry): void;
}

export function createMindosKbExtension(host: MindosKbExtensionHost): (pi: ExtensionAPI) => void {
  return function kbExtension(pi: ExtensionAPI) {
    const policy = getEffectiveKbPermissionPolicy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = host.getToolsForPolicy(policy) as AgentTool<any>[];

    for (const tool of tools) {
      pi.registerTool({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => {
          const args = (params ?? {}) as Record<string, unknown>;

          // Write-protection guard
          if (WRITE_TOOLS.has(tool.name)) {
            for (const filePath of getProtectedPaths(tool.name, args)) {
              try {
                assertNotProtected(filePath, 'modified by AI agent');
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                return textResult(`Write-protection error: ${msg}. You CANNOT modify ${filePath} because it is system-protected. Please tell the user you don't have permission to do this.`);
              }
            }
          }

          // Execute the actual tool
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await tool.execute(toolCallId, params, signal, onUpdate as any);

          // Log the operation
          try {
            const outputText = result?.content
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ?.filter((p: any) => p.type === 'text')
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((p: any) => p.text)
              .join('') ?? '';
            host.logAgentOp?.({
              ts: new Date().toISOString(),
              tool: tool.name,
              params: args,
              result: outputText.startsWith('Error:') ? 'error' : 'ok',
              message: outputText.slice(0, 200),
              agentName: 'MindOS',
            });
          } catch {
            // logging must never kill the stream
          }

          return result;
        },
      } as ToolDefinition<TSchema, unknown>);
    }
  };
}

// ─── Host registration bridge ────────────────────────────────────────────────
// The pi resource loader imports the host's kb-extension entry file with jiti,
// which resolves no host path aliases (`@/...`). Any webpack-land import in
// the entry's module graph makes the whole entry fail to load — and because
// the session runs with `noTools: 'builtin'`, a failed entry means the agent
// has NO KB tools at all. The host therefore registers its toolkit through a
// process-global slot (webpack module graph) and the entry reads it back at
// extension-execution time (jiti module graph).

type MindosKbExtensionHostSlot = { host: MindosKbExtensionHost | undefined };

function getHostSlot(): MindosKbExtensionHostSlot {
  return getProcessGlobal<MindosKbExtensionHostSlot>(KB_EXTENSION_HOST_KEY, () => ({ host: undefined }));
}

/** Register the host toolkit. Must run before resourceLoader.reload(). Idempotent. */
export function registerMindosKbExtensionHost(host: MindosKbExtensionHost): void {
  getHostSlot().host = host;
}

/** The toolkit registered by the host runtime, if any. */
export function getMindosKbExtensionHost(): MindosKbExtensionHost | undefined {
  return getHostSlot().host;
}

/**
 * Extension factory for host entry files: resolves the host toolkit from the
 * registered slot at execution time, so the entry file's own import graph
 * stays free of host modules (jiti-loadable).
 */
export function createMindosKbExtensionFromRegisteredHost(): (pi: ExtensionAPI) => void {
  return function kbExtensionFromRegisteredHost(pi: ExtensionAPI) {
    const host = getMindosKbExtensionHost();
    if (!host) {
      throw new Error(
        'MindOS KB extension host not registered. Call registerMindosKbExtensionHost() '
        + 'from the host runtime before resourceLoader.reload() — the kb-extension entry '
        + 'is loaded in the pi loader module graph and cannot import host modules.',
      );
    }
    return createMindosKbExtension(host)(pi);
  };
}
