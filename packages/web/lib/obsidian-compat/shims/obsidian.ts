/**
 * Obsidian Plugin Compatibility - obsidian module export surface
 */

import net from 'net';
import { Component } from '../component';
import { Events } from '../events';
import { Plugin } from './plugin';
import { Notice, Modal } from './ui';
import { PluginSettingTab, Setting } from './settings';
import { TAbstractFileImpl, TFileImpl, TFolderImpl } from './vault';
import { createObsidianElement } from './dom';
import { MarkdownRenderer } from './markdown-renderer';
import { getActiveObsidianRuntimeHost } from '../runtime';
import type { RequestUrlParam, RequestUrlResponse, RequestUrlResponsePromise, WorkspaceLeaf } from '../types';

const REQUEST_URL_TIMEOUT_MS = 15_000;
const REQUEST_URL_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_URL_ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

export function normalizePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/\.$/, '')
    .replace(/^\/+/, '');
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
  const [a, b] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
  );
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fe90:')
    || normalized.startsWith('fea0:')
    || normalized.startsWith('feb0:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
  ) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
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

export function requestUrl(input: string | RequestUrlParam): RequestUrlResponsePromise {
  const params: RequestUrlParam = typeof input === 'string' ? { url: input } : input;
  let parsedUrl: URL;
  let method: string;
  try {
    parsedUrl = assertRequestUrlAllowed(params.url);
    method = normalizeRequestMethod(params.method);
  } catch (err) {
    return rejectRequestUrl(err instanceof Error ? err : new Error(String(err)));
  }
  if (typeof fetch !== 'function') {
    return rejectRequestUrl(new Error('[obsidian-compat] requestUrl requires fetch support in the current runtime.'));
  }

  return createRequestUrlPromise((async (): Promise<RequestUrlResponse> => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_URL_TIMEOUT_MS);
    let response: Response;
    let arrayBuffer: ArrayBuffer;
    try {
      response = await fetch(parsedUrl.toString(), {
        method,
        headers: {
          ...(params.contentType ? { 'content-type': params.contentType } : {}),
          ...(params.headers ?? {}),
        },
        body: params.body as BodyInit | undefined,
        signal: abortController.signal,
      });
      arrayBuffer = await readResponseArrayBuffer(response, parsedUrl.toString());
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
      throw new RequestUrlError(parsedUrl.toString(), result);
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

moment.now = Date.now;
moment.utc = moment;
moment.unix = (seconds: number) => moment(seconds * 1000);

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

export class MarkdownView extends ItemView {}

export class WorkspaceLeafShimExport {
  getViewState() {
    return { type: 'empty' };
  }

  async setViewState(): Promise<void> {}

  async openFile(): Promise<void> {}

  detach(): void {}
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

export function createObsidianModule() {
  return {
    Plugin,
    Component,
    Events,
    Notice,
    Modal,
    PluginSettingTab,
    Setting,
    TAbstractFile: TAbstractFileImpl,
    TFile: TFileImpl,
    TFolder: TFolderImpl,
    normalizePath,
    requestUrl,
    request,
    Platform,
    moment,
    MarkdownRenderer,
    MarkdownRenderChild,
    ItemView,
    MarkdownView,
    WorkspaceLeaf: WorkspaceLeafShimExport,
    Menu,
    MenuItem,
    SuggestModal,
    FuzzySuggestModal,
  };
}
