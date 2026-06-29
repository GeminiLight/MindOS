import crypto from 'crypto';

export type AiTaskMode = 'chat' | 'structured' | 'agent';

export type AiTaskMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiTaskPolicy = {
  tools: 'none' | 'read-only' | 'write-gated' | 'full-agent';
  sideEffects: 'none' | 'state-only' | 'user-confirmed';
  requireSourceRefs?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
};

export type AiTaskModelProfile = 'fast-structured' | 'deep-structured' | 'chat' | 'agent';

export type AiTaskDefinition<TInput, TOutput> = {
  id: string;
  mode: AiTaskMode;
  promptVersion: string;
  modelProfile: AiTaskModelProfile;
  policy: AiTaskPolicy;
  buildMessages: (input: TInput) => AiTaskMessage[];
  validateOutput: (output: unknown, input: TInput) => TOutput;
};

export type AiTaskRunOptions = {
  signal?: AbortSignal;
  providerOverride?: string;
  modelOverride?: string;
};

export type AiTaskRunResult<TOutput> = {
  taskId: string;
  promptVersion: string;
  modelProfile: AiTaskModelProfile;
  mode: AiTaskMode;
  model: {
    provider: string;
    name: string;
  };
  output: TOutput;
  trace: {
    startedAt: string;
    completedAt: string;
    inputHash: string;
    outputHash: string;
  };
};

export type AiTaskModelClient = {
  completeText(input: {
    taskId: string;
    promptVersion: string;
    messages: AiTaskMessage[];
    modelProfile: AiTaskModelProfile;
    signal?: AbortSignal;
    providerOverride?: string;
    modelOverride?: string;
  }): Promise<{
    text: string;
    model: {
      provider: string;
      name: string;
    };
  }>;
};

export type AiTaskRunnerLike = {
  run<TInput, TOutput>(
    task: AiTaskDefinition<TInput, TOutput>,
    input: TInput,
    options?: AiTaskRunOptions,
  ): Promise<AiTaskRunResult<TOutput>>;
};

export class AiTaskRunner implements AiTaskRunnerLike {
  constructor(private readonly modelClient: AiTaskModelClient) {}

  async run<TInput, TOutput>(
    task: AiTaskDefinition<TInput, TOutput>,
    input: TInput,
    options: AiTaskRunOptions = {},
  ): Promise<AiTaskRunResult<TOutput>> {
    validateRunnableTask(task);
    const startedAt = new Date().toISOString();
    const messages = task.buildMessages(input);
    const inputHash = stableHash(JSON.stringify({ taskId: task.id, promptVersion: task.promptVersion, input }));
    const completion = await this.modelClient.completeText({
      taskId: task.id,
      promptVersion: task.promptVersion,
      messages,
      modelProfile: task.modelProfile,
      signal: options.signal,
      providerOverride: options.providerOverride,
      modelOverride: options.modelOverride,
    });
    const parsed = parseJsonObject(completion.text);
    const output = task.validateOutput(parsed, input);
    const completedAt = new Date().toISOString();

    return {
      taskId: task.id,
      promptVersion: task.promptVersion,
      modelProfile: task.modelProfile,
      mode: task.mode,
      model: completion.model,
      output,
      trace: {
        startedAt,
        completedAt,
        inputHash,
        outputHash: stableHash(JSON.stringify(output)),
      },
    };
  }
}

function validateRunnableTask<TInput, TOutput>(task: AiTaskDefinition<TInput, TOutput>): void {
  if (task.mode === 'agent') {
    throw new Error('AiTaskRunner does not execute agent-mode tasks. Use AgentRuntime for multi-step tool workflows.');
  }
  if (task.policy.tools !== 'none') {
    throw new Error(`AiTaskRunner only supports tool-free tasks. Task "${task.id}" requested ${task.policy.tools}.`);
  }
  if (task.policy.sideEffects !== 'none') {
    throw new Error(`AiTaskRunner only supports side-effect-free tasks. Task "${task.id}" requested ${task.policy.sideEffects}.`);
  }
}

export function parseJsonObject(raw: string): unknown {
  const cleaned = stripMarkdownJsonFence(raw.trim());
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectStart = cleaned.indexOf('{');
    const objectEnd = cleaned.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error('AI task output is not valid JSON.');
  }
}

function stripMarkdownJsonFence(value: string): string {
  if (!value.startsWith('```')) return value;
  const firstNewline = value.indexOf('\n');
  if (firstNewline < 0) return value;
  let next = value.slice(firstNewline + 1).trim();
  if (next.endsWith('```')) next = next.slice(0, -3).trim();
  return next;
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
