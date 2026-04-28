import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'pdf',
  name: 'PDF Viewer',
  description: 'Renders PDF files using the browser built-in PDF viewer.',
  author: 'MindOS',
  icon: '📄',
  tags: ['pdf', 'document', 'viewer'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ extension }) => extension === 'pdf',
  load: () => import('./PdfRenderer').then(m => ({ default: m.PdfRenderer })),
};
