import { registerRenderer } from './registry';
import { TodoRenderer } from '@/components/renderers/TodoRenderer';
import { CsvRenderer } from '@/components/renderers/CsvRenderer';
import { GraphRenderer } from '@/components/renderers/GraphRenderer';
import { TimelineRenderer } from '@/components/renderers/TimelineRenderer';
import { SummaryRenderer } from '@/components/renderers/SummaryRenderer';
import { ConfigRenderer } from '@/components/renderers/ConfigRenderer';
import { AgentInspectorRenderer } from '@/components/renderers/AgentInspectorRenderer';

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
  id: 'config-panel',
  name: 'Config Panel',
  description: 'Renders CONFIG.json as an editable control panel based on uiSchema/keySpecs. Changes are written back to the JSON file directly.',
  author: 'MindOS',
  icon: '🧩',
  tags: ['config', 'json', 'settings', 'schema'],
  builtin: true,
  match: ({ filePath, extension }) => extension === 'json' && /(^|\/)CONFIG\.json$/i.test(filePath),
  component: ConfigRenderer,
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
  description: 'Visualizes agent tool-call logs as a filterable timeline. Auto-activates on .agent-log.json (JSON Lines format).',
  author: 'MindOS',
  icon: '🔍',
  tags: ['agent', 'inspector', 'log', 'mcp', 'tools'],
  builtin: true,
  match: ({ filePath }) => /\.agent-log\.json$/i.test(filePath),
  component: AgentInspectorRenderer,
});
