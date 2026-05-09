export type MindosToolInputSchema = Record<string, unknown>;

export type MindosToolResult<TOutput = unknown> = {
  ok: boolean;
  output?: TOutput;
  error?: string;
};

export type MindosToolContext = {
  actor?: string;
  signal?: AbortSignal;
};

export type MindosToolDefinition<TInput = unknown, TOutput = unknown> = {
  id: string;
  description: string;
  inputSchema?: MindosToolInputSchema;
  permission?: string;
  run(input: TInput, context: MindosToolContext): Promise<MindosToolResult<TOutput>> | MindosToolResult<TOutput>;
};

export type MindosToolRegistry = {
  list(): MindosToolDefinition[];
  get(id: string): MindosToolDefinition | undefined;
  register(tool: MindosToolDefinition): void;
};

export function defineMindosTool<TInput = unknown, TOutput = unknown>(
  tool: MindosToolDefinition<TInput, TOutput>,
): MindosToolDefinition<TInput, TOutput> {
  if (!tool.id?.trim()) throw new Error('tool id is required');
  if (!tool.description?.trim()) throw new Error(`tool "${tool.id}" description is required`);
  return tool;
}

export function createMindosToolRegistry(initial: MindosToolDefinition[] = []): MindosToolRegistry {
  const tools = new Map<string, MindosToolDefinition>();
  const registry: MindosToolRegistry = {
    list() {
      return [...tools.values()];
    },
    get(id) {
      return tools.get(id);
    },
    register(tool) {
      if (tools.has(tool.id)) throw new Error(`tool already registered: ${tool.id}`);
      tools.set(tool.id, tool);
    },
  };

  for (const tool of initial) registry.register(tool);
  return registry;
}
