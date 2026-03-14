import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'backlinks',
  name: 'Backlinks Explorer',
  description: 'Shows all files that link to the current page via wikilinks or markdown links, with highlighted snippet context.',
  author: 'MindOS',
  icon: '🔗',
  tags: ['backlinks', 'wiki', 'links', 'references'],
  builtin: true,
  entryPath: 'BACKLINKS.md',
  match: ({ filePath }) => /\bBACKLINKS\b.*\.md$/i.test(filePath),
  load: () => import('./BacklinksRenderer').then(m => ({ default: m.BacklinksRenderer })),
};
