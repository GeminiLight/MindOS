// Sunk into the core package (Wave 3, spec-agent-core-consolidation).
// Tool logic lives in packages/mindos/src/agent/tool/kb-tools.ts; this adapter
// wires the web app's fs/search/skills/lint/compile services into the
// host-injected toolkit and re-exports the historical API surface.

import {
  getFileContent, getFileTree, getRecentlyModified,
  saveFileContent, createFile, appendToFile, insertAfterHeading, updateSection,
  moveToTrashFile, renameFile, moveFile, findBacklinks, gitLog, gitShowFile, appendCsvRow,
  getMindRoot,
} from '@/lib/fs';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { readSkillContentByName } from '@/lib/pi-integration/skills';
import { readSettings } from '@/lib/settings';
import { a2aTools } from '@/lib/a2a/a2a-tools';
import { acpTools } from '@/lib/acp/acp-tools';
import { computeDiffAsync } from '@/lib/agent/diff-async';
import { getProjectRoot } from '@/lib/project-root';
import {
  createMindosKbToolkit,
  type MindosAgentTool,
  type MindosKbFileTreeNode,
  type MindosKbToolsHost,
} from '@geminilight/mindos/agent/tool/kb-tools';
import type { MindosAgentPermissionPolicy } from '@geminilight/mindos/agent/tool/permission-policy';

export {
  ORGANIZE_TOOL_NAMES,
  READONLY_TOOL_NAMES,
  WRITE_TOOLS,
  truncate,
} from '@geminilight/mindos/agent/tool/kb-tools';

const host: MindosKbToolsHost = {
  files: {
    getMindRoot,
    getFileTree: () => getFileTree() as MindosKbFileTreeNode[],
    getFileContent,
    getRecentlyModified,
    saveFileContent,
    createFile,
    appendToFile,
    insertAfterHeading,
    updateSection,
    // Dynamic import mirrors the pre-consolidation code: @/lib/core pulls in
    // the full core barrel, which must not load at tools module-init time.
    updateLines: async (mindRoot, filePath, startIndex, endIndex, lines) => {
      const { updateLines } = await import('@/lib/core');
      updateLines(mindRoot, filePath, startIndex, endIndex, lines);
    },
    moveToTrashFile,
    renameFile,
    moveFile,
    findBacklinks,
    gitLog,
    gitShowFile,
    appendCsvRow,
  },
  hybridSearch,
  readSkillContent: (name) =>
    readSkillContentByName(name, {
      projectRoot: getProjectRoot(),
      mindRoot: getMindRoot(),
      settings: readSettings(),
    }),
  runLint: async (mindRoot, space) => {
    const { runLint } = await import('@/lib/lint');
    return runLint(mindRoot, space);
  },
  runDreaming: async (mindRoot, options) => {
    const { runDreaming, formatDreamingReport } = await import('@/lib/dreaming');
    const run = runDreaming(mindRoot, {
      space: options.space,
      writeArtifacts: options.writeArtifacts,
    });
    const artifactLine = run.artifacts
      ? `\n\nArtifacts:\n- ${run.artifacts.reportMarkdown}\n- ${run.artifacts.pendingJson}`
      : '\n\nDry run: no artifacts written.';
    return { run, report: `${formatDreamingReport(run)}${artifactLine}` };
  },
  compileSpaceOverview: async (space) => {
    const { compileSpaceOverview, isCompileError } = await import('@/lib/compile');
    const result = await compileSpaceOverview(space);
    if (isCompileError(result)) return { ok: false, message: result.message };
    return { ok: true, stats: { spaceName: result.stats.spaceName, fileCount: result.stats.fileCount } };
  },
  computeDiffAsync,
  delegationTools: {
    a2a: a2aTools as MindosAgentTool[],
    acp: acpTools as MindosAgentTool[],
  },
};

const toolkit = createMindosKbToolkit(host);

export const knowledgeBaseTools: MindosAgentTool[] = toolkit.knowledgeBaseTools;

export function getToolsForMindosAgentPolicy(policy: MindosAgentPermissionPolicy): MindosAgentTool[] {
  return toolkit.getToolsForPolicy(policy);
}

/** Lean tool set for organize mode - skips MCP discovery, history, backlinks, etc. */
export function getOrganizeTools(): MindosAgentTool[] {
  return toolkit.getOrganizeTools();
}

/** Read-only knowledge-base tool set. */
export function getReadonlyTools(): MindosAgentTool[] {
  return toolkit.getReadonlyTools();
}

export function getRequestScopedTools(): MindosAgentTool[] {
  return toolkit.getRequestScopedTools();
}
