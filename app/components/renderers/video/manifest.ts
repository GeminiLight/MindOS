import type { RendererDefinition } from '@/lib/renderers/registry';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv']);

export const manifest: RendererDefinition = {
  id: 'video',
  name: 'Video Player',
  description: 'Plays video files with native browser controls.',
  author: 'MindOS',
  icon: '🎬',
  tags: ['video', 'movie', 'recording', 'mp4', 'webm'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ extension }) => VIDEO_EXTENSIONS.has(extension),
  load: () => import('./VideoRenderer').then(m => ({ default: m.VideoRenderer })),
};
