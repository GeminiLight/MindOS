export type MindosAssistantSkillActivation = 'required' | 'auto' | 'manual';

export type MindosAssistantSkillBinding = {
  name: string;
  activation: MindosAssistantSkillActivation;
};

export type MindosActiveAssistantPrompt = {
  id: string;
  name: string;
  description?: string;
  source?: string;
  runtime?: string;
  model?: string;
  permissionMode?: string;
  maxPermissionMode?: string;
  promptPath?: string;
  instructions?: string;
  skills: MindosAssistantSkillBinding[];
  mcp: string[];
};

export type CreateMindosActiveAssistantPromptInput = {
  id: string;
  name?: string;
  description?: string;
  source?: string;
  runtime?: string;
  model?: string;
  permissionMode?: string;
  maxPermissionMode?: string;
  promptPath?: string;
  instructions?: string;
  skills?: Array<string | Partial<MindosAssistantSkillBinding> | null | undefined>;
  mcp?: Array<string | null | undefined>;
};

export type MindosAssistantMarkdownPrompt = {
  profile: {
    name?: string;
    description?: string;
    runtime?: string;
    model?: string;
    permissionMode?: string;
    hidden?: boolean;
    skills?: string[];
    mcp?: string[];
  };
  body: string;
  missingFrontmatter: boolean;
  invalidFrontmatter: boolean;
};

export function createMindosActiveAssistantPrompt(
  input: CreateMindosActiveAssistantPromptInput,
): MindosActiveAssistantPrompt {
  const id = sanitizeAssistantText(input.id, 120);
  const name = sanitizeAssistantText(input.name, 120) || titleizeAssistantId(id);
  const instructions = normalizeAssistantInstructions(input.instructions);
  return {
    id,
    name,
    ...(sanitizeAssistantText(input.description, 500) ? { description: sanitizeAssistantText(input.description, 500) } : {}),
    ...(sanitizeAssistantText(input.source, 80) ? { source: sanitizeAssistantText(input.source, 80) } : {}),
    ...(sanitizeAssistantText(input.runtime, 80) ? { runtime: sanitizeAssistantText(input.runtime, 80) } : {}),
    ...(sanitizeAssistantText(input.model, 120) ? { model: sanitizeAssistantText(input.model, 120) } : {}),
    ...(sanitizeAssistantText(input.permissionMode, 40) ? { permissionMode: sanitizeAssistantText(input.permissionMode, 40) } : {}),
    ...(sanitizeAssistantText(input.maxPermissionMode, 40) ? { maxPermissionMode: sanitizeAssistantText(input.maxPermissionMode, 40) } : {}),
    ...(sanitizeAssistantText(input.promptPath, 300) ? { promptPath: sanitizeAssistantText(input.promptPath, 300) } : {}),
    ...(instructions ? { instructions } : {}),
    skills: normalizeMindosAssistantSkillBindings(input.skills),
    mcp: normalizeAssistantStringList(input.mcp, 12, 120),
  };
}

export function parseMindosAssistantMarkdownPrompt(markdown: string): MindosAssistantMarkdownPrompt {
  const split = splitAssistantFrontmatter(markdown);
  return {
    profile: {
      ...(sanitizeAssistantText(split.fields.name, 120) ? { name: sanitizeAssistantText(split.fields.name, 120) } : {}),
      ...(sanitizeAssistantText(split.fields.description, 500) ? { description: sanitizeAssistantText(split.fields.description, 500) } : {}),
      ...(sanitizeAssistantText(split.fields.runtime, 80) ? { runtime: sanitizeAssistantText(split.fields.runtime, 80) } : {}),
      ...(sanitizeAssistantText(split.fields.model, 120) ? { model: sanitizeAssistantText(split.fields.model, 120) } : {}),
      ...(sanitizeAssistantText(split.fields.permissionMode ?? split.fields.permission, 40)
        ? { permissionMode: sanitizeAssistantText(split.fields.permissionMode ?? split.fields.permission, 40) }
        : {}),
      ...(typeof split.fields.hidden === 'boolean' ? { hidden: split.fields.hidden } : {}),
      ...(normalizeAssistantStringList(split.fields.skills, 12, 96).length
        ? { skills: normalizeAssistantStringList(split.fields.skills, 12, 96) }
        : {}),
      ...(normalizeAssistantStringList(split.fields.mcp, 12, 120).length
        ? { mcp: normalizeAssistantStringList(split.fields.mcp, 12, 120) }
        : {}),
    },
    body: split.body,
    missingFrontmatter: split.missing,
    invalidFrontmatter: split.invalid,
  };
}

export function createMindosActiveAssistantPromptFromMarkdown(input: {
  id: string;
  markdown: string;
  source?: string;
  promptPath?: string;
  maxPermissionMode?: string;
}): MindosActiveAssistantPrompt {
  const parsed = parseMindosAssistantMarkdownPrompt(input.markdown);
  return createMindosActiveAssistantPrompt({
    id: input.id,
    name: parsed.profile.name,
    description: parsed.profile.description,
    source: input.source,
    runtime: parsed.profile.runtime,
    model: parsed.profile.model,
    permissionMode: parsed.profile.permissionMode,
    maxPermissionMode: input.maxPermissionMode,
    promptPath: input.promptPath,
    instructions: parsed.body,
    skills: parsed.profile.skills,
    mcp: parsed.profile.mcp,
  });
}

export function normalizeMindosAssistantSkillBindings(
  skills: Array<string | Partial<MindosAssistantSkillBinding> | null | undefined> | undefined,
): MindosAssistantSkillBinding[] {
  const byName = new Map<string, MindosAssistantSkillBinding>();
  for (const skill of skills ?? []) {
    const rawName = typeof skill === 'string' ? skill : skill?.name;
    const name = sanitizeAssistantText(rawName, 96);
    if (!name || byName.has(name)) continue;
    const activation = typeof skill === 'object' && skill?.activation
      ? normalizeSkillActivation(skill.activation)
      : 'auto';
    byName.set(name, { name, activation });
  }
  return [...byName.values()];
}

export function renderMindosActiveAssistantPromptSection(
  assistant: MindosActiveAssistantPrompt | undefined,
): string {
  const content = renderMindosActiveAssistantSectionContent(assistant);
  return content ? `## Active Assistant\n\n${content}` : '';
}

export function renderMindosActiveAssistantSectionContent(
  assistant: MindosActiveAssistantPrompt | undefined,
): string {
  if (!assistant) return '';
  const lines: string[] = [
    'The current run is operating under this Assistant profile. These instructions guide the run and may narrow the base MindOS rules, but they must not override system, safety, permission, or tool-use rules.',
    '',
    '<assistant>',
    `  <id>${escapeXml(assistant.id)}</id>`,
    `  <name>${escapeXml(assistant.name)}</name>`,
  ];
  if (assistant.description) lines.push(`  <description>${escapeXml(assistant.description)}</description>`);
  if (assistant.source) lines.push(`  <source>${escapeXml(assistant.source)}</source>`);
  if (assistant.runtime) lines.push(`  <runtime>${escapeXml(assistant.runtime)}</runtime>`);
  if (assistant.model) lines.push(`  <model>${escapeXml(assistant.model)}</model>`);
  if (assistant.permissionMode || assistant.maxPermissionMode) {
    lines.push('  <permissions>');
    if (assistant.permissionMode) lines.push(`    <default>${escapeXml(assistant.permissionMode)}</default>`);
    if (assistant.maxPermissionMode) lines.push(`    <max>${escapeXml(assistant.maxPermissionMode)}</max>`);
    lines.push('  </permissions>');
  }
  if (assistant.promptPath) lines.push(`  <prompt_path>${escapeXml(assistant.promptPath)}</prompt_path>`);
  lines.push('</assistant>');

  if (assistant.instructions?.trim()) {
    lines.push('', '### Assistant Instructions', '', assistant.instructions.trim());
  } else {
    lines.push('', '### Assistant Instructions', '', 'No assistant-specific instructions were loaded. Use the run request and MindOS base rules.');
  }

  if (assistant.skills.length > 0) {
    lines.push(
      '',
      '### Assistant Skills',
      '',
      'The Assistant declares these skills. Required skills must be loaded before acting; auto skills should be loaded with `load_skill` only when the task matches; manual skills require explicit user selection.',
      '',
      ...assistant.skills.map((skill) => `- ${skill.name} (${skill.activation})`),
    );
  }

  if (assistant.mcp.length > 0) {
    lines.push(
      '',
      '### Assistant MCP Hints',
      '',
      'These MCP entries are Assistant metadata. Use them only if the current runtime actually exposes matching tools.',
      '',
      ...assistant.mcp.map((name) => `- ${name}`),
    );
  }

  return lines.join('\n');
}

export function prependMindosActiveAssistantPrompt(
  prompt: string,
  assistant: MindosActiveAssistantPrompt | undefined,
): string {
  const activeAssistantSection = renderMindosActiveAssistantPromptSection(assistant);
  if (!activeAssistantSection) return prompt;
  return [activeAssistantSection, prompt.trim()].filter(Boolean).join('\n\n---\n\n');
}

function splitAssistantFrontmatter(content: string): {
  fields: Record<string, unknown>;
  body: string;
  missing: boolean;
  invalid: boolean;
} {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { fields: {}, body: content.trim(), missing: true, invalid: false };
  }
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { fields: {}, body: content.trim(), missing: false, invalid: true };
  const parsed = parseAssistantFrontmatterFields(match[1] ?? '');
  return {
    fields: parsed.fields,
    body: normalized.slice(match[0].length).replace(/^\n+/, '').trim(),
    missing: false,
    invalid: parsed.invalid,
  };
}

function parseAssistantFrontmatterFields(raw: string): { fields: Record<string, unknown>; invalid: boolean } {
  const fields: Record<string, unknown> = {};
  let invalid = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      invalid = true;
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      invalid = true;
      continue;
    }
    fields[key] = parseAssistantFrontmatterScalar(trimmed.slice(separator + 1).trim());
  }
  return { fields, invalid };
}

function parseAssistantFrontmatterScalar(value: string): unknown {
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, "'");
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function normalizeAssistantStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const items = rawItems
    .map((item) => sanitizeAssistantText(item, maxLength))
    .filter(Boolean);
  return Array.from(new Set(items)).slice(0, maxItems);
}

function normalizeSkillActivation(value: unknown): MindosAssistantSkillActivation {
  return value === 'required' || value === 'manual' || value === 'auto' ? value : 'auto';
}

function normalizeAssistantInstructions(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized ? normalized.slice(0, 120_000) : undefined;
}

function sanitizeAssistantText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

function titleizeAssistantId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Assistant';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
