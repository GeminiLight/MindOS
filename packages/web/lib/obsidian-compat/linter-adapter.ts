import {
  BROWSER_EDITOR_SANDBOX_VERSION,
  type BrowserEditorSandboxContribution,
  type BrowserEditorSandboxPermissionGrant,
} from './browser-editor-sandbox';

export type ObsidianLinterAdapterRuleId =
  | 'heading-space'
  | 'trailing-whitespace'
  | 'hard-tab'
  | 'multiple-blank-lines'
  | 'missing-final-newline';

export type ObsidianLinterAdapterSeverity = 'info' | 'warning';

export interface ObsidianLinterAdapterIssue {
  ruleId: ObsidianLinterAdapterRuleId;
  message: string;
  line: number;
  severity: ObsidianLinterAdapterSeverity;
  fixable: boolean;
  from?: number;
  to?: number;
}

export interface ObsidianLinterAdapterSkippedIssueSummary {
  reason: 'max-issues';
  count: number;
}

export interface ObsidianLinterAdapterOptions {
  pluginId?: string;
  maxIssues?: number;
  maxConsecutiveBlankLines?: number;
  enabledRules?: Partial<Record<ObsidianLinterAdapterRuleId, boolean>>;
}

export interface ObsidianLinterAdapterResult {
  pluginId: string;
  issues: ObsidianLinterAdapterIssue[];
  contributions: BrowserEditorSandboxContribution[];
  skipped: ObsidianLinterAdapterSkippedIssueSummary[];
}

interface MarkdownLine {
  number: number;
  text: string;
  from: number;
  to: number;
}

const DEFAULT_PLUGIN_ID = 'obsidian-linter';
const DEFAULT_MAX_ISSUES = 80;
const DEFAULT_MAX_CONSECUTIVE_BLANK_LINES = 1;
const SAFE_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const RULE_MESSAGES: Record<ObsidianLinterAdapterRuleId, string> = {
  'heading-space': 'Heading marker should be followed by a space.',
  'trailing-whitespace': 'Line has trailing whitespace.',
  'hard-tab': 'Line contains hard tab indentation.',
  'multiple-blank-lines': 'Line exceeds the configured consecutive blank line limit.',
  'missing-final-newline': 'File should end with a newline.',
};

export function buildObsidianLinterSandboxContributions(
  markdown: string,
  options: ObsidianLinterAdapterOptions = {},
): ObsidianLinterAdapterResult {
  const pluginId = normalizePluginId(options.pluginId);
  const maxIssues = normalizePositiveInteger(options.maxIssues, DEFAULT_MAX_ISSUES);
  const maxConsecutiveBlankLines = normalizePositiveInteger(
    options.maxConsecutiveBlankLines,
    DEFAULT_MAX_CONSECUTIVE_BLANK_LINES,
  );
  const enabledRules = options.enabledRules ?? {};
  const issues: ObsidianLinterAdapterIssue[] = [];
  const lines = splitMarkdownLines(String(markdown));

  for (const line of lines) {
    if (isRuleEnabled('heading-space', enabledRules)) {
      const headingMatch = /^(#{1,6})(?![\s#])/.exec(line.text);
      if (headingMatch) {
        issues.push(createRangeIssue('heading-space', line, line.from, line.from + headingMatch[1].length));
      }
    }

    if (isRuleEnabled('trailing-whitespace', enabledRules)) {
      const trailingMatch = /[ \t]+$/.exec(line.text);
      if (trailingMatch && trailingMatch[0].length > 0) {
        issues.push(createRangeIssue(
          'trailing-whitespace',
          line,
          line.from + trailingMatch.index,
          line.to,
        ));
      }
    }

    if (isRuleEnabled('hard-tab', enabledRules)) {
      const tabIndex = line.text.indexOf('\t');
      if (tabIndex >= 0) {
        issues.push(createRangeIssue('hard-tab', line, line.from + tabIndex, line.from + tabIndex + 1));
      }
    }
  }

  if (isRuleEnabled('multiple-blank-lines', enabledRules)) {
    issues.push(...findMultipleBlankLineIssues(lines, maxConsecutiveBlankLines));
  }

  if (
    isRuleEnabled('missing-final-newline', enabledRules)
    && markdown.length > 0
    && !markdown.endsWith('\n')
  ) {
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      issues.push(createLineIssue('missing-final-newline', lastLine));
    }
  }

  const sortedIssues = sortIssues(issues);
  const acceptedIssues = sortedIssues.slice(0, maxIssues);
  const skippedCount = sortedIssues.length - acceptedIssues.length;

  return {
    pluginId,
    issues: acceptedIssues,
    contributions: acceptedIssues.map((issue) => issueToContribution(pluginId, issue)),
    skipped: skippedCount > 0 ? [{ reason: 'max-issues', count: skippedCount }] : [],
  };
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const rawLines = markdown.split('\n');
  const lines: MarkdownLine[] = [];
  let offset = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const text = rawLines[index] ?? '';
    const from = offset;
    const to = from + text.length;
    lines.push({
      number: index + 1,
      text,
      from,
      to,
    });
    offset = to + 1;
  }

  return lines;
}

function findMultipleBlankLineIssues(
  lines: MarkdownLine[],
  maxConsecutiveBlankLines: number,
): ObsidianLinterAdapterIssue[] {
  const issues: ObsidianLinterAdapterIssue[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (line.text.trim().length === 0) {
      blankRun += 1;
      if (blankRun > maxConsecutiveBlankLines) {
        issues.push(createLineIssue('multiple-blank-lines', line));
      }
      continue;
    }
    blankRun = 0;
  }

  return issues;
}

function createRangeIssue(
  ruleId: ObsidianLinterAdapterRuleId,
  line: MarkdownLine,
  from: number,
  to: number,
): ObsidianLinterAdapterIssue {
  return {
    ruleId,
    message: RULE_MESSAGES[ruleId],
    line: line.number,
    severity: 'warning',
    fixable: true,
    from,
    to,
  };
}

function createLineIssue(
  ruleId: ObsidianLinterAdapterRuleId,
  line: MarkdownLine,
): ObsidianLinterAdapterIssue {
  return {
    ruleId,
    message: RULE_MESSAGES[ruleId],
    line: line.number,
    severity: ruleId === 'missing-final-newline' || ruleId === 'multiple-blank-lines' ? 'info' : 'warning',
    fixable: true,
  };
}

function sortIssues(issues: ObsidianLinterAdapterIssue[]): ObsidianLinterAdapterIssue[] {
  return [...issues].sort((a, b) =>
    a.line - b.line
    || (a.from ?? Number.MAX_SAFE_INTEGER) - (b.from ?? Number.MAX_SAFE_INTEGER)
    || a.ruleId.localeCompare(b.ruleId, 'en'),
  );
}

function issueToContribution(
  pluginId: string,
  issue: ObsidianLinterAdapterIssue,
): BrowserEditorSandboxContribution {
  const base = {
    sandboxVersion: BROWSER_EDITOR_SANDBOX_VERSION as typeof BROWSER_EDITOR_SANDBOX_VERSION,
    id: `${pluginId}:${issue.ruleId}:${issue.line}`,
    pluginId,
    source: 'mindos-signed' as const,
    permissionGrant: permissionGrantFor(pluginId),
    label: issue.message,
    tone: issue.severity === 'warning' ? 'warning' as const : 'muted' as const,
  };

  if (typeof issue.from === 'number' && typeof issue.to === 'number' && issue.to > issue.from) {
    return {
      ...base,
      kind: 'range-highlight',
      from: issue.from,
      to: issue.to,
    };
  }

  return {
    ...base,
    kind: 'line-highlight',
    line: issue.line,
  };
}

function permissionGrantFor(pluginId: string): BrowserEditorSandboxPermissionGrant {
  return {
    scope: 'browser-editor-sandbox',
    grantedBy: 'mindos',
    permissions: ['editor.read', 'editor.decorations'],
    grantId: `${pluginId}:linter-adapter`,
  };
}

function normalizePluginId(pluginId: string | undefined): string {
  if (!pluginId) return DEFAULT_PLUGIN_ID;
  const normalized = pluginId.trim().toLowerCase();
  return SAFE_PLUGIN_ID_PATTERN.test(normalized) ? normalized : DEFAULT_PLUGIN_ID;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function isRuleEnabled(
  ruleId: ObsidianLinterAdapterRuleId,
  enabledRules: Partial<Record<ObsidianLinterAdapterRuleId, boolean>>,
): boolean {
  return enabledRules[ruleId] !== false;
}
