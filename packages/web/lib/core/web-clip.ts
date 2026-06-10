import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { detectSourcePlatform } from '@/lib/link-preview/source-platforms';

export interface WebClipResult {
  title: string;
  markdown: string;
  fileName: string;
  wordCount: number;
  url: string;
  siteName: string | null;
  byline: string | null;
  mode: 'article' | 'link';
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECTS = 5;

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

export function isSafeHttpUrlForFetch(input: string): boolean {
  if (!isValidUrl(input)) return false;
  const parsed = new URL(input);
  return isSafePublicHostname(parsed.hostname);
}

function isSafePublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (isUnsafeIpv4(host) || isUnsafeIpv6(host)) return false;
  return true;
}

function isUnsafeIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(part => Number(part));
  if (octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isUnsafeIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  const normalized = host.toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:192.168.');
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[/\\?*:|"<>]/g, '-')
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
  if (!isSafeHttpUrlForFetch(url)) {
    throw new Error('Unsafe URL — local and private network addresses are not supported');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  let finalUrl: string;
  try {
    const res = await fetchWithSafeRedirects(url, controller.signal);

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
  const platform = detectSourcePlatform(finalUrl);

  const savedAt = new Date().toISOString();
  const fm = buildFrontmatter({
    title,
    source: finalUrl,
    source_platform: platform?.id,
    source_domain: hostname,
    author: article?.byline || null,
    site: article?.siteName || platform?.label || hostname,
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
    siteName: article?.siteName || platform?.label || hostname,
    byline: article?.byline || null,
    mode: 'article',
  };
}

async function fetchWithSafeRedirects(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!isSafeHttpUrlForFetch(current)) {
      throw new Error('Unsafe redirect URL — local and private network addresses are not supported');
    }

    const res = await fetch(current, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MindOS-Clipper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      redirect: 'manual',
    });

    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get('location');
    if (!location) throw new Error(`Redirect response missing Location header (HTTP ${res.status})`);

    const next = new URL(location, current).toString();
    if (!isSafeHttpUrlForFetch(next)) {
      throw new Error('Unsafe redirect URL — local and private network addresses are not supported');
    }
    current = next;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

export function createFallbackWebClip(url: string): WebClipResult {
  if (!isValidUrl(url)) {
    throw new Error('Invalid URL — only http:// and https:// are supported');
  }
  if (!isSafeHttpUrlForFetch(url)) {
    throw new Error('Unsafe URL — local and private network addresses are not supported');
  }

  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^www\./, '');
  const platform = detectSourcePlatform(url);
  const siteName = platform?.label || hostname;
  const title = `${siteName} link`;
  const savedAt = new Date().toISOString();
  const fm = buildFrontmatter({
    title,
    source: parsed.toString(),
    source_platform: platform?.id,
    source_domain: hostname,
    site: siteName,
    clipped: savedAt,
    clip_status: 'link-only',
  });

  return {
    title,
    markdown: `${fm}# ${title}\n\n${parsed.toString()}\n`,
    fileName: `${sanitizeFileName(title)}.md`,
    wordCount: 0,
    url: parsed.toString(),
    siteName,
    byline: null,
    mode: 'link',
  };
}
