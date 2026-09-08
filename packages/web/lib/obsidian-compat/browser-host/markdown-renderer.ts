import { remark } from 'remark';
import gfm from 'remark-gfm';
import html from 'remark-html';
import wikiLink from 'remark-wiki-link';
import './wiki-link-notices';
import { BrowserWikiLinks } from './wiki-links';
import { BrowserMarkdownDom } from './markdown-dom';
import { Component } from '../component';
import yaml from 'js-yaml';
import { getFrontMatterInfo } from '../shims/frontmatter';

type Owner = { assertActive(): void };
type Section = { text: string; lineStart: number; lineEnd: number };
export type BrowserMarkdownContext = {
  sourcePath: string; frontmatter: Record<string, unknown> | null;
  getSectionInfo(element: HTMLElement): Section | null;
  addChild<T extends Component>(child: T): T;
};
export type BrowserMarkdownPostProcessor = ((element: HTMLElement, context: BrowserMarkdownContext) => unknown) & { sortOrder?: number };
export type BrowserCodeBlockProcessor = ((source: string, element: HTMLElement, context: BrowserMarkdownContext) => unknown) & { sortOrder?: number };
type Registration = { owner: Owner; language?: string; processor: BrowserMarkdownPostProcessor | BrowserCodeBlockProcessor };
type Scope = { active: boolean; children: Set<Component>; loading: Promise<unknown>[] };
type Render = { active: boolean; dom: BrowserMarkdownDom; source: string; path: string; scopes: Scope[]; frontmatter: Record<string, unknown> | null;
  component?: Component; lifecycle?: Component };
type MarkdownNode = { type: string; lang?: string; value?: string; children?: MarkdownNode[];
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } } };

/** Real render lifecycle, shared by original plugin code and the preview host. */
export class BrowserMarkdownRenderChild extends Component {
  constructor(readonly containerEl: HTMLElement) { super(); }
}

/** Browser-only rendering. Source HTML is sanitized before plugin processors run. */
export class BrowserMarkdownRenderer {
  private registrations: Registration[] = [];
  private renders = new Map<HTMLElement, Render>();
  private destroyed = false;
  private readonly timeoutMs: number;
  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) throw new Error('Invalid Markdown lifecycle timeout.');
  }
  registerCodeBlock(owner: Owner, language: string, processor: BrowserCodeBlockProcessor): BrowserCodeBlockProcessor {
    if (!/^[\w+-]{1,64}$/.test(language)) throw new Error('Invalid codeblock language.');
    this.register({ owner, language, processor }); return processor;
  }
  registerPostProcessor(owner: Owner, processor: BrowserMarkdownPostProcessor): BrowserMarkdownPostProcessor {
    this.register({ owner, processor }); return processor;
  }
  private register(registration: Registration) {
    if (this.destroyed) throw new Error('Markdown renderer is destroyed.');
    registration.owner.assertActive();
    if (typeof registration.processor !== 'function') throw new Error('Markdown processor must be a function.');
    this.registrations.push(registration);
  }
  async render(source: string, target: HTMLElement, sourcePath: string, component?: Component): Promise<void> {
    if (this.destroyed) throw new Error('Markdown renderer is destroyed.');
    if (typeof source !== 'string' || new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw new Error('Markdown source exceeds the 2 MiB limit.');
    const info = getFrontMatterInfo(source);
    let frontmatter: Record<string, unknown> | null = null;
    if (info.exists) {
      try {
        const value = yaml.load(info.frontmatter) ?? {};
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a YAML mapping.');
        frontmatter = value as Record<string, unknown>;
      } catch (error) { throw new Error('Invalid Markdown frontmatter.', { cause: error }); }
    }
    // Preserve line numbers while omitting YAML from the visible Markdown body.
    const body = info.exists ? source.slice(0, info.contentStart).replace(/[^\r\n]/g, '') + source.slice(info.contentStart) : source;
    const previous = this.renders.get(target);
    const current: Render = { active: true, dom: new BrowserMarkdownDom(), source, path: sourcePath, scopes: [], frontmatter };
    this.renders.set(target, current);
    const assertCurrent = () => {
      if (!current.active || this.renders.get(target) !== current || this.destroyed) throw new Error('Markdown render replaced or closed.');
    };
    try {
      if (component) {
        const lifecycle = new Component();
        lifecycle.onunload = async () => {
          if (this.renders.get(target) === current) this.renders.delete(target);
          await this.dispose(current);
        };
        current.component = component; current.lifecycle = lifecycle; component.addChild(lifecycle);
      }
      if (previous) await this.dispose(previous);
      assertCurrent();
      const links = new BrowserWikiLinks();
      const sourceSections: { tag: string; info: Section | null }[] = [];
      const parser = remark().use(gfm).use(wikiLink, links.options).use(html, {
        handlers: { root(state, node) {
          // Capture the compiler's real output order and source positions before
          // serialization, preserving full-document reference resolution.
          const children = state.wrap(state.all(node));
          for (const child of children) if (child.type === 'element') {
            sourceSections.push({ tag: child.tagName.toUpperCase(), info: child.position ? {
              text: source, lineStart: child.position.start.line - 1, lineEnd: child.position.end.line - 1,
            } : null });
          }
          return children;
        } },
      });
      const tree = parser.parse(body) as MarkdownNode;
      links.preserveEmbeds(tree, body);
      const code: MarkdownNode[] = [];
      const walk = (node: MarkdownNode) => { if (node.type === 'code') code.push(node); node.children?.forEach(walk); };
      walk(tree);
      // remark-html sanitizes source markup/URLs; do not enable sanitize:false.
      // remark-html narrows its compiler input to the Markdown root returned by parse.
      const fragment = document.createElement('div');
      fragment.innerHTML = String(parser.stringify(parser.runSync(tree as ReturnType<typeof parser.parse>) as Parameters<typeof parser.stringify>[0]));
      links.decorate(fragment);
      const sectionInfo = new WeakMap<Element, Section | null>();
      const elements = Array.from(fragment.children);
      // Sanitization or browser normalization may change structure. Return null
      // rather than attributing a section to the wrong source in that case.
      if (elements.length === sourceSections.length && elements.every((el, index) => el.tagName === sourceSections[index].tag)) {
        elements.forEach((el, index) => sectionInfo.set(el, sourceSections[index].info));
      }
      const blocks = Array.from(fragment.querySelectorAll<HTMLElement>('pre'));
      current.dom.publish(target, fragment);
      const registrations = [...this.registrations].sort((a, b) => (a.processor.sortOrder ?? 0) - (b.processor.sortOrder ?? 0));
      for (const registration of registrations) {
        assertCurrent(); registration.owner.assertActive();
        if (registration.language) {
          for (let index = 0; index < code.length; index++) {
            if (code[index].lang !== registration.language || !blocks[index]) continue;
            const block = document.createElement('div'); block.className = `block-language-${registration.language}`;
            sectionInfo.set(block, sectionInfo.get(blocks[index]) ?? null);
            blocks[index].replaceWith(block); blocks[index] = block;
            const position = code[index].position;
            await this.process(current, registration, block, assertCurrent, position
              ? { text: source, lineStart: position.start.line - 1, lineEnd: position.end.line - 1 } : null, code[index].value ?? '');
          }
        } else {
          // Give each processor a live section, never the reusable target. An
          // asynchronous old processor can then only mutate retired nodes.
          for (const section of Array.from(target.children)) {
            assertCurrent();
            if (section instanceof HTMLElement && current.dom.owns(section)) {
              await this.process(current, registration, section, assertCurrent, sectionInfo.get(section) ?? null);
            }
          }
        }
      }
      assertCurrent();
    } catch (error) {
      await this.dispose(current).catch(() => {});
      if (this.renders.get(target) === current) this.renders.delete(target);
      throw error;
    }
  }
  private async process(render: Render, registration: Registration, element: HTMLElement, assertCurrent: () => void, section: Section | null, source?: string) {
    const scope: Scope = { active: true, children: new Set(), loading: [] }; render.scopes.push(scope);
    const context: BrowserMarkdownContext = {
      sourcePath: render.path, frontmatter: structuredClone(render.frontmatter),
      getSectionInfo: candidate => candidate === element || element.contains(candidate) ? section : null,
      addChild: child => {
        if (!scope.active || !render.active) {
          void this.bounded(() => child.unload()).catch(() => {});
          throw new Error('Markdown render context is closed.');
        }
        if (!scope.children.has(child)) {
          scope.children.add(child);
          const loading = this.bounded(() => child.load()); scope.loading.push(loading);
          void loading.catch(() => {});
        }
        return child;
      },
    };
    await this.bounded(() => source === undefined
      ? (registration.processor as BrowserMarkdownPostProcessor)(element, context)
      : (registration.processor as BrowserCodeBlockProcessor)(source, element, context));
    // A child's onload may register more children after an await. Drain every
    // batch, with one deadline for the chain, rather than await one snapshot.
    await this.bounded(async () => {
      let loaded = 0;
      while (loaded < scope.loading.length) {
        const pending = scope.loading.slice(loaded); loaded = scope.loading.length;
        await Promise.all(pending); assertCurrent();
      }
    });
    assertCurrent(); registration.owner.assertActive();
  }
  async clear(target: HTMLElement): Promise<void> {
    const render = this.renders.get(target); if (!render) return;
    this.renders.delete(target); await this.dispose(render);
  }
  async removeOwner(owner: Owner): Promise<void> {
    this.registrations = this.registrations.filter(entry => entry.owner !== owner);
    // Processors may alter shared Markdown DOM. Rebuild instead of leaving stale
    // plugin output or trying to reverse unknown DOM mutations.
    const results = await Promise.allSettled([...this.renders].map(([target, render]) => this.render(render.source, target, render.path, render.component)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Markdown refresh failed.');
  }
  async destroy(): Promise<void> {
    this.destroyed = true; this.registrations = [];
    const results = await Promise.allSettled([...this.renders.keys()].map(target => this.clear(target)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Markdown cleanup failed.');
  }
  private async dispose(render: Render) {
    if (!render.active) return;
    render.active = false; render.dom.dispose();
    if (render.component && render.lifecycle) render.component.removeChild(render.lifecycle);
    const children = render.scopes.flatMap(scope => { scope.active = false; return [...scope.children]; });
    const results = await Promise.allSettled(children.map(child => this.bounded(() => child.unload())));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Markdown child cleanup failed.');
  }
  private async bounded(action: () => unknown): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Markdown processor lifecycle timed out.')), this.timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
}
