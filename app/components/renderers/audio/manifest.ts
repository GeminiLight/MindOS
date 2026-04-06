import type { RendererDefinition } from '@/lib/renderers/registry';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac']);

export const manifest: RendererDefinition = {
  id: 'audio',
  name: 'Audio Player',
  description: 'Plays audio files with native browser controls.',
  author: 'MindOS',
  icon: '🎵',
  tags: ['audio', 'music', 'voice', 'mp3', 'wav'],
  builtin: true,
  core: true,
  appBuiltinFeature: true,
  match: ({ extension }) => AUDIO_EXTENSIONS.has(extension),
  load: () => import('./AudioRenderer').then(m => ({ default: m.AudioRenderer })),
};
