import {
  assertMindosPermissionMode,
  normalizeMindosPermissionMode,
  type MindosPermissionMode,
} from '../../permission/index.js';

export type MindosHarnessPermissionMode = 'readonly' | 'agent';
export type MindosAcpPermissionMode = 'readonly' | 'ask' | 'auto' | 'full';
export type MindosKbWriteScope = 'none' | 'bounded' | 'all';

export type MindosExtensionScope =
  | 'kb'
  | 'ask-user-question'
  | 'pi-web-access'
  | 'user-extensions'
  | 'pi-mcp-adapter'
  | 'im'
  | 'subagents'
  | 'schedule-prompt';

export interface MindosAgentToolScope {
  kbRead: boolean;
  kbWrite: MindosKbWriteScope;
  web: boolean;
  askUserQuestion: boolean;
  terminal: boolean;
  mcp: boolean;
  subagents: boolean;
  acpDelegation: boolean;
  a2aDelegation: boolean;
  im: boolean;
  schedule: boolean;
  userExtensions: boolean;
}

export interface MindosAgentPermissionPolicy {
  mode: MindosPermissionMode;
  permissionMode: MindosPermissionMode;
  runtimePermissionMode: MindosHarnessPermissionMode;
  acpPermissionMode: MindosAcpPermissionMode;
  toolScope: MindosAgentToolScope;
  kbToolNames: readonly string[];
  writeToolNames: readonly string[];
  extensionScopes: readonly MindosExtensionScope[];
}

export const MINDOS_WRITE_TOOL_NAMES = [
  'write_file',
  'create_file',
  'batch_create_files',
  'append_to_file',
  'insert_after_heading',
  'update_section',
  'edit_lines',
  'delete_file',
  'rename_file',
  'move_file',
  'append_csv',
  'dreaming',
] as const;

export const MINDOS_READONLY_KB_TOOL_NAMES = [
  'list_files',
  'read_file',
  'read_file_chunk',
  'search',
  'load_skill',
  'get_recent',
  'get_backlinks',
] as const;

export const MINDOS_KNOWLEDGE_WRITE_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search',
  'load_skill',
  'create_file',
  'batch_create_files',
  'write_file',
  'append_to_file',
  'insert_after_heading',
  'update_section',
] as const;

export const MINDOS_ASK_KB_TOOL_NAMES = [
  'list_files',
  'read_file',
  'read_file_chunk',
  'search',
  'load_skill',
  'get_recent',
  'create_file',
  'batch_create_files',
  'write_file',
  'append_to_file',
  'insert_after_heading',
  'update_section',
  'get_backlinks',
  'get_history',
  'get_file_at_version',
  'append_csv',
  'lint',
  'dreaming',
  'compile',
] as const;

const BASE_SAFE_EXTENSION_SCOPES = [
  'kb',
  'ask-user-question',
  'pi-web-access',
] as const satisfies readonly MindosExtensionScope[];

const SAFE_AGENT_EXTENSION_SCOPES = [
  ...BASE_SAFE_EXTENSION_SCOPES,
  'subagents',
] as const satisfies readonly MindosExtensionScope[];

const AUTO_EXTENSION_SCOPES = [
  ...SAFE_AGENT_EXTENSION_SCOPES,
  'im',
  'schedule-prompt',
] as const satisfies readonly MindosExtensionScope[];

const FULL_EXTENSION_SCOPES = [
  ...AUTO_EXTENSION_SCOPES,
  'user-extensions',
  'pi-mcp-adapter',
] as const satisfies readonly MindosExtensionScope[];

function fullToolScope(): MindosAgentToolScope {
  return {
    kbRead: true,
    kbWrite: 'all',
    web: true,
    askUserQuestion: true,
    terminal: true,
    mcp: true,
    subagents: true,
    acpDelegation: true,
    a2aDelegation: true,
    im: true,
    schedule: true,
    userExtensions: true,
  };
}

function askToolScope(): MindosAgentToolScope {
  return {
    kbRead: true,
    kbWrite: 'bounded',
    web: true,
    askUserQuestion: true,
    terminal: false,
    mcp: false,
    subagents: true,
    acpDelegation: false,
    a2aDelegation: false,
    im: false,
    schedule: false,
    userExtensions: false,
  };
}

function autoToolScope(): MindosAgentToolScope {
  return {
    kbRead: true,
    kbWrite: 'all',
    web: true,
    askUserQuestion: true,
    terminal: false,
    mcp: false,
    subagents: true,
    acpDelegation: true,
    a2aDelegation: true,
    im: true,
    schedule: true,
    userExtensions: false,
  };
}

function readOnlyPolicy(): MindosAgentPermissionPolicy {
  return {
    mode: 'read',
    permissionMode: 'read',
    runtimePermissionMode: 'readonly',
    acpPermissionMode: 'readonly',
    toolScope: {
      kbRead: true,
      kbWrite: 'none',
      web: true,
      askUserQuestion: true,
      terminal: false,
      mcp: false,
      subagents: true,
      acpDelegation: false,
      a2aDelegation: false,
      im: false,
      schedule: false,
      userExtensions: false,
    },
    kbToolNames: [...MINDOS_READONLY_KB_TOOL_NAMES],
    writeToolNames: [...MINDOS_WRITE_TOOL_NAMES],
    extensionScopes: [...SAFE_AGENT_EXTENSION_SCOPES],
  };
}

function askPolicy(): MindosAgentPermissionPolicy {
  return {
    mode: 'ask',
    permissionMode: 'ask',
    runtimePermissionMode: 'agent',
    acpPermissionMode: 'ask',
    toolScope: askToolScope(),
    kbToolNames: [...MINDOS_ASK_KB_TOOL_NAMES],
    writeToolNames: [...MINDOS_WRITE_TOOL_NAMES],
    extensionScopes: [...SAFE_AGENT_EXTENSION_SCOPES],
  };
}

function autoPolicy(): MindosAgentPermissionPolicy {
  return {
    mode: 'auto',
    permissionMode: 'auto',
    runtimePermissionMode: 'agent',
    acpPermissionMode: 'auto',
    toolScope: autoToolScope(),
    kbToolNames: [],
    writeToolNames: [...MINDOS_WRITE_TOOL_NAMES],
    extensionScopes: [...AUTO_EXTENSION_SCOPES],
  };
}

function fullPolicy(): MindosAgentPermissionPolicy {
  return {
    mode: 'full',
    permissionMode: 'full',
    runtimePermissionMode: 'agent',
    acpPermissionMode: 'full',
    toolScope: fullToolScope(),
    kbToolNames: [],
    writeToolNames: [...MINDOS_WRITE_TOOL_NAMES],
    extensionScopes: [...FULL_EXTENSION_SCOPES],
  };
}

export function createMindosAgentPermissionPolicy(
  mode: MindosPermissionMode = 'ask',
): MindosAgentPermissionPolicy {
  const normalized = assertMindosPermissionMode(mode);
  switch (normalized) {
    case 'read':
      return readOnlyPolicy();
    case 'ask':
      return askPolicy();
    case 'auto':
      return autoPolicy();
    case 'full':
      return fullPolicy();
  }
}

export function createMindosKnowledgeWritePermissionPolicy(
  mode: MindosPermissionMode = 'ask',
): MindosAgentPermissionPolicy {
  const normalized = normalizeMindosPermissionMode(mode);
  return {
    mode: normalized,
    permissionMode: normalized,
    runtimePermissionMode: 'readonly',
    acpPermissionMode: 'readonly',
    toolScope: {
      kbRead: true,
      kbWrite: 'bounded',
      web: true,
      askUserQuestion: true,
      terminal: false,
      mcp: false,
      subagents: false,
      acpDelegation: false,
      a2aDelegation: false,
      im: false,
      schedule: false,
      userExtensions: false,
    },
    kbToolNames: [...MINDOS_KNOWLEDGE_WRITE_TOOL_NAMES],
    writeToolNames: [...MINDOS_WRITE_TOOL_NAMES],
    extensionScopes: [...BASE_SAFE_EXTENSION_SCOPES],
  };
}

export function createMindosAgentPermissionPolicyFromContext(
  context: unknown,
  fallbackMode: MindosPermissionMode = 'ask',
): MindosAgentPermissionPolicy {
  if (!context || typeof context !== 'object') {
    return createMindosAgentPermissionPolicy(fallbackMode);
  }
  const record = context as Record<string, unknown>;
  return createMindosAgentPermissionPolicy(
    normalizeMindosPermissionMode(record.permissionMode, fallbackMode),
  );
}

export function getMindosKbToolNameSet(policy: MindosAgentPermissionPolicy): ReadonlySet<string> | null {
  if (policy.toolScope.kbWrite === 'all') return null;
  return new Set(policy.kbToolNames);
}

export function hasMindosExtensionScope(
  policy: MindosAgentPermissionPolicy,
  scope: MindosExtensionScope,
): boolean {
  return policy.extensionScopes.includes(scope);
}
