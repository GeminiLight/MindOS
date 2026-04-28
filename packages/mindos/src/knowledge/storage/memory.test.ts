/**
 * Tests for MemoryFileSystem
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryFileSystem } from './memory.js'

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem

  beforeEach(() => {
    fs = new MemoryFileSystem()
  })

  describe('writeFile and readFile', () => {
    it('should write and read file', async () => {
      const result = await fs.writeFile('/test.txt', 'Hello, World!')
      expect(result.ok).toBe(true)

      const readResult = await fs.readFile('/test.txt')
      expect(readResult.ok).toBe(true)
      if (readResult.ok) {
        expect(readResult.value).toBe('Hello, World!')
      }
    })

    it('should return error for non-existent file', async () => {
      const result = await fs.readFile('/nonexistent.txt')
      expect(result.ok).toBe(false)
    })

    it('should overwrite existing file', async () => {
      await fs.writeFile('/test.txt', 'First')
      await fs.writeFile('/test.txt', 'Second')

      const result = await fs.readFile('/test.txt')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe('Second')
      }
    })

    it('should handle nested paths', async () => {
      await fs.writeFile('/dir/subdir/file.txt', 'Content')
      const result = await fs.readFile('/dir/subdir/file.txt')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe('Content')
      }
    })
  })

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await fs.writeFile('/test.txt', 'Content')
      const result = await fs.exists('/test.txt')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(true)
      }
    })

    it('should return false for non-existent file', async () => {
      const result = await fs.exists('/nonexistent.txt')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(false)
      }
    })

    it('should return true for directory', async () => {
      await fs.mkdir('/dir')
      const result = await fs.exists('/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(true)
      }
    })
  })

  describe('stat', () => {
    it('should return metadata for file', async () => {
      await fs.writeFile('/test.txt', 'Hello')
      const result = await fs.stat('/test.txt')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.path).toBe('/test.txt')
        expect(result.value.size).toBe(5)
        expect(result.value.isFile).toBe(true)
        expect(result.value.isDirectory).toBe(false)
        expect(result.value.createdAt).toBeInstanceOf(Date)
        expect(result.value.modifiedAt).toBeInstanceOf(Date)
      }
    })

    it('should return metadata for directory', async () => {
      await fs.mkdir('/dir')
      const result = await fs.stat('/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.isDirectory).toBe(true)
        expect(result.value.isFile).toBe(false)
      }
    })

    it('should return error for non-existent path', async () => {
      const result = await fs.stat('/nonexistent')
      expect(result.ok).toBe(false)
    })
  })

  describe('mkdir', () => {
    it('should create directory', async () => {
      const result = await fs.mkdir('/dir')
      expect(result.ok).toBe(true)

      const exists = await fs.exists('/dir')
      expect(exists.ok && exists.value).toBe(true)
    })

    it('should create nested directories with recursive option', async () => {
      const result = await fs.mkdir('/dir/subdir/deep', true)
      expect(result.ok).toBe(true)

      const exists = await fs.exists('/dir/subdir/deep')
      expect(exists.ok && exists.value).toBe(true)
    })

    it('should fail for nested directories without recursive', async () => {
      const result = await fs.mkdir('/dir/subdir/deep', false)
      expect(result.ok).toBe(false)
    })
  })

  describe('readdir', () => {
    it('should list directory contents', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file1.txt', 'Content 1')
      await fs.writeFile('/dir/file2.txt', 'Content 2')
      await fs.mkdir('/dir/subdir')

      const result = await fs.readdir('/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(3)
        const names = result.value.map((e) => e.name).sort()
        expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir'])
      }
    })

    it('should return empty array for empty directory', async () => {
      await fs.mkdir('/empty')
      const result = await fs.readdir('/empty')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('should return error for non-existent directory', async () => {
      const result = await fs.readdir('/nonexistent')
      expect(result.ok).toBe(false)
    })

    it('should return error for file path', async () => {
      await fs.writeFile('/file.txt', 'Content')
      const result = await fs.readdir('/file.txt')
      expect(result.ok).toBe(false)
    })
  })

  describe('remove', () => {
    it('should remove file', async () => {
      await fs.writeFile('/test.txt', 'Content')
      const result = await fs.remove('/test.txt')
      expect(result.ok).toBe(true)

      const exists = await fs.exists('/test.txt')
      expect(exists.ok && exists.value).toBe(false)
    })

    it('should remove empty directory', async () => {
      await fs.mkdir('/dir')
      const result = await fs.remove('/dir')
      expect(result.ok).toBe(true)

      const exists = await fs.exists('/dir')
      expect(exists.ok && exists.value).toBe(false)
    })

    it('should remove directory recursively', async () => {
      await fs.mkdir('/dir/subdir', true)
      await fs.writeFile('/dir/file.txt', 'Content')
      await fs.writeFile('/dir/subdir/file.txt', 'Content')

      const result = await fs.remove('/dir', true)
      expect(result.ok).toBe(true)

      const exists = await fs.exists('/dir')
      expect(exists.ok && exists.value).toBe(false)
    })

    it('should fail to remove non-empty directory without recursive', async () => {
      await fs.mkdir('/dir')
      await fs.writeFile('/dir/file.txt', 'Content')

      const result = await fs.remove('/dir', false)
      expect(result.ok).toBe(false)
    })
  })

  describe('copy', () => {
    it('should copy file', async () => {
      await fs.writeFile('/source.txt', 'Content')
      const result = await fs.copy('/source.txt', '/dest.txt')
      expect(result.ok).toBe(true)

      const destContent = await fs.readFile('/dest.txt')
      expect(destContent.ok && destContent.value).toBe('Content')
    })

    it('should copy directory recursively', async () => {
      await fs.mkdir('/source/subdir', true)
      await fs.writeFile('/source/file.txt', 'Content')
      await fs.writeFile('/source/subdir/file.txt', 'Nested')

      const result = await fs.copy('/source', '/dest')
      expect(result.ok).toBe(true)

      const destFile = await fs.readFile('/dest/file.txt')
      expect(destFile.ok && destFile.value).toBe('Content')

      const nestedFile = await fs.readFile('/dest/subdir/file.txt')
      expect(nestedFile.ok && nestedFile.value).toBe('Nested')
    })
  })

  describe('move', () => {
    it('should move file', async () => {
      await fs.writeFile('/source.txt', 'Content')
      const result = await fs.move('/source.txt', '/dest.txt')
      expect(result.ok).toBe(true)

      const sourceExists = await fs.exists('/source.txt')
      expect(sourceExists.ok && sourceExists.value).toBe(false)

      const destContent = await fs.readFile('/dest.txt')
      expect(destContent.ok && destContent.value).toBe('Content')
    })

    it('should move directory', async () => {
      await fs.mkdir('/source/subdir', true)
      await fs.writeFile('/source/file.txt', 'Content')

      const result = await fs.move('/source', '/dest')
      expect(result.ok).toBe(true)

      const sourceExists = await fs.exists('/source')
      expect(sourceExists.ok && sourceExists.value).toBe(false)

      const destFile = await fs.readFile('/dest/file.txt')
      expect(destFile.ok && destFile.value).toBe('Content')
    })
  })

  describe('watch', () => {
    it('should return watch function', async () => {
      const result = await fs.watch('/dir', {}, () => {})
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeInstanceOf(Function)
      }
    })

    it('should allow unwatch', async () => {
      const result = await fs.watch('/dir', {}, () => {})
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(() => result.value()).not.toThrow()
      }
    })
  })
})
