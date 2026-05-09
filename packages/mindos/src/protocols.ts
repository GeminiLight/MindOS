export type MindosProtocolHost = 'mcp' | 'acp' | 'a2a';

export interface ProtocolCapabilityBoundary {
  readonly host: MindosProtocolHost;
  readonly productLogicOwner: '@geminilight/mindos';
  readonly transportRole: 'host';
}

export const protocolCapabilityBoundaries: readonly ProtocolCapabilityBoundary[] = [
  { host: 'mcp', productLogicOwner: '@geminilight/mindos', transportRole: 'host' },
  { host: 'acp', productLogicOwner: '@geminilight/mindos', transportRole: 'host' },
  { host: 'a2a', productLogicOwner: '@geminilight/mindos', transportRole: 'host' },
];
