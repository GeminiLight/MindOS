// ─── Knowledge Base Extension ─────────────────────────────────────────────────
// Registers all MindOS knowledge base tools via the Pi Extension API.
// This file is loaded as an extension by DefaultResourceLoader in ask/route.ts.
//
// Tools are defined in ./tools.ts (the canonical source). This extension wraps
// them with write-protection and logging, then registers via pi.registerTool().
//
// Mode-based filtering (chat/organize/agent) is controlled by setKbMode() which
// must be called before resourceLoader.reload().

import type { ExtensionAPI, ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import { knowledgeBaseTools, WRITE_TOOLS, CHAT_TOOL_NAMES, ORGANIZE_TOOL_NAMES } from './tools';
import { a2aTools } from '@/lib/a2a/a2a-tools';
import { acpTools } from '@/lib/acp/acp-tools';
import { assertNotProtected } from '@/lib/core';
import { logAgentOp } from './log';

// ─── Mode-based tool filtering ───────────────────────────────────────────────

export type KbMode = 'agent' | 'chat' | 'organize';

let currentMode: KbMode = 'agent';

/** Set the mode before resourceLoader.reload(). Determines which tools get registered. */
export function setKbMode(mode: KbMode): void {
  currentMode = mode;
}

function getToolsForMode(mode: KbMode): AgentTool<any>[] {
  switch (mode) {
    case 'chat':
      return knowledgeBaseTools.filter(t => CHAT_TOOL_NAMES.has(t.name));
    case 'organize':
      return knowledgeBaseTools.filter(t => ORGANIZE_TOOL_NAMES.has(t.name));
    case 'agent':
      return [...knowledgeBaseTools, ...a2aTools, ...acpTools];
  }
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

export default function kbExtension(pi: ExtensionAPI) {
  const tools = getToolsForMode(currentMode);

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
        const result = await tool.execute(toolCallId, params, signal, onUpdate as any);

        // Log the operation
        try {
          const outputText = result?.content
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('') ?? '';
          logAgentOp({
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
}
