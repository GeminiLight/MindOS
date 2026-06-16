import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('SearchModal routes', () => {
  it('navigates Discover command to the existing Explore route', () => {
    const source = fs.readFileSync(path.join(ROOT, 'components', 'SearchModal.tsx'), 'utf-8');

    expect(source).not.toContain("router.push('/discover')");
    expect(source).toContain("smoothPush('/explore')");
  });

  it('clears the left panel before navigating to Studio from actions', () => {
    const source = fs.readFileSync(path.join(ROOT, 'components', 'SearchModal.tsx'), 'utf-8');

    expect(source).toContain("detail: { panel: null }");
    expect(source).toContain("smoothPush('/studio')");
  });
});
