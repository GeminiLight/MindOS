import { describe, expect, it } from 'vitest';
import {
  AI_CONVERSATION_PLATFORMS,
  buildConversationHtml,
  detectAiConversationPlatform,
  normalizeRole,
  type AiConversationMessage,
} from '../packages/browser-extension/src/content/ai-conversation';
import { toClipDocument } from '../packages/browser-extension/src/lib/markdown';
import type { PageContent } from '../packages/browser-extension/src/lib/types';

describe('browser extension AI conversation capture helpers', () => {
  it('recognizes the requested mainstream AI chat platforms by URL', () => {
    expect(detectAiConversationPlatform('https://chatgpt.com/c/abc')?.id).toBe('chatgpt');
    expect(detectAiConversationPlatform('https://chat.openai.com/c/abc')?.id).toBe('chatgpt');
    expect(detectAiConversationPlatform('https://claude.ai/chat/abc')?.id).toBe('claude');
    expect(detectAiConversationPlatform('https://gemini.google.com/app/abc')?.id).toBe('gemini');
    expect(detectAiConversationPlatform('https://chat.deepseek.com/a/chat/s/abc')?.id).toBe('deepseek');
    expect(detectAiConversationPlatform('https://kimi.moonshot.cn/chat/abc')?.id).toBe('kimi');
    expect(detectAiConversationPlatform('https://chat.qwen.ai/c/abc')?.id).toBe('qwen');
    expect(detectAiConversationPlatform('https://chatglm.cn/main/alltoolsdetail')?.id).toBe('zhipu');
    expect(detectAiConversationPlatform('https://chat.minimax.io/chat/abc')?.id).toBe('minimax');
  });

  it('keeps platform profiles scoped and selector-backed', () => {
    const profileIds = AI_CONVERSATION_PLATFORMS.map(platform => platform.id);
    expect(profileIds).toEqual([
      'chatgpt',
      'claude',
      'gemini',
      'deepseek',
      'kimi',
      'qwen',
      'zhipu',
      'minimax',
    ]);
    for (const platform of AI_CONVERSATION_PLATFORMS) {
      expect(platform.domains.length).toBeGreaterThan(0);
      expect(platform.messageSelectors.length).toBeGreaterThan(0);
      expect(platform.userSelectors.length).toBeGreaterThan(0);
      expect(platform.assistantSelectors.length).toBeGreaterThan(0);
    }
  });

  it('normalizes common role labels and platform markers', () => {
    expect(normalizeRole('data-message-author-role=user')).toBe('user');
    expect(normalizeRole('assistant-message')).toBe('assistant');
    expect(normalizeRole('font-claude-response')).toBe('assistant');
    expect(normalizeRole('system')).toBe('system');
    expect(normalizeRole('neutral')).toBe('unknown');
  });

  it('formats conversation HTML with stable role sections', () => {
    const platform = detectAiConversationPlatform('https://chatgpt.com/c/abc');
    expect(platform).toBeTruthy();
    const messages: AiConversationMessage[] = [
      { role: 'user', html: '<p>Hello</p>', text: 'Hello' },
      { role: 'assistant', html: '<pre><code>world()</code></pre>', text: 'world()' },
    ];

    const html = buildConversationHtml(messages, platform!);

    expect(html).toContain('data-mindos-ai-conversation="true"');
    expect(html).toContain('data-mindos-message-role="user"');
    expect(html).toContain('<h2>ChatGPT</h2>');
    expect(html).toContain('<pre><code>world()</code></pre>');
  });

  it('writes AI conversations as canonical MindOS session frontmatter', () => {
    const page: PageContent = {
      title: 'Debug a sync issue',
      byline: null,
      excerpt: null,
      content: '<section><h2>User</h2><p>Why did sync fail?</p></section><section><h2>DeepSeek</h2><p>Check the token.</p></section>',
      textContent: 'User: Why did sync fail?\nDeepSeek: Check the token.',
      siteName: 'DeepSeek',
      url: 'https://chat.deepseek.com/a/chat/s/123',
      savedAt: '2026-06-17T10:30:00.000Z',
      wordCount: 9,
      captureType: 'ai-conversation',
      sourceType: 'session',
      sourcePlatform: 'deepseek',
      sourcePlatformLabel: 'DeepSeek',
      messageCount: 2,
    };

    const doc = toClipDocument(page, '', html => html.replace(/<[^>]+>/g, '').trim());

    expect(doc.source).toBe('ai-conversation-clipper');
    expect(doc.markdown).toContain('type: log');
    expect(doc.markdown).toContain('source_type: session');
    expect(doc.markdown).toContain('source_url: "https://chat.deepseek.com/a/chat/s/123"');
    expect(doc.markdown).toContain('source_platform: deepseek');
    expect(doc.markdown).toContain('captured_at: "2026-06-17T10:30:00.000Z"');
    expect(doc.markdown).toContain('> Captured from DeepSeek (2 messages).');
  });
});
