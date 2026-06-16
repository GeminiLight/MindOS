/**
 * Obsidian Plugin Compatibility - Vault Shim
 * Maps Obsidian Vault API to MindOS fs-ops + file object model
 */

import fs from 'fs';
import path from 'path';
import { resolveExistingSafe, resolveSafe } from '@/lib/core/security';
import { Events } from '../events';
import { DataAdapter, DataWriteOptions, IVault, ListedFiles, Stat, TFile, TFolder, TAbstractFile } from '../types';

const PRIVATE_VAULT_DIRS = new Set(['.mindos', '.obsidian', '.plugins']);

function normalizeVaultPath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

function isPrivateVaultPath(input: string): boolean {
  const normalizedPath = normalizeVaultPath(input);
  if (!normalizedPath) return false;
  const topLevelDir = normalizedPath.split('/')[0] ?? normalizedPath;
  return PRIVATE_VAULT_DIRS.has(topLevelDir);
}

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function statFromFs(stats: fs.Stats): Stat {
  return {
    type: stats.isDirectory() ? 'folder' : 'file',
    ctime: stats.birthtimeMs,
    mtime: stats.mtimeMs,
    size: stats.size,
  };
}

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

  updatePath(filePath: string): void {
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
    this.stat = this.readStat();
  }

  updatePath(filePath: string): void {
    super.updatePath(filePath);
    this.basename = path.basename(filePath, path.extname(filePath));
    this.extension = path.extname(filePath).slice(1);
    this.refreshStat();
  }

  refreshStat(): void {
    this.stat = this.readStat();
  }

  private readStat(): { ctime: number; mtime: number; size: number } {
    try {
      const stats = fs.statSync(resolveExistingSafe(this.mindRoot, this.path));
      return {
        ctime: stats.birthtimeMs,
        mtime: stats.mtimeMs,
        size: stats.size,
      };
    } catch {
      return { ctime: 0, mtime: 0, size: 0 };
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

class VaultDataAdapter implements DataAdapter {
  constructor(private readonly vault: Vault) {}

  getName(): string {
    return this.vault.getName();
  }

  async exists(normalizedPath: string, _sensitive?: boolean): Promise<boolean> {
    return this.vault.adapterExists(normalizedPath);
  }

  async stat(normalizedPath: string): Promise<Stat | null> {
    return this.vault.adapterStat(normalizedPath);
  }

  async list(normalizedPath: string): Promise<ListedFiles> {
    return this.vault.adapterList(normalizedPath);
  }

  async read(normalizedPath: string): Promise<string> {
    return this.vault.adapterRead(normalizedPath);
  }

  async readBinary(normalizedPath: string): Promise<ArrayBuffer> {
    return this.vault.adapterReadBinary(normalizedPath);
  }

  async write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void> {
    this.vault.adapterWrite(normalizedPath, data, options);
  }

  async writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    this.vault.adapterWriteBinary(normalizedPath, data, options);
  }

  async append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void> {
    this.vault.adapterAppend(normalizedPath, data, options);
  }

  async appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    this.vault.adapterAppendBinary(normalizedPath, data, options);
  }

  async process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
    const nextData = fn(await this.read(normalizedPath));
    await this.write(normalizedPath, nextData, options);
    return nextData;
  }

  getResourcePath(normalizedPath: string): string {
    return `mindos-vault:///${encodeURIComponent(normalizeVaultPath(normalizedPath))}`;
  }

  async mkdir(normalizedPath: string): Promise<void> {
    this.vault.adapterMkdir(normalizedPath);
  }

  async remove(normalizedPath: string): Promise<void> {
    this.vault.adapterRemove(normalizedPath);
  }

  async rmdir(normalizedPath: string, recursive = false): Promise<void> {
    this.vault.adapterRemove(normalizedPath, { directoryOnly: true, recursive });
  }

  async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    this.vault.adapterRename(normalizedPath, normalizedNewPath);
  }

  async copy(normalizedPath: string, normalizedNewPath: string): Promise<void> {
    this.vault.adapterCopy(normalizedPath, normalizedNewPath);
  }

  async trashSystem(normalizedPath: string): Promise<boolean> {
    void normalizedPath;
    return false;
  }

  async trashLocal(normalizedPath: string): Promise<void> {
    await this.remove(normalizedPath);
  }
}

/**
 * Vault shim: maps Obsidian Vault API to MindOS file operations.
 * Emits events on create/modify/delete/rename.
 */
export class Vault extends Events implements IVault {
  adapter: DataAdapter;
  configDir = '.obsidian';
  private fileCache: Map<string, TFile> = new Map();

  constructor(private mindRoot: string) {
    super();
    this.adapter = new VaultDataAdapter(this);
  }

  static recurseChildren(root: TFolder, callback: (file: TAbstractFile) => void): void {
    for (const child of root.children) {
      callback(child);
      const folder = child as Partial<TFolder>;
      if (Array.isArray(folder.children)) {
        Vault.recurseChildren(folder as TFolder, callback);
      }
    }
  }

  private resolve(filePath: string): string {
    return resolveSafe(this.mindRoot, normalizeVaultPath(filePath));
  }

  private assertPublicVaultPath(filePath: string): void {
    if (isPrivateVaultPath(filePath)) {
      throw new Error(`Vault path is private: ${filePath}`);
    }
  }

  private isRealPathWithinRoot(resolvedPath: string): boolean {
    try {
      const rootRealPath = fs.realpathSync(this.mindRoot);
      const targetRealPath = fs.realpathSync(resolvedPath);
      const relative = path.relative(rootRealPath, targetRealPath);
      return relative === '' || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
      );
    } catch {
      return false;
    }
  }

  private resolveExisting(filePath: string): string {
    const normalizedPath = normalizeVaultPath(filePath);
    this.assertPublicVaultPath(normalizedPath);
    const resolved = this.resolve(normalizedPath);
    if (fs.existsSync(resolved) && !this.isRealPathWithinRoot(resolved)) {
      throw new Error(`Path resolves outside vault: ${filePath}`);
    }
    return resolved;
  }

  private resolveForWrite(filePath: string): string {
    const normalizedPath = normalizeVaultPath(filePath);
    this.assertPublicVaultPath(normalizedPath);
    const resolved = this.resolve(normalizedPath);
    let existingParent = path.dirname(resolved);
    while (!fs.existsSync(existingParent)) {
      const parent = path.dirname(existingParent);
      if (parent === existingParent) {
        break;
      }
      existingParent = parent;
    }
    if (!this.isRealPathWithinRoot(existingParent)) {
      throw new Error(`Path resolves outside vault: ${filePath}`);
    }
    return resolved;
  }

  private applyWriteOptions(resolvedPath: string, options?: DataWriteOptions): void {
    if (options?.ctime === undefined && options?.mtime === undefined) {
      return;
    }
    try {
      const current = fs.statSync(resolvedPath);
      const atime = current.atime;
      const mtime = new Date(options.mtime ?? current.mtimeMs);
      fs.utimesSync(resolvedPath, atime, mtime);
    } catch {
      // Obsidian treats write options as best-effort metadata hints.
    }
  }

  private clearCacheForPath(vaultPath: string): void {
    const normalized = normalizeVaultPath(vaultPath);
    this.fileCache.delete(normalized);
    for (const key of Array.from(this.fileCache.keys())) {
      if (key.startsWith(`${normalized}/`)) {
        this.fileCache.delete(key);
      }
    }
  }

  private toAbstractFile(vaultPath: string, resolvedPath?: string): TAbstractFile {
    const normalized = normalizeVaultPath(vaultPath);
    const resolved = resolvedPath ?? this.resolveExisting(normalized);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? new TFolderImpl(this, normalized)
      : new TFileImpl(this, normalized, this.mindRoot);
  }

  private triggerAdapterWrite(vaultPath: string, existedBefore: boolean): void {
    const file = new TFileImpl(this, vaultPath, this.mindRoot);
    this.fileCache.set(vaultPath, file);
    this.trigger(existedBefore ? 'modify' : 'create', file);
  }

  getName(): string {
    return path.basename(this.mindRoot);
  }

  getAbstractFileByPath(filePath: string): TAbstractFile | null {
    try {
      const normalizedPath = normalizeVaultPath(filePath);
      const resolved = this.resolveExisting(normalizedPath);
      if (!fs.existsSync(resolved)) {
        return null;
      }
      const stats = fs.statSync(resolved);
      return stats.isDirectory() ? new TFolderImpl(this, normalizedPath) : new TFileImpl(this, normalizedPath, this.mindRoot);
    } catch {
      return null;
    }
  }

  getFileByPath(filePath: string): TFile | null {
    try {
      const normalizedPath = normalizeVaultPath(filePath);
      const resolved = this.resolveExisting(normalizedPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return null;
      }
      if (!this.fileCache.has(normalizedPath)) {
        this.fileCache.set(normalizedPath, new TFileImpl(this, normalizedPath, this.mindRoot));
      }
      return this.fileCache.get(normalizedPath) || null;
    } catch {
      return null;
    }
  }

  getFolderByPath(dirPath: string): TFolder | null {
    try {
      const normalizedPath = normalizeVaultPath(dirPath);
      const resolved = this.resolveExisting(normalizedPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return null;
      }
      return new TFolderImpl(this, normalizedPath);
    } catch {
      return null;
    }
  }

  getRoot(): TFolder {
    return new TFolderImpl(this, '');
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

          if (isPrivateVaultPath(relPath)) {
            continue;
          }

          const stats = fs.lstatSync(fullPath);
          if (stats.isSymbolicLink() || !this.isRealPathWithinRoot(fullPath)) {
            continue;
          }
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
      const filePath = this.resolveExisting(file.path);
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    try {
      return arrayBufferFromBuffer(fs.readFileSync(this.resolveExisting(file.path)));
    } catch (err) {
      throw new Error(`Failed to read binary file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async cachedRead(file: TFile): Promise<string> {
    // First-phase: same as read. TODO: add caching in phase 2
    return this.read(file);
  }

  async create(filePath: string, data: string, options?: DataWriteOptions): Promise<TFile> {
    try {
      const normalizedPath = normalizeVaultPath(filePath);
      const resolved = this.resolveForWrite(normalizedPath);
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, data, 'utf-8');
      this.applyWriteOptions(resolved, options);

      const file = new TFileImpl(this, normalizedPath, this.mindRoot);
      this.fileCache.set(normalizedPath, file);
      this.trigger('create', file);
      return file;
    } catch (err) {
      throw new Error(`Failed to create file: ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createBinary(filePath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
    try {
      const normalizedPath = normalizeVaultPath(filePath);
      const resolved = this.resolveForWrite(normalizedPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, Buffer.from(data));
      this.applyWriteOptions(resolved, options);

      const file = new TFileImpl(this, normalizedPath, this.mindRoot);
      this.fileCache.set(normalizedPath, file);
      this.trigger('create', file);
      return file;
    } catch (err) {
      throw new Error(`Failed to create binary file: ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createFolder(folderPath: string): Promise<TFolder> {
    try {
      const normalizedPath = normalizeVaultPath(folderPath);
      const resolved = this.resolveForWrite(normalizedPath);
      fs.mkdirSync(resolved, { recursive: true });
      const folder = new TFolderImpl(this, normalizedPath);
      this.trigger('create', folder);
      return folder;
    } catch (err) {
      throw new Error(`Failed to create folder: ${folderPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    try {
      const resolved = this.resolveExisting(file.path);
      fs.writeFileSync(resolved, data, 'utf-8');
      this.applyWriteOptions(resolved, options);
      if (file instanceof TFileImpl) {
        file.refreshStat();
        this.fileCache.set(file.path, file);
      }
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to modify file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    try {
      const resolved = this.resolveExisting(file.path);
      fs.writeFileSync(resolved, Buffer.from(data));
      this.applyWriteOptions(resolved, options);
      if (file instanceof TFileImpl) {
        file.refreshStat();
        this.fileCache.set(file.path, file);
      }
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to modify binary file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async append(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    try {
      const resolved = this.resolveExisting(file.path);
      const current = fs.readFileSync(resolved, 'utf-8');
      fs.writeFileSync(resolved, current + data, 'utf-8');
      this.applyWriteOptions(resolved, options);
      if (file instanceof TFileImpl) {
        file.refreshStat();
        this.fileCache.set(file.path, file);
      }
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to append to file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async appendBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    try {
      const resolved = this.resolveExisting(file.path);
      fs.appendFileSync(resolved, Buffer.from(data));
      this.applyWriteOptions(resolved, options);
      if (file instanceof TFileImpl) {
        file.refreshStat();
        this.fileCache.set(file.path, file);
      }
      this.trigger('modify', file);
    } catch (err) {
      throw new Error(`Failed to append binary to file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async process(file: TFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
    const nextData = fn(await this.read(file));
    await this.modify(file, nextData, options);
    return nextData;
  }

  getResourcePath(file: TFile): string {
    return this.adapter.getResourcePath(file.path);
  }

  async delete(file: TAbstractFile, _force?: boolean): Promise<void> {
    try {
      const resolved = this.resolveExisting(file.path);
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

  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    try {
      if (system && await this.adapter.trashSystem(file.path)) {
        return;
      }
      await this.adapter.trashLocal(file.path);
    } catch (err) {
      throw new Error(`Failed to trash file: ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    try {
      const oldResolved = this.resolveExisting(file.path);
      const normalizedNewPath = normalizeVaultPath(newPath);
      const newResolved = this.resolveForWrite(normalizedNewPath);
      const oldPath = file.path;
      const newDir = path.dirname(newResolved);
      fs.mkdirSync(newDir, { recursive: true });
      fs.renameSync(oldResolved, newResolved);

      if (file instanceof TFileImpl) {
        this.fileCache.delete(oldPath);
        file.updatePath(normalizedNewPath);
        this.fileCache.set(normalizedNewPath, file);
      } else if (file instanceof TFolderImpl) {
        file.updatePath(normalizedNewPath);
      } else {
        file.path = normalizedNewPath;
        file.name = path.basename(normalizedNewPath);
      }
      this.trigger('rename', file, oldPath);
    } catch (err) {
      throw new Error(`Failed to rename file: ${file.path} -> ${newPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async copy(file: TFile, newPath: string): Promise<TFile> {
    try {
      const sourceResolved = this.resolveExisting(file.path);
      const normalizedNewPath = normalizeVaultPath(newPath);
      const targetResolved = this.resolveForWrite(normalizedNewPath);
      fs.mkdirSync(path.dirname(targetResolved), { recursive: true });
      fs.copyFileSync(sourceResolved, targetResolved);
      const copied = new TFileImpl(this, normalizedNewPath, this.mindRoot);
      this.fileCache.set(normalizedNewPath, copied);
      this.trigger('create', copied);
      return copied;
    } catch (err) {
      throw new Error(`Failed to copy file: ${file.path} -> ${newPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  adapterExists(vaultPath: string): boolean {
    try {
      return fs.existsSync(this.resolveExisting(vaultPath));
    } catch {
      return false;
    }
  }

  adapterStat(vaultPath: string): Stat | null {
    try {
      const resolved = this.resolveExisting(vaultPath);
      if (!fs.existsSync(resolved)) {
        return null;
      }
      return statFromFs(fs.statSync(resolved));
    } catch {
      return null;
    }
  }

  adapterList(vaultPath: string): ListedFiles {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveExisting(normalizedPath);
    const files: string[] = [];
    const folders: string[] = [];

    for (const entry of fs.readdirSync(resolved)) {
      const childPath = normalizedPath ? `${normalizedPath}/${entry}` : entry;
      const childResolved = path.join(resolved, entry);
      if (isPrivateVaultPath(childPath)) {
        continue;
      }
      if (!this.isRealPathWithinRoot(childResolved)) {
        continue;
      }
      const stats = fs.statSync(childResolved);
      if (stats.isDirectory()) {
        folders.push(childPath);
      } else if (stats.isFile()) {
        files.push(childPath);
      }
    }

    return {
      files: files.sort(),
      folders: folders.sort(),
    };
  }

  adapterRead(vaultPath: string): string {
    return fs.readFileSync(this.resolveExisting(vaultPath), 'utf-8');
  }

  adapterReadBinary(vaultPath: string): ArrayBuffer {
    return arrayBufferFromBuffer(fs.readFileSync(this.resolveExisting(vaultPath)));
  }

  adapterWrite(vaultPath: string, data: string, options?: DataWriteOptions): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveForWrite(normalizedPath);
    const existedBefore = fs.existsSync(resolved);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, data, 'utf-8');
    this.applyWriteOptions(resolved, options);
    this.triggerAdapterWrite(normalizedPath, existedBefore);
  }

  adapterWriteBinary(vaultPath: string, data: ArrayBuffer, options?: DataWriteOptions): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveForWrite(normalizedPath);
    const existedBefore = fs.existsSync(resolved);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, Buffer.from(data));
    this.applyWriteOptions(resolved, options);
    this.triggerAdapterWrite(normalizedPath, existedBefore);
  }

  adapterAppend(vaultPath: string, data: string, options?: DataWriteOptions): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveForWrite(normalizedPath);
    const existedBefore = fs.existsSync(resolved);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, data, 'utf-8');
    this.applyWriteOptions(resolved, options);
    this.triggerAdapterWrite(normalizedPath, existedBefore);
  }

  adapterAppendBinary(vaultPath: string, data: ArrayBuffer, options?: DataWriteOptions): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveForWrite(normalizedPath);
    const existedBefore = fs.existsSync(resolved);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, Buffer.from(data));
    this.applyWriteOptions(resolved, options);
    this.triggerAdapterWrite(normalizedPath, existedBefore);
  }

  adapterMkdir(vaultPath: string): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveForWrite(normalizedPath);
    const existedBefore = fs.existsSync(resolved);
    fs.mkdirSync(resolved, { recursive: true });
    if (!existedBefore) {
      this.trigger('create', new TFolderImpl(this, normalizedPath));
    }
  }

  adapterRemove(vaultPath: string, options: { directoryOnly?: boolean; recursive?: boolean } = {}): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const resolved = this.resolveExisting(normalizedPath);
    const file = this.toAbstractFile(normalizedPath, resolved);
    const stats = fs.statSync(resolved);

    if (options.directoryOnly && !stats.isDirectory()) {
      throw new Error(`Path is not a folder: ${vaultPath}`);
    }
    if (stats.isDirectory()) {
      fs.rmSync(resolved, { recursive: options.recursive ?? true, force: false });
      this.clearCacheForPath(normalizedPath);
    } else {
      fs.unlinkSync(resolved);
      this.fileCache.delete(normalizedPath);
    }
    this.trigger('delete', file);
  }

  adapterRename(vaultPath: string, newPath: string): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const normalizedNewPath = normalizeVaultPath(newPath);
    const oldResolved = this.resolveExisting(normalizedPath);
    const newResolved = this.resolveForWrite(normalizedNewPath);
    const file = this.toAbstractFile(normalizedPath, oldResolved);
    fs.mkdirSync(path.dirname(newResolved), { recursive: true });
    fs.renameSync(oldResolved, newResolved);
    this.clearCacheForPath(normalizedPath);
    if (file instanceof TFileImpl) {
      file.updatePath(normalizedNewPath);
      this.fileCache.set(normalizedNewPath, file);
    } else if (file instanceof TFolderImpl) {
      file.updatePath(normalizedNewPath);
    } else {
      file.path = normalizedNewPath;
      file.name = path.basename(normalizedNewPath);
    }
    this.trigger('rename', file, normalizedPath);
  }

  adapterCopy(vaultPath: string, newPath: string): void {
    const normalizedPath = normalizeVaultPath(vaultPath);
    const normalizedNewPath = normalizeVaultPath(newPath);
    const sourceResolved = this.resolveExisting(normalizedPath);
    const targetResolved = this.resolveForWrite(normalizedNewPath);
    fs.mkdirSync(path.dirname(targetResolved), { recursive: true });
    fs.cpSync(sourceResolved, targetResolved, { recursive: true });
    const created = this.toAbstractFile(normalizedNewPath, targetResolved);
    if (created instanceof TFileImpl) {
      this.fileCache.set(normalizedNewPath, created);
    }
    this.trigger('create', created);
  }
}
