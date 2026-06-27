import type { ObsidianWorkflowAudit } from './workflow-audit';
import type {
  ObsidianNativeQueryIndex,
  ObsidianNativeQueryNoteRecord,
  ObsidianNativeQueryTaskRecord,
} from './native-query-index';

const NATIVE_QUERY_WORKFLOW_IDS = new Set([
  'dataview-native-query',
  'tasks-native-query',
]);

const NATIVE_QUERY_PLUGIN_IDS = new Set([
  'dataview',
  'obsidian-tasks-plugin',
  'tasks',
  'obsidian-tasks',
]);

const NOTE_SAMPLE_LIMIT = 5;
const TASK_SAMPLE_LIMIT = 8;

export interface ObsidianNativeQueryPreviewPlugin {
  id: string;
  workflowAudits?: ObsidianWorkflowAudit[];
}

export interface ObsidianNativeQueryPreviewNote {
  path: string;
  basename: string;
  tags: string[];
  frontmatter: Record<string, string | number | boolean>;
  taskCount: number;
  incompleteTaskCount: number;
  linkCount: number;
  headingCount: number;
}

export interface ObsidianNativeQueryPreviewTask {
  path: string;
  basename: string;
  line: number;
  status: string;
  completed: boolean;
  text: string;
  tags: string[];
  noteTags: string[];
  effectiveTags: string[];
}

export interface ObsidianNativeQueryPreviewResponse {
  ok: true;
  pluginId: string;
  proof: ObsidianNativeQueryIndex['proof'];
  stats: ObsidianNativeQueryIndex['stats'];
  sampleLimits: {
    notes: number;
    tasks: number;
  };
  notes: ObsidianNativeQueryPreviewNote[];
  tasks: ObsidianNativeQueryPreviewTask[];
}

export function hasObsidianNativeQueryPluginId(pluginId: string): boolean {
  return NATIVE_QUERY_PLUGIN_IDS.has(pluginId.trim().toLowerCase());
}

export function hasObsidianNativeQueryPreview(plugin: ObsidianNativeQueryPreviewPlugin): boolean {
  const hasNativeAudit = (plugin.workflowAudits ?? []).some((audit) => (
    NATIVE_QUERY_WORKFLOW_IDS.has(audit.id)
    && audit.status === 'native-replacement'
    && audit.source === 'native-replacement'
  ));
  return hasNativeAudit || hasObsidianNativeQueryPluginId(plugin.id);
}

export function buildObsidianNativeQueryPreview(
  pluginId: string,
  index: ObsidianNativeQueryIndex,
): ObsidianNativeQueryPreviewResponse {
  return {
    ok: true,
    pluginId,
    proof: index.proof,
    stats: index.stats,
    sampleLimits: {
      notes: NOTE_SAMPLE_LIMIT,
      tasks: TASK_SAMPLE_LIMIT,
    },
    notes: index.notes.slice(0, NOTE_SAMPLE_LIMIT).map(previewNote),
    tasks: index.tasks
      .filter((task) => !task.completed)
      .slice(0, TASK_SAMPLE_LIMIT)
      .map(previewTask),
  };
}

function previewNote(note: ObsidianNativeQueryNoteRecord): ObsidianNativeQueryPreviewNote {
  return {
    path: note.path,
    basename: note.basename,
    tags: note.tags.slice(0, 6),
    frontmatter: frontmatterPreview(note.frontmatter),
    taskCount: note.tasks.length,
    incompleteTaskCount: note.tasks.filter((task) => !task.completed).length,
    linkCount: note.links.length + note.embeds.length,
    headingCount: note.headings.length,
  };
}

function previewTask(task: ObsidianNativeQueryTaskRecord): ObsidianNativeQueryPreviewTask {
  return {
    path: task.path,
    basename: task.basename,
    line: task.line,
    status: task.status,
    completed: task.completed,
    text: task.text,
    tags: task.tags.slice(0, 6),
    noteTags: task.noteTags.slice(0, 6),
    effectiveTags: task.effectiveTags.slice(0, 8),
  };
}

function frontmatterPreview(frontmatter: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  if (!frontmatter) return {};
  const preview: Record<string, string | number | boolean> = {};
  for (const key of ['title', 'status', 'type', 'date', 'due', 'priority']) {
    const value = frontmatter[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      preview[key] = value;
    }
  }
  return preview;
}
