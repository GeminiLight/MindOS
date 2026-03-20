/**
 * Phase 3: Context management — token estimation, compaction, tool output truncation.
 *
 * All operations are request-scoped (no persistence to frontend session).
 * Uses pi-ai types (AgentMessage from pi-agent-core, complete from pi-ai).
 */
import { complete, type Model } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ToolResultMessage, AssistantMessage, UserMessage } from '@mariozechner/pi-ai';

// ---------------------------------------------------------------------------
// Token estimation (1 token ≈ 4 chars)
// ---------------------------------------------------------------------------

/** Rough token count for a single AgentMessage */
function messageTokens(msg: AgentMessage): number {
  if ('content' in msg) {
    const content = (msg as any).content;
    if (typeof content === 'string') return Math.ceil(content.length / 4);
    if (Array.isArray(content)) {
      let chars = 0;
      for (const part of content) {
        if ('text' in part && typeof part.text === 'string') chars += part.text.length;
        if ('args' in part) chars += JSON.stringify(part.args).length;
      }
      return Math.ceil(chars / 4);
    }
  }
  return 0;
}

/** Estimate total tokens for a message array */
export function estimateTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const m of messages) total += messageTokens(m);
  return total;
}

/** Estimate tokens for a plain string (e.g. system prompt) */
export function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Context limits by model family
// ---------------------------------------------------------------------------

const MODEL_LIMITS: Record<string, number> = {
  'claude': 200_000,
  'gpt-4o': 128_000,
  'gpt-4': 128_000,
  'gpt-3.5': 16_000,
  'gpt-5': 200_000,
};

// Sort by prefix length descending so "gpt-4o" matches before "gpt-4"
const MODEL_LIMIT_ENTRIES = Object.entries(MODEL_LIMITS)
  .sort((a, b) => b[0].length - a[0].length);

/** Get context token limit for a model string */
export function getContextLimit(model: string): number {
  const lower = model.toLowerCase();
  for (const [prefix, limit] of MODEL_LIMIT_ENTRIES) {
    if (lower.includes(prefix)) return limit;
  }
  return 100_000; // conservative default
}

/** Check if messages + system prompt exceed threshold of context limit */
export function needsCompact(
  messages: AgentMessage[],
  systemPrompt: string,
  model: string,
  threshold = 0.7,
): boolean {
  const total = estimateTokens(messages) + estimateStringTokens(systemPrompt);
  const limit = getContextLimit(model);
  return total > limit * threshold;
}

// ---------------------------------------------------------------------------
// Tool output truncation (per-tool-type thresholds)
// ---------------------------------------------------------------------------

const TOOL_OUTPUT_LIMITS: Record<string, number> = {
  // List/search tools — only need to know "what was found"
  search: 500,
  list_files: 500,
  get_recent: 500,
  get_backlinks: 500,
  get_history: 500,
  // Read tools — some context value, but not full file
  read_file: 2000,
  get_file_at_version: 2000,
  // Write tools — only need success/failure
  write_file: 200,
  create_file: 200,
  delete_file: 200,
  rename_file: 200,
  move_file: 200,
  append_to_file: 200,
  insert_after_heading: 200,
  update_section: 200,
  append_csv: 200,
};

/**
 * Truncate tool outputs in historical messages to save tokens.
 * Only truncates non-last toolResult messages (the last one is kept intact
 * because the model may need its full output for the current step).
 */
export function truncateToolOutputs(messages: AgentMessage[]): AgentMessage[] {
  // Find the index of the last 'toolResult' role message
  let lastToolIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as any).role === 'toolResult') { lastToolIdx = i; break; }
  }

  return messages.map((msg, idx) => {
    const m = msg as any;
    if (m.role !== 'toolResult' || idx === lastToolIdx) return msg;

    const toolMsg = m as ToolResultMessage;
    const toolName = toolMsg.toolName ?? '';
    const limit = TOOL_OUTPUT_LIMITS[toolName] ?? 500;

    // Truncate text content in toolResult
    const truncatedContent = toolMsg.content.map(part => {
      if (part.type !== 'text') return part;
      if (part.text.length <= limit) return part;
      return {
        ...part,
        text: part.text.slice(0, limit) + `\n[...truncated from ${part.text.length} chars]`,
      };
    });

    return { ...toolMsg, content: truncatedContent } as AgentMessage;
  });
}

// ---------------------------------------------------------------------------
// Compact: summarize early messages via LLM
// ---------------------------------------------------------------------------

const COMPACT_PROMPT = `Summarize the key points, decisions, and file operations from this conversation in under 500 words. Focus on:
- What the user asked for
- What files were read, created, or modified
- Key decisions and outcomes
- Any unresolved issues

Be concise and factual. Output only the summary, no preamble.`;

/** Extract a short text representation from an AgentMessage for summarization */
function messageToText(m: AgentMessage): string {
  const msg = m as any;
  const role = msg.role;
  let content = '';

  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    const pieces: string[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        pieces.push(part.text);
      } else if (part.type === 'toolCall' && 'toolName' in part) {
        pieces.push(`[Tool: ${part.toolName}]`);
      }
    }
    content = pieces.filter(Boolean).join(' ');
  }
  return `${role}: ${content}`;
}

/**
 * Compact messages by summarizing early ones with LLM.
 * Returns a new message array with early messages replaced by a summary.
 * Only called when needsCompact() returns true.
 *
 * Uses pi-ai complete() for summarization.
 */
export async function compactMessages(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
  systemPrompt: string,
  modelName: string,
): Promise<{ messages: AgentMessage[]; compacted: boolean }> {
  if (messages.length < 6) {
    return { messages, compacted: false };
  }

  // Keep the last 6 messages intact, summarize the rest.
  // Adjust split point to avoid cutting between an assistant (with tool calls)
  // and its tool result.
  let splitIdx = messages.length - 6;
  while (splitIdx > 0 && (messages[splitIdx] as any).role === 'toolResult') {
    splitIdx--;
  }
  if (splitIdx < 2) {
    return { messages, compacted: false };
  }
  const earlyMessages = messages.slice(0, splitIdx);
  const recentMessages = messages.slice(splitIdx);

  // Build a text representation of early messages for summarization
  let earlyText = earlyMessages.map(messageToText).join('\n\n');

  // Truncate if enormous (avoid sending too much to summarizer)
  if (earlyText.length > 30_000) {
    earlyText = earlyText.slice(0, 30_000) + '\n[...truncated]';
  }

  try {
    const summaryMessage = await complete(model, {
      messages: [{
        role: 'user',
        content: `${COMPACT_PROMPT}\n\n---\n\nConversation to summarize:\n\n${earlyText}`,
        timestamp: Date.now(),
      }],
    }, { apiKey });

    const summaryText = summaryMessage.content
      .filter(p => p.type === 'text')
      .map(p => (p as any).text)
      .join('');

    console.log(`[ask] Compacted ${earlyMessages.length} early messages into summary (${summaryText.length} chars)`);

    const summaryContent = `[Summary of earlier conversation]\n\n${summaryText}`;

    // If first recent message is also 'user', merge summary into it to avoid
    // consecutive user messages (Anthropic rejects user→user sequences).
    if ((recentMessages[0] as any)?.role === 'user') {
      const merged = { ...(recentMessages[0] as any) };
      if (typeof merged.content === 'string') {
        merged.content = `${summaryContent}\n\n---\n\n${merged.content}`;
      } else if (Array.isArray(merged.content)) {
        merged.content = [{ type: 'text' as const, text: `${summaryContent}\n\n---\n\n` }, ...merged.content];
      } else {
        merged.content = summaryContent;
      }
      return {
        messages: [merged as AgentMessage, ...recentMessages.slice(1)],
        compacted: true,
      };
    }

    // Otherwise prepend as separate user message
    const summaryMsg: UserMessage = {
      role: 'user',
      content: summaryContent,
      timestamp: Date.now(),
    };

    return {
      messages: [summaryMsg as AgentMessage, ...recentMessages],
      compacted: true,
    };
  } catch (err) {
    // API failure: fall back to hard prune instead of risking context overflow
    console.warn('[ask] Compact failed, applying hard prune as fallback:', err);
    const pruned = hardPrune(messages, systemPrompt, modelName);
    if (pruned.length < messages.length) {
      console.log(`[ask] Hard prune fallback succeeded (${messages.length} → ${pruned.length} messages)`);
      return { messages: pruned, compacted: false };
    }
    // If pruning also can't help, let it bubble up so request fails safely
    throw new Error(`Context compaction failed and pruning insufficient: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Hard prune: drop earliest messages as last resort (>90% context)
// ---------------------------------------------------------------------------

/**
 * Hard prune: if still over 90% context after compact, drop earliest messages.
 * Respects assistant-tool pairs: never cuts between an assistant message
 * (containing tool calls) and its following tool result message.
 */
export function hardPrune(
  messages: AgentMessage[],
  systemPrompt: string,
  model: string,
): AgentMessage[] {
  const limit = getContextLimit(model);
  const threshold = limit * 0.9;
  const systemTokens = estimateStringTokens(systemPrompt);

  let total = systemTokens + estimateTokens(messages);
  if (total <= threshold) return messages;

  // Find the cut index: keep messages from cutIdx onward
  let cutIdx = 0;
  while (cutIdx < messages.length - 2 && total > threshold) {
    total -= messageTokens(messages[cutIdx]);
    cutIdx++;
  }

  // Ensure we don't cut between an assistant (with tool calls) and its tool result.
  while (cutIdx < messages.length - 1 && (messages[cutIdx] as any).role === 'toolResult') {
    total -= messageTokens(messages[cutIdx]);
    cutIdx++;
  }

  // Ensure first message is 'user' (Anthropic requirement)
  while (cutIdx < messages.length - 1 && (messages[cutIdx] as any).role !== 'user') {
    total -= messageTokens(messages[cutIdx]);
    cutIdx++;
  }

  // Fallback: if no user message found in remaining messages, inject a synthetic one
  const pruned = cutIdx > 0 ? messages.slice(cutIdx) : messages;
  if (pruned.length > 0 && (pruned[0] as any).role !== 'user') {
    console.log(`[ask] Hard pruned ${cutIdx} messages, injecting synthetic user message (${messages.length} → ${pruned.length + 1})`);
    const syntheticUser: UserMessage = {
      role: 'user',
      content: '[Conversation context was pruned due to length. Continuing from here.]',
      timestamp: Date.now(),
    };
    return [syntheticUser as AgentMessage, ...pruned];
  }

  if (cutIdx > 0) {
    console.log(`[ask] Hard pruned ${cutIdx} messages (${messages.length} → ${messages.length - cutIdx})`);
    return pruned;
  }

  return messages;
}

// ---------------------------------------------------------------------------
// transformContext factory — for Agent's transformContext hook
// ---------------------------------------------------------------------------

/**
 * Create a transformContext function that captures the model and apiKey via closure.
 * Agent calls this before each LLM call to manage context window.
 */
export function createTransformContext(
  systemPrompt: string,
  modelName: string,
  getCompactModel: () => Model<any>,
  apiKey: string,
  contextStrategy: string,
) {
  return async (messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> => {
    // 1. Truncate tool outputs in historical messages
    let result = truncateToolOutputs(messages);

    const preTokens = estimateTokens(result);
    const sysTokens = estimateStringTokens(systemPrompt);
    const ctxLimit = getContextLimit(modelName);
    console.log(`[ask] Context: ~${preTokens + sysTokens} tokens (messages=${preTokens}, system=${sysTokens}), limit=${ctxLimit}`);

    // 2. Compact if >70% context limit (skip if user disabled)
    if (contextStrategy === 'auto' && needsCompact(result, systemPrompt, modelName)) {
      console.log('[ask] Context >70% limit, compacting...');
      const compactResult = await compactMessages(
        result,
        getCompactModel(),
        apiKey,
        systemPrompt,
        modelName,
      );
      result = compactResult.messages;
      if (compactResult.compacted) {
        const postTokens = estimateTokens(result);
        console.log(`[ask] After compact: ~${postTokens + sysTokens} tokens`);
      } else {
        console.log('[ask] Compact skipped (too few messages or fallback used), hard prune will handle overflow if needed');
      }
    }

    // 3. Hard prune if still >90% context limit
    result = hardPrune(result, systemPrompt, modelName);

    return result;
  };
}
