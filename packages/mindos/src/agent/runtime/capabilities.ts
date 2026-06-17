import type {
  AgentRuntimeCapabilities,
  AgentRuntimeHarnessCapabilities,
} from './registry.js';

export const mindosCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: true,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: true,
  supportsApprovals: false,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

const nativeBaseCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: true,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

export const codexCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
  supportsListSessions: true,
  supportsAttachExisting: true,
  supportsFork: true,
  supportsArchive: true,
};

export const claudeCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
};

export const acpCapabilities: AgentRuntimeCapabilities = {
  ownsModelSelection: true,
  supportsResume: false,
  supportsFreshSession: false,
  supportsListSessions: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: false,
  supportsUserInput: false,
  supportsToolEvents: true,
  supportsRuntimeStatus: false,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: false,
};

export const mindosHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'local-id',
  eventStream: ['text', 'tool-events', 'runtime-status', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'mindos-only',
  tools: ['file', 'mcp', 'skills'],
  output: ['text', 'artifact'],
};

export const codexHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'native-thread',
  eventStream: ['text', 'tool-events', 'thread-turn-item', 'runtime-status', 'permissions', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'runtime-bridged',
  tools: ['shell', 'file', 'git', 'mcp'],
  output: ['text', 'diff', 'checkpoint', 'artifact', 'branch', 'pr'],
};

export const claudeHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'local-id',
  eventStream: ['text', 'tool-events', 'runtime-status', 'permissions', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'runtime-bridged',
  tools: ['shell', 'file', 'git', 'mcp'],
  output: ['text', 'diff', 'artifact'],
};

export const acpHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'none',
  eventStream: ['text', 'tool-events'],
  workspace: 'local-cwd',
  permissions: 'none',
  tools: ['shell', 'file'],
  output: ['text'],
};
