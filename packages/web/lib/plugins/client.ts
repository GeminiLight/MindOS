import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { PluginSurface } from './surfaces';

interface PluginSurfacesResponse {
  ok: boolean;
  surfaces: PluginSurface[];
}

export interface PluginWorkspaceOpenRequest {
  linktext: string;
  sourcePath: string;
  targetPath?: string;
}

export interface PluginEditorCommandContext {
  sourcePath: string;
  selectionStart?: number;
  selectionEnd?: number;
  cursorOffset?: number;
}

export interface PluginEditorUpdate {
  sourcePath: string;
  changed: boolean;
}

export interface PluginModalSnapshot {
  id: string;
  pluginId?: string;
  kind: 'modal' | 'suggest';
  title: string;
  text: string;
  placeholder?: string;
  textInput?: {
    value: string;
    placeholder?: string;
  };
  suggestions?: Array<{ index: number; label: string }>;
  interactionId?: string;
  suggestionError?: string;
}

export interface PluginModalSuggestionChoice {
  index: number;
  label: string;
}

export interface PluginMenuSnapshot {
  id: string;
  pluginId?: string;
  source: 'mouse' | 'position';
  interactionId?: string;
  items: Array<{
    index: number;
    title: string;
    icon?: string;
    checked?: boolean;
    disabled?: boolean;
    separator?: boolean;
    canRun?: boolean;
  }>;
}

export type PluginNoticeLevel = 'info' | 'success' | 'error';

export interface PluginNoticeSnapshot {
  id: string;
  pluginId?: string;
  message: string;
  timeout?: number;
  level: PluginNoticeLevel;
}

export interface PluginActionResult {
  workspaceOpenRequests?: PluginWorkspaceOpenRequest[];
  modalSnapshots?: PluginModalSnapshot[];
  menuSnapshots?: PluginMenuSnapshot[];
  noticeSnapshots?: PluginNoticeSnapshot[];
  editorUpdates?: PluginEditorUpdate[];
}

export interface PluginCommandHotkey {
  modifiers: string[];
  key: string;
}

export interface PluginCommandHotkeyConflict {
  label: string;
  owner: 'mindos-reserved' | 'plugin-command';
  ownerLabel: string;
  pluginId?: string;
  commandId?: string;
}

export const OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY = 'mindos:obsidian-plugin-hotkeys-enabled';
export const OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT = 'mindos:obsidian-plugin-hotkeys-changed';

interface ObsidianPluginActionResponse {
  ok: boolean;
  result?: PluginActionResult;
}

export interface PluginViewSnapshot {
  pluginId: string;
  viewType: string;
  resolvedViewType: string;
  displayText: string;
  className: string;
  text: string;
  sourcePath?: string;
  file?: {
    path: string;
    name: string;
    basename: string;
    extension: string;
  };
}

interface PluginViewResponse {
  ok: boolean;
  view: PluginViewSnapshot;
}

export interface PluginStylesheetSnapshot {
  pluginId: string;
  path: 'styles.css';
  bytes: number;
  css: string;
  scopedCss: string;
  scopeSelector: string;
}

interface PluginStylesheetResponse {
  ok: boolean;
  stylesheet: PluginStylesheetSnapshot;
}

export interface PluginMarkdownCodeBlockRequest {
  id: string;
  language: string;
  source: string;
}

export interface PluginMarkdownCodeBlockRender {
  processorId: string;
  pluginId: string;
  pluginName: string;
  language: string;
  text: string;
  error?: string;
}

export interface PluginMarkdownCodeBlockSnapshot {
  id: string;
  language: string;
  renders: PluginMarkdownCodeBlockRender[];
}

interface PluginMarkdownCodeBlocksResponse {
  ok: boolean;
  blocks: PluginMarkdownCodeBlockSnapshot[];
}

export interface PluginMarkdownPostProcessorRender {
  processorId: string;
  pluginId: string;
  pluginName: string;
  text: string;
  error?: string;
}

interface PluginMarkdownPostProcessorsResponse {
  ok: boolean;
  renders: PluginMarkdownPostProcessorRender[];
}

export function pluginCommandLabel(surface: PluginSurface): string {
  return `${surface.pluginName}: ${surface.title}`;
}

export function pluginCommandHotkeyLabel(surface: PluginSurface): string | null {
  const first = pluginCommandHotkeys(surface)[0];
  return first ? formatPluginCommandHotkey(first) : null;
}

export function pluginCommandHotkeyCount(surface: PluginSurface): number {
  return pluginCommandHotkeys(surface).length;
}

export function pluginCommandHotkeys(surface: PluginSurface): PluginCommandHotkey[] {
  const hotkeys = surface.metadata?.hotkeys;
  return Array.isArray(hotkeys) ? hotkeys.filter(isPluginCommandHotkey) : [];
}

export function pluginCommandHotkeyConflictCount(surface: PluginSurface): number {
  return pluginCommandHotkeyConflicts(surface).length;
}

export function pluginCommandHotkeyPolicyLabel(surface: PluginSurface): string | null {
  if (surface.kind !== 'command' || pluginCommandHotkeyCount(surface) === 0) return null;
  return pluginCommandHotkeyConflictCount(surface) > 0 ? 'Conflict' : 'User-confirmable';
}

export function pluginCommandHotkeyBindableCount(surface: PluginSurface): number {
  if (!isPluginCommandHotkeyBindable(surface)) return 0;
  return pluginCommandHotkeys(surface).filter(hasBindableModifier).length;
}

export function isPluginCommandHotkeyBindable(surface: PluginSurface): boolean {
  if (surface.kind !== 'command') return false;
  if (surface.availability !== 'available') return false;
  if (surface.action?.type !== 'obsidian-command') return false;
  if (pluginCommandHotkeyConflictCount(surface) > 0) return false;
  if (!pluginCommandHotkeys(surface).some(hasBindableModifier)) return false;
  const policy = surface.metadata?.hotkeyPolicy;
  if (policy && typeof policy === 'object') {
    const binding = (policy as { binding?: unknown }).binding;
    const status = (policy as { status?: unknown }).status;
    if (binding === 'display-only' || status === 'conflict') return false;
  }
  return true;
}

export function pluginCommandHotkeyMatchesEvent(surface: PluginSurface, event: KeyboardEvent): boolean {
  if (!isPluginCommandHotkeyBindable(surface)) return false;
  const eventSignature = hotkeySignatureForEvent(event);
  if (!eventSignature) return false;
  return pluginCommandHotkeys(surface)
    .filter(hasBindableModifier)
    .some((hotkey) => hotkeySignature(hotkey) === eventSignature);
}

export function readObsidianPluginHotkeysEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setObsidianPluginHotkeysEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Local storage can be unavailable in private or embedded contexts.
  }
  window.dispatchEvent(new Event(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT));
}

export function pluginCommandHotkeyConflictSummary(surface: PluginSurface): string | null {
  const conflicts = pluginCommandHotkeyConflicts(surface);
  if (conflicts.length === 0) return null;
  const visible = conflicts.slice(0, 2).map((conflict) => `${conflict.label} -> ${conflict.ownerLabel}`);
  const suffix = conflicts.length > visible.length ? ` +${conflicts.length - visible.length}` : '';
  return `${visible.join(', ')}${suffix}`;
}

export function pluginCommandHotkeyConflicts(surface: PluginSurface): PluginCommandHotkeyConflict[] {
  const conflicts = surface.metadata?.hotkeyConflicts;
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter(isPluginCommandHotkeyConflict);
}

function isPluginCommandHotkey(value: unknown): value is PluginCommandHotkey {
  return value !== null
    && typeof value === 'object'
    && Array.isArray((value as PluginCommandHotkey).modifiers)
    && (value as PluginCommandHotkey).modifiers.every((modifier) => typeof modifier === 'string')
    && typeof (value as PluginCommandHotkey).key === 'string'
    && (value as PluginCommandHotkey).key.trim().length > 0;
}

function isPluginCommandHotkeyConflict(value: unknown): value is PluginCommandHotkeyConflict {
  if (value === null || typeof value !== 'object') return false;
  const record = value as PluginCommandHotkeyConflict;
  return typeof record.label === 'string'
    && record.label.trim().length > 0
    && (record.owner === 'mindos-reserved' || record.owner === 'plugin-command')
    && typeof record.ownerLabel === 'string'
    && record.ownerLabel.trim().length > 0;
}

function formatPluginCommandHotkey(hotkey: PluginCommandHotkey): string {
  const key = normalizeHotkeyKey(hotkey.key);
  const modifiers = hotkey.modifiers
    .map((modifier) => normalizeHotkeyModifier(modifier))
    .filter(Boolean);
  return [...modifiers, key].join('');
}

function hasBindableModifier(hotkey: PluginCommandHotkey): boolean {
  const modifiers = hotkey.modifiers.map(normalizeHotkeyModifierSignature).filter(Boolean);
  return modifiers.includes('mod') || modifiers.includes('ctrl') || modifiers.includes('alt');
}

function normalizeHotkeyModifier(modifier: string): string {
  const normalized = modifier.trim().toLowerCase();
  if (normalized === 'mod' || normalized === 'meta' || normalized === 'cmd' || normalized === 'command') return '⌘';
  if (normalized === 'ctrl' || normalized === 'control') return '⌃';
  if (normalized === 'shift') return '⇧';
  if (normalized === 'alt' || normalized === 'option') return '⌥';
  return modifier.trim();
}

function normalizeHotkeyKey(key: string): string {
  const normalized = key.trim();
  if (normalized.length === 1) return normalized.toUpperCase();
  const lower = normalized.toLowerCase();
  if (lower === 'arrowup') return '↑';
  if (lower === 'arrowdown') return '↓';
  if (lower === 'arrowleft') return '←';
  if (lower === 'arrowright') return '→';
  if (lower === 'escape') return 'Esc';
  if (lower === 'enter') return 'Enter';
  if (lower === 'space') return 'Space';
  return normalized;
}

function hotkeySignature(hotkey: PluginCommandHotkey): string | null {
  const key = hotkey.key.trim().toLowerCase();
  if (!key) return null;
  const modifiers = Array.from(new Set(hotkey.modifiers.map(normalizeHotkeyModifierSignature).filter(Boolean)))
    .sort((a, b) => hotkeyModifierSortValue(a) - hotkeyModifierSortValue(b) || a.localeCompare(b));
  return [...modifiers, key].join('+');
}

function hotkeySignatureForEvent(event: KeyboardEvent): string | null {
  if (!event.key || event.key === 'Dead' || event.isComposing) return null;
  const key = event.key.trim().toLowerCase();
  if (!key) return null;
  const modifiers: string[] = [];
  const applePlatform = isApplePlatform();
  if (event.metaKey) modifiers.push('mod');
  if (event.ctrlKey) modifiers.push(applePlatform ? 'ctrl' : 'mod');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  const uniqueModifiers = Array.from(new Set(modifiers))
    .sort((a, b) => hotkeyModifierSortValue(a) - hotkeyModifierSortValue(b) || a.localeCompare(b));
  return [...uniqueModifiers, key].join('+');
}

function normalizeHotkeyModifierSignature(modifier: string): string {
  const normalized = modifier.trim().toLowerCase();
  if (normalized === 'mod' || normalized === 'meta' || normalized === 'cmd' || normalized === 'command') return 'mod';
  if (normalized === 'ctrl' || normalized === 'control') return 'ctrl';
  if (normalized === 'shift') return 'shift';
  if (normalized === 'alt' || normalized === 'option') return 'alt';
  return normalized;
}

function hotkeyModifierSortValue(modifier: string): number {
  if (modifier === 'mod') return 0;
  if (modifier === 'ctrl') return 1;
  if (modifier === 'alt') return 2;
  if (modifier === 'shift') return 3;
  return 10;
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function matchesPluginCommandQuery(surface: PluginSurface, query: string): boolean {
  const raw = query.trim();
  if (!raw) return false;
  if (!raw.startsWith('>')) return false;
  const normalized = raw.startsWith('>') ? raw.slice(1).trim() : raw;
  if (!normalized) return raw.startsWith('>');

  const haystack = [
    surface.pluginName,
    surface.title,
    surface.description,
    surface.metadata?.fullCommandId,
    surface.metadata?.commandId,
  ].filter(Boolean).join(' ').toLowerCase();

  return normalized.toLowerCase().split(/\s+/).every((part) => haystack.includes(part));
}

export function sourcePathFromViewPathname(pathname: string | null | undefined): string | null {
  if (!pathname?.startsWith('/view/')) return null;
  const rawPath = pathname.slice('/view/'.length).split('?')[0] ?? '';
  if (!rawPath) return null;
  const decoded = rawPath
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/')
    .replace(/^\/+/, '');
  return decoded || null;
}

export function markdownSourcePathFromPathname(pathname: string | null | undefined): string | null {
  const decoded = sourcePathFromViewPathname(pathname);
  return decoded?.toLowerCase().endsWith('.md') ? decoded : null;
}

export function pluginEditorCommandContextForPathname(pathname: string | null | undefined): PluginEditorCommandContext | undefined {
  const sourcePath = markdownSourcePathFromPathname(pathname);
  return sourcePath ? { sourcePath } : undefined;
}

interface FetchPluginSurfacesOptions {
  loadEnabled?: boolean;
  bypassCache?: boolean;
}

const PLUGIN_SURFACES_CACHE_TTL_MS = 5_000;
const MARKDOWN_POST_PROCESSOR_CACHE_TTL_MS = 30_000;

interface PluginSurfacesCacheEntry {
  expiresAt: number;
  surfaces?: PluginSurface[];
  promise?: Promise<PluginSurface[]>;
}

const pluginSurfacesCache = new Map<string, PluginSurfacesCacheEntry>();

export function clearPluginSurfacesCacheForTests(): void {
  pluginSurfacesCache.clear();
  clearPluginMarkdownPostProcessorCacheForTests();
}

interface MarkdownPostProcessorCacheEntry {
  expiresAt: number;
  renders?: PluginMarkdownPostProcessorRender[];
  promise?: Promise<PluginMarkdownPostProcessorRender[]>;
}

const pluginMarkdownPostProcessorCache = new Map<string, MarkdownPostProcessorCacheEntry>();

function hashMarkdownInput(markdown: string): string {
  let hash = 5381;
  for (let index = 0; index < markdown.length; index += 1) {
    hash = Math.imul(hash, 33) ^ markdown.charCodeAt(index);
  }
  return `${markdown.length}:${(hash >>> 0).toString(36)}`;
}

function markdownPostProcessorCacheKey(markdown: string, sourcePath: string): string {
  return `${sourcePath}\0${hashMarkdownInput(markdown)}`;
}

export function clearPluginMarkdownPostProcessorCacheForTests(): void {
  pluginMarkdownPostProcessorCache.clear();
}

export async function fetchPluginCommandSurfaces(
  context?: PluginEditorCommandContext,
  options: Pick<FetchPluginSurfacesOptions, 'bypassCache'> = {},
): Promise<PluginSurface[]> {
  const sourcePathQuery = context?.sourcePath ? `&sourcePath=${encodeURIComponent(context.sourcePath)}` : '';
  const data = await fetchPluginSurfaces(`kind=command${sourcePathQuery}`, {
    loadEnabled: true,
    bypassCache: options.bypassCache,
  });
  return (data ?? []).filter((surface) => (
    surface.kind === 'command'
    && surface.availability === 'available'
    && surface.action?.type === 'obsidian-command'
  ));
}

export async function fetchPluginSurfaces(query?: string, options: FetchPluginSurfacesOptions = {}): Promise<PluginSurface[]> {
  const queryString = [
    options.loadEnabled ? 'loadEnabled=1' : '',
    query ?? '',
  ].filter(Boolean).join('&');
  const cacheKey = queryString;
  const now = Date.now();
  if (!options.bypassCache) {
    const cached = pluginSurfacesCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      if (cached.surfaces) return cached.surfaces;
      if (cached.promise) return cached.promise;
    }
  }

  const promise = apiFetch<PluginSurfacesResponse>(`/api/plugins/surfaces${queryString ? `?${queryString}` : ''}`, {
    cache: 'no-store',
  }).then((data) => {
    const surfaces = data.surfaces ?? [];
    pluginSurfacesCache.set(cacheKey, {
      expiresAt: Date.now() + PLUGIN_SURFACES_CACHE_TTL_MS,
      surfaces,
    });
    return surfaces;
  }).catch((error) => {
    if (pluginSurfacesCache.get(cacheKey)?.promise === promise) {
      pluginSurfacesCache.delete(cacheKey);
    }
    throw error;
  });

  pluginSurfacesCache.set(cacheKey, {
    expiresAt: now + PLUGIN_SURFACES_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

export async function fetchPluginHostSurfaces(options: FetchPluginSurfacesOptions = {}): Promise<PluginSurface[]> {
  const surfaces = await fetchPluginSurfaces(undefined, options);
  return surfaces.filter((surface) => (
    surface.source === 'obsidian'
    && (
      surface.kind === 'command'
      || surface.kind === 'ribbon'
      || surface.kind === 'status'
      || surface.kind === 'view'
      || surface.kind === 'markdown'
      || surface.kind === 'style'
      || surface.kind === 'editor'
    )
    && (surface.availability === 'available' || surface.availability === 'recorded')
  ));
}

export function normalizePluginViewExtension(extension: string): string {
  return extension.trim().replace(/^\.+/, '').toLowerCase();
}

export function pluginViewSurfaceMatchesExtension(surface: PluginSurface, extension: string): boolean {
  const normalizedExtension = normalizePluginViewExtension(extension);
  if (!normalizedExtension) return false;
  if (surface.source !== 'obsidian') return false;
  if (surface.kind !== 'view') return false;
  if (surface.availability !== 'available') return false;
  if (surface.action?.type !== 'obsidian-view') return false;
  if (surface.metadata?.missingViewRegistration === true) return false;

  const fileExtensions = surface.metadata?.fileExtensions;
  if (!Array.isArray(fileExtensions)) return false;
  return fileExtensions.some((fileExtension) => (
    typeof fileExtension === 'string'
    && normalizePluginViewExtension(fileExtension) === normalizedExtension
  ));
}

export async function fetchPluginViewSurfacesForExtension(extension: string): Promise<PluginSurface[]> {
  const normalizedExtension = normalizePluginViewExtension(extension);
  if (!normalizedExtension) return [];

  const surfaces = await fetchPluginSurfaces('kind=view&source=obsidian');
  return surfaces.filter((surface) => pluginViewSurfaceMatchesExtension(surface, normalizedExtension));
}

export function firstPluginActionTargetPath(result: PluginActionResult | null | undefined): string | null {
  const target = result?.workspaceOpenRequests?.find((request) => (
    typeof request.targetPath === 'string' && request.targetPath.length > 0
  ));
  return target?.targetPath ?? null;
}

export function firstPluginActionModalSnapshot(result: PluginActionResult | null | undefined): PluginModalSnapshot | null {
  return result?.modalSnapshots?.[0] ?? null;
}

export function firstPluginActionMenuSnapshot(result: PluginActionResult | null | undefined): PluginMenuSnapshot | null {
  return result?.menuSnapshots?.[0] ?? null;
}

export function toastPluginActionNotices(result: PluginActionResult | null | undefined): boolean {
  const notices = result?.noticeSnapshots?.filter(isPluginNoticeSnapshot) ?? [];
  for (const notice of notices) {
    if (notice.level === 'error') {
      toast.error(notice.message, notice.timeout);
    } else if (notice.level === 'success') {
      toast.success(notice.message, notice.timeout);
    } else {
      toast(notice.message, notice.timeout !== undefined ? { duration: notice.timeout } : undefined);
    }
  }
  return notices.length > 0;
}

function isPluginNoticeSnapshot(value: unknown): value is PluginNoticeSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const record = value as PluginNoticeSnapshot;
  return typeof record.id === 'string'
    && typeof record.message === 'string'
    && (record.level === 'info' || record.level === 'success' || record.level === 'error')
    && (record.timeout === undefined || typeof record.timeout === 'number');
}

export async function executePluginCommandSurface(
  surface: PluginSurface,
  context?: PluginEditorCommandContext,
): Promise<PluginActionResult> {
  if (surface.action?.type !== 'obsidian-command') {
    throw new Error(`Unsupported plugin command surface: ${surface.id}`);
  }

  const data = await apiFetch<ObsidianPluginActionResponse>('/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'execute-command',
      commandId: surface.action.commandId,
      ...(context ? { editorContext: context } : {}),
    }),
  });
  return data.result ?? {};
}

export async function executePluginRibbonSurface(surface: PluginSurface): Promise<PluginActionResult> {
  if (surface.action?.type !== 'obsidian-ribbon') {
    throw new Error(`Unsupported plugin ribbon surface: ${surface.id}`);
  }

  const data = await apiFetch<ObsidianPluginActionResponse>('/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'execute-ribbon-action',
      pluginId: surface.action.pluginId,
      ribbonIndex: surface.action.ribbonIndex,
    }),
  });
  return data.result ?? {};
}

export async function choosePluginModalSuggestion(
  modalId: string,
  suggestionIndex: number,
  interactionId: string,
): Promise<PluginActionResult> {
  const data = await apiFetch<ObsidianPluginActionResponse>('/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'choose-modal-suggestion',
      modalId,
      suggestionIndex,
      interactionId,
    }),
  });
  return data.result ?? {};
}

export async function submitPluginModalText(
  modalId: string,
  text: string,
  interactionId: string,
): Promise<PluginActionResult> {
  const data = await apiFetch<ObsidianPluginActionResponse>('/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'submit-modal-text',
      modalId,
      text,
      interactionId,
    }),
  });
  return data.result ?? {};
}

export async function choosePluginMenuItem(
  menuId: string,
  itemIndex: number,
  interactionId: string,
): Promise<PluginActionResult> {
  const data = await apiFetch<ObsidianPluginActionResponse>('/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'choose-menu-item',
      menuId,
      itemIndex,
      interactionId,
    }),
  });
  return data.result ?? {};
}

export function pluginViewSurfaceHref(surface: PluginSurface, sourcePath?: string | null): string | null {
  if (surface.action?.type !== 'obsidian-view') return null;
  const params = new URLSearchParams({
    pluginId: surface.action.pluginId,
    viewType: surface.action.viewType,
  });
  if (sourcePath?.trim()) {
    params.set('sourcePath', sourcePath.trim());
  }
  return `/plugins/views?${params.toString()}`;
}

export async function fetchPluginView(pluginId: string, viewType: string, sourcePath?: string): Promise<PluginViewSnapshot> {
  const params = new URLSearchParams({ pluginId, viewType });
  if (sourcePath?.trim()) {
    params.set('sourcePath', sourcePath.trim());
  }
  const data = await apiFetch<PluginViewResponse>(`/api/obsidian-plugins/views?${params.toString()}`, {
    cache: 'no-store',
  });
  return data.view;
}

export async function fetchPluginStylesheet(pluginId: string): Promise<PluginStylesheetSnapshot> {
  const params = new URLSearchParams({ pluginId });
  const data = await apiFetch<PluginStylesheetResponse>(`/api/obsidian-plugins/styles?${params.toString()}`, {
    cache: 'no-store',
  });
  return data.stylesheet;
}

export async function fetchPluginMarkdownCodeBlockSnapshots(
  blocks: PluginMarkdownCodeBlockRequest[],
): Promise<PluginMarkdownCodeBlockSnapshot[]> {
  const data = await apiFetch<PluginMarkdownCodeBlocksResponse>('/api/obsidian-plugins/markdown-code-blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ blocks }),
  });
  return data.blocks ?? [];
}

export async function fetchPluginMarkdownPostProcessorSnapshots(
  markdown: string,
  sourcePath = '',
): Promise<PluginMarkdownPostProcessorRender[]> {
  const cacheKey = markdownPostProcessorCacheKey(markdown, sourcePath);
  const now = Date.now();
  const cached = pluginMarkdownPostProcessorCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if (cached.renders) return cached.renders;
    if (cached.promise) return cached.promise;
  }

  const promise = apiFetch<PluginMarkdownPostProcessorsResponse>('/api/obsidian-plugins/markdown-post-processors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ markdown, sourcePath }),
  }).then((data) => {
    const renders = data.renders ?? [];
    pluginMarkdownPostProcessorCache.set(cacheKey, {
      expiresAt: Date.now() + MARKDOWN_POST_PROCESSOR_CACHE_TTL_MS,
      renders,
    });
    return renders;
  }).catch((error) => {
    if (pluginMarkdownPostProcessorCache.get(cacheKey)?.promise === promise) {
      pluginMarkdownPostProcessorCache.delete(cacheKey);
    }
    throw error;
  });

  pluginMarkdownPostProcessorCache.set(cacheKey, {
    expiresAt: now + MARKDOWN_POST_PROCESSOR_CACHE_TTL_MS,
    promise,
  });
  return promise;
}
