export {
  AGENT_ALIASES,
  AGENT_DESCRIPTORS,
  findUserOverride,
  getDescriptorBinary,
  getDescriptorDescription,
  getDescriptorDisplayName,
  getDescriptorInstallCmd,
  getDetectableAgents,
  parseAcpAgentOverrides,
  resolveAgentCommand,
  resolveAlias,
} from './agent-descriptors.js';
export {
  clearRegistryCache,
  fetchAcpRegistry,
  findAcpAgent,
  getAcpAgents,
} from './registry.js';
export {
  detectLocalAcpAgents,
  expandHome,
  isPathLikeCommand,
  resolveCommandPath,
  resolveCommandPathSync,
  resolveDirectCommandPath,
  resolveExistingPresenceDir,
} from './detect-local.js';
export {
  getActiveProcesses,
  getProcess,
  killAgent,
  killAllAgents,
  spawnAcpAgent,
  spawnAndConnect,
} from './subprocess.js';
export {
  cancelPrompt,
  closeAllSessions,
  closeSession,
  createSession,
  createSessionFromEntry,
  getActiveSessions,
  getSession,
  listSessions,
  loadSession,
  prompt,
  promptStream,
  setConfigOption,
  setMode,
} from './session.js';
export { ACP_ERRORS } from './types.js';
export type {
  AcpAgentDescriptor,
  AcpAgentOverride,
  DetectableAgent,
  ResolvedAgentCommand,
} from './agent-descriptors.js';
export type {
  AcpSessionOptions,
} from './session.js';
export type {
  AcpConnection,
  AcpClientCallbacks,
  AcpLaunchOptions,
  AcpProcess,
} from './subprocess.js';
export type {
  InstalledAgent,
  LocalAcpDetectionOptions,
  NotInstalledAgent,
} from './detect-local.js';
export type {
  AcpAgentCapabilities,
  AcpAuthMethod,
  AcpClientCapabilities,
  AcpConfigOption,
  AcpConfigOptionEntry,
  AcpContentBlock,
  AcpMode,
  AcpPermissionOutcome,
  AcpPlan,
  AcpPlanEntry,
  AcpPlanEntryPriority,
  AcpPlanEntryStatus,
  AcpPromptResponse,
  AcpRegistry,
  AcpRegistryEntry,
  AcpSession,
  AcpSessionInfo,
  AcpSessionState,
  AcpSessionUpdate,
  AcpStopReason,
  AcpToolCall,
  AcpToolCallFull,
  AcpToolCallKind,
  AcpToolCallStatus,
  AcpToolResult,
  AcpTransportType,
  AcpUpdateType,
} from './types.js';
