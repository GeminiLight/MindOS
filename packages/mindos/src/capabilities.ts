export type MindosCapabilityDomain = 'foundation' | 'knowledge' | 'retrieval' | 'protocols';

export type MindosCapabilityLoadMode = 'core' | 'facade' | 'optional' | 'host';

export interface MindosCapabilityContract {
  readonly domain: MindosCapabilityDomain;
  readonly owner: '@geminilight/mindos';
  readonly publicEntry: `@geminilight/mindos${string}`;
  readonly loadMode: MindosCapabilityLoadMode;
  readonly role: string;
  readonly implementation: readonly string[];
}

export const mindosCapabilityContracts: readonly MindosCapabilityContract[] = [
  {
    domain: 'foundation',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/foundation',
    loadMode: 'core',
    role: 'Shared types, errors, configuration, logging, permissions, and path safety.',
    implementation: ['shared', 'errors', 'core', 'config', 'logger', 'permissions', 'security'],
  },
  {
    domain: 'knowledge',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/knowledge',
    loadMode: 'core',
    role: 'Local knowledge storage, spaces, graph, audit history, git history, and write operations.',
    implementation: ['storage', 'spaces', 'graph', 'audit', 'git', 'knowledge-ops'],
  },
  {
    domain: 'retrieval',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/retrieval',
    loadMode: 'optional',
    role: 'Indexing, keyword search, vector search, and retrieval API boundaries.',
    implementation: ['indexer', 'search', 'vector', 'retrieval-api'],
  },
  {
    domain: 'protocols',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/protocols',
    loadMode: 'host',
    role: 'Protocol ownership rules; transport hosts adapt external SDKs to product logic.',
    implementation: ['mcp-host', 'acp-host', 'a2a-host'],
  },
];

export function getMindosCapabilityContract(domain: MindosCapabilityDomain): MindosCapabilityContract {
  const contract = mindosCapabilityContracts.find((entry) => entry.domain === domain);
  if (!contract) {
    throw new Error(`Unknown MindOS capability domain: ${domain}`);
  }
  return contract;
}
