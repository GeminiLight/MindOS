import { apiFetch } from '@/lib/api';
import { buildAgentTurnEndpoint, createTransientAgentSessionId } from '@/lib/agent-turn-endpoint';
import { isAiConfiguredForAgentTurn, type SettingsJsonForAi } from '@/lib/settings-ai-client';
import { notifyFilesChanged } from '@/lib/files-changed';
import { parseSseJsonData, parseSseText, readSseStream, type SseFrame } from '@/lib/sse/read-sse-stream';

/**
 * Check if AI is available by inspecting the active or explicitly selected provider.
 */
export async function checkAiAvailable(providerOverride?: string | null): Promise<boolean> {
  try {
    const data = await apiFetch<SettingsJsonForAi>('/api/settings', { cache: 'no-store' });
    return isAiConfiguredForAgentTurn(data, providerOverride);
  } catch {
    return false;
  }
}

function findSpaceAiInitFrameError(frame: SseFrame): string | null {
  const event = parseSseJsonData<{ type?: unknown; message?: unknown }>(frame);
  if (event?.type === 'error') return String(event.message || 'AI initialization failed');
  return null;
}

export function findSpaceAiInitStreamError(raw: string): string | null {
  for (const frame of parseSseText(raw)) {
    const error = findSpaceAiInitFrameError(frame);
    if (error) return error;
  }
  return null;
}

export async function consumeSpaceAiInitStream(body: ReadableStream<Uint8Array>): Promise<void> {
  await readSseStream(body, (frame) => {
    const error = findSpaceAiInitFrameError(frame);
    if (error) throw new Error(error);
  });
}

/**
 * Trigger AI to generate README.md and INSTRUCTION.md for a space.
 * Dispatches `mindos:ai-init` events consumed by SpaceInitToast.
 * The call is fire-and-forget — returns immediately after starting the stream.
 */
export function triggerSpaceAiInit(
  spaceName: string,
  spacePath: string,
  description = '',
): void {
  const isZh = typeof document !== 'undefined' && document.documentElement.lang === 'zh';
  const prompt = isZh
    ? `初始化新建的心智空间「${spaceName}」，路径为「${spacePath}/」。${description ? `描述：「${description}」。` : ''}两个文件均已存在模板，用 write_file 覆盖：\n1. 「${spacePath}/README.md」— 写入空间用途、结构概览、使用指南\n2. 「${spacePath}/INSTRUCTION.md」— 写入 AI Agent 在此空间中的行为规则和操作约定\n\n内容简洁实用，直接使用工具写入。`
    : `Initialize the new Mind Space "${spaceName}" at "${spacePath}/". ${description ? `Description: "${description}". ` : ''}Both files already exist with templates — use write_file to overwrite:\n1. "${spacePath}/README.md" — write purpose, structure overview, usage guidelines\n2. "${spacePath}/INSTRUCTION.md" — write rules for AI agents operating in this space\n\nKeep content concise and actionable. Write files directly using tools.`;

  window.dispatchEvent(new CustomEvent('mindos:ai-init', {
    detail: { spaceName, spacePath, description, state: 'working' },
  }));

  fetch(buildAgentTurnEndpoint(createTransientAgentSessionId('space-init')), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      currentFile: spacePath + '/INSTRUCTION.md',
    }),
  }).then(async (res) => {
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await consumeSpaceAiInitStream(res.body);
    window.dispatchEvent(new CustomEvent('mindos:ai-init', {
      detail: { spacePath, state: 'done' },
    }));
    notifyFilesChanged([`${spacePath}/INSTRUCTION.md`]);
  }).catch(() => {
    window.dispatchEvent(new CustomEvent('mindos:ai-init', {
      detail: { spacePath, state: 'error' },
    }));
  });
}
