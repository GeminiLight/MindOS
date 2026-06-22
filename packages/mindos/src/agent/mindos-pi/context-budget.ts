import type {
  MindosAgentHistoryMessage,
  MindOSSSEvent,
} from '../turn/index.js';

export const MINDOS_PI_DEFAULT_CONTEXT_WINDOW = 128_000;
export const MINDOS_PI_DEFAULT_RESERVE_TOKENS = 16_384;
export const MINDOS_PI_DEFAULT_KEEP_RECENT_TOKENS = 20_000;
export const MINDOS_PI_MIN_RESERVE_TOKENS = 512;

const PRUNE_NOTE = '[MindOS context preflight: older chat history was pruned before this request to avoid overflowing the model context window.]';
const TRUNCATION_NOTE = '\n\n[MindOS context preflight: middle content omitted to stay within the model context window.]\n\n';

export type MindosPiContextBudgetAction =
  | 'none'
  | 'prompt_compacted'
  | 'prompt_truncated'
  | 'history_pruned'
  | 'prompt_compacted_history_pruned'
  | 'prompt_truncated_history_pruned';

export type MindosPiContextUsageEvent = Extract<MindOSSSEvent, { type: 'context_usage' }>;

export type PrepareMindosPiContextBudgetOptions = {
  systemPrompt: string;
  turnPrompt: string;
  historyMessages: MindosAgentHistoryMessage[];
  model: unknown;
  modelName: string;
  estimateTokens(content: string): number;
  compactPrompt?: (
    prompt: string,
    options: {
      maxPromptTokens: number;
      estimateTokens(content: string): number;
      onStrip?(section: string, sectionTokens: number): void;
    },
  ) => string;
  reserveTokens?: number;
  keepRecentTokens?: number;
};

export type PreparedMindosPiContextBudget = {
  systemPrompt: string;
  turnPrompt: string;
  historyMessages: MindosAgentHistoryMessage[];
  usage: MindosPiContextUsageEvent;
};

export function resolveMindosPiContextWindow(model: unknown): number {
  if (isRecord(model)) {
    const value = model.contextWindow;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return MINDOS_PI_DEFAULT_CONTEXT_WINDOW;
}

export function resolveMindosPiReserveTokens(contextWindow: number, reserveTokens?: number): number {
  const explicitReserve = positiveInteger(reserveTokens);
  if (explicitReserve !== undefined) return Math.min(explicitReserve, Math.max(0, contextWindow - 1));
  if (contextWindow <= 0) return 0;
  return Math.min(
    MINDOS_PI_DEFAULT_RESERVE_TOKENS,
    Math.max(MINDOS_PI_MIN_RESERVE_TOKENS, Math.floor(contextWindow * 0.2)),
  );
}

export function prepareMindosPiContextBudget(
  options: PrepareMindosPiContextBudgetOptions,
): PreparedMindosPiContextBudget {
  const contextWindow = resolveMindosPiContextWindow(options.model);
  const reserveTokens = resolveMindosPiReserveTokens(contextWindow, options.reserveTokens);
  const keepRecentTokens = positiveInteger(options.keepRecentTokens) ?? MINDOS_PI_DEFAULT_KEEP_RECENT_TOKENS;
  const budgetTokens = Math.max(0, contextWindow - reserveTokens);

  let turnPrompt = options.turnPrompt;
  const systemPrompt = options.systemPrompt;
  let historyMessages = options.historyMessages;

  const originalSystemPromptTokens = options.estimateTokens(systemPrompt);
  const originalTurnPromptTokens = options.estimateTokens(turnPrompt);
  const originalHistoryTokens = estimateHistoryTokens(historyMessages, options.estimateTokens);
  const originalUsedTokens = originalSystemPromptTokens + originalTurnPromptTokens + originalHistoryTokens;

  let promptAction: Extract<MindosPiContextBudgetAction, 'none' | 'prompt_compacted' | 'prompt_truncated'> = 'none';

  if (budgetTokens > 0 && originalSystemPromptTokens + originalTurnPromptTokens > budgetTokens) {
    const maxTurnPromptTokens = Math.max(0, budgetTokens - originalSystemPromptTokens);
    if (options.compactPrompt && maxTurnPromptTokens > 0 && maxTurnPromptTokens < originalTurnPromptTokens) {
      const compacted = options.compactPrompt(turnPrompt, {
        maxPromptTokens: maxTurnPromptTokens,
        estimateTokens: options.estimateTokens,
      });
      if (compacted.trim() && options.estimateTokens(compacted) < originalTurnPromptTokens) {
        turnPrompt = compacted;
        promptAction = 'prompt_compacted';
      }
    }

    const compactedTurnTokens = options.estimateTokens(turnPrompt);
    if (originalSystemPromptTokens + compactedTurnTokens > budgetTokens) {
      const truncated = truncateByEstimatedTokens(turnPrompt, maxTurnPromptTokens, options.estimateTokens);
      if (truncated !== turnPrompt) {
        turnPrompt = truncated;
        promptAction = 'prompt_truncated';
      }
    }
  }

  const systemPromptTokens = options.estimateTokens(systemPrompt);
  const turnPromptTokens = options.estimateTokens(turnPrompt);
  const maxHistoryTokens = Math.max(0, budgetTokens - systemPromptTokens - turnPromptTokens);
  const pruned = pruneHistoryToBudget(historyMessages, {
    maxHistoryTokens,
    keepRecentTokens,
    estimateTokens: options.estimateTokens,
  });
  historyMessages = pruned.historyMessages;
  const historyTokens = estimateHistoryTokens(historyMessages, options.estimateTokens);
  const usedTokens = systemPromptTokens + turnPromptTokens + historyTokens;
  const historyPruned = pruned.prunedMessages > 0;
  const action = combineActions(promptAction, historyPruned);

  return {
    systemPrompt,
    turnPrompt,
    historyMessages,
    usage: {
      type: 'context_usage',
      runtime: 'mindos',
      phase: 'preflight',
      action,
      modelName: options.modelName,
      percent: percentage(usedTokens, contextWindow),
      usedTokens,
      contextWindow,
      budgetTokens,
      reserveTokens,
      keepRecentTokens,
      systemPromptTokens,
      turnPromptTokens,
      historyTokens,
      originalUsedTokens,
      originalHistoryTokens,
      prunedMessages: pruned.prunedMessages,
      message: contextUsageMessage(action, usedTokens, contextWindow, pruned.prunedMessages),
    },
  };
}

export function estimateHistoryTokens(
  messages: MindosAgentHistoryMessage[],
  estimateTokens: (content: string) => number,
): number {
  return messages.reduce((total, message) => total + estimateTokens(historyMessageToText(message)), 0);
}

function pruneHistoryToBudget(input: MindosAgentHistoryMessage[], options: {
  maxHistoryTokens: number;
  keepRecentTokens: number;
  estimateTokens(content: string): number;
}): { historyMessages: MindosAgentHistoryMessage[]; prunedMessages: number } {
  if (input.length === 0) return { historyMessages: input, prunedMessages: 0 };
  if (options.maxHistoryTokens <= 0) {
    return { historyMessages: [], prunedMessages: input.length };
  }

  const messageTokens = input.map((message) => options.estimateTokens(historyMessageToText(message)));
  const currentTokens = messageTokens.reduce((sum, tokens) => sum + tokens, 0);
  if (currentTokens <= options.maxHistoryTokens) return { historyMessages: input, prunedMessages: 0 };

  // Keep the newest coherent suffix. The budget is the hard limit; keepRecent
  // only avoids over-pruning when the window is large enough for more history.
  const targetTokens = Math.min(
    options.maxHistoryTokens,
    Math.max(options.keepRecentTokens, Math.floor(options.maxHistoryTokens * 0.9)),
  );
  let cutIndex = 0;
  let remainingTokens = currentTokens;

  while (cutIndex < input.length && remainingTokens > targetTokens) {
    remainingTokens -= messageTokens[cutIndex] ?? 0;
    cutIndex += 1;
  }

  while (cutIndex < input.length && roleOf(input[cutIndex]) !== 'user') {
    remainingTokens -= messageTokens[cutIndex] ?? 0;
    cutIndex += 1;
  }

  while (cutIndex < input.length && remainingTokens > options.maxHistoryTokens) {
    remainingTokens -= messageTokens[cutIndex] ?? 0;
    cutIndex += 1;
    while (cutIndex < input.length && roleOf(input[cutIndex]) !== 'user') {
      remainingTokens -= messageTokens[cutIndex] ?? 0;
      cutIndex += 1;
    }
  }

  return buildPrunedHistorySuffix(input, cutIndex, options);
}

function buildPrunedHistorySuffix(input: MindosAgentHistoryMessage[], startIndex: number, options: {
  maxHistoryTokens: number;
  estimateTokens(content: string): number;
}): { historyMessages: MindosAgentHistoryMessage[]; prunedMessages: number } {
  let cutIndex = startIndex;
  while (cutIndex < input.length) {
    const candidate = prefixPruneNote(input.slice(cutIndex));
    if (estimateHistoryTokens(candidate, options.estimateTokens) <= options.maxHistoryTokens) {
      return {
        historyMessages: candidate,
        prunedMessages: cutIndex,
      };
    }
    cutIndex += 1;
    while (cutIndex < input.length && roleOf(input[cutIndex]) !== 'user') {
      cutIndex += 1;
    }
  }

  return { historyMessages: [], prunedMessages: input.length };
}

function prefixPruneNote(messages: MindosAgentHistoryMessage[]): MindosAgentHistoryMessage[] {
  if (messages.length === 0) return messages;
  const first = messages[0];
  if (!first) return messages;
  const rest = messages.slice(1);
  if (roleOf(first) !== 'user') {
    return [{ role: 'user', content: PRUNE_NOTE, timestamp: Date.now() }, ...messages];
  }

  const content = first.content;
  if (typeof content === 'string') {
    return [{ ...first, content: `${PRUNE_NOTE}\n\n${content}` }, ...rest];
  }
  if (Array.isArray(content)) {
    return [{
      ...first,
      content: [{ type: 'text', text: `${PRUNE_NOTE}\n\n` }, ...content],
    }, ...rest];
  }
  return [{ ...first, content: PRUNE_NOTE }, ...rest];
}

function combineActions(
  promptAction: Extract<MindosPiContextBudgetAction, 'none' | 'prompt_compacted' | 'prompt_truncated'>,
  historyPruned: boolean,
): MindosPiContextBudgetAction {
  if (promptAction === 'prompt_compacted' && historyPruned) return 'prompt_compacted_history_pruned';
  if (promptAction === 'prompt_truncated' && historyPruned) return 'prompt_truncated_history_pruned';
  if (historyPruned) return 'history_pruned';
  return promptAction;
}

function contextUsageMessage(
  action: MindosPiContextBudgetAction,
  usedTokens: number,
  contextWindow: number,
  prunedMessages: number,
): string {
  const percent = percentage(usedTokens, contextWindow);
  if (action === 'none') return `MindOS context preflight: ${percent}% of the model window is in use.`;
  const prunedText = prunedMessages > 0 ? `, pruned ${prunedMessages} old message${prunedMessages === 1 ? '' : 's'}` : '';
  return `MindOS prepared the context before sending (${percent}% used${prunedText}).`;
}

function truncateByEstimatedTokens(
  value: string,
  maxTokens: number,
  estimateTokens: (content: string) => number,
): string {
  if (maxTokens <= 0) return '';
  if (estimateTokens(value) <= maxTokens) return value;

  const noteTokens = estimateTokens(TRUNCATION_NOTE);
  if (noteTokens >= maxTokens) {
    return truncateEndByEstimatedTokens(value, maxTokens, estimateTokens);
  }

  let low = 1;
  let high = value.length - 1;
  let best = '';
  while (low <= high) {
    const totalChars = Math.floor((low + high) / 2);
    const headChars = Math.max(1, Math.floor(totalChars * 0.62));
    const tailChars = Math.max(0, totalChars - headChars);
    const candidate = `${value.slice(0, headChars).trimEnd()}${TRUNCATION_NOTE}${tailChars > 0 ? value.slice(-tailChars).trimStart() : ''}`;
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate;
      low = totalChars + 1;
    } else {
      high = totalChars - 1;
    }
  }

  return best || truncateEndByEstimatedTokens(value, maxTokens, estimateTokens);
}

function truncateEndByEstimatedTokens(
  value: string,
  maxTokens: number,
  estimateTokens: (content: string) => number,
): string {
  let low = 0;
  let high = value.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = value.slice(0, mid).trimEnd();
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function historyMessageToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(historyMessageToText).filter(Boolean).join('\n');
  if (!isRecord(value)) return '';

  const role = typeof value.role === 'string' ? value.role : '';
  const toolName = typeof value.toolName === 'string' ? value.toolName : '';
  const content = historyMessageToText(value.content);
  const args = 'arguments' in value ? stableJson(value.arguments) : '';
  const input = 'input' in value ? stableJson(value.input) : '';
  const output = typeof value.output === 'string' ? value.output : '';

  if (typeof value.text === 'string') return value.text;
  if (typeof value.data === 'string' && value.type === 'image') return '[image]';

  return [role, toolName, content, args, input, output].filter(Boolean).join('\n');
}

function stableJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function roleOf(message: MindosAgentHistoryMessage | undefined): string {
  return isRecord(message) && typeof message.role === 'string' ? message.role : '';
}

function percentage(usedTokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0;
  return Math.max(0, Math.ceil((usedTokens / contextWindow) * 100));
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
