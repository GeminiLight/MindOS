type Node = { type: string; value?: string; data?: unknown; children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } } };

/** Per-render routing markers keep source Markdown from impersonating generated links.
 * Actual navigation belongs to the still-separate approved document coordinator.
 */
export class BrowserWikiLinks {
  // getRandomValues is also available in the opaque browser host, where
  // secure-context-only randomUUID is absent. Keep 128 bits of unpredictability.
  private readonly prefix = `#mindos-wiki-${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')}-`;
  private readonly paths: string[] = [];
  readonly options = {
    aliasDivider: '|',
    pageResolver: (name: string) => [name],
    hrefTemplate: (path: string) => `${this.prefix}${this.paths.push(path) - 1}`,
  };
  preserveEmbeds(node: Node, source: string): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    let escapes = 0;
    if (start !== undefined) for (let index = start - 2; source[index] === '\\'; index--) escapes++;
    if (node.type === 'wikiLink' && start !== undefined && end !== undefined && source[start - 1] === '!' && escapes % 2 === 0) {
      // An image/file embed is not an ordinary link. Leave unsupported embeds
      // visible rather than silently turning them into a different operation.
      node.type = 'text'; node.value = source.slice(start, end); delete node.data;
    }
    node.children?.forEach(child => this.preserveEmbeds(child, source));
  }
  decorate(root: HTMLElement): void {
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a')) {
      const href = anchor.getAttribute('href');
      if (!href?.startsWith(this.prefix)) continue;
      const path = this.paths[Number(href.slice(this.prefix.length))];
      if (path === undefined) continue;
      anchor.classList.add('internal-link');
      anchor.dataset.href = path;
      anchor.setAttribute('href', `#${encodeURIComponent(path)}`);
      anchor.setAttribute('aria-disabled', 'true');
      anchor.title = 'Link navigation is not yet available in this isolated editor.';
      anchor.addEventListener('click', event => event.preventDefault());
    }
  }
}
