import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { revertSpaceInitAction } from '@/lib/actions';
import { getTestMindRoot } from '../setup';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('revertSpaceInitAction path safety', () => {
  it('does not write scaffold files outside MIND_ROOT via sibling-prefix traversal', async () => {
    const root = getTestMindRoot();
    const outsideDir = `${root}-outside`;
    fs.mkdirSync(outsideDir, { recursive: true });

    try {
      const traversalPath = path.relative(root, outsideDir);
      const result = await revertSpaceInitAction(traversalPath, 'Outside', 'Should not write');

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.join(outsideDir, 'README.md'))).toBe(false);
      expect(fs.existsSync(path.join(outsideDir, 'INSTRUCTION.md'))).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
