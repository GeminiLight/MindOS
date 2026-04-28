export type MindosProtocolHost = 'mcp' | 'acp' | 'a2a';

export interface ProtocolCapabilityBoundary {
  readonly host: MindosProtocolHost;
  readonly productLogicOwner: '@geminilight/mindos';
  readonly transportRole: 'host';
  readonly hostPackageRole?: string;
}

export const protocolCapabilityBoundaries: readonly ProtocolCapabilityBoundary[] = [
  { host: 'mcp', productLogicOwner: '@geminilight/mindos', transportRole: 'host', hostPackageRole: 'mcp-server' },
  { host: 'acp', productLogicOwner: '@geminilight/mindos', transportRole: 'host', hostPackageRole: 'acp' },
  { host: 'a2a', productLogicOwner: '@geminilight/mindos', transportRole: 'host' },
];
