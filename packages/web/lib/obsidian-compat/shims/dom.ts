import type { PluginSettingItem } from '../types';

export interface ObsidianCreateElAttrs {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string | number | boolean>;
  href?: string;
  title?: string;
  type?: string;
  value?: string;
}

export type ObsidianElement = HTMLElement & {
  __obsidianSettingItems?: PluginSettingItem[];
  empty(): void;
  createEl(tagName: string, attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  createDiv(attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  createSpan(attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  setText(text: string): ObsidianElement;
  appendText(text: string): ObsidianElement;
  addClass(cls: string | string[]): ObsidianElement;
  removeClass(cls: string | string[]): ObsidianElement;
  toggleClass(cls: string, value?: boolean): ObsidianElement;
  on(type: string, selectorOrCallback: string | EventListener, callback?: EventListener, options?: boolean | AddEventListenerOptions): ObsidianElement;
  off(type: string, selectorOrCallback: string | EventListener, callback?: EventListener, options?: boolean | AddEventListenerOptions): ObsidianElement;
};

function normalizeClasses(cls: string | string[] | undefined): string[] {
  if (!cls) return [];
  return Array.isArray(cls) ? cls : cls.split(/\s+/).filter(Boolean);
}

function applyAttrs(el: ObsidianElement, attrs?: ObsidianCreateElAttrs | string): void {
  if (!attrs) return;
  if (typeof attrs === 'string') {
    el.addClass(attrs);
    return;
  }

  if (attrs.text !== undefined) {
    el.textContent = attrs.text;
  }
  if (attrs.title !== undefined) {
    el.title = attrs.title;
  }
  if (attrs.href !== undefined) {
    el.setAttribute('href', attrs.href);
  }
  if (attrs.type !== undefined) {
    el.setAttribute('type', attrs.type);
  }
  if (attrs.value !== undefined) {
    (el as unknown as { value: string }).value = attrs.value;
  }
  for (const cls of normalizeClasses(attrs.cls)) {
    el.classList.add(cls);
  }
  for (const [key, value] of Object.entries(attrs.attr ?? {})) {
    el.setAttribute(key, String(value));
  }
}

function attachHelpers(el: HTMLElement): ObsidianElement {
  const target = el as ObsidianElement;

  target.empty ??= function empty() {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
    this.textContent = '';
    this.innerHTML = '';
    if (this.__obsidianSettingItems) {
      this.__obsidianSettingItems.length = 0;
    }
  };

  target.createEl ??= function createEl(tagName, attrs, callback) {
    const child = createObsidianElement(tagName);
    applyAttrs(child, attrs);
    this.appendChild(child);
    callback?.(child);
    return child;
  };

  target.createDiv ??= function createDiv(attrs, callback) {
    return this.createEl('div', attrs, callback);
  };

  target.createSpan ??= function createSpan(attrs, callback) {
    return this.createEl('span', attrs, callback);
  };

  target.setText ??= function setText(text) {
    this.textContent = text;
    return this;
  };

  target.appendText ??= function appendText(text) {
    this.textContent = `${this.textContent ?? ''}${text}`;
    return this;
  };

  target.addClass ??= function addClass(cls) {
    for (const item of normalizeClasses(cls)) {
      this.classList.add(item);
    }
    return this;
  };

  target.removeClass ??= function removeClass(cls) {
    for (const item of normalizeClasses(cls)) {
      this.classList.remove(item);
    }
    return this;
  };

  target.toggleClass ??= function toggleClass(cls, value) {
    this.classList.toggle(cls, value);
    return this;
  };

  target.on ??= function on(type, selectorOrCallback, callback, options) {
    const listener = typeof selectorOrCallback === 'function' ? selectorOrCallback : callback;
    if (listener) {
      this.addEventListener(type, listener, options);
    }
    return this;
  };

  target.off ??= function off(type, selectorOrCallback, callback, options) {
    const listener = typeof selectorOrCallback === 'function' ? selectorOrCallback : callback;
    if (listener) {
      this.removeEventListener(type, listener, options);
    }
    return this;
  };

  return target;
}

function createStubClassList() {
  const classes = new Set<string>();
  return {
    add: (...items: string[]) => items.forEach((item) => classes.add(item)),
    remove: (...items: string[]) => items.forEach((item) => classes.delete(item)),
    toggle: (item: string, value?: boolean) => {
      const next = value ?? !classes.has(item);
      if (next) classes.add(item);
      else classes.delete(item);
      return next;
    },
    contains: (item: string) => classes.has(item),
    toString: () => Array.from(classes).join(' '),
  };
}

type StubElementInternals = ObsidianElement & {
  __stubAttributes?: Map<string, string>;
};

function getStubChildren(element: ObsidianElement): ObsidianElement[] {
  return Array.from((element as unknown as { children?: Iterable<ObsidianElement> }).children ?? []);
}

function matchesStubSelector(element: ObsidianElement, selector: string): boolean {
  const simple = selector.trim().split(/\s+/).pop()?.trim() ?? '';
  if (!simple) return false;

  const attrMatches = Array.from(simple.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g));
  const withoutAttrs = simple.replace(/\[[^\]]+\]/g, '');
  const classNames = Array.from(withoutAttrs.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((match) => match[1]);
  const tagName = withoutAttrs.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();

  if (tagName && element.tagName.toLowerCase() !== tagName.toLowerCase()) {
    return false;
  }
  for (const cls of classNames) {
    if (!element.classList.contains(cls)) return false;
  }

  const attrs = (element as StubElementInternals).__stubAttributes;
  for (const match of attrMatches) {
    const key = match[1];
    const expected = match[2];
    const actual = attrs?.get(key) ?? null;
    if (actual === null) return false;
    if (expected !== undefined && actual !== expected) return false;
  }

  return true;
}

function queryStubDescendants(element: ObsidianElement, selector: string): ObsidianElement[] {
  const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
  if (selectors.length === 0) return [];

  const result: ObsidianElement[] = [];
  const visit = (node: ObsidianElement) => {
    for (const child of getStubChildren(node)) {
      if (selectors.some((item) => matchesStubSelector(child, item))) {
        result.push(child);
      }
      visit(child);
    }
  };
  visit(element);
  return result;
}

function createStubElement(tagName: string): ObsidianElement {
  const children: ObsidianElement[] = [];
  const attributes = new Map<string, string>();
  const classList = createStubClassList();
  let parentElement: ObsidianElement | null = null;

  const el: Record<string, unknown> = {
    tagName: tagName.toUpperCase(),
    nodeName: tagName.toUpperCase(),
    children,
    childNodes: children,
    firstChild: null as unknown,
    parentElement: null as ObsidianElement | null,
    textContent: '',
    innerHTML: '',
    title: '',
    value: '',
    dataset: {},
    style: {},
    classList,
    __stubAttributes: attributes,
    appendChild(child: ObsidianElement) {
      Object.defineProperty(child, 'parentElement', {
        configurable: true,
        get: () => el as unknown as ObsidianElement,
      });
      children.push(child);
      el.firstChild = children[0] ?? null;
      return child;
    },
    removeChild(child: ObsidianElement) {
      const index = children.indexOf(child);
      if (index >= 0) {
        children.splice(index, 1);
      }
      el.firstChild = children[0] ?? null;
      return child;
    },
    remove() {
      const currentParent = (el as unknown as { parentElement?: ObsidianElement | null }).parentElement ?? parentElement;
      currentParent?.removeChild(el as unknown as ObsidianElement);
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(key: string, value: string) {
      attributes.set(key, value);
    },
    getAttribute(key: string) {
      return attributes.get(key) ?? null;
    },
    querySelector(selector: string) {
      return queryStubDescendants(el as unknown as ObsidianElement, selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return queryStubDescendants(el as unknown as ObsidianElement, selector);
    },
    cloneNode() {
      const clone = createStubElement(tagName);
      clone.textContent = String(el.textContent ?? '');
      clone.innerHTML = String(el.innerHTML ?? '');
      return clone;
    },
  };

  Object.defineProperty(el, 'parentElement', {
    configurable: true,
    get: () => parentElement,
    set: (next: ObsidianElement | null) => {
      parentElement = next;
    },
  });

  return attachHelpers(el as unknown as HTMLElement);
}

export function createObsidianElement(tagName = 'div'): ObsidianElement {
  if (typeof document !== 'undefined') {
    return attachHelpers(document.createElement(tagName));
  }
  return createStubElement(tagName);
}

export function ensureObsidianElement(el: HTMLElement): ObsidianElement {
  return attachHelpers(el);
}
