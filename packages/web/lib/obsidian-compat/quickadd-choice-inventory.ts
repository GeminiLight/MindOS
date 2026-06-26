export type ImportedQuickAddChoiceKind = 'capture' | 'template' | 'macro' | 'multi' | 'unknown';
export type ImportedQuickAddChoiceSupport = 'safe-subset' | 'review' | 'not-command';

export interface ImportedQuickAddChoiceSummary {
  id: string;
  name: string;
  type: string;
  kind: ImportedQuickAddChoiceKind;
  command: boolean;
  support: ImportedQuickAddChoiceSupport;
  summary: string;
  targetPath?: string;
  templatePath?: string;
  targetPathPreview?: string;
}

export interface ImportedQuickAddChoiceInventory {
  schemaVersion: 1;
  source: 'quickadd-data-json';
  pluginId: string;
  choices: ImportedQuickAddChoiceSummary[];
  safeSubsetChoices: string[];
  reviewChoices: string[];
  ignoredChoices: string[];
  warnings: string[];
}

export function parseImportedQuickAddChoiceInventoryJson(
  pluginId: string,
  rawDataJson: string,
): ImportedQuickAddChoiceInventory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDataJson);
  } catch {
    return {
      schemaVersion: 1,
      source: 'quickadd-data-json',
      pluginId,
      choices: [],
      safeSubsetChoices: [],
      reviewChoices: [],
      ignoredChoices: [],
      warnings: ['QuickAdd data.json could not be parsed.'],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const rawChoices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(rawChoices)) {
    return null;
  }

  const warnings: string[] = [];
  const choices = rawChoices
    .map((choice, index) => summarizeQuickAddChoice(choice, index, warnings))
    .filter((choice): choice is ImportedQuickAddChoiceSummary => choice !== null);

  if (choices.length === 0 && rawChoices.length > 0) {
    warnings.push('QuickAdd choices were present but none could be summarized safely.');
  }

  return {
    schemaVersion: 1,
    source: 'quickadd-data-json',
    pluginId,
    choices,
    safeSubsetChoices: choices
      .filter((choice) => choice.support === 'safe-subset')
      .map((choice) => choice.summary),
    reviewChoices: choices
      .filter((choice) => choice.support === 'review')
      .map((choice) => choice.summary),
    ignoredChoices: choices
      .filter((choice) => choice.support === 'not-command')
      .map((choice) => choice.summary),
    warnings: unique(warnings),
  };
}

function summarizeQuickAddChoice(
  value: unknown,
  index: number,
  warnings: string[],
): ImportedQuickAddChoiceSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(`Ignored QuickAdd choice at index ${index}: choice is not an object.`);
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id) || `choice-${index + 1}`;
  const name = stringValue(record.name) || id;
  const type = stringValue(record.type) || 'Unknown';
  const normalizedType = type.trim().toLowerCase();
  const kind = quickAddChoiceKind(normalizedType);
  const command = record.command === true;

  if (!command) {
    return {
      id,
      name,
      type,
      kind,
      command,
      support: 'not-command',
      summary: `${type}: ${name} (not command-enabled)`,
    };
  }

  if (kind === 'capture') {
    const targetPath = normalizeVaultPath(record.captureTo);
    const blockers = captureReviewReasons(record);
    const support: ImportedQuickAddChoiceSupport = targetPath && blockers.length === 0 ? 'safe-subset' : 'review';
    if (!targetPath) {
      warnings.push(`Capture choice "${name}" has no static captureTo target.`);
    }
    warnings.push(...blockers.map((reason) => `Capture choice "${name}" requires review: ${reason}.`));
    return {
      id,
      name,
      type,
      kind,
      command,
      support,
      summary: targetPath ? `Capture: ${name} -> ${targetPath}` : `Capture: ${name} (target requires review)`,
      ...(targetPath ? { targetPath } : {}),
    };
  }

  if (kind === 'template') {
    const templatePath = normalizeVaultPath(record.templatePath);
    const targetPathPreview = templateTargetPathPreview(record);
    const support: ImportedQuickAddChoiceSupport = templatePath && targetPathPreview ? 'safe-subset' : 'review';
    if (!templatePath) {
      warnings.push(`Template choice "${name}" has no templatePath.`);
    }
    if (templatePath && !targetPathPreview) {
      warnings.push(`Template choice "${name}" has dynamic folder or filename settings that need review after import.`);
    }
    return {
      id,
      name,
      type,
      kind,
      command,
      support,
      summary: `Template: ${name}${targetPathPreview ? ` -> ${targetPathPreview}` : ''}${templatePath ? ` from ${templatePath}` : ' (template requires review)'}`,
      ...(templatePath ? { templatePath } : {}),
      ...(targetPathPreview ? { targetPathPreview } : {}),
    };
  }

  return {
    id,
    name,
    type,
    kind,
    command,
    support: 'review',
    summary: `${type}: ${name} (requires review)`,
  };
}

function quickAddChoiceKind(type: string): ImportedQuickAddChoiceKind {
  if (type === 'capture') return 'capture';
  if (type === 'template') return 'template';
  if (type === 'macro') return 'macro';
  if (type === 'multi') return 'multi';
  return 'unknown';
}

function templateTargetPathPreview(record: Record<string, unknown>): string | null {
  const templatePath = normalizeVaultPath(record.templatePath);
  const fileName = templateFileNamePreview(record);
  if (!fileName) return null;
  const folder = templateFolderPreview(record);
  const extension = templateExtension(templatePath);
  const fileNameWithoutExtension = fileName
    .replace(/\.md$/iu, '')
    .replace(/\.canvas$/iu, '')
    .replace(/\.base$/iu, '');
  return `${folder ? `${folder}/` : ''}${fileNameWithoutExtension}${extension}`;
}

function templateFileNamePreview(record: Record<string, unknown>): string | null {
  const fileNameFormat = record.fileNameFormat;
  if (!fileNameFormat || typeof fileNameFormat !== 'object' || Array.isArray(fileNameFormat)) {
    return null;
  }
  const format = stringValue((fileNameFormat as { format?: unknown }).format);
  if (!format) return null;
  if ((fileNameFormat as { enabled?: unknown }).enabled !== true) return null;
  return normalizeVaultPath(format);
}

function templateFolderPreview(record: Record<string, unknown>): string | null {
  const folder = record.folder;
  if (!folder || typeof folder !== 'object' || Array.isArray(folder)) {
    return '';
  }
  const folderRecord = folder as {
    enabled?: unknown;
    folders?: unknown;
    chooseWhenCreatingNote?: unknown;
    createInSameFolderAsActiveFile?: unknown;
    chooseFromSubfolders?: unknown;
  };
  if (folderRecord.enabled !== true) return '';
  if (folderRecord.chooseWhenCreatingNote === true || folderRecord.createInSameFolderAsActiveFile === true || folderRecord.chooseFromSubfolders === true) {
    return null;
  }
  if (!Array.isArray(folderRecord.folders) || folderRecord.folders.length !== 1) {
    return null;
  }
  return normalizeVaultPath(folderRecord.folders[0]);
}

function templateExtension(templatePath: string | null): '.md' | '.canvas' | '.base' {
  const lower = (templatePath ?? '').toLowerCase();
  if (lower.endsWith('.canvas')) return '.canvas';
  if (lower.endsWith('.base')) return '.base';
  return '.md';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVaultPath(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('//')) return null;
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  if (/^\w+:/u.test(normalized)) return null;
  if (hasDynamicTemplateToken(normalized)) return null;
  return normalized;
}

function captureReviewReasons(record: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const onePageInput = stringValue(record.onePageInput);
  if (onePageInput && onePageInput !== 'never') {
    reasons.push('choice uses a one-page input prompt');
  }
  const format = record.format;
  if (!format || typeof format !== 'object' || Array.isArray(format) || (format as { enabled?: unknown }).enabled !== true) {
    reasons.push('capture content is not statically configured');
  } else {
    const formatText = stringValue((format as { format?: unknown }).format);
    if (!formatText) {
      reasons.push('capture content is not statically configured');
    } else if (hasDynamicTemplateToken(formatText)) {
      reasons.push('capture content uses dynamic template tokens');
    }
  }
  if (record.captureToActiveFile === true) {
    reasons.push('target depends on the active file');
  }
  if (stringValue(record.captureToCanvasNodeId)) {
    reasons.push('target depends on a Canvas node');
  }
  if (record.useSelectionAsCaptureValue === true) {
    reasons.push('capture depends on editor selection');
  }
  if (nestedEnabled(record.createFileIfItDoesntExist, 'createWithTemplate')) {
    reasons.push('file creation uses a template');
  }
  if (nestedEnabled(record.insertAfter, 'enabled')) {
    reasons.push('insert-after matching changes write position');
  }
  if (nestedEnabled(record.insertBefore, 'enabled')) {
    reasons.push('insert-before matching changes write position');
  }
  if (nestedEnabled(record.newLineCapture, 'enabled')) {
    reasons.push('newline capture changes write position');
  }
  const templater = record.templater;
  if (templater && typeof templater === 'object' && !Array.isArray(templater)) {
    const afterCapture = stringValue((templater as { afterCapture?: unknown }).afterCapture);
    if (afterCapture && afterCapture !== 'none') {
      reasons.push('Templater integration runs after capture');
    }
  }
  return reasons;
}

function hasDynamicTemplateToken(value: string): boolean {
  return /[{}]|<%|%>/u.test(value);
}

function nestedEnabled(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>)[key] === true);
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
