import { describe, expect, it } from 'vitest';
import { requiresBrowserBridgeCapture } from '@/lib/browser-bridge';

describe('requiresBrowserBridgeCapture', () => {
  it('routes logged-in AI sessions and social collections through the browser bridge', () => {
    expect(requiresBrowserBridgeCapture('https://chatgpt.com/share/6a4403f0-62f8-83ea-95fb-926fb268f639')).toBe(true);
    expect(requiresBrowserBridgeCapture('https://chat.openai.com/c/abc')).toBe(true);
    expect(requiresBrowserBridgeCapture('https://claude.ai/chat/abc')).toBe(true);
    expect(requiresBrowserBridgeCapture('https://www.xiaohongshu.com/user/profile/abc')).toBe(true);
    expect(requiresBrowserBridgeCapture('https://xhslink.com/a/abc')).toBe(true);
    expect(requiresBrowserBridgeCapture('https://mp.weixin.qq.com/s/example')).toBe(true);
  });

  it('keeps ordinary public URLs on the server-side clip path', () => {
    expect(requiresBrowserBridgeCapture('https://example.com/article')).toBe(false);
    expect(requiresBrowserBridgeCapture('https://github.com/GeminiLight/MindOS')).toBe(false);
    expect(requiresBrowserBridgeCapture('not a url')).toBe(false);
  });
});
