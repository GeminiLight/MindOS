export function buildConflictCopyPath(filePath: string, now = Date.now()): string {
  return filePath.replace(/\.md$/i, '') + `-${now}.md`;
}
