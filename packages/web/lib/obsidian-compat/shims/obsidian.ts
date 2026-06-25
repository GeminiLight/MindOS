/**
 * Obsidian Plugin Compatibility - obsidian module export surface
 */

import net from 'net';
import yaml from 'js-yaml';
import TurndownService from 'turndown';
import { Component } from '../component';
import { Events } from '../events';
import { Plugin } from './plugin';
import { Notice, Modal } from './ui';
import { ButtonComponent, DropdownComponent, PluginSettingTab, Setting, TextAreaComponent, TextComponent, ToggleComponent } from './settings';
import { TAbstractFileImpl, TFileImpl, TFolderImpl, Vault } from './vault';
import { createObsidianElement } from './dom';
import { MarkdownRenderer } from './markdown-renderer';
import { getActiveObsidianRuntimeHost } from '../runtime';
import type { CachedMetadata, RequestUrlParam, RequestUrlResponse, RequestUrlResponsePromise, SecretStorage, TFile, WorkspaceLeaf } from '../types';

const REQUEST_URL_TIMEOUT_MS = 15_000;
const REQUEST_URL_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_URL_MAX_REDIRECTS = 5;
const REQUEST_URL_ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const SENSITIVE_REDIRECT_HEADER = /^(authorization|cookie|proxy-authorization)$|api[-_]?key|token|secret|session/i;
const htmlToMarkdownConverter = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  headingStyle: 'atx',
});

export function normalizePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/\.$/, '')
    .replace(/^\/+/, '');
}

export function parseYaml(yamlText: string): unknown {
  return yaml.load(yamlText);
}

export function stringifyYaml(value: unknown): string {
  return yaml.dump(value, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const withoutAlias = String(linktext ?? '').split('|')[0]?.trim() ?? '';
  const hashIndex = withoutAlias.indexOf('#');
  if (hashIndex < 0) {
    return { path: withoutAlias, subpath: '' };
  }
  return {
    path: withoutAlias.slice(0, hashIndex),
    subpath: withoutAlias.slice(hashIndex),
  };
}

export function getLinkpath(linktext: string): string {
  return parseLinktext(linktext).path;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buffer = Buffer.from(String(base64), 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function htmlNodeText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as { textContent?: unknown; childNodes?: Iterable<unknown>; children?: Iterable<unknown> };
  if (typeof record.textContent === 'string' && record.textContent.length > 0) {
    return record.textContent;
  }
  const children = record.childNodes ?? record.children;
  if (!children) return '';
  return Array.from(children).map((child) => htmlNodeText(child)).join('');
}

function htmlNodeChildren(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const children = (value as { childNodes?: unknown; children?: unknown }).childNodes
    ?? (value as { childNodes?: unknown; children?: unknown }).children;
  if (!children || typeof children !== 'object') return [];
  if (Symbol.iterator in children) return Array.from(children as Iterable<unknown>);
  const length = (children as { length?: unknown }).length;
  if (typeof length === 'number') return Array.from(children as ArrayLike<unknown>);
  return [];
}

function htmlNodeMarkup(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as { outerHTML?: unknown; textContent?: unknown; innerHTML?: unknown };
  if (typeof record.outerHTML === 'string') return record.outerHTML;
  const children = htmlNodeChildren(value);
  if (children.length > 0) return children.map((child) => htmlNodeMarkup(child)).join('');
  if (typeof record.textContent === 'string') return record.textContent;
  if (typeof record.innerHTML === 'string') return record.innerHTML;
  return '';
}

function htmlToTurndownInput(html: string | HTMLElement | Document | DocumentFragment): string | HTMLElement | Document {
  if (typeof html === 'string') return html;
  const record = html as {
    outerHTML?: unknown;
    innerHTML?: unknown;
    body?: { innerHTML?: unknown };
    documentElement?: { outerHTML?: unknown };
    childNodes?: Iterable<unknown>;
  };
  if (typeof record.outerHTML === 'string') return record.outerHTML;
  if (typeof record.body?.innerHTML === 'string') return record.body.innerHTML;
  if (typeof record.documentElement?.outerHTML === 'string') return record.documentElement.outerHTML;
  const childMarkup = htmlNodeChildren(html).map((child) => htmlNodeMarkup(child)).join('');
  if (childMarkup.length > 0) return childMarkup;
  if (typeof record.innerHTML === 'string' && (record.innerHTML.length > 0 || !record.childNodes)) return record.innerHTML;
  const text = htmlNodeText(html);
  return text;
}

export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  return htmlToMarkdownConverter.turndown(htmlToTurndownInput(html)).trim();
}

type DebouncedFunction<T extends unknown[]> = ((...args: T) => void) & { cancel: () => void; run: () => void };

export function debounce<T extends unknown[]>(
  callback: (...args: T) => unknown,
  timeout = 0,
  resetTimer = true,
): DebouncedFunction<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const clearPending = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = () => {
    const args = lastArgs;
    timer = null;
    lastArgs = null;
    if (args) {
      callback(...args);
    }
  };

  const debounced = ((...args: T) => {
    lastArgs = args;
    if (timer !== null && !resetTimer) {
      return;
    }
    clearPending();
    timer = setTimeout(run, Math.max(0, timeout));
  }) as DebouncedFunction<T>;

  debounced.cancel = () => {
    clearPending();
    lastArgs = null;
  };
  debounced.run = () => {
    clearPending();
    run();
  };

  return debounced;
}

const coreIconIds = [
  'alert-triangle',
  'check',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'file',
  'folder',
  'info',
  'link',
  'list',
  'pencil',
  'plus',
  'search',
  'settings',
  'star',
  'trash',
  'x',
];

const iconRegistry = new Map<string, string>();

export function addIcon(iconId: string, svgContent: string): void {
  iconRegistry.set(iconId, svgContent);
}

export function getIcon(iconId: string): string | null {
  return iconRegistry.get(iconId) ?? null;
}

export function getIconIds(): string[] {
  return Array.from(new Set([...coreIconIds, ...iconRegistry.keys()])).sort((a, b) => a.localeCompare(b, 'en'));
}

export function setIcon(parent: HTMLElement, iconId: string, size?: number): void {
  parent.setAttribute('data-obsidian-icon', iconId);
  parent.setAttribute('aria-label', iconId);
  if (size !== undefined) {
    parent.setAttribute('data-obsidian-icon-size', String(size));
  }
  parent.textContent = iconId;
}

export function setTooltip(parent: HTMLElement, tooltip: string): void {
  parent.setAttribute('aria-label', tooltip);
  parent.setAttribute('title', tooltip);
}

export class RequestUrlError extends Error {
  status: number;
  headers: Record<string, string>;
  response: RequestUrlResponse;

  constructor(url: string, response: RequestUrlResponse) {
    super(`[obsidian-compat] requestUrl failed with HTTP ${response.status}: ${url}`);
    this.name = 'RequestUrlError';
    this.status = response.status;
    this.headers = response.headers;
    this.response = response;
  }
}

function createRequestUrlPromise(source: Promise<RequestUrlResponse>): RequestUrlResponsePromise {
  const responsePromise = source as RequestUrlResponsePromise;
  Object.defineProperties(responsePromise, {
    arrayBuffer: {
      enumerable: true,
      get: () => source.then((response) => response.arrayBuffer),
    },
    json: {
      enumerable: true,
      get: () => source.then((response) => response.json),
    },
    text: {
      enumerable: true,
      get: () => source.then((response) => response.text),
    },
  });
  return responsePromise;
}

function rejectRequestUrl(error: Error): RequestUrlResponsePromise {
  return createRequestUrlPromise(Promise.reject(error));
}

function normalizeRequestMethod(method?: string): string {
  const normalized = (method ?? 'GET').trim().toUpperCase();
  if (!REQUEST_URL_ALLOWED_METHODS.has(normalized)) {
    throw new Error(`[obsidian-compat] requestUrl method is not allowed: ${method ?? ''}`);
  }
  return normalized;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b, c] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function ipv4FromMappedIPv6(hostname: string): string | null {
  const dotted = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return dotted[1];
  }

  const hex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) {
    return null;
  }
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const mapped = ipv4FromMappedIPv6(normalized);
  if (mapped) {
    return isPrivateIPv4(mapped);
  }
  if (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fe90:')
    || normalized.startsWith('fea0:')
    || normalized.startsWith('feb0:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('ff')
    || normalized === '2001:db8::'
    || normalized.startsWith('2001:db8:')
  ) {
    return true;
  }
  return false;
}

function assertRequestUrlAllowed(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[obsidian-compat] requestUrl received an invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[obsidian-compat] requestUrl only supports http/https URLs: ${rawUrl}`);
  }

  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === '0'
  ) {
    throw new Error(`[obsidian-compat] requestUrl blocks local/private hosts: ${rawUrl}`);
  }

  const ipVersion = net.isIP(hostname);
  if ((ipVersion === 4 && isPrivateIPv4(hostname)) || (ipVersion === 6 && isPrivateIPv6(hostname))) {
    throw new Error(`[obsidian-compat] requestUrl blocks local/private hosts: ${rawUrl}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`[obsidian-compat] requestUrl does not allow credentials in URLs: ${rawUrl}`);
  }

  return parsed;
}

async function readResponseArrayBuffer(response: Response, url: string): Promise<ArrayBuffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > REQUEST_URL_MAX_RESPONSE_BYTES) {
      throw new Error(`[obsidian-compat] requestUrl response is too large: ${url}`);
    }
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > REQUEST_URL_MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Best effort only.
        }
        throw new Error(`[obsidian-compat] requestUrl response is too large: ${url}`);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > REQUEST_URL_MAX_RESPONSE_BYTES) {
    throw new Error(`[obsidian-compat] requestUrl response is too large: ${url}`);
  }
  return arrayBuffer;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function redirectedMethod(status: number, method: string): string {
  if (status === 303) return 'GET';
  if ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD') {
    return 'GET';
  }
  return method;
}

function buildRequestHeaders(params: RequestUrlParam): Record<string, string> {
  return {
    ...(params.contentType ? { 'content-type': params.contentType } : {}),
    ...(params.headers ?? {}),
  };
}

function stripSensitiveRedirectHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_REDIRECT_HEADER.test(name)),
  );
}

async function fetchRequestUrlWithRedirects(
  parsedUrl: URL,
  params: RequestUrlParam,
  method: string,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = parsedUrl;
  let currentMethod = method;
  let currentBody = params.body as BodyInit | undefined;
  let currentHeaders = buildRequestHeaders(params);

  for (let redirectCount = 0; redirectCount <= REQUEST_URL_MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      signal,
      redirect: 'manual',
    });

    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl.toString() };
    }

    if (redirectCount >= REQUEST_URL_MAX_REDIRECTS) {
      throw new Error(`[obsidian-compat] requestUrl followed too many redirects: ${parsedUrl.toString()}`);
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response, finalUrl: currentUrl.toString() };
    }

    const nextUrl = new URL(location, currentUrl);
    const allowedNextUrl = assertRequestUrlAllowed(nextUrl.toString());
    if (allowedNextUrl.origin !== currentUrl.origin) {
      currentHeaders = stripSensitiveRedirectHeaders(currentHeaders);
    }
    currentUrl = allowedNextUrl;
    const nextMethod = redirectedMethod(response.status, currentMethod);
    if (nextMethod !== currentMethod) {
      currentBody = undefined;
    }
    currentMethod = nextMethod;
  }

  throw new Error(`[obsidian-compat] requestUrl followed too many redirects: ${parsedUrl.toString()}`);
}

export function requestUrl(input: string | RequestUrlParam): RequestUrlResponsePromise {
  const params: RequestUrlParam = typeof input === 'string' ? { url: input } : input;
  const host = getActiveObsidianRuntimeHost();
  const pluginId = host?.getCurrentPluginId();
  let parsedUrl: URL;
  let method: string;
  try {
    parsedUrl = assertRequestUrlAllowed(params.url);
    method = normalizeRequestMethod(params.method);
  } catch (err) {
    host?.recordRuntimeCapability(pluginId, 'requestUrl', 'blocked', err instanceof Error ? err.message : String(err));
    return rejectRequestUrl(err instanceof Error ? err : new Error(String(err)));
  }
  if (typeof fetch !== 'function') {
    host?.recordRuntimeCapability(pluginId, 'requestUrl', 'blocked', '[obsidian-compat] requestUrl requires fetch support in the current runtime.');
    return rejectRequestUrl(new Error('[obsidian-compat] requestUrl requires fetch support in the current runtime.'));
  }
  host?.recordRuntimeCapability(pluginId, 'requestUrl', 'called', `Plugin requested ${method} ${parsedUrl.origin}.`);

  return createRequestUrlPromise((async (): Promise<RequestUrlResponse> => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_URL_TIMEOUT_MS);
    let response: Response;
    let arrayBuffer: ArrayBuffer;
    let finalUrl = parsedUrl.toString();
    try {
      const fetched = await fetchRequestUrlWithRedirects(parsedUrl, params, method, abortController.signal);
      response = fetched.response;
      finalUrl = fetched.finalUrl;
      arrayBuffer = await readResponseArrayBuffer(response, finalUrl);
    } catch (err) {
      if (abortController.signal.aborted) {
        throw new Error(`[obsidian-compat] requestUrl timed out after ${REQUEST_URL_TIMEOUT_MS}ms: ${parsedUrl.toString()}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const result = {
      status: response.status,
      headers,
      arrayBuffer,
      text,
      json,
    };

    if (params.throw !== false && response.status >= 400) {
      throw new RequestUrlError(finalUrl, result);
    }

    return result;
  })());
}

export async function request(input: string | RequestUrlParam): Promise<string> {
  return requestUrl(input).text;
}

const runtimePlatform = typeof process !== 'undefined' ? process.platform : 'browser';

export const Platform = {
  isDesktop: false,
  isDesktopApp: false,
  isMobile: false,
  isMobileApp: false,
  isMacOS: runtimePlatform === 'darwin',
  isWin: runtimePlatform === 'win32',
  isLinux: runtimePlatform === 'linux',
};

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function formatDate(date: Date, format: string): string {
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/YY/g, String(date.getFullYear()).slice(-2))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

export function moment(input?: string | number | Date) {
  const date = input instanceof Date ? new Date(input) : input === undefined ? new Date() : new Date(input);
  return {
    format: (format = 'YYYY-MM-DDTHH:mm:ss') => formatDate(date, format),
    toDate: () => new Date(date),
    valueOf: () => date.valueOf(),
    unix: () => Math.floor(date.valueOf() / 1000),
    isValid: () => !Number.isNaN(date.valueOf()),
  };
}

let currentMomentLocale = 'en';

moment.now = Date.now;
moment.utc = moment;
moment.unix = (seconds: number) => moment(seconds * 1000);
moment.locale = (locale?: string): string => {
  if (typeof locale === 'string' && locale.trim()) {
    currentMomentLocale = locale.trim();
  }
  return currentMomentLocale;
};
moment.localeData = () => ({
  firstDayOfWeek: () => 0,
  longDateFormat: (token: string) => ({
    L: 'YYYY-MM-DD',
    LL: 'MMMM D, YYYY',
    LLL: 'MMMM D, YYYY HH:mm',
    LLLL: 'dddd, MMMM D, YYYY HH:mm',
    LT: 'HH:mm',
    LTS: 'HH:mm:ss',
  })[token] ?? token,
});

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;

  constructor(containerEl: HTMLElement = createObsidianElement('div')) {
    super();
    this.containerEl = containerEl;
  }
}

export class ItemView extends Component {
  leaf?: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf?: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.containerEl = createObsidianElement('div');
    this.contentEl = createObsidianElement('div');
    this.containerEl.appendChild(this.contentEl);
  }

  getViewType(): string {
    return 'mindos-unsupported-item-view';
  }

  getDisplayText(): string {
    return 'Unsupported Obsidian view';
  }

  onOpen(): Promise<void> | void {}

  onClose(): Promise<void> | void {}
}

export class View extends ItemView {}

export class MarkdownView extends ItemView {}

export class FileView extends ItemView {
  file: TFile | null = null;
}

export class AbstractInputSuggest<T> extends Component {
  app: unknown;
  inputEl: HTMLInputElement;
  suggestions: T[] = [];

  constructor(app: unknown, inputEl: HTMLInputElement) {
    super();
    this.app = app;
    this.inputEl = inputEl;
  }

  getSuggestions(query: string): T[] | Promise<T[]> {
    void query;
    return [];
  }

  renderSuggestion(value: T, el: HTMLElement): void {
    el.textContent = String(value);
  }

  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    void value;
    void evt;
  }

  close(): void {}
}

export interface EditorSuggestTriggerInfo {
  start: unknown;
  end: unknown;
  query: string;
}

export class EditorSuggest<T> extends Component {
  app: unknown;
  context: unknown = null;
  suggestions: T[] = [];
  scope: Scope;

  constructor(app: unknown) {
    super();
    this.app = app;
    this.scope = new Scope();
  }

  onTrigger(cursor: unknown, editor: unknown, file: TFile | null): EditorSuggestTriggerInfo | null {
    void cursor;
    void editor;
    void file;
    return null;
  }

  getSuggestions(context: unknown): T[] | Promise<T[]> {
    void context;
    return [];
  }

  renderSuggestion(value: T, el: HTMLElement): void {
    el.textContent = String(value);
  }

  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    void value;
    void evt;
  }

  open(): void {}

  close(): void {}
}

export class SettingGroup extends Component {
  containerEl: HTMLElement;

  constructor(containerEl: HTMLElement = createObsidianElement('div')) {
    super();
    this.containerEl = containerEl;
  }
}

export class SecretComponent extends TextComponent {
  constructor(target: HTMLElement) {
    super(target);
    this.inputEl.setAttribute('type', 'password');
  }
}

export type { SecretStorage };

export class WorkspaceLeafShimExport {
  getViewState() {
    return { type: 'empty' };
  }

  async setViewState(): Promise<void> {}

  async openFile(): Promise<void> {}

  detach(): void {}
}

export class FileSystemAdapter {
  getBasePath(): string {
    throw new Error('[obsidian-compat] FileSystemAdapter.getBasePath() is not available in the restricted MindOS plugin runtime.');
  }
}

export class MenuItem {
  title = '';
  icon = '';
  checked = false;
  disabled = false;
  separator = false;
  callback?: () => void;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setChecked(checked: boolean): this {
    this.checked = checked;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  onClick(callback: () => void): this {
    this.callback = callback;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];

  addItem(configure: (item: MenuItem) => void): this {
    const item = new MenuItem();
    configure(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    const item = new MenuItem();
    item.separator = true;
    item.disabled = true;
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(_evt?: MouseEvent): this {
    this.recordSnapshot('mouse');
    return this;
  }

  showAtPosition(_position?: unknown, _doc?: Document): this {
    this.recordSnapshot('position');
    return this;
  }

  hide(): this {
    return this;
  }

  private recordSnapshot(source: 'mouse' | 'position'): void {
    getActiveObsidianRuntimeHost()?.recordMenuOpen({
      source,
      items: this.items.map((item) => ({
        title: item.title,
        icon: item.icon,
        checked: item.checked,
        disabled: item.disabled,
        separator: item.separator,
        callback: item.callback,
      })),
    });
  }
}

export class SuggestModal<T> extends Modal {
  inputEl = createObsidianElement('input');
  suggestions: T[] = [];

  setPlaceholder(value: string): void {
    this.inputEl.setAttribute('placeholder', value);
  }

  getSuggestions(query: string): T[] | Promise<T[]> {
    void query;
    return [];
  }

  renderSuggestion(value: T, el: HTMLElement): void {
    el.textContent = String(value);
  }

  onChooseSuggestion(value: T): void {
    void value;
  }
}

export class FuzzySuggestModal<T> extends SuggestModal<T> {}

export const Keymap = {
  isModEvent(event: MouseEvent | KeyboardEvent | { metaKey?: boolean; ctrlKey?: boolean }): boolean {
    return Boolean(event?.metaKey || event?.ctrlKey);
  },
};

export interface ScopeKeyRegistration {
  modifiers: string[];
  key: string;
  func: (evt: KeyboardEvent, ctx?: unknown) => unknown;
}

export class Scope {
  keys: ScopeKeyRegistration[] = [];
  parent: Scope | null = null;

  constructor(parent?: Scope | null) {
    this.parent = parent ?? null;
  }

  register(
    modifiers: string[] | null | undefined,
    key: string,
    func: (evt: KeyboardEvent, ctx?: unknown) => unknown,
  ): ScopeKeyRegistration {
    const registration = {
      modifiers: Array.isArray(modifiers) ? modifiers.map(String) : [],
      key: String(key),
      func,
    };
    this.keys.push(registration);
    return registration;
  }

  unregister(registrationOrModifiers: ScopeKeyRegistration | string[], key?: string, func?: unknown): void {
    if (isScopeKeyRegistration(registrationOrModifiers)) {
      this.keys = this.keys.filter((item) => item !== registrationOrModifiers);
      return;
    }

    const modifiers = Array.isArray(registrationOrModifiers)
      ? registrationOrModifiers.map(String)
      : [];
    const normalizedKey = key === undefined ? undefined : String(key);
    this.keys = this.keys.filter((item) => {
      if (normalizedKey !== undefined && item.key !== normalizedKey) return true;
      if (!sameStringArray(item.modifiers, modifiers)) return true;
      if (func && item.func !== func) return true;
      return false;
    });
  }

  unregisterAll(): void {
    this.keys = [];
  }
}

export function parseFrontMatterAliases(frontmatter: Record<string, unknown> | null | undefined): string[] | null {
  const value = frontmatter?.aliases ?? frontmatter?.alias ?? frontmatter?.Aliases;
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    return [value];
  }
  return null;
}

export function parseFrontMatterTags(frontmatter: Record<string, unknown> | null | undefined): string[] | null {
  const value = frontmatter?.tags ?? frontmatter?.tag ?? frontmatter?.Tags;
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/).filter(Boolean);
  }
  return null;
}

function normalizeTagValue(tag: unknown): string | null {
  const value = String(tag ?? '').trim();
  if (!value) return null;
  return value.startsWith('#') ? value : `#${value}`;
}

export function getAllTags(cache: CachedMetadata | null | undefined): string[] | null {
  if (!cache) return null;
  const tags: string[] = [];
  const add = (value: unknown) => {
    const tag = normalizeTagValue(value);
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  };
  for (const tag of parseFrontMatterTags(cache.frontmatter) ?? []) {
    add(tag);
  }
  for (const tag of cache.tags ?? []) {
    add(tag.tag);
  }
  return tags.length > 0 ? tags : null;
}

export function getLanguage(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en';
}

const OBSIDIAN_COMPAT_API_VERSION = '1.7.2';
export const apiVersion = `${OBSIDIAN_COMPAT_API_VERSION}-mindos-compat`;

function versionParts(version: string): number[] {
  return String(version ?? '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

export function requireApiVersion(version: string): boolean {
  const required = versionParts(version);
  const current = versionParts(OBSIDIAN_COMPAT_API_VERSION);
  for (let index = 0; index < Math.max(required.length, current.length); index += 1) {
    const requiredPart = required[index] ?? 0;
    const currentPart = current[index] ?? 0;
    if (currentPart > requiredPart) return true;
    if (currentPart < requiredPart) return false;
  }
  return true;
}

export type SearchMatch = [number, number] | { start: number; end: number };

export interface SearchResult {
  score: number;
  matches: SearchMatch[];
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  const normalizedQuery = query.trim().toLowerCase();
  return (text: string) => {
    if (!normalizedQuery) {
      return { score: 0, matches: [] };
    }
    const normalizedText = String(text).toLowerCase();
    const index = normalizedText.indexOf(normalizedQuery);
    return index >= 0
      ? { score: normalizedQuery.length / Math.max(String(text).length, 1), matches: [[index, index + normalizedQuery.length]] }
      : null;
  };
}

export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  const normalizedQuery = query.trim().toLowerCase();
  return (text: string) => {
    if (!normalizedQuery) {
      return { score: 0, matches: [] };
    }
    const normalizedText = String(text).toLowerCase();
    const index = normalizedText.indexOf(normalizedQuery);
    return index >= 0 ? { score: normalizedQuery.length / Math.max(String(text).length, 1), matches: [[index, index + normalizedQuery.length]] } : null;
  };
}

export function renderMatches(el: HTMLElement, text: string, matches: SearchMatch[] | null | undefined, offset = 0): void {
  const source = String(text);
  const normalizedMatches = normalizeSearchMatches(matches, offset, source.length);
  el.textContent = '';

  if (normalizedMatches.length === 0) {
    el.textContent = source;
    return;
  }

  let cursor = 0;
  for (const match of normalizedMatches) {
    if (match.start > cursor) {
      appendSearchText(el, source.slice(cursor, match.start), false);
    }
    appendSearchText(el, source.slice(match.start, match.end), true);
    cursor = match.end;
  }
  if (cursor < source.length) {
    appendSearchText(el, source.slice(cursor), false);
  }
}

function isScopeKeyRegistration(value: unknown): value is ScopeKeyRegistration {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as ScopeKeyRegistration).modifiers)
    && typeof (value as ScopeKeyRegistration).key === 'string'
    && typeof (value as ScopeKeyRegistration).func === 'function';
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeSearchMatches(matches: SearchMatch[] | null | undefined, offset: number, textLength: number): Array<{ start: number; end: number }> {
  return (matches ?? [])
    .map((match) => {
      const rawStart = Array.isArray(match) ? match[0] : match.start;
      const rawEnd = Array.isArray(match) ? match[1] : match.end;
      const start = Math.max(0, Math.min(textLength, rawStart - offset));
      const end = Math.max(start, Math.min(textLength, rawEnd - offset));
      return { start, end };
    })
    .filter((match) => match.end > match.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function appendSearchText(el: HTMLElement, text: string, highlighted: boolean): void {
  if (!text) return;
  const span = createObsidianElement('span');
  span.textContent = text;
  if (highlighted) {
    span.classList.add('suggestion-highlight');
  }
  el.appendChild(span);
}

export function createObsidianModule() {
  return {
    Plugin,
    Component,
    Events,
    Notice,
    Modal,
    PluginSettingTab,
    Setting,
    ButtonComponent,
    TextComponent,
    TextAreaComponent,
    ToggleComponent,
    DropdownComponent,
    TAbstractFile: TAbstractFileImpl,
    TFile: TFileImpl,
    TFolder: TFolderImpl,
    Vault,
    normalizePath,
    parseYaml,
    stringifyYaml,
    parseLinktext,
    getLinkpath,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    htmlToMarkdown,
    debounce,
    addIcon,
    getIcon,
    getIconIds,
    setIcon,
    setTooltip,
    requestUrl,
    request,
    Platform,
    moment,
    MarkdownRenderer,
    MarkdownRenderChild,
    ItemView,
    View,
    MarkdownView,
    FileView,
    AbstractInputSuggest,
    EditorSuggest,
    SettingGroup,
    SecretComponent,
    WorkspaceLeaf: WorkspaceLeafShimExport,
    FileSystemAdapter,
    Menu,
    MenuItem,
    SuggestModal,
    FuzzySuggestModal,
    Keymap,
    Scope,
    parseFrontMatterAliases,
    parseFrontMatterTags,
    getAllTags,
    getLanguage,
    apiVersion,
    requireApiVersion,
    prepareSimpleSearch,
    prepareFuzzySearch,
    renderMatches,
  };
}
