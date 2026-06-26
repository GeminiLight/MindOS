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
  __dispatchObsidianEvent?: (type: string, init?: Record<string, unknown>) => Promise<boolean>;
  empty(): void;
  createEl(tagName: string, attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  createDiv(attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  createSpan(attrs?: ObsidianCreateElAttrs | string, callback?: (el: ObsidianElement) => void): ObsidianElement;
  setText(text: string): ObsidianElement;
  appendText(text: string): ObsidianElement;
  addClass(cls: string | string[]): ObsidianElement;
  removeClass(cls: string | string[]): ObsidianElement;
  toggleClass(cls: string, value?: boolean): ObsidianElement;
  setCssProps(props: Record<string, string | number | null | undefined>): ObsidianElement;
  setCssStyles(styles: Record<string, string | number | null | undefined>): ObsidianElement;
  on(type: string, selectorOrCallback: string | EventListener, callback?: EventListener, options?: boolean | AddEventListenerOptions): ObsidianElement;
  off(type: string, selectorOrCallback: string | EventListener, callback?: EventListener, options?: boolean | AddEventListenerOptions): ObsidianElement;
  detach(): void;
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

  target.setCssProps ??= function setCssProps(props) {
    for (const [key, value] of Object.entries(props ?? {})) {
      const property = key.startsWith('--') ? key : `--${key}`;
      if (value === null || value === undefined) {
        this.style.removeProperty(property);
      } else {
        this.style.setProperty(property, String(value));
      }
    }
    return this;
  };

  target.setCssStyles ??= function setCssStyles(styles) {
    for (const [key, value] of Object.entries(styles ?? {})) {
      if (value === null || value === undefined) {
        this.style.removeProperty(key);
      } else if (key.includes('-')) {
        this.style.setProperty(key, String(value));
      } else {
        (this.style as unknown as Record<string, string>)[key] = String(value);
      }
    }
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

  target.detach ??= function detach() {
    this.remove();
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

type StubEventListener = (event: Event) => unknown;

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
  const styleValues = new Map<string, string>();
  const cssRules: Array<{ cssText: string }> = [];
  const listeners = new Map<string, Set<StubEventListener>>();
  let parentElement: ObsidianElement | null = null;
  const style = {
    setProperty(key: string, value: string) {
      styleValues.set(key, value);
    },
    removeProperty(key: string) {
      const previous = styleValues.get(key) ?? '';
      styleValues.delete(key);
      return previous;
    },
    getPropertyValue(key: string) {
      return styleValues.get(key) ?? '';
    },
  };
  const adoptChild = (child: ObsidianElement) => {
    const parent = el as unknown as ObsidianElement;
    const previousParent = (child as unknown as { parentElement?: ObsidianElement | null }).parentElement;
    if (previousParent && previousParent !== parent) {
      previousParent.removeChild(child);
    }
    (child as unknown as { parentElement?: ObsidianElement | null }).parentElement = parent;
    (child as unknown as { parentNode?: ObsidianElement | null }).parentNode = parent;
  };
  const releaseChild = (child: ObsidianElement) => {
    (child as unknown as { parentElement?: ObsidianElement | null }).parentElement = null;
    (child as unknown as { parentNode?: ObsidianElement | null }).parentNode = null;
  };
  const dispatchStubEvent = async (type: string, init: Record<string, unknown> = {}) => {
    const target = el as unknown as EventTarget;
    let defaultPrevented = false;
    const event = {
      type,
      target,
      currentTarget: target,
      isComposing: false,
      ...init,
      get defaultPrevented() {
        return defaultPrevented;
      },
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
    } as unknown as Event & { defaultPrevented: boolean };
    const propertyHandler = (el as Record<string, unknown>)[`on${type}`];
    if (typeof propertyHandler === 'function') {
      await Promise.resolve((propertyHandler as StubEventListener)(event));
    }
    for (const listener of Array.from(listeners.get(type) ?? [])) {
      await Promise.resolve(listener(event));
    }
    return !event.defaultPrevented;
  };

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
    sheet: {
      cssRules,
      insertRule(rule: string, index = cssRules.length) {
        const boundedIndex = Math.max(0, Math.min(index, cssRules.length));
        cssRules.splice(boundedIndex, 0, { cssText: rule });
        return boundedIndex;
      },
      deleteRule(index: number) {
        if (index >= 0 && index < cssRules.length) {
          cssRules.splice(index, 1);
        }
      },
    },
    style,
    classList,
    __stubAttributes: attributes,
    appendChild(child: ObsidianElement) {
      adoptChild(child);
      children.push(child);
      el.firstChild = children[0] ?? null;
      return child;
    },
    insertBefore(child: ObsidianElement, referenceChild: ObsidianElement | null) {
      adoptChild(child);
      const index = referenceChild ? children.indexOf(referenceChild) : -1;
      if (index >= 0) {
        children.splice(index, 0, child);
      } else {
        children.push(child);
      }
      el.firstChild = children[0] ?? null;
      return child;
    },
    removeChild(child: ObsidianElement) {
      const index = children.indexOf(child);
      if (index >= 0) {
        children.splice(index, 1);
        releaseChild(child);
      }
      el.firstChild = children[0] ?? null;
      return child;
    },
    remove() {
      const currentParent = (el as unknown as { parentElement?: ObsidianElement | null }).parentElement ?? parentElement;
      currentParent?.removeChild(el as unknown as ObsidianElement);
    },
    addEventListener(type: string, listener: unknown) {
      if (typeof listener !== 'function') return;
      const normalizedType = String(type);
      const bucket = listeners.get(normalizedType) ?? new Set<StubEventListener>();
      bucket.add(listener as StubEventListener);
      listeners.set(normalizedType, bucket);
    },
    removeEventListener(type: string, listener: unknown) {
      if (typeof listener !== 'function') return;
      listeners.get(String(type))?.delete(listener as StubEventListener);
    },
    dispatchEvent(event: Event) {
      void dispatchStubEvent(String(event.type || ''), event as unknown as Record<string, unknown>);
      return !(event as { defaultPrevented?: boolean }).defaultPrevented;
    },
    async __dispatchObsidianEvent(type: string, init?: Record<string, unknown>) {
      return dispatchStubEvent(type, init);
    },
    click() {
      void dispatchStubEvent('click');
    },
    focus() {},
    select() {},
    blur() {},
    setAttribute(key: string, value: string) {
      attributes.set(key, value);
      (el as Record<string, unknown>)[key] = String(value);
    },
    getAttribute(key: string) {
      return attributes.get(key) ?? null;
    },
    hasAttribute(key: string) {
      return attributes.has(key);
    },
    removeAttribute(key: string) {
      attributes.delete(key);
      delete (el as Record<string, unknown>)[key];
    },
    toggleAttribute(key: string, force?: boolean) {
      const next = force ?? !attributes.has(key);
      if (next) {
        attributes.set(key, '');
      } else {
        attributes.delete(key);
      }
      return next;
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
  Object.defineProperty(el, 'parentNode', {
    configurable: true,
    get: () => parentElement,
    set: (next: ObsidianElement | null) => {
      parentElement = next;
    },
  });
  Object.defineProperty(el, 'nextSibling', {
    configurable: true,
    get: () => {
      if (!parentElement) return null;
      const siblings = getStubChildren(parentElement);
      const index = siblings.indexOf(el as unknown as ObsidianElement);
      return index >= 0 ? siblings[index + 1] ?? null : null;
    },
  });
  Object.defineProperty(el, 'previousSibling', {
    configurable: true,
    get: () => {
      if (!parentElement) return null;
      const siblings = getStubChildren(parentElement);
      const index = siblings.indexOf(el as unknown as ObsidianElement);
      return index > 0 ? siblings[index - 1] ?? null : null;
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
