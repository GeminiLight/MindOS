import { getObsidianImportSupport, type ObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import type { PluginManifest } from '@/lib/obsidian-compat/types';
import type { RendererPluginManifest } from '@/lib/renderers/registry';

export type PluginSurfaceSource = 'obsidian' | 'mindos-renderer' | 'mindos-native';

export type PluginSurfaceKind =
  | 'command'
  | 'settings'
  | 'ribbon'
  | 'status'
  | 'view'
  | 'markdown'
  | 'style'
  | 'editor'
  | 'document-renderer';

export type PluginSurfaceLocation =
  | 'command-center'
  | 'settings'
  | 'plugin-actions'
  | 'status-bar'
  | 'plugin-views'
  | 'document'
  | 'plugin-assets'
  | 'editor'
  | 'diagnostics';

export type PluginSurfaceAvailability = 'available' | 'recorded' | 'blocked' | 'disabled';

export type PluginSurfaceHostState = 'mounted' | 'catalog' | 'diagnostic';

export interface PluginSurfaceHost {
  state: PluginSurfaceHostState;
  label: string;
  description: string;
}

export type PluginSurfaceAction =
  | {
    type: 'obsidian-command';
    commandId: string;
  }
  | {
    type: 'obsidian-ribbon';
    pluginId: string;
    ribbonIndex: number;
  }
  | {
    type: 'obsidian-view';
    pluginId: string;
    viewType: string;
  };

export interface PluginSurface {
  id: string;
  source: PluginSurfaceSource;
  kind: PluginSurfaceKind;
  location: PluginSurfaceLocation;
  availability: PluginSurfaceAvailability;
  pluginId: string;
  pluginName: string;
  title: string;
  description?: string;
  icon?: string;
  host: PluginSurfaceHost;
  action?: PluginSurfaceAction;
  metadata?: Record<string, unknown>;
}

export interface PluginHotkey {
  modifiers: string[];
  key: string;
}

export interface PluginHotkeyConflict {
  hotkey: PluginHotkey;
  label: string;
  owner: 'mindos-reserved' | 'plugin-command';
  ownerLabel: string;
  pluginId?: string;
  commandId?: string;
}

export interface PluginHotkeyPolicy {
  binding: 'display-only' | 'user-confirmable';
  status: 'ready' | 'conflict';
  reason: string;
  conflicts: PluginHotkeyConflict[];
}

export interface ObsidianRuntimeCommand {
  id: string;
  fullId: string;
  name: string;
  executable?: boolean;
  requiresEditor?: boolean;
  callbackType?: 'callback' | 'check-callback' | 'editor-callback' | 'editor-check-callback' | 'none';
  availabilityReason?: string;
  hotkeys?: PluginHotkey[];
  hotkeySources?: { default: number; obsidianImport: number };
}

export interface ObsidianRuntimeSummaryForSurfaces {
  commandList?: ObsidianRuntimeCommand[];
  settingTabs?: number;
  ribbonIconList?: Array<{ icon: string; title: string }>;
  statusBarItemList?: Array<{ text: string }>;
  viewList?: Array<{ type: string }>;
  viewExtensionList?: Array<{ viewType: string; extensions: string[] }>;
  markdownPostProcessors?: number;
  markdownCodeBlockLanguages?: string[];
  styleSheetList?: Array<{ path: string; bytes: number }>;
  editorExtensions?: number;
  editorExtensionList?: Array<{
    id: string;
    kind: string;
    valueType: string;
    serializable: boolean;
    count?: number;
    constructorName?: string;
    keys?: string[];
    mountStatus?: 'catalog-only';
    capabilityGate?: string;
    mountReason?: string;
    autoMount?: false;
    sandbox?: BrowserEditorSandboxPlanLike;
  }>;
}

export interface BrowserEditorSandboxPlanLike {
  phase?: 'p3a-browser-editor-sandbox';
  target?: 'codemirror-extension' | 'editor-suggest';
  host?: 'browser-codemirror-sandbox';
  status?: 'requires-browser-sandbox';
  transferable?: boolean;
  permissionGate?: string;
  canAutoMount?: false;
  cleanupRequired?: boolean;
  requiredPermissions?: string[];
  requirements?: string[];
  reasons?: string[];
}

export interface PluginCapabilityGate {
  capability: 'browser-editor-extension-host';
  status: 'required';
  autoEnable: false;
  reason: string;
  nextStep: string;
}

export interface BrowserEditorSandboxSurfaceSummary {
  phase: 'p3a-browser-editor-sandbox';
  host: 'browser-codemirror-sandbox';
  status: 'requires-browser-sandbox';
  registrations: number;
  transferableRegistrations: number;
  cleanupRequired: true;
  canAutoMount: false;
  permissionGate: 'browser-editor-extension-host';
  requirements: string[];
}

export interface ObsidianPluginForSurfaces {
  id: string;
  name: string;
  enabled: boolean;
  loaded: boolean;
  manifest?: PluginManifest;
  compatibilityLevel: 'compatible' | 'partial' | 'blocked';
  compatibility?: {
    partialApis: string[];
    unsupportedApis?: string[];
    blockers: string[];
  };
  runtime: ObsidianRuntimeSummaryForSurfaces;
  lastError?: string;
}

export interface RendererPluginForSurfaces {
  id: string;
  name: string;
  description: string;
  author: string;
  icon: string;
  tags: string[];
  builtin: boolean;
  manifest: RendererPluginManifest;
  core?: boolean;
  entryPath?: string;
  enabled?: boolean;
}

export interface PluginSurfaceFilter {
  kind?: PluginSurfaceKind;
  source?: PluginSurfaceSource;
}

interface HotkeyOwner {
  pluginId: string;
  pluginName: string;
  commandId: string;
  commandFullId: string;
  commandName: string;
}

const HOTKEY_POLICY_REASON = 'Obsidian default and imported hotkeys are shown for recognition; conflict-free hotkeys can be bound only after user confirmation in MindOS.';

const EDITOR_EXTENSION_CAPABILITY_GATE: PluginCapabilityGate = {
  capability: 'browser-editor-extension-host',
  status: 'required',
  autoEnable: false,
  reason: 'CodeMirror extensions are executable browser-side editor objects and cannot be safely mounted from the server plugin runtime.',
  nextStep: 'Mount only after a per-plugin editor sandbox, explicit permission gate, and unload cleanup path exist.',
};

const MINDOS_RESERVED_HOTKEYS: Array<{ hotkey: PluginHotkey; ownerLabel: string }> = [
  { hotkey: { modifiers: ['Mod'], key: 'k' }, ownerLabel: 'MindOS Search' },
  { hotkey: { modifiers: ['Mod'], key: '/' }, ownerLabel: 'Ask MindOS' },
  { hotkey: { modifiers: ['Mod'], key: ',' }, ownerLabel: 'Settings' },
  { hotkey: { modifiers: ['Mod', 'Shift'], key: '/' }, ownerLabel: 'Keyboard shortcuts' },
];

function pluginSurfaceBase(plugin: ObsidianPluginForSurfaces): Pick<PluginSurface, 'source' | 'pluginId' | 'pluginName'> {
  return {
    source: 'obsidian',
    pluginId: plugin.id,
    pluginName: plugin.name,
  };
}

function pluginSupportMetadata(support: ObsidianImportSupport): Record<string, unknown> {
  return {
    supportKind: support.kind,
    supportLabel: support.label,
    supportReason: support.reason,
    importable: support.importable,
  };
}

function slugifySurfacePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export function buildObsidianPluginSurfaces(plugins: ObsidianPluginForSurfaces[]): PluginSurface[] {
  const surfaces: PluginSurface[] = [];
  const commandHotkeyOwners = buildCommandHotkeyOwnerIndex(plugins);

  for (const plugin of plugins) {
    const base = pluginSurfaceBase(plugin);
    const pluginBlocked = plugin.compatibilityLevel === 'blocked';
    const support = getObsidianImportSupport({
      compatibilityLevel: plugin.compatibilityLevel,
      compatibility: plugin.compatibility ?? { partialApis: [], unsupportedApis: [], blockers: [] },
    });
    const supportMetadata = {
      ...pluginSupportMetadata(support),
      ...(plugin.manifest ? { manifest: plugin.manifest } : {}),
    };

    for (const command of plugin.runtime.commandList ?? []) {
      const hotkeys = command.hotkeys ?? [];
      const hotkeyPolicy = buildCommandHotkeyPolicy(command, commandHotkeyOwners);
      const commandExecutable = command.executable !== false && !pluginBlocked;
      const commandRecorded = !pluginBlocked && !commandExecutable;
      const commandReason = command.availabilityReason ?? (
        command.requiresEditor
          ? 'This command requires an active editor facade and is cataloged until an editor host is available.'
          : 'This command is recorded for diagnosis but is not currently executable.'
      );
      surfaces.push({
        ...base,
        id: `obsidian:command:${command.fullId}`,
        kind: 'command',
        location: 'command-center',
        availability: pluginBlocked ? 'blocked' : commandExecutable ? 'available' : 'recorded',
        title: command.name,
        description: commandExecutable ? `Run ${plugin.name} command` : commandReason,
        icon: 'terminal',
        host: {
          state: pluginBlocked ? 'diagnostic' : commandExecutable ? 'mounted' : 'catalog',
          label: commandExecutable ? 'Command Center' : command.requiresEditor ? 'Editor command catalog' : 'Command catalog',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : commandExecutable
              ? 'Searchable and executable from MindOS command surfaces.'
              : commandReason,
        },
        ...(commandExecutable ? {
          action: {
            type: 'obsidian-command' as const,
            commandId: command.fullId,
          },
        } : {}),
        metadata: {
          ...supportMetadata,
          commandId: command.id,
          fullCommandId: command.fullId,
          executable: commandExecutable,
          requiresEditor: command.requiresEditor === true,
          callbackType: command.callbackType ?? 'callback',
          availabilityReason: pluginBlocked ? 'Blocked by compatibility checks.' : commandRecorded ? commandReason : undefined,
          hotkeys,
          hotkeySources: command.hotkeySources ?? { default: hotkeys.length, obsidianImport: 0 },
          hotkeyPolicy,
          hotkeyConflicts: hotkeyPolicy.conflicts,
        },
      });
    }

    if ((plugin.runtime.settingTabs ?? 0) > 0) {
      surfaces.push({
        ...base,
        id: `obsidian:settings:${plugin.id}`,
        kind: 'settings',
        location: 'settings',
        availability: 'available',
        title: `${plugin.name} settings`,
        description: 'Configure this plugin in Settings > Plugins.',
        icon: 'sliders',
        host: {
          state: 'mounted',
          label: 'Settings > Plugins',
          description: 'Mounted in the plugin management and configuration surface.',
        },
        metadata: {
          ...supportMetadata,
          settingTabs: plugin.runtime.settingTabs,
        },
      });
    }

    for (const [index, ribbon] of (plugin.runtime.ribbonIconList ?? []).entries()) {
      surfaces.push({
        ...base,
        id: `obsidian:ribbon:${plugin.id}:${index}:${slugifySurfacePart(ribbon.title)}`,
        kind: 'ribbon',
        location: 'plugin-actions',
        availability: pluginBlocked ? 'blocked' : 'available',
        title: ribbon.title,
        description: 'Obsidian ribbon action shown in Plugin Entries.',
        icon: ribbon.icon,
        host: {
          state: pluginBlocked ? 'diagnostic' : 'mounted',
          label: 'Plugin Entries actions',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : 'Executable from Plugin Entries through the Obsidian compatibility lifecycle host.',
        },
        action: {
          type: 'obsidian-ribbon',
          pluginId: plugin.id,
          ribbonIndex: index,
        },
        metadata: {
          ...supportMetadata,
          index,
        },
      });
    }

    for (const [index, status] of (plugin.runtime.statusBarItemList ?? []).entries()) {
      surfaces.push({
        ...base,
        id: `obsidian:status:${plugin.id}:${index}`,
        kind: 'status',
        location: 'status-bar',
        availability: 'recorded',
        title: status.text || `${plugin.name} status`,
        description: 'Obsidian status item shown in Plugin Entries.',
        icon: 'activity',
        host: {
          state: 'mounted',
          label: 'Plugin Entries status',
          description: 'Mounted as a text snapshot in the Plugin Entries status section.',
        },
        metadata: {
          ...supportMetadata,
          index,
          text: status.text,
        },
      });
    }

    for (const view of plugin.runtime.viewList ?? []) {
      const fileExtensions = viewExtensionsForType(plugin.runtime.viewExtensionList, view.type);
      surfaces.push({
        ...base,
        id: `obsidian:view:${plugin.id}:${slugifySurfacePart(view.type)}`,
        kind: 'view',
        location: 'plugin-views',
        availability: pluginBlocked ? 'blocked' : 'available',
        title: view.type,
        description: 'Custom view available in the Plugin View host.',
        icon: 'panel',
        host: {
          state: pluginBlocked ? 'diagnostic' : 'mounted',
          label: 'Plugin View host',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : 'Openable through a stable MindOS Plugin View host without dynamically extending the main navigation.',
        },
        action: {
          type: 'obsidian-view',
          pluginId: plugin.id,
          viewType: view.type,
        },
        metadata: {
          ...supportMetadata,
          viewType: view.type,
          fileExtensions,
        },
      });
    }

    const registeredViewTypes = new Set((plugin.runtime.viewList ?? []).map((view) => view.type));
    for (const extensionMapping of plugin.runtime.viewExtensionList ?? []) {
      if (registeredViewTypes.has(extensionMapping.viewType)) continue;
      surfaces.push({
        ...base,
        id: `obsidian:view-extension:${plugin.id}:${slugifySurfacePart(extensionMapping.viewType)}`,
        kind: 'view',
        location: 'plugin-views',
        availability: pluginBlocked ? 'blocked' : 'recorded',
        title: extensionMapping.viewType,
        description: 'File extension mapping recorded without a matching registered view.',
        icon: 'panel',
        host: {
          state: 'diagnostic',
          label: 'Plugin View host',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : 'File extensions were registered for this view type, but no matching registerView() host was recorded.',
        },
        metadata: {
          ...supportMetadata,
          viewType: extensionMapping.viewType,
          fileExtensions: extensionMapping.extensions,
          missingViewRegistration: true,
        },
      });
    }

    for (const language of plugin.runtime.markdownCodeBlockLanguages ?? []) {
      surfaces.push({
        ...base,
        id: `obsidian:markdown-code:${plugin.id}:${slugifySurfacePart(language)}`,
        kind: 'markdown',
        location: 'document',
        availability: pluginBlocked ? 'blocked' : 'available',
        title: `\`\`\`${language}`,
        description: 'Code block processor available in the document rendering host.',
        icon: 'code',
        host: {
          state: pluginBlocked ? 'diagnostic' : 'mounted',
          label: 'Document rendering host',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : 'Rendered as a sanitized text snapshot next to matching fenced code blocks.',
        },
        metadata: {
          ...supportMetadata,
          processorType: 'code-block',
          language,
        },
      });
    }

    for (const [index, styleSheet] of (plugin.runtime.styleSheetList ?? []).entries()) {
      const styleMounted = !pluginBlocked && plugin.enabled && plugin.loaded;
      surfaces.push({
        ...base,
        id: `obsidian:style:${plugin.id}:${index}:${slugifySurfacePart(styleSheet.path)}`,
        kind: 'style',
        location: 'plugin-assets',
        availability: pluginBlocked ? 'blocked' : styleMounted ? 'available' : 'recorded',
        title: `${plugin.name} stylesheet`,
        description: 'Obsidian styles.css asset mounted through a scoped Plugin View host when the plugin is loaded.',
        icon: 'palette',
        host: {
          state: pluginBlocked ? 'diagnostic' : styleMounted ? 'mounted' : 'catalog',
          label: styleMounted ? 'Scoped stylesheet host' : 'Stylesheet catalog',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : styleMounted
              ? 'Mounted only inside MindOS Plugin View host containers; global CSS injection remains disabled.'
              : 'Recorded as a plugin package asset and mounted only after the plugin is enabled and loaded.',
        },
        metadata: {
          ...supportMetadata,
          path: styleSheet.path,
          bytes: styleSheet.bytes,
          injectionPolicy: 'scoped-plugin-view',
          scope: 'plugin-view-host',
          globalInjection: false,
        },
      });
    }

    if ((plugin.runtime.markdownPostProcessors ?? 0) > 0) {
      surfaces.push({
        ...base,
        id: `obsidian:markdown-post:${plugin.id}`,
        kind: 'markdown',
        location: 'document',
        availability: pluginBlocked ? 'blocked' : 'available',
        title: `${plugin.name} markdown post processors`,
        description: 'Markdown post processor available in the document rendering host.',
        icon: 'file-text',
        host: {
          state: pluginBlocked ? 'diagnostic' : 'mounted',
          label: 'Document rendering host',
          description: pluginBlocked
            ? 'Blocked by compatibility checks; listed for diagnosis only.'
            : 'Rendered as a sanitized text snapshot for the current document.',
        },
        metadata: {
          ...supportMetadata,
          processorType: 'post',
          count: plugin.runtime.markdownPostProcessors,
        },
      });
    }

    const editorExtensions = plugin.runtime.editorExtensionList ?? [];
    if ((plugin.runtime.editorExtensions ?? 0) > 0) {
      surfaces.push({
        ...base,
        id: `obsidian:editor:${plugin.id}`,
        kind: 'editor',
        location: 'editor',
        availability: 'recorded',
        title: `${plugin.name} editor extensions`,
        description: 'CodeMirror editor extensions cataloged behind a browser editor capability gate.',
        icon: 'edit',
        host: {
          state: 'catalog',
          label: 'Editor capability gate',
          description: EDITOR_EXTENSION_CAPABILITY_GATE.reason,
        },
        metadata: {
          ...supportMetadata,
          count: plugin.runtime.editorExtensions,
          editorExtensions,
          mountPolicy: 'catalog-only',
          capabilityGate: EDITOR_EXTENSION_CAPABILITY_GATE,
          browserEditorSandbox: buildBrowserEditorSandboxSurfaceSummary(editorExtensions),
        },
      });
    }
  }

  return surfaces;
}

export function buildRendererPluginSurfaces(renderers: RendererPluginForSurfaces[]): PluginSurface[] {
  return renderers.map((renderer) => ({
    id: `mindos-renderer:document-renderer:${renderer.id}`,
    source: 'mindos-renderer',
    kind: 'document-renderer',
    location: 'document',
    availability: renderer.enabled === false ? 'disabled' : 'available',
    pluginId: renderer.id,
    pluginName: renderer.name,
    title: renderer.name,
    description: renderer.description,
    icon: renderer.icon,
    host: {
      state: renderer.enabled === false ? 'diagnostic' : 'mounted',
      label: 'Document renderer',
      description: renderer.enabled === false
        ? 'Registered but disabled for document rendering.'
        : 'Mounted in the document rendering pipeline.',
    },
    metadata: {
      author: renderer.author,
      tags: renderer.tags,
      builtin: renderer.builtin,
      core: renderer.core === true,
      entryPath: renderer.entryPath,
      manifest: renderer.manifest,
    },
  }));
}

export function filterPluginSurfaces(surfaces: PluginSurface[], filter: PluginSurfaceFilter): PluginSurface[] {
  return surfaces.filter((surface) => (
    (!filter.kind || surface.kind === filter.kind)
    && (!filter.source || surface.source === filter.source)
  ));
}

function buildCommandHotkeyOwnerIndex(plugins: ObsidianPluginForSurfaces[]): Map<string, HotkeyOwner[]> {
  const owners = new Map<string, HotkeyOwner[]>();

  for (const plugin of plugins) {
    for (const command of plugin.runtime.commandList ?? []) {
      for (const hotkey of command.hotkeys ?? []) {
        const signature = hotkeySignature(hotkey);
        if (!signature) continue;
        const list = owners.get(signature) ?? [];
        list.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          commandId: command.id,
          commandFullId: command.fullId,
          commandName: command.name,
        });
        owners.set(signature, list);
      }
    }
  }

  return owners;
}

function viewExtensionsForType(
  mappings: Array<{ viewType: string; extensions: string[] }> | undefined,
  viewType: string,
): string[] {
  const extensions = new Set<string>();
  for (const mapping of mappings ?? []) {
    if (mapping.viewType !== viewType) continue;
    for (const extension of mapping.extensions) {
      const normalized = extension.trim().replace(/^\.+/, '').toLowerCase();
      if (normalized) extensions.add(normalized);
    }
  }
  return Array.from(extensions).sort();
}

function buildBrowserEditorSandboxSurfaceSummary(
  editorExtensions: NonNullable<ObsidianRuntimeSummaryForSurfaces['editorExtensionList']>,
): BrowserEditorSandboxSurfaceSummary {
  const requirements = new Set<string>();
  let transferableRegistrations = 0;

  for (const extension of editorExtensions) {
    if ((extension.sandbox?.transferable ?? extension.serializable) === true) {
      transferableRegistrations += 1;
    }
    for (const requirement of extension.sandbox?.requirements ?? []) {
      if (typeof requirement === 'string' && requirement.trim()) {
        requirements.add(requirement.trim());
      }
    }
  }

  if (requirements.size === 0) {
    requirements.add('per-plugin browser editor sandbox');
    requirements.add('explicit user permission gate');
    requirements.add('deterministic unload cleanup for extensions, keymaps, suggestions, and decorations');
  }

  return {
    phase: 'p3a-browser-editor-sandbox',
    host: 'browser-codemirror-sandbox',
    status: 'requires-browser-sandbox',
    registrations: editorExtensions.length,
    transferableRegistrations,
    cleanupRequired: true,
    canAutoMount: false,
    permissionGate: 'browser-editor-extension-host',
    requirements: Array.from(requirements),
  };
}

function buildCommandHotkeyPolicy(command: ObsidianRuntimeCommand, commandHotkeyOwners: Map<string, HotkeyOwner[]>): PluginHotkeyPolicy {
  const conflicts: PluginHotkeyConflict[] = [];
  const seen = new Set<string>();

  for (const hotkey of command.hotkeys ?? []) {
    const signature = hotkeySignature(hotkey);
    if (!signature) continue;

    for (const reserved of MINDOS_RESERVED_HOTKEYS) {
      if (hotkeySignature(reserved.hotkey) !== signature) continue;
      const conflictKey = `${signature}:mindos:${reserved.ownerLabel}`;
      if (seen.has(conflictKey)) continue;
      seen.add(conflictKey);
      conflicts.push({
        hotkey,
        label: formatHotkeyLabel(hotkey),
        owner: 'mindos-reserved',
        ownerLabel: reserved.ownerLabel,
      });
    }

    for (const owner of commandHotkeyOwners.get(signature) ?? []) {
      if (owner.commandFullId === command.fullId) continue;
      const conflictKey = `${signature}:plugin:${owner.commandFullId}`;
      if (seen.has(conflictKey)) continue;
      seen.add(conflictKey);
      conflicts.push({
        hotkey,
        label: formatHotkeyLabel(hotkey),
        owner: 'plugin-command',
        ownerLabel: `${owner.pluginName}: ${owner.commandName}`,
        pluginId: owner.pluginId,
        commandId: owner.commandFullId,
      });
    }
  }

  return {
    binding: conflicts.length > 0 ? 'display-only' : 'user-confirmable',
    status: conflicts.length > 0 ? 'conflict' : 'ready',
    reason: HOTKEY_POLICY_REASON,
    conflicts,
  };
}

function hotkeySignature(hotkey: PluginHotkey): string | null {
  const key = normalizeHotkeyKey(hotkey.key);
  if (!key) return null;
  const modifiers = Array.from(new Set(hotkey.modifiers.map(normalizeHotkeyModifier).filter(Boolean)))
    .sort((a, b) => hotkeyModifierSortValue(a) - hotkeyModifierSortValue(b) || a.localeCompare(b));
  return [...modifiers, key].join('+');
}

function normalizeHotkeyModifier(modifier: string): string {
  const value = modifier.trim().toLowerCase();
  if (value === 'mod' || value === 'meta' || value === 'cmd' || value === 'command') return 'mod';
  if (value === 'ctrl' || value === 'control') return 'ctrl';
  if (value === 'shift') return 'shift';
  if (value === 'alt' || value === 'option') return 'alt';
  return value;
}

function normalizeHotkeyKey(key: string): string {
  return key.trim().toLowerCase();
}

function hotkeyModifierSortValue(modifier: string): number {
  if (modifier === 'mod') return 0;
  if (modifier === 'ctrl') return 1;
  if (modifier === 'alt') return 2;
  if (modifier === 'shift') return 3;
  return 10;
}

function formatHotkeyLabel(hotkey: PluginHotkey): string {
  const modifiers = hotkey.modifiers.map((modifier) => {
    const normalized = normalizeHotkeyModifier(modifier);
    if (normalized === 'mod') return 'Mod';
    if (normalized === 'ctrl') return 'Ctrl';
    if (normalized === 'alt') return 'Alt';
    if (normalized === 'shift') return 'Shift';
    return modifier.trim();
  });
  return [...modifiers, hotkey.key.trim()].filter(Boolean).join('+');
}
