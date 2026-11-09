export * as shared from './foundation/shared/index.js';
export * as errors from './foundation/errors/index.js';
export * as core from './foundation/core/index.js';
export type { AsyncResult, DeepPartial, DeepReadonly, JsonValue, Optional, Result } from './foundation/shared/index.js';
export { err, generateUUID, ok } from './foundation/shared/index.js';
export {
  createGlobMatcher,
  expandHome,
  expandWindowsEnvVars,
  isGlobPattern,
  parseJsonc,
  parseJsoncDocument,
  removeJsoncValue,
  setJsoncValue,
  stripBom,
  toPosixPath,
  type GlobMatcher,
  type GlobMatcherOptions,
  type JsoncDocument,
} from './foundation/shared/index.js';
export {
  collectScannableLines,
  maskInlineCode,
  buildWikiLinkBasenameMap,
  parseWikiLinks,
  extractMarkdownSection,
  parseInlineTags,
  resolveWikiLinkTarget,
  stripFrontmatter,
  parseWikiLinksInLine,
  parseWikiTarget,
  splitSubpath,
  type ScannableLine,
  type WikiLinkMatch,
  type WikiLinkSubpath,
  type WikiLinkToken,
} from './foundation/shared/index.js';
export {
  parseJsonCanvas,
  type CanvasBounds,
  type CanvasColor,
  type CanvasEdge,
  type CanvasEdgeEnd,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasLinkNode,
  type CanvasNode,
  type CanvasNodeSide,
  type CanvasTextNode,
  type JsonCanvas,
  type JsonCanvasParseResult,
} from './foundation/shared/index.js';
export {
  AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  createError,
  formatErrorForLog,
  getErrorMessage,
  getErrorStack,
  isAppError,
  wrapError,
  type ErrorCode,
} from './foundation/errors/index.js';
export { DIContainer, TOKENS, createContainer, createToken } from './foundation/core/index.js';
export type { Container, ServiceFactory, ServiceIdentifier, ServiceLifecycle, ServiceRegistration } from './foundation/core/index.js';
export * from './foundation/config/index.js';
export * from './foundation/logger/index.js';
export * from './foundation/mind-root/index.js';
export * from './foundation/pi-agent-dir/index.js';
export * from './foundation/permissions/index.js';
export * from './foundation/plugins/index.js';
export * from './foundation/security/index.js';
