import { encodePath } from './utils';

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function isExternalMarkdownHref(href: string | undefined | null): boolean {
  if (!href) return false;
  const value = href.trim();
  return URL_SCHEME_RE.test(value) || value.startsWith('//');
}

function splitHrefSuffix(href: string): { pathPart: string; suffix: string } {
  const hashIndex = href.indexOf('#');
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex < 0) return { pathPart: beforeHash, suffix: hash };
  return {
    pathPart: beforeHash.slice(0, queryIndex),
    suffix: `${beforeHash.slice(queryIndex)}${hash}`,
  };
}

function decodeLinkPath(linkPath: string): string {
  try {
    return decodeURIComponent(linkPath);
  } catch {
    return linkPath;
  }
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return normalized.replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
}

function normalizeRelativePath(input: string): string | null {
  const parts: string[] = [];
  for (const rawPart of input.replace(/\\/g, '/').split('/')) {
    const part = rawPart.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function resolveMarkdownInternalHref(
  href: string | undefined | null,
  sourcePath: string | undefined | null,
): string | undefined {
  if (!href) return href ?? undefined;
  const value = href.trim();
  if (!value || value.startsWith('#')) return href;
  if (value.startsWith('/view/')) return href;
  if (isExternalMarkdownHref(value)) return href;

  const { pathPart, suffix } = splitHrefSuffix(value);
  if (!pathPart || !/\.md$/i.test(pathPart)) return href;

  const decodedPath = decodeLinkPath(pathPart).replace(/^\/+/, '');
  const baseDir = pathPart.startsWith('/') ? '' : dirname(sourcePath ?? '');
  const targetPath = normalizeRelativePath(baseDir ? `${baseDir}/${decodedPath}` : decodedPath);
  if (!targetPath) return href;

  return `/view/${encodePath(targetPath)}${suffix}`;
}
