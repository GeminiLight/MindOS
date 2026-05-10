import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('desktop tauri connect renderer HTML safety', () => {
  it('does not render connection failures through inline HTML handlers', () => {
    const source = readFileSync(
      path.join(root, 'packages/desktop-tauri/src/main.ts'),
      'utf-8',
    );

    expect(source).not.toContain('errorEl.innerHTML =');
    expect(source).not.toContain('onclick=');
    expect(source).toContain('renderConnectionFailure(errorEl');
  });
});
