import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export interface WebClipResult {
  title: string;
  markdown: string;
  fileName: string;
  wordCount: number;
  url: string;
  siteName: string | null;
  byline: string | null;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Validates a URL string. Only http/https schemes allowed.
 */
export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[\/\\?*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
    || 'Untitled';
}

function buildFrontmatter(meta: Record<string, string | null | undefined>): string {
  const lines = ['---'];
  const yamlReserved = /^(true|false|null|yes|no|on|off|~)$/i;
  const yamlSpecialStart = /^[*&!@`>|%-]/;

  for (const [key, val] of Object.entries(meta)) {
    if (val == null || val === '') continue;
    const clean = val.replace(/[\r\n]+/g, ' ').trim();
    const needsQuote = clean.includes(':') || clean.includes('#') || clean.includes("'")
      || clean.includes('"') || clean.includes('[') || clean.includes('{')
      || yamlReserved.test(clean) || yamlSpecialStart.test(clean);
    const safe = needsQuote
      ? `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : clean;
    lines.push(`${key}: ${safe}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  td.addRule('pre-code', {
    filter: (node) => node.nodeName === 'PRE' && !!node.querySelector('code'),
    replacement: (_content, node) => {
      const code = (node as Element).querySelector('code');
      const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
      const text = code?.textContent || '';
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    },
  });

  td.addRule('remove-scripts-styles', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => '',
  });

  return td;
}

/**
 * Fetches a URL, extracts article content via Readability, and converts to Markdown.
 */
export async function clipUrl(url: string): Promise<WebClipResult> {
  if (!isValidUrl(url)) {
    throw new Error('Invalid URL — only http:// and https:// are supported');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  let finalUrl: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MindOS-Clipper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch: HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error(`URL does not point to an HTML page (got ${contentType})`);
    }

    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
    if (contentLength > MAX_HTML_SIZE) {
      throw new Error(`Page too large (${Math.round(contentLength / 1024 / 1024)}MB, max 5MB)`);
    }

    html = await res.text();
    finalUrl = res.url;

    if (html.length > MAX_HTML_SIZE) {
      throw new Error('Page content too large (max 5MB)');
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;

  const reader = new Readability(doc, { charThreshold: 100 });
  const article = reader.parse();

  const title = article?.title || doc.title || new URL(finalUrl).hostname;
  const content = article?.content || doc.body?.innerHTML || '';
  const textContent = article?.textContent || doc.body?.textContent || '';

  const latinWords = textContent.split(/\s+/).filter(Boolean).length;
  const cjkChars = (textContent.match(/[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]/g) || []).length;
  const wordCount = cjkChars > latinWords ? cjkChars : latinWords;

  let hostname: string;
  try {
    hostname = new URL(finalUrl).hostname.replace(/^www\./, '');
  } catch {
    hostname = 'unknown';
  }

  const turndown = createTurndown();
  const bodyMd = turndown.turndown(content);

  const savedAt = new Date().toISOString();
  const fm = buildFrontmatter({
    title,
    source: finalUrl,
    author: article?.byline || null,
    site: article?.siteName || hostname,
    clipped: savedAt,
  });

  const markdown = `${fm}# ${title}\n\n${bodyMd}\n`;
  const fileName = sanitizeFileName(title) + '.md';

  dom.window.close();

  return {
    title,
    markdown,
    fileName,
    wordCount,
    url: finalUrl,
    siteName: article?.siteName || hostname,
    byline: article?.byline || null,
  };
}
