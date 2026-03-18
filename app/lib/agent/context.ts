/**
 * Phase 3: Context management — token estimation, compaction, tool output truncation.
 *
 * All operations are request-scoped (no persistence to frontend session).
 */
import { generateText, type ModelMessage, type ToolResultPart, type ToolModelMessage } from 'ai';
import type { LanguageModel } from 'ai';

// ---------------------------------------------------------------------------
// Token estimation (1 token ≈ 4 chars)
// ---------------------------------------------------------------------------

/** Rough token count for a single ModelMessage */
function messageTokens(msg: ModelMessage): number {
  if (typeof msg.content === 'string') return Math.ceil(msg.content.length / 4);
  if (Array.isArray(msg.content)) {
    let chars = 0;
    for (const part of msg.content) {
      if ('text' in part && typeof part.text === 'string') chars += part.text.length;
      if ('value' in part && typeof part.value === 'string') chars += part.value.length;
      if ('input' in part) chars += JSON.stringify(part.input).length;
    }
    return Math.ceil(chars / 4);
  }
  return 0;
}

/** Estimate total tokens for a message array */
export function estimateTokens(messages: ModelMessage[]): number {
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
  messages: ModelMessage[],
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
 * Only truncates non-last tool messages (the last tool message is kept intact
 * because the model may need its full output for the current step).
 */
export function truncateToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  // Find the index of the last 'tool' role message
  let lastToolIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') { lastToolIdx = i; break; }
  }

  return messages.map((msg, idx) => {
    if (msg.role !== 'tool' || idx === lastToolIdx) return msg;

    const toolMsg = msg as ToolModelMessage;
    const truncatedContent = toolMsg.content.map(part => {
      if (part.type !== 'tool-result') return part;
      const trp = part as ToolResultPart;
      const toolName = trp.toolName ?? '';
      const limit = TOOL_OUTPUT_LIMITS[toolName] ?? 500;
      if (!trp.output || typeof trp.output !== 'object' || trp.output.type !== 'text') return part;
      if (trp.output.value.length <= limit) return part;

      return {
        ...trp,
        output: {
          ...trp.output,
          value: trp.output.value.slice(0, limit) + `\n[...truncated from ${trp.output.value.length} chars]`,
        },
      } satisfies ToolResultPart;
    });

    return { ...toolMsg, content: truncatedContent } satisfies ToolModelMessage;
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

/** Extract a short text representation from a ModelMessage for summarization */
function messageToText(m: ModelMessage): string {
  const role = m.role;
  let content = '';
  if (typeof m.content === 'string') {
    content = m.content;
  } else if (Array.isArray(m.content)) {
    const pieces: string[] = [];
    for (const part of m.content) {
      if ('text' in part && typeof (part as { text?: string }).text === 'string') {
        pieces.push((part as { text: string }).text);
      } else if (part.type === 'tool-call' && 'toolName' in part) {
        pieces.push(`[Tool: ${(part as { toolName: string }).toolName}]`);
      } else if (part.type === 'tool-result' && 'output' in part) {
        const trp = part as ToolResultPart;
        const val = trp.output && typeof trp.output === 'object' && trp.output.type === 'text' ? trp.output.value : '';
        pieces.push(`[Result: ${val.slice(0, 200)}]`);
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
 * NOTE: Currently uses the same model as the main generation. A cheaper model
 * (e.g. haiku) would suffice for summarization and avoid competing for rate
 * limits. Deferred until users report rate-limit issues — compact triggers
 * infrequently (>70% context fill).
 */
export async function compactMessages(
  messages: ModelMessage[],
  model: LanguageModel,
): Promise<{ messages: ModelMessage[]; compacted: boolean }> {
  if (messages.length < 6) {
    return { messages, compacted: false };
  }

  // Keep the last 6 messages intact, summarize the rest.
  // Adjust split point to avoid cutting between an assistant (with tool calls)
  // and its tool result. Only need to check for orphaned 'tool' messages —
  // an assistant at the split point is safe because its tool results follow it.
  // (Orphaned assistants without results can't exist in history: only completed
  // tool calls are persisted by the frontend.)
  let splitIdx = messages.length - 6;
  while (splitIdx > 0 && messages[splitIdx]?.role === 'tool') {
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
    const { text: summary } = await generateText({
      model,
      prompt: `${COMPACT_PROMPT}\n\n---\n\nConversation to summarize:\n\n${earlyText}`,
    });

    console.log(`[ask] Compacted ${earlyMessages.length} early messages into summary (${summary.length} chars)`);

    const summaryText = `[Summary of earlier conversation]\n\n${summary}`;

    // If first recent message is also 'user', merge summary into it to avoid
    // consecutive user messages (Anthropic rejects user→user sequences).
    if (recentMessages[0]?.role === 'user') {
      const merged = { ...recentMessages[0] };
      if (typeof merged.content === 'string') {
        merged.content = `${summaryText}\n\n---\n\n${merged.content}`;
      } else if (Array.isArray(merged.content)) {
        // Multimodal content (e.g. images) — prepend summary as text part
        merged.content = [{ type: 'text' as const, text: `${summaryText}\n\n---\n\n` }, ...merged.content];
      } else {
        merged.content = summaryText;
      }
      return {
        messages: [merged, ...recentMessages.slice(1)],
        compacted: true,
      };
    }

    // Otherwise prepend as separate user message
    const summaryMessage: ModelMessage = {
      role: 'user',
      content: summaryText,
    };

    return {
      messages: [summaryMessage, ...recentMessages],
      compacted: true,
    };
  } catch (err) {
    console.error('[ask] Compact failed, using uncompacted messages:', err);
    return { messages, compacted: false };
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
  messages: ModelMessage[],
  systemPrompt: string,
  model: string,
): ModelMessage[] {
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
  // If cutIdx lands on a 'tool' message, advance past it so the pair stays together
  // or is fully removed.
  while (cutIdx < messages.length - 1 && messages[cutIdx].role === 'tool') {
    total -= messageTokens(messages[cutIdx]);
    cutIdx++;
  }

  // Ensure first message is 'user' (Anthropic requirement)
  while (cutIdx < messages.length - 1 && messages[cutIdx].role !== 'user') {
    total -= messageTokens(messages[cutIdx]);
    cutIdx++;
  }

  // Fallback: if no user message found in remaining messages, inject a synthetic one
  const pruned = cutIdx > 0 ? messages.slice(cutIdx) : messages;
  if (pruned.length > 0 && pruned[0].role !== 'user') {
    console.log(`[ask] Hard pruned ${cutIdx} messages, injecting synthetic user message (${messages.length} → ${pruned.length + 1})`);
    return [{ role: 'user', content: '[Conversation context was pruned due to length. Continuing from here.]' } as ModelMessage, ...pruned];
  }

  if (cutIdx > 0) {
    console.log(`[ask] Hard pruned ${cutIdx} messages (${messages.length} → ${messages.length - cutIdx})`);
    return pruned;
  }

  return messages;
}
