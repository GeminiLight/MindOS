/**
 * Obsidian Plugin Compatibility - Vault Shim
 * Maps Obsidian Vault API to MindOS fs-ops + file object model
 */

import fs from 'fs';
import path from 'path';
import { resolveSafe } from '@/lib/core/security';
import { Events } from '../events';
import { IVault, TFile, TFolder, TAbstractFile } from '../types';

export class TAbstractFileImpl implements TAbstractFile {
  vault: IVault;
  path: string;
  name: string;
  parent: TFolder | null = null;

  constructor(vault: IVault, filePath: string) {
    this.vault = vault;
    this.path = filePath;
    this.name = path.basename(filePath);
  }
}

export class TFileImpl extends TAbstractFileImpl implements TFile {
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };

  constructor(vault: IVault, filePath: string, private mindRoot: string) {
    super(vault, filePath);
    this.basename = path.basename(filePath, path.extname(filePath));
    this.extension = path.extname(filePath).slice(1);

    // Stat the file to get timestamps
    try {
      const stats = fs.statSync(path.join(mindRoot, filePath));
      this.stat = {
        ctime: stats.birthtimeMs,
        mtime: stats.mtimeMs,
        size: stats.size,
      };
    } catch {
      this.stat = { ctime: 0, mtime: 0, size: 0 };
    }
  }
}

export class TFolderImpl extends TAbstractFileImpl implements TFolder {
  children: TAbstractFile[] = [];

  constructor(vault: IVault, dirPath: string) {
    super(vault, dirPath);
  }

  isRoot(): boolean {
    return this.path === '';
  }
}

/**
 * Vault shim: maps Obsidian Vault API to MindOS file operations.
 * Emits events on create/modify/delete/rename.
 */
export class Vault extends Events implements IVault {
  private fileCache: Map<string, TFile> = new Map();

  constructor(private mindRoot: string) {
    super();
  }

  private resolve(filePath: string): string {
    return resolveSafe(this.mindRoot, filePath);
  }

  getAbstractFileByPath(filePath: string): TAbstractFile | null {
    try {
      const resolved = this.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return null;
      }
      const stats = fs.statSync(resolved);
      return stats.isDirectory() ? new TFolderImpl(this, filePath) : new TFileImpl(this, filePath, this.mindRoot);
    } catch {
      return null;
    }
  }

  getFileByPath(filePath: string): TFile | null {
    try {
      const resolved = this.resolve(filePath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return null;
      }
      if (!this.fileCache.has(filePath)) {
        this.fileCache.set(filePath, new TFileImpl(this, filePath, this.mindRoot));
      }
      return this.fileCache.get(filePath) || null;
    } catch {
      return null;
    }
  }

  getFolderByPath(dirPath: string): TFolder | null {
    try {
      const resolved = this.resolve(dirPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return null;
      }
      return new TFolderImpl(this, dirPath);
    } catch {
      return null;
    }
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter(f => f.extension === 'md');
  }

  getFiles(): TFile[] {
    const files: TFile[] = [];
    const walkDir = (dir: string, rel: string) => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const relPath = rel ? path.join(rel, entry) : entry;

          if (relPath === '.plugins' || relPath.startsWith(`.plugins${path.sep}`)) {
            continue;
          }

          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            walkDir(fullPath, relPath);
          } else if (stats.isFile()) {
            const file = new TFileImpl(this, relPath, this.mindRoot);
            files.push(file);
            this.fileCache.set(relPath, file);
          }
        }
      } catch {
        // Ignore errors during directory walk
      }
    };
    walkDir(this.mindRoot, '');
    return files;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return this.getFiles();
  }

  async read(file: TFile): Promise<string> {
    try {
      const filePath = this.resolve(file.path);
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async cachedRead(file: TFile): Promise<string> {
    // First-phase: same as read. TODO: add caching in phase 2
    return this.read(file);
  }

  async create(filePath: string, data: string): Promise<TFile> {
    try {
      const resolved = this.resolve(filePath);
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, data, 'utf-8');

      const file = new TFileImpl(this, filePath, this.mindRoot);
      this.fileCache.set(filePath, file);
      this.trigger('create', file);
      return file;
    } catch (err) {
      throw new Error(`Failed to create file: ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async modify(file: TFile, data: string): Promise<void> {
    try {
      const resolved = this.resolve(file.path);
      fs.writeFileSync(resolved, data, 'utf-8');
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to modify file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async append(file: TFile, data: string): Promise<void> {
    try {
      const resolved = this.resolve(file.path);
      const current = fs.readFileSync(resolved, 'utf-8');
      fs.writeFileSync(resolved, current + data, 'utf-8');
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to append to file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(file: TAbstractFile): Promise<void> {
    try {
      const resolved = this.resolve(file.path);
      if (fs.lstatSync(resolved).isDirectory()) {
        fs.rmSync(resolved, { recursive: true, force: true });
      } else {
        fs.unlinkSync(resolved);
      }
      if (file instanceof TFileImpl) {
        this.fileCache.delete(file.path);
      }
      this.trigger('delete', file);
    } catch (err) {
      throw new Error(`Failed to delete file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    try {
      const oldResolved = this.resolve(file.path);
      const newResolved = this.resolve(newPath);
      const newDir = path.dirname(newResolved);
      fs.mkdirSync(newDir, { recursive: true });
      fs.renameSync(oldResolved, newResolved);

      if (file instanceof TFileImpl) {
        this.fileCache.delete(file.path);
      }
      this.trigger('rename', file, file.path);
    } catch (err) {
      throw new Error(`Failed to rename file: ${file.path} -> ${newPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async copy(file: TFile, newPath: string): Promise<TFile> {
    try {
      const content = await this.read(file);
      return this.create(newPath, content);
    } catch (err) {
      throw new Error(`Failed to copy file: ${file.path} -> ${newPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
