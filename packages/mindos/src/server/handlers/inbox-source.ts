export type InboxSourcePlatformId =
  | 'youtube'
  | 'bilibili'
  | 'xiaohongshu'
  | 'zhihu'
  | 'github'
  | 'reddit'
  | 'x'
  | 'wechat'
  | 'arxiv';

export interface InboxSourcePlatform {
  id: InboxSourcePlatformId;
  label: string;
  domains: string[];
}

export interface InboxSourceMetadata {
  kind: 'web';
  url: string;
  domain: string;
  siteName?: string;
  platform?: InboxSourcePlatformId;
  platformLabel?: string;
  title?: string;
}

const SOURCE_PLATFORMS: InboxSourcePlatform[] = [
  { id: 'youtube', label: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { id: 'bilibili', label: 'Bilibili', domains: ['bilibili.com', 'b23.tv'] },
  { id: 'xiaohongshu', label: 'Xiaohongshu', domains: ['xiaohongshu.com', 'xhslink.com'] },
  { id: 'zhihu', label: 'Zhihu', domains: ['zhihu.com'] },
  { id: 'github', label: 'GitHub', domains: ['github.com', 'gist.github.com'] },
  { id: 'reddit', label: 'Reddit', domains: ['reddit.com', 'redd.it'] },
  { id: 'x', label: 'X', domains: ['x.com', 'twitter.com'] },
  { id: 'wechat', label: 'WeChat', domains: ['mp.weixin.qq.com', 'weixin.qq.com'] },
  { id: 'arxiv', label: 'arXiv', domains: ['arxiv.org'] },
];

const PLATFORM_BY_ID = new Map(SOURCE_PLATFORMS.map(platform => [platform.id, platform]));

export function detectInboxSourcePlatform(input: string | null | undefined): InboxSourcePlatform | null {
  const hostname = normalizeSourceHostname(input);
  if (!hostname) return null;
  return SOURCE_PLATFORMS.find(platform => (
    platform.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  )) ?? null;
}

export function extractInboxSourceMetadata(markdownPrefix: string): InboxSourceMetadata | undefined {
  const frontmatter = parseLeadingScalarFrontmatter(markdownPrefix);
  if (!frontmatter) return undefined;

  const sourceUrl = firstNonEmpty(frontmatter.source, frontmatter.url, frontmatter.canonical_url);
  const domain = normalizeSourceHostname(sourceUrl ?? frontmatter.domain ?? frontmatter.site);
  if (!sourceUrl || !domain) return undefined;

  const platformFromFrontmatter = normalizePlatformId(frontmatter.source_platform ?? frontmatter.platform);
  const detectedPlatform = detectInboxSourcePlatform(sourceUrl) ?? detectInboxSourcePlatform(domain);
  const platform = platformFromFrontmatter
    ? PLATFORM_BY_ID.get(platformFromFrontmatter) ?? detectedPlatform
    : detectedPlatform;

  return {
    kind: 'web',
    url: sourceUrl,
    domain,
    ...(frontmatter.site ? { siteName: frontmatter.site } : {}),
    ...(platform ? { platform: platform.id, platformLabel: platform.label } : {}),
    ...(frontmatter.title ? { title: frontmatter.title } : {}),
  };
}

function normalizeSourceHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizePlatformId(input: string | null | undefined): InboxSourcePlatformId | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (normalized === 'twitter') return 'x';
  if (normalized === 'xhs' || normalized === 'rednote') return 'xiaohongshu';
  if (PLATFORM_BY_ID.has(normalized as InboxSourcePlatformId)) return normalized as InboxSourcePlatformId;
  return null;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function parseLeadingScalarFrontmatter(content: string): Record<string, string> | null {
  const opening = content.match(/^\uFEFF?---[ \t]*(?:\r?\n)/);
  if (!opening?.[0]) return null;

  const rest = content.slice(opening[0].length);
  const closing = rest.match(/(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/);
  if (!closing || typeof closing.index !== 'number') return null;

  const raw = rest.slice(0, closing.index).replace(/\r\n/g, '\n');
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue == null) continue;
    const value = unquoteFrontmatterScalar(rawValue.trim());
    if (value !== '') result[key] = value;
  }
  return result;
}

function unquoteFrontmatterScalar(value: string): string {
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'").trim();
  }
  const commentIndex = value.search(/\s#/);
  const withoutComment = commentIndex >= 0 ? value.slice(0, commentIndex) : value;
  return withoutComment.trim();
}
