import { describe, expect, it } from 'vitest';
import path from 'path';

import { getExtensionsList } from '@/lib/pi-integration/extensions';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('pi extensions discovery', () => {
  it('discovers the current-time extension from .pi/extensions/', async () => {
    const extensions = await getExtensionsList(PROJECT_ROOT, '/tmp/nonexistent-mind-root');

    const timeExt = extensions.find((e) => e.name === 'current-time');
    expect(timeExt).toBeDefined();
    expect(timeExt!.enabled).toBe(true);
    expect(timeExt!.path).toContain('current-time');
  });

  it('returns empty array when no extensions exist', async () => {
    const extensions = await getExtensionsList('/tmp/nonexistent-project', '/tmp/nonexistent-mind');
    expect(extensions).toEqual([]);
  });
});
