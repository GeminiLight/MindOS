import type { RendererDefinition } from '@/lib/renderers/registry';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

export const manifest: RendererDefinition = {
  id: 'image',
  name: 'Image Viewer',
  description: 'Renders image files with zoom, fit-to-view, and transparency support.',
  author: 'MindOS',
  icon: '🖼',
  tags: ['image', 'photo', 'viewer', 'png', 'jpg', 'svg'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ extension }) => IMAGE_EXTENSIONS.has(extension),
  load: () => import('./ImageRenderer').then(m => ({ default: m.ImageRenderer })),
};
