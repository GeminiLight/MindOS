/** Own native render nodes without a visible wrapper. Original plugins unwrap
 * paragraphs and retain section references for later refreshes. Track identity,
 * including moved descendants, rather than clearing a shared target on unload.
 */
export class BrowserMarkdownDom {
  private readonly nodes = new Set<Node>();
  private observer?: MutationObserver;
  publish(target: HTMLElement, fragment: HTMLElement): void {
    for (const node of fragment.childNodes) this.remember(node);
    target.replaceChildren(...fragment.childNodes);
    this.observer = new MutationObserver(records => this.collect(records));
    this.observer.observe(target, { childList: true, subtree: true });
  }
  owns(node: Node): boolean {
    this.collect(this.observer?.takeRecords() ?? []);
    return this.nodes.has(node);
  }
  dispose(): void {
    this.collect(this.observer?.takeRecords() ?? []);
    this.observer?.disconnect(); this.observer = undefined;
    // Keep detached subtrees intact: child unload hooks still need their widget
    // DOM to dispose it. Moved descendants without an owned parent are roots too.
    const roots = [...this.nodes].filter(node => node.parentNode && !this.nodes.has(node.parentNode));
    for (const node of roots) node.parentNode?.removeChild(node);
    this.nodes.clear();
  }
  private remember(node: Node): void {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ALL);
    this.nodes.add(node);
    while (walker.nextNode()) this.nodes.add(walker.currentNode);
  }
  private collect(records: MutationRecord[]): void {
    if (records.length === 0) return;
    for (const record of records) {
      // Direct replacements inherit ownership; unrelated host siblings do not.
      if (this.nodes.has(record.target) || [...record.removedNodes].some(node => this.nodes.has(node))) {
        for (const node of record.addedNodes) this.remember(node);
      }
    }
    // A tree rooted in one of our own nodes is retired and detached. Do this
    // after the whole batch so unwrap/reparent into another (even detached)
    // host container keeps ownership. Evaluate roots before deleting any keys.
    const retired = [...this.nodes].filter(node => this.nodes.has(node.getRootNode()));
    for (const node of retired) this.nodes.delete(node);
  }
}
