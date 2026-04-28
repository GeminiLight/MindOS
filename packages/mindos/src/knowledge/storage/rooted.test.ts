import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from './memory.js';
import { RootedFileSystem } from './rooted.js';

describe('RootedFileSystem', () => {
  it('reads and writes relative paths under the configured root', async () => {
    const base = new MemoryFileSystem();
    const fs = new RootedFileSystem('/vault', base);

    const write = await fs.writeFile('notes/today.md', 'hello');
    expect(write.ok).toBe(true);

    const read = await base.readFile('/vault/notes/today.md');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value).toBe('hello');
    }
  });

  it('rejects traversal and absolute paths before they reach the underlying filesystem', async () => {
    const base = new MemoryFileSystem();
    const fs = new RootedFileSystem('/vault', base);

    const traversal = await fs.writeFile('../evil.md', 'nope');
    const absolute = await fs.writeFile('/tmp/evil.md', 'nope');

    expect(traversal.ok).toBe(false);
    expect(absolute.ok).toBe(false);
    expect((await base.exists('/evil.md')).value).toBe(false);
    expect((await base.exists('/tmp/evil.md')).value).toBe(false);
  });

  it('protects only root INSTRUCTION.md while allowing nested space instructions', async () => {
    const base = new MemoryFileSystem();
    const fs = new RootedFileSystem('/vault', base);

    const rootInstruction = await fs.writeFile('INSTRUCTION.md', 'root');
    const nestedInstruction = await fs.writeFile('Projects/INSTRUCTION.md', 'space');

    expect(rootInstruction.ok).toBe(false);
    expect(nestedInstruction.ok).toBe(true);
    expect((await base.exists('/vault/INSTRUCTION.md')).value).toBe(false);
    expect((await base.exists('/vault/Projects/INSTRUCTION.md')).value).toBe(true);
  });

  it('validates both source and destination for move operations', async () => {
    const base = new MemoryFileSystem();
    const fs = new RootedFileSystem('/vault', base);

    await fs.writeFile('safe.md', 'safe');

    expect((await fs.move('safe.md', '../safe.md')).ok).toBe(false);
    expect((await fs.move('../evil.md', 'safe.md')).ok).toBe(false);
    expect((await base.exists('/vault/safe.md')).value).toBe(true);
  });
});
