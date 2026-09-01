import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const extensionExtractor = readFileSync(
  resolve(testDir, '../../packages/browser-extension/extension/content/extractor.js'),
  'utf-8',
);

test.describe('browser extension generated AI conversation extractor', () => {
  test('captures ChatGPT-like DOM without mistaking the message list container for one message', async ({ browser }) => {
    const result = await extractGeneratedClipResult(browser, 'https://chatgpt.com/c/sync-debugging', `
      <!doctype html>
      <title>Sync debugging - ChatGPT</title>
      <main id="thread" class="message-list">
        <h1>Sync debugging</h1>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="user">
            <p>Why did sync fail?</p>
          </div>
        </article>
        <article data-testid="conversation-turn-2">
          <div data-message-author-role="assistant">
            <div class="markdown prose">
              <p>Check the local token and retry.</p>
              <button data-testid="copy-turn">Copy</button>
              <span aria-hidden="true">hidden decoration</span>
            </div>
          </div>
        </article>
      </main>
    `);

    expect(result.captureType).toBe('ai-conversation');
    expect(result.sourcePlatform).toBe('chatgpt');
    expect(result.messageCount).toBe(2);
    expect(result.title).toBe('Sync debugging');
    expect(result.textContent).toContain('User:\nWhy did sync fail?');
    expect(result.textContent).toContain('ChatGPT:\nCheck the local token and retry.');
    expect(result.textContent).not.toContain('Copy');
    expect(result.textContent).not.toContain('hidden decoration');
  });

  test('captures Gemini custom elements and preserves assistant code language classes', async ({ browser }) => {
    const result = await extractGeneratedClipResult(browser, 'https://gemini.google.com/app/test-session', `
      <!doctype html>
      <title>Code review - Gemini</title>
      <main id="chat-history">
        <h1>Code review</h1>
        <user-query>
          <user-query-content>Review this parser.</user-query-content>
        </user-query>
        <model-response>
          <message-content>
            <p>Keep the parser structured.</p>
            <pre><code class="language-ts">const role = "assistant";</code></pre>
          </message-content>
        </model-response>
      </main>
    `);

    expect(result.captureType).toBe('ai-conversation');
    expect(result.sourcePlatform).toBe('gemini');
    expect(result.messageCount).toBe(2);
    expect(result.textContent).toContain('User:\nReview this parser.');
    expect(result.textContent).toContain('Gemini:\nKeep the parser structured.');
    expect(result.content).toContain('class="language-ts"');
  });

  test('ignores CSS-hidden pre-rendered messages in generated extraction', async ({ browser }) => {
    const result = await extractGeneratedClipResult(browser, 'https://chatgpt.com/c/hidden-template', `
      <!doctype html>
      <title>Hidden template - ChatGPT</title>
      <style>.template-message { display: none; }</style>
      <main id="thread">
        <h1>Hidden template</h1>
        <article data-testid="conversation-turn-template" class="template-message">
          <div data-message-author-role="assistant">
            <div class="markdown"><p>Do not capture this hidden template.</p></div>
          </div>
        </article>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="user"><p>Visible request</p></div>
        </article>
        <article data-testid="conversation-turn-2">
          <div data-message-author-role="assistant">
            <div class="markdown"><p>Visible answer</p></div>
          </div>
        </article>
      </main>
    `);

    expect(result.captureType).toBe('ai-conversation');
    expect(result.messageCount).toBe(2);
    expect(result.textContent).toContain('User:\nVisible request');
    expect(result.textContent).toContain('ChatGPT:\nVisible answer');
    expect(result.textContent).not.toContain('hidden template');
  });

  test('falls back to ordinary web extraction when a known AI domain has no loaded session', async ({ browser }) => {
    const result = await extractGeneratedClipResult(browser, 'https://chat.deepseek.com/', `
      <!doctype html>
      <title>DeepSeek</title>
      <main>
        <h1>Start a new chat</h1>
        <p>This landing page has no user and assistant message pair yet.</p>
      </main>
    `);

    expect(result.captureType).toBe('web-page');
    expect(result.sourcePlatform).toBeUndefined();
    expect(result.messageCount).toBeUndefined();
  });
});

async function extractGeneratedClipResult(browser: Browser, url: string, body: string): Promise<any> {
  const page = await browser.newPage();
  try {
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body }));
    await page.goto(url);
    await page.addScriptTag({ content: extensionExtractor });
    return await page.evaluate(() => (globalThis as any).__mindosClipResult);
  } finally {
    await page.close();
  }
}
