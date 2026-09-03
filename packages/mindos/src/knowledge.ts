export * from './knowledge/storage/index.js';
export * from './knowledge/spaces/index.js';
export * from './knowledge/graph/index.js';
export * as audit from './knowledge/audit/index.js';
export * as git from './knowledge/git/index.js';
export {
  appendAgentAuditEvent,
  appendContentChange,
  getContentChangeSummary,
  listAgentAuditEvents,
  listContentChanges,
  markContentChangesSeen,
  type AgentAuditEvent,
  type AgentAuditInput,
  type ContentChangeEvent,
  type ContentChangeInput,
  type ContentChangeSummary,
} from './knowledge/audit/index.js';
export { gitLog, gitShowFile, isGitRepo, type GitLogEntry } from './knowledge/git/index.js';
export * from './knowledge/knowledge-ops/index.js';
export * from './knowledge/context-assets/index.js';
export * from './knowledge/context-feedback/index.js';
