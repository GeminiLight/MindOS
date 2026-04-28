import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpaceManager, createSpaceManager } from './index.js';
import { IFileSystem, FileEntry } from '../storage/index.js';
import { Result } from '../../foundation/shared/index.js';
import { createError } from '../../foundation/errors/index.js';

// Helper functions for Result type
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
}

// Mock filesystem
class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  async readFile(path: string) {
    const content = this.files.get(path);
    if (content === undefined) {
      return err(createError('NOT_FOUND', 'File not found', { context: { path } }));
    }
    return ok(content);
  }

  async writeFile(path: string, content: string) {
    this.files.set(path, content);
    return ok(undefined);
  }

  async remove(path: string, recursive?: boolean) {
    this.files.delete(path);
    this.dirs.delete(path);
    // Delete all files/dirs under this path if recursive
    if (recursive) {
      for (const key of this.files.keys()) {
        if (key.startsWith(path + '/')) {
          this.files.delete(key);
        }
      }
      for (const key of this.dirs.keys()) {
        if (key.startsWith(path + '/')) {
          this.dirs.delete(key);
        }
      }
    }
    return ok(undefined);
  }

  async exists(path: string) {
    return ok(this.files.has(path) || this.dirs.has(path));
  }

  async stat(path: string) {
    if (this.dirs.has(path)) {
      return ok({
        path,
        name: path.split('/').pop() || '',
        size: 0,
        isDirectory: true,
        createdAt: new Date(),
        modifiedAt: new Date(),
      });
    }
    if (this.files.has(path)) {
      return ok({
        path,
        name: path.split('/').pop() || '',
        size: this.files.get(path)!.length,
        isDirectory: false,
        createdAt: new Date(),
        modifiedAt: new Date(),
      });
    }
    return err(createError('NOT_FOUND', 'Path not found', { context: { path } }));
  }

  async readdir(path: string, options?: { recursive?: boolean }) {
    const entries: FileEntry[] = [];
    const pathPrefix = path.endsWith('/') ? path : path + '/';

    // Add directories
    for (const dir of this.dirs) {
      if (dir.startsWith(pathPrefix)) {
        const relativePath = dir.slice(pathPrefix.length);
        if (!options?.recursive && relativePath.includes('/')) {
          continue;
        }
        entries.push({
          path: dir,
          name: dir.split('/').pop() || '',
          size: 0,
          isDirectory: true,
          createdAt: new Date(),
          modifiedAt: new Date(),
        });
      }
    }

    // Add files
    for (const [filePath, content] of this.files) {
      if (filePath.startsWith(pathPrefix)) {
        const relativePath = filePath.slice(pathPrefix.length);
        if (!options?.recursive && relativePath.includes('/')) {
          continue;
        }
        entries.push({
          path: filePath,
          name: filePath.split('/').pop() || '',
          size: content.length,
          isDirectory: false,
          createdAt: new Date(),
          modifiedAt: new Date(),
        });
      }
    }

    return ok(entries);
  }

  async mkdir(path: string, recursive?: boolean) {
    this.dirs.add(path);
    return ok(undefined);
  }

  async copy(source: string, destination: string) {
    const content = this.files.get(source);
    if (content === undefined) {
      return err(createError('NOT_FOUND', 'Source not found', { context: { source } }));
    }
    this.files.set(destination, content);
    return ok(undefined);
  }

  async move(source: string, destination: string) {
    // Move directory
    if (this.dirs.has(source)) {
      this.dirs.delete(source);
      this.dirs.add(destination);
      // Move all files/dirs under this directory
      for (const key of Array.from(this.files.keys())) {
        if (key.startsWith(source + '/')) {
          const newKey = destination + key.slice(source.length);
          this.files.set(newKey, this.files.get(key)!);
          this.files.delete(key);
        }
      }
      for (const key of Array.from(this.dirs.keys())) {
        if (key.startsWith(source + '/')) {
          const newKey = destination + key.slice(source.length);
          this.dirs.add(newKey);
          this.dirs.delete(key);
        }
      }
      return ok(undefined);
    }
    // Move file
    const copyResult = await this.copy(source, destination);
    if (!copyResult.ok) {
      return copyResult;
    }
    return await this.remove(source);
  }
}

describe('SpaceManager', () => {
  let fs: MockFileSystem;
  let manager: SpaceManager;
  const rootPath = '/spaces';

  beforeEach(() => {
    fs = new MockFileSystem();
    fs.mkdir(rootPath);
    manager = createSpaceManager(fs, rootPath);
  });

  describe('createSpace', () => {
    it('should create a new space with scaffold files', async () => {
      const result = await manager.createSpace('test-space');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('test-space');
        expect(result.value.path).toBe('/spaces/test-space');
      }

      // Check scaffold files were created
      const instructionExists = await fs.exists('/spaces/test-space/INSTRUCTION.md');
      const readmeExists = await fs.exists('/spaces/test-space/README.md');
      expect(instructionExists.value).toBe(true);
      expect(readmeExists.value).toBe(true);
    });

    it('should create space without scaffold when scaffold=false', async () => {
      const result = await manager.createSpace('test-space', { scaffold: false });

      expect(result.ok).toBe(true);

      const instructionExists = await fs.exists('/spaces/test-space/INSTRUCTION.md');
      const readmeExists = await fs.exists('/spaces/test-space/README.md');
      expect(instructionExists.value).toBe(false);
      expect(readmeExists.value).toBe(false);
    });

    it('should create space with custom instruction', async () => {
      const customInstruction = '# Custom Instruction\nThis is custom.';
      const result = await manager.createSpace('test-space', {
        instruction: customInstruction,
      });

      expect(result.ok).toBe(true);

      const content = await fs.readFile('/spaces/test-space/INSTRUCTION.md');
      expect(content.ok).toBe(true);
      if (content.ok) {
        expect(content.value).toBe(customInstruction);
      }
    });

    it('should fail if space already exists', async () => {
      await manager.createSpace('test-space');
      const result = await manager.createSpace('test-space');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFLICT');
      }
    });

    it.each(['', '   ', '../evil', 'nested/space', 'nested\\space', '/absolute'])(
      'should reject unsafe space name "%s"',
      async (name) => {
        const result = await manager.createSpace(name);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      }
    );
  });

  describe('deleteSpace', () => {
    it('should delete an existing space', async () => {
      await manager.createSpace('test-space');

      const result = await manager.deleteSpace('test-space');
      expect(result.ok).toBe(true);

      const exists = await fs.exists('/spaces/test-space');
      expect(exists.value).toBe(false);
    });

    it('should fail if space does not exist', async () => {
      const result = await manager.deleteSpace('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject traversal names before checking the filesystem', async () => {
      const result = await manager.deleteSpace('../evil');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('renameSpace', () => {
    it('should rename an existing space', async () => {
      await manager.createSpace('old-name');
      await fs.writeFile('/spaces/old-name/test.txt', 'test content');

      const result = await manager.renameSpace('old-name', 'new-name');
      expect(result.ok).toBe(true);

      const oldExists = await fs.exists('/spaces/old-name');
      const newExists = await fs.exists('/spaces/new-name');
      expect(oldExists.value).toBe(false);
      expect(newExists.value).toBe(true);

      // Check file was moved
      const fileContent = await fs.readFile('/spaces/new-name/test.txt');
      expect(fileContent.ok).toBe(true);
      if (fileContent.ok) {
        expect(fileContent.value).toBe('test content');
      }
    });

    it('should fail if source space does not exist', async () => {
      const result = await manager.renameSpace('nonexistent', 'new-name');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should fail if target space already exists', async () => {
      await manager.createSpace('space1');
      await manager.createSpace('space2');

      const result = await manager.renameSpace('space1', 'space2');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFLICT');
      }
    });

    it('should reject unsafe old or new names', async () => {
      await manager.createSpace('safe');

      const unsafeOld = await manager.renameSpace('../evil', 'new-name');
      const unsafeNew = await manager.renameSpace('safe', 'nested/space');

      expect(unsafeOld.ok).toBe(false);
      expect(unsafeNew.ok).toBe(false);
      if (!unsafeOld.ok) expect(unsafeOld.error.code).toBe('VALIDATION_ERROR');
      if (!unsafeNew.ok) expect(unsafeNew.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listSpaces', () => {
    it('should list all spaces', async () => {
      await manager.createSpace('space1');
      await manager.createSpace('space2');
      await manager.createSpace('space3');

      const result = await manager.listSpaces();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const names = result.value.map((s) => s.name);
        expect(names).toContain('space1');
        expect(names).toContain('space2');
        expect(names).toContain('space3');
      }
    });

    it('should return empty array when no spaces exist', async () => {
      const result = await manager.listSpaces();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('getSpace', () => {
    it('should get space metadata', async () => {
      await manager.createSpace('test-space');

      const result = await manager.getSpace('test-space');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('test-space');
        expect(result.value.path).toBe('/spaces/test-space');
      }
    });

    it('should fail if space does not exist', async () => {
      const result = await manager.getSpace('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
