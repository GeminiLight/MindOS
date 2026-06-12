// Shared path helper used by both knowledge-en and knowledge-zh.
// No translated strings live here so neither locale chunk pulls in the other.
export function spaceDraftsPath(spacePath: string): string {
  return `${spacePath.replace(/\/?$/, '/')}Drafts/`;
}
