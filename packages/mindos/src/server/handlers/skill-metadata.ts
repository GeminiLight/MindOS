import {
  emptySkillRuntimeRequirements,
  type MindosSkillRuntimeKindRequirement,
  type MindosSkillRuntimeRequirements,
  type MindosSkillRuntimeToolRequirement,
} from '../../agent/runtime/skill-runtime-requirements.js';

export type MindosSkillMetadata = {
  name?: string;
  description?: string;
  runtimeRequirements: MindosSkillRuntimeRequirements;
};

type ScalarFrontmatter = Record<string, string>;

const REQUIREMENT_KEYS = new Set([
  'runtimekinds',
  'runtimekind',
  'runtimes',
  'runtime',
  'tools',
  'requiredtools',
  'requiredtool',
  'capabilities',
  'requiredcapabilities',
  'requiredcapability',
  'remotesafe',
  'unattendedsafe',
  'requiresapprovals',
  'requiresapproval',
  'requiresuserinput',
  'runtimenotes',
  'notes',
]);

const RUNTIME_KIND_ALIASES: Record<string, MindosSkillRuntimeKindRequirement> = {
  '*': 'any',
  any: 'any',
  all: 'any',
  mindos: 'mindos',
  pi: 'mindos',
  'mindos-pi': 'mindos',
  codex: 'codex',
  claude: 'claude',
  'claude-code': 'claude',
  acp: 'acp',
  native: 'native',
};

const TOOL_ALIASES: Record<string, MindosSkillRuntimeToolRequirement> = {
  shell: 'shell',
  terminal: 'shell',
  command: 'shell',
  commands: 'shell',
  file: 'file',
  files: 'file',
  filesystem: 'file',
  fs: 'file',
  git: 'git',
  browser: 'browser',
  web: 'browser',
  mcp: 'mcp',
  plugin: 'plugins',
  plugins: 'plugins',
  skill: 'skills',
  skills: 'skills',
};

export { emptySkillRuntimeRequirements };
export type { MindosSkillRuntimeRequirements };

export function parseSkillMarkdownMetadata(content: string): MindosSkillMetadata {
  const frontmatter = parseLeadingScalarFrontmatter(content);
  if (!frontmatter) {
    return { runtimeRequirements: emptySkillRuntimeRequirements() };
  }

  const runtimeRequirements = parseSkillRuntimeRequirements(frontmatter);
  return {
    ...(frontmatter.name ? { name: frontmatter.name } : {}),
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    runtimeRequirements,
  };
}

export function parseSkillRuntimeRequirements(frontmatter: ScalarFrontmatter): MindosSkillRuntimeRequirements {
  const requirements = emptySkillRuntimeRequirements();
  const keys = new Set(Object.keys(frontmatter).map(normalizeKey));
  requirements.declared = [...keys].some((key) => REQUIREMENT_KEYS.has(key));

  requirements.runtimeKinds = unique(
    readList(frontmatter, ['runtimeKinds', 'runtimeKind', 'runtimes', 'runtime'])
      .map((value) => RUNTIME_KIND_ALIASES[normalizeToken(value)])
      .filter(isPresent),
  );
  requirements.requiredTools = unique(
    readList(frontmatter, ['requiredTools', 'requiredTool', 'tools'])
      .map((value) => TOOL_ALIASES[normalizeToken(value)])
      .filter(isPresent),
  );
  requirements.requiredCapabilities = unique(
    readList(frontmatter, ['requiredCapabilities', 'requiredCapability', 'capabilities'])
      .map(normalizeCapability)
      .filter(isPresent),
  );

  const remoteSafe = readBoolean(frontmatter, ['remoteSafe']);
  const unattendedSafe = readBoolean(frontmatter, ['unattendedSafe']);
  const requiresApprovals = readBoolean(frontmatter, ['requiresApprovals', 'requiresApproval']);
  const requiresUserInput = readBoolean(frontmatter, ['requiresUserInput']);
  requirements.remote = remoteSafe === undefined ? 'unknown' : remoteSafe ? 'safe' : 'unsafe';
  requirements.unattended = unattendedSafe === undefined ? 'unknown' : unattendedSafe ? 'safe' : 'unsafe';
  requirements.approvals = requiresApprovals === undefined ? 'unknown' : requiresApprovals ? 'required' : 'not-required';
  requirements.userInput = requiresUserInput === undefined ? 'unknown' : requiresUserInput ? 'required' : 'not-required';
  requirements.notes = readNotes(frontmatter, ['runtimeNotes', 'notes']);

  return requirements;
}

function parseLeadingScalarFrontmatter(content: string): ScalarFrontmatter | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: ScalarFrontmatter = {};
  for (const rawLine of (match[1] ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    const value = unquote(line.slice(separator + 1).trim());
    result[key] = value;
  }
  return result;
}

function readList(frontmatter: ScalarFrontmatter, keys: string[]): string[] {
  for (const key of keys) {
    const value = readScalar(frontmatter, key);
    if (value !== undefined) return splitList(value);
  }
  return [];
}

function readNotes(frontmatter: ScalarFrontmatter, keys: string[]): string[] {
  for (const key of keys) {
    const value = readScalar(frontmatter, key);
    if (!value) continue;
    const values = value.startsWith('[') || value.includes(';')
      ? splitList(value)
      : [value];
    return values.map((note) => note.trim()).filter(Boolean).slice(0, 12);
  }
  return [];
}

function readBoolean(frontmatter: ScalarFrontmatter, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = readScalar(frontmatter, key);
    if (value === undefined) continue;
    const normalized = normalizeToken(value);
    if (['true', 'yes', 'y', '1', 'safe', 'supported', 'required'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'unsafe', 'unsupported', 'not-required', 'none'].includes(normalized)) return false;
  }
  return undefined;
}

function readScalar(frontmatter: ScalarFrontmatter, desired: string): string | undefined {
  const normalizedDesired = normalizeKey(desired);
  const entry = Object.entries(frontmatter).find(([key]) => normalizeKey(key) === normalizedDesired);
  return entry?.[1];
}

function splitList(value: string): string[] {
  const trimmed = value.trim();
  const bracketless = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  return bracketless
    .split(/[;,]/)
    .map((item) => unquote(item.trim()))
    .filter(Boolean)
    .slice(0, 32);
}

function normalizeCapability(value: string): string | undefined {
  const normalized = normalizeToken(value);
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeKey(value: string): string {
  return value.replace(/[-_\s]/g, '').toLowerCase();
}

function normalizeToken(value: string): string {
  return unquote(value).trim().toLowerCase();
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
