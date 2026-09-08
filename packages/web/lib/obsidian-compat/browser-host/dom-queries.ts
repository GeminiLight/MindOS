/** Native selectors, installed only by the disposable-frame DOM entrypoint. */
export function installBrowserDomQueries(): void {
  const queries = {
    find(this: ParentNode, selector: string) { return this.querySelector(selector); },
    findAll(this: ParentNode, selector: string) { return Array.from(this.querySelectorAll(selector)); },
  };
  for (const prototype of [Element.prototype, DocumentFragment.prototype]) {
    for (const [name, value] of Object.entries(queries)) {
      if (!(name in prototype)) Object.defineProperty(prototype, name, { value, configurable: true, writable: true });
    }
  }
  if (!('findAllSelf' in Element.prototype)) Object.defineProperty(Element.prototype, 'findAllSelf', {
    configurable: true, writable: true,
    value(this: Element, selector: string) {
      return [...(this.matches(selector) ? [this] : []), ...this.querySelectorAll(selector)];
    },
  });
}
