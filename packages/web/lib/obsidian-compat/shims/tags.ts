export function normalizeObsidianTag(value: unknown): string | null {
  const tag = String(value ?? '').trim();
  if (!tag) return null;
  return tag.startsWith('#') ? tag : `#${tag}`;
}

export function parseFrontMatterTagValues(frontmatter: Record<string, unknown> | null | undefined): string[] | null {
  const value = frontmatter?.tags ?? frontmatter?.tag ?? frontmatter?.Tags;
  if (value === undefined) return null;

  const rawTags = Array.isArray(value)
    ? value.flatMap((item) => splitFrontMatterTagText(item))
    : splitFrontMatterTagText(value);

  return rawTags.flatMap((tag) => {
    const normalized = normalizeObsidianTag(tag);
    return normalized ? [normalized] : [];
  });
}

function splitFrontMatterTagText(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value).split(/[\s,]+/).filter(Boolean);
}
