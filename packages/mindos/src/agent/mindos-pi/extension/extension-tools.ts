import type { MindosExecutableTool } from '../../tool/executable-tool.js';
import type {
  MindosExtensionEntry,
  MindosPiResourceLoaderAdapter,
} from '../resource-types.js';

type MindosExtensionToolDefinition = {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  prepareArguments?: unknown;
  execute?: unknown;
};

type MindosExtensionToolExecute = (
  this: unknown,
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: ((update: unknown) => void) | undefined,
  ctx: Record<string, unknown>,
) => Promise<unknown> | unknown;

export function createMindosHeadlessExtensionContext(input: {
  cwd: string;
  model: unknown;
  modelRegistry: unknown;
  sessionManager: unknown;
  settingsManager: unknown;
  resourceLoader: unknown;
}): Record<string, unknown> {
  return {
    cwd: input.cwd,
    hasUI: false,
    model: input.model,
    modelRegistry: input.modelRegistry,
    sessionManager: input.sessionManager,
    settingsManager: input.settingsManager,
    resourceLoader: input.resourceLoader,
    ui: {
      notify: () => {},
      setWidget: () => {},
      custom: async () => undefined,
    },
  };
}

export function collectMindosRuntimeToolsForFallback(input: {
  requestTools: MindosExecutableTool[];
  resourceLoader: MindosPiResourceLoaderAdapter;
  extensionContext: Record<string, unknown>;
}): MindosExecutableTool[] {
  const byName = new Map<string, MindosExecutableTool>();
  for (const tool of input.requestTools) {
    if (tool.name) byName.set(tool.name, tool);
  }

  let extensions: MindosExtensionEntry[] = [];
  try {
    extensions = input.resourceLoader.getExtensions?.().extensions ?? [];
  } catch {
    return [...byName.values()];
  }

  for (const extension of extensions) {
    for (const [entryName, rawTool] of mindosExtensionToolEntries(extension.tools)) {
      const tool = mindosExtensionToolDefinition(rawTool);
      if (!tool) continue;
      const name = typeof tool.name === 'string' ? tool.name : entryName;
      if (!name || byName.has(name) || typeof tool.execute !== 'function') continue;
      byName.set(name, createMindosExecutableToolFromExtension(name, tool, input.extensionContext));
    }
  }

  return [...byName.values()];
}

function mindosExtensionToolEntries(tools: unknown): Array<[string | undefined, unknown]> {
  if (!tools) return [];
  if (tools instanceof Map) {
    return [...tools.entries()].map(([name, tool]) => [
      typeof name === 'string' ? name : undefined,
      tool,
    ]);
  }
  if (Array.isArray(tools)) {
    return tools.map((tool) => [
      isRecord(tool) && typeof tool.name === 'string' ? tool.name : undefined,
      tool,
    ]);
  }
  if (isRecord(tools)) {
    return Object.entries(tools).map(([name, tool]) => [name, tool]);
  }
  return [];
}

function mindosExtensionToolDefinition(rawTool: unknown): MindosExtensionToolDefinition | null {
  if (!isRecord(rawTool)) return null;
  const wrappedDefinition = rawTool.definition;
  if (isRecord(wrappedDefinition)) return wrappedDefinition as MindosExtensionToolDefinition;
  return rawTool as MindosExtensionToolDefinition;
}

function createMindosExecutableToolFromExtension(
  name: string,
  tool: MindosExtensionToolDefinition,
  extensionContext: Record<string, unknown>,
): MindosExecutableTool {
  const execute = tool.execute as MindosExtensionToolExecute;
  const prepareArguments = typeof tool.prepareArguments === 'function'
    ? tool.prepareArguments as (args: unknown) => unknown
    : undefined;

  return {
    name,
    description: typeof tool.description === 'string' ? tool.description : undefined,
    parameters: tool.parameters,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const preparedArgs = prepareArguments ? prepareArguments(args) : args;
      const result = await execute.call(tool, toolCallId, preparedArgs, signal, onUpdate, extensionContext);
      return normalizeMindosExecutableToolResult(result);
    },
  };
}

function normalizeMindosExecutableToolResult(result: unknown): {
  content: Array<{ type: string; text?: string }>;
} {
  if (isRecord(result) && Array.isArray(result.content)) {
    return {
      content: result.content
        .filter(isRecord)
        .map((part) => ({
          type: typeof part.type === 'string' ? part.type : 'text',
          ...(typeof part.text === 'string' ? { text: part.text } : {}),
        })),
    };
  }
  if (typeof result === 'string') return { content: [{ type: 'text', text: result }] };
  if (result == null) return { content: [] };
  return { content: [{ type: 'text', text: stringifyMindosToolResult(result) }] };
}

function stringifyMindosToolResult(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
