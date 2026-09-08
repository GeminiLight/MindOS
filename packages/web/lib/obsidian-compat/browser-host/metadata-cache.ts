import { Events, type EventCallback, type EventRef } from '../events';
import { parseMarkdownMetadata, stripSubpath } from '../markdown-metadata';
import { normalizeObsidianTag, parseFrontMatterTagValues } from '../shims/tags';
import { BrowserTFile, type BrowserVaultController } from './vault';

type Metadata = ReturnType<typeof parseMarkdownMetadata>;
function normalizeLink(path: string): string | null {
  if (/[\\:\x00-\x1f]/.test(path) || path.startsWith('/')) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else { if (part.startsWith('.')) return null; parts.push(part); }
  }
  return parts.join('/');
}

/** Synchronous metadata reads over the broker's already-approved byte snapshot. */
export class BrowserMetadataCache extends Events {
  #controller: BrowserVaultController;
  #cache = new Map<BrowserTFile, Metadata>();
  #refs: EventRef[] = [];
  #listeners = new Set<EventRef>();
  #closed = false;
  constructor(controller: BrowserVaultController) {
    super(); this.#controller = controller;
    const update = (file: BrowserTFile) => {
      this.#cache.delete(file);
      if (!(file instanceof BrowserTFile) || file.extension.toLowerCase() !== 'md') return;
      this.emit('changed', file, controller.readText(file), this.getFileCache(file));
      this.emit('resolve', file); this.emit('resolved');
    };
    for (const name of ['create', 'modify', 'rename']) this.#refs.push(controller.vault.on(name, update));
    this.#refs.push(controller.vault.on('delete', (file: BrowserTFile) => {
      const before = this.#cache.get(file) ?? null; this.#cache.delete(file);
      if (file instanceof BrowserTFile) { this.emit('deleted', file, structuredClone(before)); this.emit('resolved'); }
    }));
  }
  private assertOpen() { if (this.#closed) throw new Error('Metadata cache is closed.'); }
  override on(name: string, callback: EventCallback, ctx?: unknown): EventRef {
    this.assertOpen(); const ref = super.on(name, callback, ctx); this.#listeners.add(ref);
    const off = ref.off; ref.off = () => { off(); this.#listeners.delete(ref); }; return ref;
  }
  private emit(name: string, ...args: unknown[]) {
    for (const result of this.trigger(name, ...args)) void Promise.resolve(result).catch(error => console.error('[obsidian-compat] Metadata listener failed:', error));
  }
  getFileCache(file: BrowserTFile): Metadata | null {
    this.assertOpen();
    if (!(file instanceof BrowserTFile) || this.#controller.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== 'md') return null;
    if (!this.#cache.has(file)) this.#cache.set(file, parseMarkdownMetadata(this.#controller.readText(file)));
    return structuredClone(this.#cache.get(file)!);
  }
  getCache(path: string): Metadata | null {
    this.assertOpen(); const file = this.#controller.vault.getFileByPath(path); return file ? this.getFileCache(file) : null;
  }
  getCachedFiles(): string[] { this.assertOpen(); return this.#controller.vault.getMarkdownFiles().map(file => file.path); }
  getFirstLinkpathDest(linkpath: string, sourcePath: string): BrowserTFile | null {
    this.assertOpen(); if (typeof linkpath !== 'string' || typeof sourcePath !== 'string') return null;
    let link = stripSubpath(linkpath);
    try { link = decodeURIComponent(link); } catch { /* Preserve literal percent characters. */ }
    if (!link) return this.#controller.vault.getFileByPath(sourcePath);
    const parent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
    const relative = normalizeLink(parent + link); const rooted = normalizeLink(link);
    const candidates = new Set([relative, rooted].filter((candidate): candidate is string => candidate !== null));
    for (const candidate of candidates) {
      const match = this.#controller.vault.getFileByPath(candidate) ?? this.#controller.vault.getFileByPath(`${candidate}.md`);
      if (match) return match;
    }
    if (rooted === null || link.includes('/')) return null;
    const files = this.#controller.vault.getFiles().filter(file => file.name === rooted || file.basename === rooted);
    // The source-relative exact path wins above; prefer the closest shared
    // ancestor for remaining basename ambiguities, then deterministic path order.
    const shared = (file: BrowserTFile) => {
      const a = file.path.split('/'); const b = sourcePath.split('/'); let count = 0;
      while (count < Math.min(a.length - 1, b.length - 1) && a[count] === b[count]) count++; return count;
    };
    return files.sort((a, b) => shared(b) - shared(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0] ?? null;
  }
  fileToLinktext(file: BrowserTFile, _sourcePath: string, omitMdExtension = false): string {
    this.assertOpen();
    if (this.#controller.vault.getFileByPath(file.path) !== file) throw new Error('Foreign or stale link file.');
    return omitMdExtension && file.extension.toLowerCase() === 'md' ? file.path.slice(0, -3) : file.path;
  }
  getTags(): Record<string, number> {
    const counts: Record<string, number> = Object.create(null);
    for (const path of this.getCachedFiles()) {
      const metadata = this.getCache(path)!;
      for (const value of [...(parseFrontMatterTagValues(metadata.frontmatter) ?? []), ...metadata.tags.map(tag => tag.tag)]) {
        const tag = normalizeObsidianTag(value); if (tag) counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  }
  private links() {
    const resolved: Record<string, Record<string, number>> = Object.create(null);
    const unresolved: Record<string, Record<string, number>> = Object.create(null);
    for (const path of this.getCachedFiles()) {
      const metadata = this.getCache(path)!;
      for (const link of [...metadata.links, ...metadata.embeds, ...(metadata.frontmatterLinks ?? [])]) {
        const destination = this.getFirstLinkpathDest(link.link, path);
        const key = destination?.path ?? stripSubpath(link.link); if (!key) continue;
        const map = destination ? resolved : unresolved;
        const counts = map[path] ??= Object.create(null); counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return { resolved, unresolved };
  }
  get resolvedLinks() { return this.links().resolved; }
  get unresolvedLinks() { return this.links().unresolved; }
  dispose() {
    if (this.#closed) return; this.#closed = true;
    this.#refs.forEach(ref => ref.off()); this.#refs = [];
    for (const ref of this.#listeners) ref.off(); this.#cache.clear();
  }
}
