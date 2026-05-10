import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('desktop connect renderer HTML safety', () => {
  it('does not interpolate command failures through innerHTML', () => {
    const source = readFileSync(
      path.join(root, 'packages/desktop/src/connect-renderer.ts'),
      'utf-8',
    );

    expect(source).not.toContain('statusEl.innerHTML =');
    expect(source).toContain('renderCommandFailure(statusEl');
  });
});
