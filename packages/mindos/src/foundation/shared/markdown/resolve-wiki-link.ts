/**
 * Resolve a wiki link target to an actual vault path.
 *
 * Pure: takes the file list, never touches `fs`, so the reading view (browser)
 * and the link index (server) can share one rule. Keeping this in one place is
 * the point — two implementations is exactly how the link graph and the reader
 * drifted apart before.
 *
 * The rule mirrors Obsidian's common case, in order:
 *   1. exact path
 *   2. path + `.md`
 *   3. unique basename anywhere in the vault (case-insensitive)
 *
 * An ambiguous basename resolves to nothing rather than guessing. Obsidian's
 * full "shortest path when possible" rule also weighs proximity to the source
 * file; that is deliberately not implemented here, and ambiguity is reported as
 * unresolved instead of silently picking one.
 */

/** Lowercased basename -> every path with that basename, in iteration order. */
export function buildWikiLinkBasenameMap(files: Iterable<string>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const path of files) {
    const base = basenameOf(path).toLowerCase();
    if (!base) continue;
    const bucket = map.get(base);
    if (bucket) bucket.push(path);
    else map.set(base, [path]);
  }
  return map;
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * Resolve `target` against the vault, or return null when it does not exist or
 * is ambiguous. `basenames` must come from {@link buildWikiLinkBasenameMap}
 * over the same file set.
 *
 * Tries the target as written first, then with `.md` appended. Each form is
 * checked as an exact path and then as a unique basename, so both `[[Note]]`
 * and `[[diagram.png]]` resolve — attachments carry their own extension and
 * must not have `.md` forced onto them.
 */
export function resolveWikiLinkTarget(
  target: string,
  files: ReadonlySet<string>,
  basenames: ReadonlyMap<string, string[]>,
): string | null {
  const raw = target.trim();
  if (!raw) return null;

  const forms = /\.md$/i.test(raw) ? [raw] : [raw, `${raw}.md`];

  for (const form of forms) {
    if (files.has(form)) return form;
  }
  for (const form of forms) {
    const candidates = basenames.get(basenameOf(form).toLowerCase());
    if (candidates?.length === 1) return candidates[0]!;
  }
  return null;
}
