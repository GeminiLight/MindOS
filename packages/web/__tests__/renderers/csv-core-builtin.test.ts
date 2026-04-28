import { describe, expect, it } from 'vitest';
import { manifest as csvManifest } from '@/components/renderers/csv/manifest';

describe('CSV renderer core/builtin contract', () => {
  it('keeps CSV as builtin + core', () => {
    expect(csvManifest.id).toBe('csv');
    expect(csvManifest.builtin).toBe(true);
    expect(csvManifest.core).toBe(true);
  });
});

