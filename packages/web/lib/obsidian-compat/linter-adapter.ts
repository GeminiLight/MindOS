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
  profile?: ObsidianLinterRuleProfileInput;
  enabledRules?: Partial<Record<ObsidianLinterAdapterRuleId, boolean>>;
}

export interface ObsidianLinterAdapterResult {
  pluginId: string;
  issues: ObsidianLinterAdapterIssue[];
  contributions: BrowserEditorSandboxContribution[];
  skipped: ObsidianLinterAdapterSkippedIssueSummary[];
}

export interface ObsidianLinterRuleProfile {
  enabledRules: Record<ObsidianLinterAdapterRuleId, boolean>;
  maxConsecutiveBlankLines: number;
}

export interface ObsidianLinterRuleProfileInput {
  enabledRules?: Partial<Record<ObsidianLinterAdapterRuleId, boolean>>;
  maxConsecutiveBlankLines?: number;
}

export interface ObsidianLinterAppliedFixSummary {
  ruleId: ObsidianLinterAdapterRuleId;
  count: number;
}

export interface ObsidianLinterApplyFixResult {
  markdown: string;
  applied: ObsidianLinterAppliedFixSummary[];
}

export interface ObsidianLinterFixPreviewResult extends ObsidianLinterApplyFixResult {
  changed: boolean;
  fixCount: number;
}

export interface ObsidianLinterRuleMetadata {
  id: ObsidianLinterAdapterRuleId;
  label: string;
  message: string;
  severity: ObsidianLinterAdapterSeverity;
  fixable: boolean;
  defaultEnabled: boolean;
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

export const OBSIDIAN_LINTER_RULE_METADATA: readonly ObsidianLinterRuleMetadata[] = [
  {
    id: 'heading-space',
    label: 'heading spacing',
    message: 'Heading marker should be followed by a space.',
    severity: 'warning',
    fixable: true,
    defaultEnabled: true,
  },
  {
    id: 'trailing-whitespace',
    label: 'trailing whitespace',
    message: 'Line has trailing whitespace.',
    severity: 'warning',
    fixable: true,
    defaultEnabled: true,
  },
  {
    id: 'hard-tab',
    label: 'hard tabs',
    message: 'Line contains hard tab indentation.',
    severity: 'warning',
    fixable: true,
    defaultEnabled: true,
  },
  {
    id: 'multiple-blank-lines',
    label: 'blank lines',
    message: 'Line exceeds the configured consecutive blank line limit.',
    severity: 'info',
    fixable: true,
    defaultEnabled: true,
  },
  {
    id: 'missing-final-newline',
    label: 'final newline',
    message: 'File should end with a newline.',
    severity: 'info',
    fixable: true,
    defaultEnabled: true,
  },
] as const;

const RULE_METADATA_BY_ID = OBSIDIAN_LINTER_RULE_METADATA.reduce((acc, rule) => {
  acc[rule.id] = rule;
  return acc;
}, {} as Record<ObsidianLinterAdapterRuleId, ObsidianLinterRuleMetadata>);

export const DEFAULT_OBSIDIAN_LINTER_RULE_PROFILE: ObsidianLinterRuleProfile = {
  enabledRules: OBSIDIAN_LINTER_RULE_METADATA.reduce((acc, rule) => {
    acc[rule.id] = rule.defaultEnabled;
    return acc;
  }, {} as Record<ObsidianLinterAdapterRuleId, boolean>),
  maxConsecutiveBlankLines: DEFAULT_MAX_CONSECUTIVE_BLANK_LINES,
};

export function getObsidianLinterRuleMetadata(
  ruleId: ObsidianLinterAdapterRuleId,
): ObsidianLinterRuleMetadata {
  return RULE_METADATA_BY_ID[ruleId];
}

export function buildObsidianLinterSandboxContributions(
  markdown: string,
  options: ObsidianLinterAdapterOptions = {},
): ObsidianLinterAdapterResult {
  const pluginId = normalizePluginId(options.pluginId);
  const maxIssues = normalizePositiveInteger(options.maxIssues, DEFAULT_MAX_ISSUES);
  const profile = normalizeObsidianLinterRuleProfile({
    ...options.profile,
    ...(options.maxConsecutiveBlankLines !== undefined
      ? { maxConsecutiveBlankLines: options.maxConsecutiveBlankLines }
      : {}),
    enabledRules: {
      ...options.profile?.enabledRules,
      ...options.enabledRules,
    },
  });
  const { enabledRules, maxConsecutiveBlankLines } = profile;
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

export function normalizeObsidianLinterRuleProfile(
  profile: ObsidianLinterRuleProfileInput = {},
): ObsidianLinterRuleProfile {
  return {
    enabledRules: normalizeEnabledRules(profile.enabledRules),
    maxConsecutiveBlankLines: normalizePositiveInteger(
      profile.maxConsecutiveBlankLines,
      DEFAULT_OBSIDIAN_LINTER_RULE_PROFILE.maxConsecutiveBlankLines,
    ),
  };
}

export function applyObsidianLinterFixes(
  markdown: string,
  options: Pick<ObsidianLinterAdapterOptions, 'profile' | 'enabledRules' | 'maxConsecutiveBlankLines'> = {},
): ObsidianLinterApplyFixResult {
  const profile = normalizeObsidianLinterRuleProfile({
    ...options.profile,
    ...(options.maxConsecutiveBlankLines !== undefined
      ? { maxConsecutiveBlankLines: options.maxConsecutiveBlankLines }
      : {}),
    enabledRules: {
      ...options.profile?.enabledRules,
      ...options.enabledRules,
    },
  });
  const applied = new Map<ObsidianLinterAdapterRuleId, number>();
  const bump = (ruleId: ObsidianLinterAdapterRuleId, count = 1) => {
    if (count <= 0) return;
    applied.set(ruleId, (applied.get(ruleId) ?? 0) + count);
  };

  let lines = String(markdown).split('\n');

  if (profile.enabledRules['heading-space']) {
    lines = lines.map((line) => {
      const fixed = line.replace(/^(#{1,6})(?![\s#])/, '$1 ');
      if (fixed !== line) bump('heading-space');
      return fixed;
    });
  }

  if (profile.enabledRules['trailing-whitespace']) {
    lines = lines.map((line) => {
      const fixed = line.replace(/[ \t]+$/, '');
      if (fixed !== line) bump('trailing-whitespace');
      return fixed;
    });
  }

  if (profile.enabledRules['hard-tab']) {
    lines = lines.map((line) => {
      const tabCount = line.split('\t').length - 1;
      if (tabCount > 0) bump('hard-tab', tabCount);
      return line.replace(/\t/g, '  ');
    });
  }

  if (profile.enabledRules['multiple-blank-lines']) {
    const nextLines: string[] = [];
    let blankRun = 0;
    for (const line of lines) {
      if (line.trim().length === 0) {
        blankRun += 1;
        if (blankRun > profile.maxConsecutiveBlankLines) {
          bump('multiple-blank-lines');
          continue;
        }
      } else {
        blankRun = 0;
      }
      nextLines.push(line);
    }
    lines = nextLines;
  }

  let fixedMarkdown = lines.join('\n');
  if (
    profile.enabledRules['missing-final-newline']
    && fixedMarkdown.length > 0
    && !fixedMarkdown.endsWith('\n')
  ) {
    fixedMarkdown += '\n';
    bump('missing-final-newline');
  }

  return {
    markdown: fixedMarkdown,
    applied: Array.from(applied.entries()).map(([ruleId, count]) => ({ ruleId, count })),
  };
}

export function previewObsidianLinterFixes(
  markdown: string,
  options: Pick<ObsidianLinterAdapterOptions, 'profile' | 'enabledRules' | 'maxConsecutiveBlankLines'> = {},
): ObsidianLinterFixPreviewResult {
  const originalMarkdown = String(markdown);
  const result = applyObsidianLinterFixes(originalMarkdown, options);
  const fixCount = result.applied.reduce((total, item) => total + item.count, 0);

  return {
    ...result,
    changed: result.markdown !== originalMarkdown,
    fixCount,
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
  const metadata = getObsidianLinterRuleMetadata(ruleId);
  return {
    ruleId,
    message: metadata.message,
    line: line.number,
    severity: metadata.severity,
    fixable: metadata.fixable,
    from,
    to,
  };
}

function createLineIssue(
  ruleId: ObsidianLinterAdapterRuleId,
  line: MarkdownLine,
): ObsidianLinterAdapterIssue {
  const metadata = getObsidianLinterRuleMetadata(ruleId);
  return {
    ruleId,
    message: metadata.message,
    line: line.number,
    severity: metadata.severity,
    fixable: metadata.fixable,
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

function normalizeEnabledRules(
  enabledRules: ObsidianLinterRuleProfileInput['enabledRules'],
): Record<ObsidianLinterAdapterRuleId, boolean> {
  const normalized = { ...DEFAULT_OBSIDIAN_LINTER_RULE_PROFILE.enabledRules };
  if (!enabledRules || typeof enabledRules !== 'object') return normalized;

  for (const rule of OBSIDIAN_LINTER_RULE_METADATA) {
    const value = enabledRules[rule.id];
    if (typeof value === 'boolean') {
      normalized[rule.id] = value;
    }
  }

  return normalized;
}

function isRuleEnabled(
  ruleId: ObsidianLinterAdapterRuleId,
  enabledRules: Partial<Record<ObsidianLinterAdapterRuleId, boolean>>,
): boolean {
  return enabledRules[ruleId] !== false;
}
