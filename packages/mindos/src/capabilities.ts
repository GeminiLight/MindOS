export type MindosCapabilityDomain = 'foundation' | 'knowledge' | 'retrieval' | 'protocols';

export type MindosCapabilityLoadMode = 'core' | 'facade' | 'optional' | 'host';

export type MindosProductRuntimeBoundary =
  | 'server'
  | 'client'
  | 'session'
  | 'agent'
  | 'tool'
  | 'plugin'
  | 'protocols';

export type MindosProductRuntimeBoundaryDefaultForm = 'subpath';

export type MindosProductRuntimeBoundaryPackageEligibility =
  | 'not-planned'
  | 'conditional';

export interface MindosCapabilityContract {
  readonly domain: MindosCapabilityDomain;
  readonly owner: '@geminilight/mindos';
  readonly publicEntry: `@geminilight/mindos${string}`;
  readonly loadMode: MindosCapabilityLoadMode;
  readonly role: string;
  readonly implementation: readonly string[];
}

export interface MindosProductRuntimeBoundaryContract {
  readonly boundary: MindosProductRuntimeBoundary;
  readonly owner: '@geminilight/mindos';
  readonly publicEntry: `@geminilight/mindos/${MindosProductRuntimeBoundary}`;
  readonly defaultForm: MindosProductRuntimeBoundaryDefaultForm;
  readonly packageSplitDefault: false;
  readonly futurePackageEligibility: MindosProductRuntimeBoundaryPackageEligibility;
  readonly graduationRequired: true;
  readonly role: string;
  readonly allowedImporters: readonly string[];
  readonly forbiddenImporters: readonly string[];
  readonly graduationCriteria: readonly string[];
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

const PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA = [
  'external-installation-demand',
  'independent-semver-compatibility',
  'separate-dependency-closure',
  'generated-or-cross-language-sdk',
  'independent-runtime-artifact',
] as const;

const CLIENT_SHELL_IMPORTERS = [
  'packages/web',
  'packages/desktop',
  'packages/mobile',
  'packages/browser-extension',
  'packages/desktop-tauri',
] as const;

const PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS = [
  'generated-runtime-artifacts',
  'deep-imports-from-client-shells',
  'ui-state-modules',
] as const;

export const MINDOS_PRODUCT_RUNTIME_BOUNDARIES: readonly MindosProductRuntimeBoundaryContract[] = [
  {
    boundary: 'server',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/server',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'not-planned',
    graduationRequired: true,
    role: 'Owns HTTP/SSE route contracts, response shape, route ownership, and Product Server adapter boundaries.',
    allowedImporters: ['packages/web', 'packages/mindos/bin', 'platform-runtime'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'client',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/client',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'conditional',
    graduationRequired: true,
    role: 'Owns typed client transport helpers and local server launcher APIs for shells and integrations.',
    allowedImporters: CLIENT_SHELL_IMPORTERS,
    forbiddenImporters: ['Product runtime internals must not call through the client boundary'],
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'session',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/session',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'not-planned',
    graduationRequired: true,
    role: 'Owns session state transitions, event stream schema, retries, fallback policy, and agent lifecycle helpers.',
    allowedImporters: ['packages/web server adapters', 'packages/mindos/src/agent', 'packages/mindos/src/server'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'agent',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/agent',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'not-planned',
    graduationRequired: true,
    role: 'Owns agent descriptors, prompts, model policy, and prompt compaction rules.',
    allowedImporters: ['packages/web server adapters', 'packages/mindos/src/session', 'packages/mindos/src/server'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'tool',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/tool',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'not-planned',
    graduationRequired: true,
    role: 'Owns built-in tool definitions, registry behavior, permission-aware execution schema, and result shape.',
    allowedImporters: ['packages/mindos/src/session', 'packages/mindos/src/plugin', 'packages/mindos/src/server'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'plugin',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/plugin',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'conditional',
    graduationRequired: true,
    role: 'Owns plugin manifest, hook, contribution, and authoring contracts before any external plugin package exists.',
    allowedImporters: ['packages/mindos/src/tool', 'packages/mindos/src/server', 'future-plugin-authoring-surface'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
  {
    boundary: 'protocols',
    owner: '@geminilight/mindos',
    publicEntry: '@geminilight/mindos/protocols',
    defaultForm: 'subpath',
    packageSplitDefault: false,
    futurePackageEligibility: 'not-planned',
    graduationRequired: true,
    role: 'Owns ACP/MCP/A2A product rules while protocol hosts adapt external SDKs and transports.',
    allowedImporters: ['packages/web protocol adapters', 'packages/mindos/src/server', 'platform-runtime'],
    forbiddenImporters: PRODUCT_INTERNAL_FORBIDDEN_IMPORTERS,
    graduationCriteria: PRODUCT_RUNTIME_PACKAGE_GRADUATION_CRITERIA,
  },
];

export function getMindosCapabilityContract(domain: MindosCapabilityDomain): MindosCapabilityContract {
  const contract = mindosCapabilityContracts.find((entry) => entry.domain === domain);
  if (!contract) {
    throw new Error(`Unknown MindOS capability domain: ${domain}`);
  }
  return contract;
}
