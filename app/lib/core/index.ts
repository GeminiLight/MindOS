// Types
export type {
  FileNode,
  SearchResult,
  BacklinkEntry,
  SearchOptions,
  GitLogEntry,
  MoveResult,
} from './types';

// Security
export {
  assertWithinRoot,
  resolveSafe,
  isRootProtected,
  assertNotProtected,
} from './security';

// File operations
export {
  readFile,
  writeFile,
  createFile,
  deleteFile,
  renameFile,
  moveFile,
  getRecentlyModified,
} from './fs-ops';

// Tree
export {
  getFileTree,
  collectAllFiles,
  renderTree,
} from './tree';
export type { TreeOptions } from './tree';

// Search
export { searchFiles, invalidateSearchIndex } from './search';

// Line-level operations
export {
  readLines,
  insertLines,
  updateLines,
  appendToFile,
  insertAfterHeading,
  updateSection,
} from './lines';

// CSV
export { appendCsvRow } from './csv';

// Backlinks
export { findBacklinks } from './backlinks';

// Git
export { isGitRepo, gitLog, gitShowFile } from './git';
