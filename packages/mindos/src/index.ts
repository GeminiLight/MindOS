export {
  createKnowledgeOperationActor,
  deriveKnowledgeOperationSource,
  executeKnowledgeOperation,
  DEFAULT_TREE_CHANGING_OPS,
  type ContentChangeSource,
  type DeriveSourceInput,
  type ExecuteKnowledgeOperationOptions,
  type KnowledgeChangeEvent,
  type KnowledgeOperationHandler,
  type KnowledgeOperationHandlerResult,
  type KnowledgeOperationResponses,
  type KnowledgeOperationResult,
  type PermissionRequiredInput,
} from './knowledge/knowledge-ops/index.js';

export {
  evaluatePermission,
  parsePermissionRules,
  type PermissionActorType,
  type PermissionDecision,
  type PermissionEffect,
  type PermissionRequest,
  type PermissionRule,
} from './foundation/permissions/index.js';

export {
  assertNotProtected,
  assertWithinRoot,
  checkProtected,
  getRelativePath,
  isAbsolutePath,
  isRootProtected,
  isWithinRoot,
  normalizePath,
  resolveSafe,
  resolveSafeResult,
  validatePath,
} from './foundation/security/index.js';

export {
  getMindosCapabilityContract,
  MINDOS_PRODUCT_RUNTIME_BOUNDARIES,
  mindosCapabilityContracts,
  type MindosCapabilityContract,
  type MindosCapabilityDomain,
  type MindosCapabilityLoadMode,
  type MindosProductRuntimeBoundary,
  type MindosProductRuntimeBoundaryContract,
  type MindosProductRuntimeBoundaryDefaultForm,
  type MindosProductRuntimeBoundaryPackageEligibility,
} from './capabilities.js';

export {
  CORS_HEADERS,
  MINDOS_SERVER_ROUTES,
  createMindosHealth,
  getMindosServerContract,
  readMindosProductVersion,
  type MindosHealth,
  type MindosHealthOptions,
  type MindosHealthRuntime,
  type MindosServerContract,
  type MindosServerRouteContract,
  type VersionResolutionOptions,
} from './server.js';

export {
  defineMindosPlugin,
  validateMindosPluginManifest,
  type MindosPlugin,
  type MindosPluginManifest,
  type MindosPluginPermission,
  type MindosPluginToolContribution,
} from './plugin.js';

export {
  createMindosToolRegistry,
  defineMindosTool,
  type MindosToolContext,
  type MindosToolDefinition,
  type MindosToolInputSchema,
  type MindosToolRegistry,
  type MindosToolResult,
} from './tool.js';

export {
  MINDOS_SESSION_STREAM_SCHEMA,
  createMindosSessionEvent,
  type MindosSessionEvent,
  type MindosSessionEventType,
  type MindosSessionStreamSchema,
} from './session.js';

export {
  defineMindosAgent,
  type MindosAgentDescriptor,
} from './agent.js';
