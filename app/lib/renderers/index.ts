import { registerRenderer } from './registry';
import { TodoRenderer } from '@/components/renderers/TodoRenderer';
import { CsvRenderer } from '@/components/renderers/CsvRenderer';
import { GraphRenderer } from '@/components/renderers/GraphRenderer';
import { TimelineRenderer } from '@/components/renderers/TimelineRenderer';
import { BacklinksRenderer } from '@/components/renderers/BacklinksRenderer';
import { SummaryRenderer } from '@/components/renderers/SummaryRenderer';
import { AgentInspectorRenderer } from '@/components/renderers/AgentInspectorRenderer';
import { WorkflowRenderer } from '@/components/renderers/WorkflowRenderer';
import { DiffRenderer } from '@/components/renderers/DiffRenderer';

registerRenderer({
  id: 'todo',
  name: 'TODO Board',
  description: 'Renders TODO.md/TODO.csv as an interactive kanban board grouped by section. Check items off directly — changes are written back to the source file.',
  author: 'MindOS',
  icon: '✅',
  tags: ['productivity', 'tasks', 'markdown'],
  builtin: true,
  match: ({ filePath }) => /\bTODO\b.*\.(md|csv)$/i.test(filePath),
  component: TodoRenderer,
});

registerRenderer({
  id: 'csv',
  name: 'CSV Views',
  description: 'Renders any CSV file as Table, Gallery, or Board. Each view is independently configurable — choose which columns map to title, description, tag, and group.',
  author: 'MindOS',
  icon: '📊',
  tags: ['csv', 'table', 'gallery', 'board', 'data'],
  builtin: true,
  match: ({ extension, filePath }) => extension === 'csv' && !/\bTODO\b/i.test(filePath),
  component: CsvRenderer,
});

registerRenderer({
  id: 'graph',
  name: 'Wiki Graph',
  description: 'Force-directed graph of wikilink references across all markdown files. Supports Global and Local (2-hop) scope filters.',
  author: 'MindOS',
  icon: '🕸️',
  tags: ['graph', 'wiki', 'links', 'visualization'],
  builtin: true,
  match: ({ extension }) => extension === 'md',
  component: GraphRenderer,
});

registerRenderer({
  id: 'timeline',
  name: 'Timeline',
  description: 'Renders changelog and journal files as a vertical timeline. Any markdown with ## date headings (e.g. ## 2025-01-15) becomes a card in the feed.',
  author: 'MindOS',
  icon: '📅',
  tags: ['timeline', 'changelog', 'journal', 'history'],
  builtin: true,
  match: ({ filePath }) => /\b(CHANGELOG|changelog|TIMELINE|timeline|journal|Journal|diary|Diary)\b.*\.md$/i.test(filePath),
  component: TimelineRenderer,
});

registerRenderer({
  id: 'backlinks',
  name: 'Backlinks',
  description: 'Shows all files that link to the current file, with snippet context around each reference. Great for understanding how a note fits into your knowledge base.',
  author: 'MindOS',
  icon: '🔗',
  tags: ['backlinks', 'references', 'graph', 'wiki'],
  builtin: true,
  match: ({ filePath }) => /\b(BACKLINKS|backlinks|Backlinks|index|Index|MOC|moc)\b.*\.md$/i.test(filePath),
  component: BacklinksRenderer,
});

registerRenderer({
  id: 'summary',
  name: 'AI Briefing',
  description: 'Streams an AI-generated daily briefing summarizing your most recently modified files — key changes, recurring themes, and suggested next actions.',
  author: 'MindOS',
  icon: '✨',
  tags: ['ai', 'summary', 'briefing', 'daily'],
  builtin: true,
  match: ({ filePath }) => /\b(SUMMARY|summary|Summary|BRIEFING|briefing|Briefing|DAILY|daily|Daily)\b.*\.md$/i.test(filePath),
  component: SummaryRenderer,
});

registerRenderer({
  id: 'agent-inspector',
  name: 'Agent Inspector',
  description: 'Renders agent operation logs (```agent-op blocks) as a filterable timeline — tool name, file path, params, result status. Click any entry to expand full details.',
  author: 'MindOS',
  icon: '🤖',
  tags: ['agent', 'audit', 'log', 'inspector', 'operations'],
  builtin: true,
  match: ({ filePath }) => /\b(Agent-Audit|agent-audit|AGENT-AUDIT|AgentLog|agent-log)\b.*\.md$/i.test(filePath),
  component: AgentInspectorRenderer,
});

registerRenderer({
  id: 'workflow',
  name: 'Workflow Runner',
  description: 'Renders SOP/Workflow .md files as an interactive step-by-step runner. Each ## Step heading becomes an executable card — click Run to have AI execute that step with your knowledge base as context.',
  author: 'MindOS',
  icon: '⚙️',
  tags: ['workflow', 'sop', 'automation', 'agent', 'steps'],
  builtin: true,
  match: ({ filePath }) => /\b(Workflow|workflow|WORKFLOW|SOP|sop|Runbook|runbook)\b.*\.md$/i.test(filePath),
  component: WorkflowRenderer,
});

registerRenderer({
  id: 'diff-viewer',
  name: 'Agent Diff Viewer',
  description: 'Renders agent before/after file snapshots (```agent-diff blocks) as line-level diffs with syntax highlighting. Approve to keep changes or reject to auto-revert the target file.',
  author: 'MindOS',
  icon: '🔀',
  tags: ['diff', 'agent', 'review', 'changes', 'approve'],
  builtin: true,
  match: ({ filePath }) => /\b(Agent-Diff|agent-diff|AGENT-DIFF|AgentDiff)\b.*\.md$/i.test(filePath),
  component: DiffRenderer,
});
