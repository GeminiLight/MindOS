export function buildConflictCopyPath(filePath: string, now = Date.now()): string {
  return filePath.replace(/\.md$/i, '') + `-${now}.md`;
}

export function buildMarkdownDraftKey(serverUrl: string, rootId: string, filePath: string): string {
  if (!serverUrl.trim() || !rootId.trim() || !filePath) throw new Error('Draft identity is unavailable.');
  return `mindos_draft_v2:${JSON.stringify([serverUrl.replace(/\/+$/, ''), rootId, filePath])}`;
}
