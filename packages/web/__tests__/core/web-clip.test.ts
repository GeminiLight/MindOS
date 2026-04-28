import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clipUrl, isValidUrl } from '@/lib/core/web-clip';

describe('isValidUrl', () => {
  it('accepts http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('https://sub.example.com/path#section')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
    expect(isValidUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects empty and garbage strings', () => {
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('example.com')).toBe(false);
    expect(isValidUrl('   ')).toBe(false);
  });

  it('rejects null-like inputs passed as any', () => {
    expect(isValidUrl(null as unknown as string)).toBe(false);
    expect(isValidUrl(undefined as unknown as string)).toBe(false);
  });
});

describe('clipUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid URLs', async () => {
    await expect(clipUrl('not-a-url')).rejects.toThrow('Invalid URL');
    await expect(clipUrl('ftp://evil.com')).rejects.toThrow('Invalid URL');
  });

  it('clips a simple HTML page', async () => {
    const html = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article</h1>
    <p>This is a test article with enough content to pass the Readability threshold.
       It needs to be longer than 100 characters to be parsed as an article by the
       Readability library. So we add more text here to make sure it works properly
       in our test environment.</p>
    <p>Second paragraph with additional content to ensure the article extraction
       algorithm has enough material to work with. We want at least a few hundred
       characters of meaningful content.</p>
  </article>
</body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/article',
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
      }),
      text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await clipUrl('https://example.com/article');

    expect(result.title).toBe('Test Article');
    expect(result.fileName).toBe('Test Article.md');
    expect(result.url).toBe('https://example.com/article');
    expect(result.markdown).toContain('# Test Article');
    expect(result.markdown).toContain('---');
    expect(result.markdown).toMatch(/source:.*example\.com\/article/);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('handles non-HTML content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/image.png',
      headers: new Headers({
        'content-type': 'image/png',
      }),
      text: () => Promise.resolve('binary data'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(clipUrl('https://example.com/image.png'))
      .rejects.toThrow('URL does not point to an HTML page');
  });

  it('handles HTTP error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      url: 'https://example.com/missing',
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(clipUrl('https://example.com/missing'))
      .rejects.toThrow('HTTP 404');
  });

  it('handles network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(clipUrl('https://example.com'))
      .rejects.toThrow('fetch failed');
  });

  it('handles pages with minimal content', async () => {
    const html = `<!DOCTYPE html>
<html><head><title>Minimal Page</title></head>
<body><p>Short.</p></body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await clipUrl('https://example.com/');

    expect(result.title).toBe('Minimal Page');
    expect(result.markdown).toContain('# Minimal Page');
    expect(result.fileName).toBe('Minimal Page.md');
  });

  it('sanitizes titles with special characters', async () => {
    const html = `<!DOCTYPE html>
<html><head><title>My "Article" — with: special/chars</title></head>
<body>
  <article>
    <h1>My "Article" — with: special/chars</h1>
    <p>Long enough content to be picked up by Readability as a proper article.
       We need several sentences of meaningful text content to ensure the extraction
       works correctly. This is the third sentence adding more words.</p>
  </article>
</body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/special',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await clipUrl('https://example.com/special');

    expect(result.fileName).not.toContain('/');
    expect(result.fileName).not.toContain('"');
    expect(result.fileName).not.toContain(':');
    expect(result.fileName.endsWith('.md')).toBe(true);
  });

  it('includes frontmatter with source metadata', async () => {
    const html = `<!DOCTYPE html>
<html><head><title>Frontmatter Test</title></head>
<body>
  <article>
    <h1>Frontmatter Test</h1>
    <p>Content paragraph one with enough text to be extracted properly by
       the Readability library. We need meaningful content here.</p>
    <p>Content paragraph two adding more substance to the article.</p>
  </article>
</body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://blog.example.com/post/123',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await clipUrl('https://blog.example.com/post/123');

    expect(result.markdown).toMatch(/^---\n/);
    expect(result.markdown).toContain('title: Frontmatter Test');
    expect(result.markdown).toMatch(/source:.*blog\.example\.com\/post\/123/);
    expect(result.markdown).toContain('clipped:');
    expect(result.siteName).toBe('blog.example.com');
  });

  it('handles CJK content word count', async () => {
    const html = `<!DOCTYPE html>
<html><head><title>中文文章</title></head>
<body>
  <article>
    <h1>中文文章标题</h1>
    <p>这是一篇中文文章的内容，包含足够多的中文字符来测试字数统计功能。
       我们需要确保中日韩字符的计数逻辑正确工作，每个汉字算作一个词。
       这段话应该有足够的内容让 Readability 提取器正常工作。</p>
  </article>
</body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.cn/article',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await clipUrl('https://example.cn/article');
    expect(result.wordCount).toBeGreaterThan(20);
  });
});
