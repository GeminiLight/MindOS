export type MindosIntelligenceCapability = 'cognition';
export type MindosIntelligenceExtensionSlot = 'memory' | 'growth';

export interface IntelligenceCapabilityBoundary {
  readonly owner: '@geminilight/mindos';
  readonly loadMode: 'core';
  readonly defaultRuntime: true;
  readonly capabilities: readonly MindosIntelligenceCapability[];
  readonly extensionSlots: readonly MindosIntelligenceExtensionSlot[];
  readonly activation: 'internal-or-explicit';
  readonly reason: string;
}

export const intelligenceCapabilityBoundary: IntelligenceCapabilityBoundary = {
  owner: '@geminilight/mindos',
  loadMode: 'core',
  defaultRuntime: true,
  capabilities: ['cognition'],
  extensionSlots: ['memory', 'growth'],
  activation: 'internal-or-explicit',
  reason: 'Intelligence owns pure product algorithms such as cognition/human modeling; storage and audit stay in knowledge.',
};

export * from './intelligence/index.js';
