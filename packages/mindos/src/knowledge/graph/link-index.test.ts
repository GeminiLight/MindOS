import { describe, it, expect, beforeEach } from 'vitest';
import { LinkIndex } from './index';
import type { IFileSystem, FileEntry, Result } from '../storage/index.js';

// Mock FileSystem for testing
class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  constructor() {
    this.dirs.add('/root');
  }

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<Result<string>> {
    const content = this.files.get(path);
    if (content === undefined) {
      return { ok: false, error: new Error('File not found') };
    }
    return { ok: true, value: content };
  }

  async writeFile(path: string, content: string): Promise<Result<void>> {
    this.files.set(path, content);
    return { ok: true, value: undefined };
  }

  async remove(path: string): Promise<Result<void>> {
    this.files.delete(path);
    return { ok: true, value: undefined };
  }

  async exists(path: string): Promise<Result<boolean>> {
    return { ok: true, value: this.files.has(path) || this.dirs.has(path) };
  }

  async readdir(path: string): Promise<Result<FileEntry[]>> {
    const entries: FileEntry[] = [];

    // Get immediate children
    for (const [filePath] of this.files.entries()) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.slice(path.length + 1);
        if (!relativePath.includes('/')) {
          entries.push({
            path: filePath,
            name: filePath.split('/').pop() || '',
            isFile: true,
            isDirectory: false,
            size: this.files.get(filePath)?.length || 0,
            modifiedAt: Date.now(),
            createdAt: Date.now()
          });
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(path + '/')) {
        const relativePath = dirPath.slice(path.length + 1);
        if (!relativePath.includes('/')) {
          entries.push({
            path: dirPath,
            name: dirPath.split('/').pop() || '',
            isFile: false,
            isDirectory: true,
            size: 0,
            modifiedAt: Date.now(),
            createdAt: Date.now()
          });
        }
      }
    }

    return { ok: true, value: entries };
  }

  async mkdir(path: string): Promise<Result<void>> {
    this.dirs.add(path);
    return { ok: true, value: undefined };
  }

  async stat(path: string): Promise<Result<FileEntry>> {
    const content = this.files.get(path);
    if (content === undefined) {
      return { ok: false, error: new Error('File not found') };
    }
    return { ok: true, value: {
      path,
      name: path.split('/').pop() || '',
      isFile: true,
      isDirectory: false,
      size: content.length,
      modifiedAt: Date.now(),
      createdAt: Date.now()
    }};
  }

  async copy(): Promise<Result<void>> {
    return { ok: false, error: new Error('Not implemented') };
  }

  async move(): Promise<Result<void>> {
    return { ok: false, error: new Error('Not implemented') };
  }

  async appendFile(): Promise<Result<void>> {
    return { ok: false, error: new Error('Not implemented') };
  }
}

describe('@mindos/graph', () => {
  let fs: MockFileSystem;
  let index: LinkIndex;

  beforeEach(() => {
    fs = new MockFileSystem();
    index = new LinkIndex(fs);
  });

  describe('LinkIndex', () => {
    it('should rebuild index from files', async () => {
      fs.setFile('/root/a.md', '[[b]] and [[c]]');
      fs.setFile('/root/b.md', '[[a]]');
      fs.setFile('/root/c.md', 'no links');

      const result = await index.rebuild('/root');
      expect(result.ok).toBe(true);
    });

    it('should get backlinks', async () => {
      fs.setFile('/root/a.md', '[[b]] and [[c]]');
      fs.setFile('/root/b.md', '[[a]]');
      fs.setFile('/root/c.md', 'no links');

      await index.rebuild('/root');

      const backlinks = index.getBacklinks('/root/b.md');
      expect(backlinks).toHaveLength(1);
      expect(backlinks).toContain('/root/a.md');
    });

    it('should get forward links', async () => {
      fs.setFile('/root/a.md', '[[b]] and [[c]]');
      fs.setFile('/root/b.md', '[[a]]');
      fs.setFile('/root/c.md', 'no links');

      await index.rebuild('/root');

      const links = index.getForwardLinks('/root/a.md');
      expect(links).toHaveLength(2);
      expect(links).toContain('/root/b.md');
      expect(links).toContain('/root/c.md');
    });

    it('should update file incrementally', async () => {
      fs.setFile('/root/a.md', '[[b]]');
      fs.setFile('/root/b.md', 'content');
      fs.setFile('/root/c.md', 'content');

      await index.rebuild('/root');

      // Update a.md to link to c instead of b
      fs.setFile('/root/a.md', '[[c]]');

      const result = await index.updateFile('/root/a.md');
      expect(result.ok).toBe(true);

      const links = index.getForwardLinks('/root/a.md');
      expect(links).not.toContain('/root/b.md');
      expect(links).toContain('/root/c.md');

      // b should no longer have backlinks from a
      const backlinks = index.getBacklinks('/root/b.md');
      expect(backlinks).not.toContain('/root/a.md');
    });

    it('should remove file from index', async () => {
      fs.setFile('/root/a.md', '[[b]]');
      fs.setFile('/root/b.md', '[[a]]');

      await index.rebuild('/root');

      index.removeFile('/root/a.md');

      const links = index.getForwardLinks('/root/a.md');
      expect(links).toHaveLength(0);

      const backlinks = index.getBacklinks('/root/b.md');
      expect(backlinks).not.toContain('/root/a.md');
    });
  });
});
