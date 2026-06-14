export const OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES = 256 * 1024;

const SCOPED_CONTAINER_AT_RULES = new Set(['media', 'supports', 'container', 'layer']);

export interface PluginStylesheetSnapshot {
  pluginId: string;
  path: 'styles.css';
  bytes: number;
  css: string;
  scopedCss: string;
  scopeSelector: string;
}

export function pluginStyleScopeSelector(pluginId: string): string {
  return `[data-obsidian-plugin-view="${escapeCssString(pluginId)}"]`;
}

export function scopePluginCss(css: string, scopeSelector: string): string {
  return scopeCssBlock(css, scopeSelector).trim();
}

function scopeCssBlock(css: string, scopeSelector: string): string {
  let output = '';
  let index = 0;

  while (index < css.length) {
    const triviaStart = index;
    index = readTrivia(css, index);
    output += css.slice(triviaStart, index);
    if (index >= css.length) break;

    const delimiter = findRuleDelimiter(css, index);
    if (!delimiter) break;

    const prelude = css.slice(index, delimiter.index).trim();
    if (!prelude) {
      index = delimiter.index + 1;
      continue;
    }

    if (delimiter.kind === ';') {
      index = delimiter.index + 1;
      continue;
    }

    const close = findMatchingBrace(css, delimiter.index);
    if (close < 0) break;

    const body = css.slice(delimiter.index + 1, close);
    if (prelude.startsWith('@')) {
      const scopedAtRule = scopeAtRule(prelude, body, scopeSelector);
      if (scopedAtRule) output += scopedAtRule;
    } else {
      const selectors = scopeSelectorList(prelude, scopeSelector);
      if (selectors) output += `${selectors} {${body}}`;
    }

    index = close + 1;
  }

  return output;
}

function scopeAtRule(prelude: string, body: string, scopeSelector: string): string {
  const atRule = /^@([a-zA-Z-]+)/.exec(prelude)?.[1]?.toLowerCase();
  if (!atRule || !SCOPED_CONTAINER_AT_RULES.has(atRule)) {
    return '';
  }

  const scopedBody = scopeCssBlock(body, scopeSelector);
  return scopedBody.trim() ? `${prelude} {${scopedBody}}` : '';
}

function scopeSelectorList(selectorList: string, scopeSelector: string): string {
  return splitTopLevelSelectors(selectorList)
    .map((selector) => scopeSingleSelector(selector, scopeSelector))
    .filter(Boolean)
    .join(',\n');
}

function scopeSingleSelector(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(scopeSelector)) return trimmed;

  const rootScoped = scopeLeadingRootSelector(trimmed, scopeSelector);
  return rootScoped ?? `${scopeSelector} ${trimmed}`;
}

function scopeLeadingRootSelector(selector: string, scopeSelector: string): string | null {
  const rootMatch = /^(?::root|:host|html|body)(?=$|[\s>+~.#:[(])/i.exec(selector);
  if (!rootMatch) return null;

  const rest = selector.slice(rootMatch[0].length);
  if (!rest.trim()) return scopeSelector;
  if (/^[.#:[(]/.test(rest)) return `${scopeSelector}${rest}`;
  return `${scopeSelector}${rest}`;
}

function splitTopLevelSelectors(selectorList: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;

  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    const next = selectorList[index + 1];

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      const commentEnd = selectorList.indexOf('*/', index + 2);
      index = commentEnd >= 0 ? commentEnd + 1 : selectorList.length;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    if (char === ')' && parenDepth > 0) parenDepth -= 1;
    if (char === '[') bracketDepth += 1;
    if (char === ']' && bracketDepth > 0) bracketDepth -= 1;
    if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(selectorList.slice(start));
  return selectors;
}

function findRuleDelimiter(css: string, start: number): { index: number; kind: '{' | ';' } | null {
  let quote: string | null = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      const commentEnd = css.indexOf('*/', index + 2);
      index = commentEnd >= 0 ? commentEnd + 1 : css.length;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    if (char === ')' && parenDepth > 0) parenDepth -= 1;
    if (char === '[') bracketDepth += 1;
    if (char === ']' && bracketDepth > 0) bracketDepth -= 1;
    if (parenDepth === 0 && bracketDepth === 0 && (char === '{' || char === ';')) {
      return { index, kind: char };
    }
  }

  return null;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      const commentEnd = css.indexOf('*/', index + 2);
      index = commentEnd >= 0 ? commentEnd + 1 : css.length;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function readTrivia(css: string, start: number): number {
  let index = start;
  while (index < css.length) {
    const char = css[index];
    const next = css[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = css.indexOf('*/', index + 2);
      index = commentEnd >= 0 ? commentEnd + 2 : css.length;
      continue;
    }
    break;
  }
  return index;
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ')
    .replace(/\f/g, '\\c ');
}
