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
export * from './knowledge/learning/index.js';
export * from './knowledge/transfer/index.js';
export * from './knowledge/method-checks/index.js';
export * from './knowledge/research/index.js';
export * from './knowledge/inquiries/index.js';
export * from './knowledge/method-comparisons/index.js';

export * from './knowledge/longitudinal/index.js';
