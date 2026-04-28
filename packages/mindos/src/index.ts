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
  mindosCapabilityContracts,
  type MindosCapabilityContract,
  type MindosCapabilityDomain,
  type MindosCapabilityLoadMode,
} from './capabilities.js';
