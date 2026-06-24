export {
  AGENT_ALIASES,
  AGENT_DESCRIPTORS,
  findUserOverride,
  getDescriptorBinary,
  getDescriptorDescription,
  getDescriptorDisplayName,
  getDescriptorInstallCmd,
  getConfiguredDetectableAgents,
  getDetectableAgents,
  parseAcpAgentOverrides,
  resolveConfiguredAcpAgentEntry,
  resolveAgentCommand,
  resolveAlias,
} from '@geminilight/mindos/protocols/acp';
export type {
  AcpAgentDescriptor,
  AcpAgentOverride,
  DetectableAgent,
  ResolvedAgentCommand,
} from '@geminilight/mindos/protocols/acp';
