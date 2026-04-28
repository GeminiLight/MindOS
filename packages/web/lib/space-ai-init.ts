import { apiFetch } from '@/lib/api';

/**
 * Check if AI is available by inspecting the active provider's API key.
 */
export async function checkAiAvailable(): Promise<boolean> {
  try {
    const data = await apiFetch<{
      ai?: { provider?: string; providers?: Record<string, { apiKey?: string }> };
    }>('/api/settings');
    const provider = data.ai?.provider ?? '';
    const providers = data.ai?.providers ?? {};
    const active = providers[provider as keyof typeof providers];
    return !!(active?.apiKey);
  } catch {
    return false;
  }
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

  fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      currentFile: spacePath + '/INSTRUCTION.md',
    }),
  }).then(async (res) => {
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    window.dispatchEvent(new CustomEvent('mindos:ai-init', {
      detail: { spacePath, state: 'done' },
    }));
    window.dispatchEvent(new Event('mindos:files-changed'));
  }).catch(() => {
    window.dispatchEvent(new CustomEvent('mindos:ai-init', {
      detail: { spacePath, state: 'error' },
    }));
  });
}
