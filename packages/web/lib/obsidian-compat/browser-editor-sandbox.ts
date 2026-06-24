export const BROWSER_EDITOR_SANDBOX_VERSION = 1;

export type BrowserEditorSandboxContributionKind = 'line-highlight' | 'range-highlight';
export type BrowserEditorSandboxContributionSource = 'mindos-signed' | 'obsidian-catalog-preview';
export type BrowserEditorSandboxPermission = 'editor.read' | 'editor.decorations';
export type BrowserEditorSandboxTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

export interface BrowserEditorSandboxPermissionGrant {
  scope: 'browser-editor-sandbox';
  grantedBy: 'mindos';
  permissions: BrowserEditorSandboxPermission[];
  grantId?: string;
}

interface BrowserEditorSandboxContributionBase {
  sandboxVersion: typeof BROWSER_EDITOR_SANDBOX_VERSION;
  id: string;
  pluginId: string;
  source: BrowserEditorSandboxContributionSource;
  kind: BrowserEditorSandboxContributionKind;
  permissionGrant: BrowserEditorSandboxPermissionGrant;
  label?: string;
  tone?: BrowserEditorSandboxTone;
}

export interface BrowserEditorSandboxLineHighlightContribution extends BrowserEditorSandboxContributionBase {
  kind: 'line-highlight';
  line: number;
}

export interface BrowserEditorSandboxRangeHighlightContribution extends BrowserEditorSandboxContributionBase {
  kind: 'range-highlight';
  from: number;
  to: number;
}

export type BrowserEditorSandboxContribution =
  | BrowserEditorSandboxLineHighlightContribution
  | BrowserEditorSandboxRangeHighlightContribution;

export type BrowserEditorSandboxRejectionCode =
  | 'not-object'
  | 'unsafe-shape'
  | 'invalid-version'
  | 'invalid-id'
  | 'invalid-plugin-id'
  | 'source-not-mountable'
  | 'invalid-kind'
  | 'missing-permission-grant'
  | 'missing-required-permission'
  | 'unknown-permission'
  | 'invalid-tone'
  | 'invalid-label'
  | 'invalid-line'
  | 'line-out-of-bounds'
  | 'invalid-range'
  | 'range-out-of-bounds'
  | 'too-many-contributions';

export interface BrowserEditorSandboxAcceptedContribution {
  contribution: BrowserEditorSandboxContribution;
  requiredPermissions: BrowserEditorSandboxPermission[];
}

export interface BrowserEditorSandboxRejectedContribution {
  index: number;
  id?: string;
  pluginId?: string;
  code: BrowserEditorSandboxRejectionCode;
  reason: string;
}

export interface BrowserEditorSandboxValidationOptions {
  documentLength?: number;
  lineCount?: number;
  maxContributions?: number;
}

export interface BrowserEditorSandboxValidationResult {
  accepted: BrowserEditorSandboxAcceptedContribution[];
  rejected: BrowserEditorSandboxRejectedContribution[];
}

const DEFAULT_MAX_CONTRIBUTIONS = 200;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 120;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SAFE_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ALLOWED_TONES: BrowserEditorSandboxTone[] = ['accent', 'success', 'warning', 'danger', 'muted'];
const REQUIRED_DECORATION_PERMISSIONS: BrowserEditorSandboxPermission[] = ['editor.read', 'editor.decorations'];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnsafeNestedValue(value: unknown, depth = 0): boolean {
  if (depth > 6) return true;
  if (value === null) return false;
  const valueType = typeof value;
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') return true;
  if (valueType !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeNestedValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) return true;
  return Object.values(value).some((item) => hasUnsafeNestedValue(item, depth + 1));
}

function readSafeString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function createRejectedContribution(
  index: number,
  record: Record<string, unknown> | undefined,
  code: BrowserEditorSandboxRejectionCode,
  reason: string,
): BrowserEditorSandboxRejectedContribution {
  return {
    index,
    id: record ? readSafeString(record, 'id') : undefined,
    pluginId: record ? readSafeString(record, 'pluginId') : undefined,
    code,
    reason,
  };
}

function hasRequiredPermissions(
  grant: BrowserEditorSandboxPermissionGrant,
  requiredPermissions: BrowserEditorSandboxPermission[],
): boolean {
  return requiredPermissions.every((permission) => grant.permissions.includes(permission));
}

function validatePermissionGrant(
  record: Record<string, unknown>,
  requiredPermissions: BrowserEditorSandboxPermission[],
): BrowserEditorSandboxPermissionGrant | BrowserEditorSandboxRejectionCode {
  const grant = record.permissionGrant;
  if (!isPlainRecord(grant)) return 'missing-permission-grant';
  if (grant.scope !== 'browser-editor-sandbox') return 'missing-permission-grant';
  if (grant.grantedBy !== 'mindos') return 'missing-permission-grant';
  if (!Array.isArray(grant.permissions)) return 'missing-permission-grant';
  if (grant.permissions.some((permission) =>
    permission !== 'editor.read' && permission !== 'editor.decorations'
  )) {
    return 'unknown-permission';
  }
  const permissions = grant.permissions.filter((permission): permission is BrowserEditorSandboxPermission =>
    permission === 'editor.read' || permission === 'editor.decorations',
  );
  const normalizedGrant: BrowserEditorSandboxPermissionGrant = {
    scope: 'browser-editor-sandbox',
    grantedBy: 'mindos',
    permissions: Array.from(new Set(permissions)),
  };
  if (typeof grant.grantId === 'string' && grant.grantId.length <= MAX_ID_LENGTH) {
    normalizedGrant.grantId = grant.grantId;
  }
  if (!hasRequiredPermissions(normalizedGrant, requiredPermissions)) {
    return 'missing-required-permission';
  }
  return normalizedGrant;
}

function normalizeTone(value: unknown): BrowserEditorSandboxTone | 'invalid-tone' {
  if (value === undefined) return 'accent';
  if (typeof value !== 'string') return 'invalid-tone';
  return ALLOWED_TONES.includes(value as BrowserEditorSandboxTone)
    ? value as BrowserEditorSandboxTone
    : 'invalid-tone';
}

function normalizeLabel(value: unknown): string | 'invalid-label' | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return 'invalid-label';
  const trimmed = value.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) return 'invalid-label';
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateLineContribution(
  record: Record<string, unknown>,
  index: number,
  options: BrowserEditorSandboxValidationOptions,
): BrowserEditorSandboxLineHighlightContribution | BrowserEditorSandboxRejectedContribution {
  const lineValue = record.line;
  if (typeof lineValue !== 'number' || !Number.isSafeInteger(lineValue) || lineValue < 1) {
    return createRejectedContribution(index, record, 'invalid-line', 'Line highlights require a positive one-based line number.');
  }
  const line = lineValue;
  if (typeof options.lineCount === 'number' && line > options.lineCount) {
    return createRejectedContribution(index, record, 'line-out-of-bounds', 'Line highlight is outside the current document.');
  }

  const base = validateContributionBase(record, index);
  if ('code' in base) return base;

  return {
    ...base,
    kind: 'line-highlight',
    line,
  };
}

function validateRangeContribution(
  record: Record<string, unknown>,
  index: number,
  options: BrowserEditorSandboxValidationOptions,
): BrowserEditorSandboxRangeHighlightContribution | BrowserEditorSandboxRejectedContribution {
  const { from: fromValue, to: toValue } = record;
  if (
    typeof fromValue !== 'number'
    || typeof toValue !== 'number'
    || !Number.isSafeInteger(fromValue)
    || !Number.isSafeInteger(toValue)
    || fromValue < 0
    || toValue <= fromValue
  ) {
    return createRejectedContribution(index, record, 'invalid-range', 'Range highlights require safe integer from/to offsets where to is greater than from.');
  }
  const from = fromValue;
  const to = toValue;
  if (typeof options.documentLength === 'number' && to > options.documentLength) {
    return createRejectedContribution(index, record, 'range-out-of-bounds', 'Range highlight is outside the current document.');
  }

  const base = validateContributionBase(record, index);
  if ('code' in base) return base;

  return {
    ...base,
    kind: 'range-highlight',
    from,
    to,
  };
}

function validateContributionBase(
  record: Record<string, unknown>,
  index: number,
): Omit<BrowserEditorSandboxContributionBase, 'kind'> | BrowserEditorSandboxRejectedContribution {
  if (record.sandboxVersion !== BROWSER_EDITOR_SANDBOX_VERSION) {
    return createRejectedContribution(index, record, 'invalid-version', 'Browser editor sandbox contributions must declare sandboxVersion 1.');
  }

  const id = readSafeString(record, 'id');
  if (!id || id.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(id)) {
    return createRejectedContribution(index, record, 'invalid-id', 'Browser editor sandbox contribution id is missing or unsafe.');
  }

  const pluginId = readSafeString(record, 'pluginId');
  if (!pluginId || !SAFE_PLUGIN_ID_PATTERN.test(pluginId)) {
    return createRejectedContribution(index, record, 'invalid-plugin-id', 'Browser editor sandbox contribution pluginId is missing or unsafe.');
  }

  if (record.source !== 'mindos-signed') {
    return createRejectedContribution(index, record, 'source-not-mountable', 'Only MindOS-signed declarative editor contributions can mount in the browser editor sandbox.');
  }

  const permissionGrant = validatePermissionGrant(record, REQUIRED_DECORATION_PERMISSIONS);
  if (typeof permissionGrant === 'string') {
    return createRejectedContribution(
      index,
      record,
      permissionGrant,
      permissionGrant === 'missing-required-permission'
        ? 'Browser editor sandbox contribution is missing required editor.read/editor.decorations permissions.'
        : permissionGrant === 'unknown-permission'
          ? 'Browser editor sandbox contribution requested an unknown editor permission.'
        : 'Browser editor sandbox contribution is missing a MindOS permission grant.',
    );
  }

  const tone = normalizeTone(record.tone);
  if (tone === 'invalid-tone') {
    return createRejectedContribution(index, record, 'invalid-tone', 'Browser editor sandbox tone is not supported.');
  }

  const label = normalizeLabel(record.label);
  if (label === 'invalid-label') {
    return createRejectedContribution(index, record, 'invalid-label', 'Browser editor sandbox label is too long or not a string.');
  }

  return {
    sandboxVersion: BROWSER_EDITOR_SANDBOX_VERSION,
    id,
    pluginId,
    source: 'mindos-signed',
    permissionGrant,
    label,
    tone,
  };
}

export function validateBrowserEditorSandboxContributions(
  contributions: readonly unknown[] | undefined,
  options: BrowserEditorSandboxValidationOptions = {},
): BrowserEditorSandboxValidationResult {
  const maxContributions = options.maxContributions ?? DEFAULT_MAX_CONTRIBUTIONS;
  const accepted: BrowserEditorSandboxAcceptedContribution[] = [];
  const rejected: BrowserEditorSandboxRejectedContribution[] = [];

  for (const [index, contribution] of (contributions ?? []).entries()) {
    if (index >= maxContributions) {
      rejected.push(createRejectedContribution(index, undefined, 'too-many-contributions', 'Too many browser editor sandbox contributions were provided.'));
      continue;
    }

    if (!isPlainRecord(contribution)) {
      rejected.push(createRejectedContribution(index, undefined, 'not-object', 'Browser editor sandbox contribution must be a plain object.'));
      continue;
    }

    if (hasUnsafeNestedValue(contribution)) {
      rejected.push(createRejectedContribution(index, contribution, 'unsafe-shape', 'Browser editor sandbox contribution must be JSON-like and cannot contain functions or prototype objects.'));
      continue;
    }

    const kind = contribution.kind;
    if (kind !== 'line-highlight' && kind !== 'range-highlight') {
      rejected.push(createRejectedContribution(index, contribution, 'invalid-kind', 'Browser editor sandbox contribution kind is not supported.'));
      continue;
    }

    const result = kind === 'line-highlight'
      ? validateLineContribution(contribution, index, options)
      : validateRangeContribution(contribution, index, options);

    if ('code' in result) {
      rejected.push(result);
    } else {
      accepted.push({
        contribution: result,
        requiredPermissions: REQUIRED_DECORATION_PERMISSIONS,
      });
    }
  }

  return { accepted, rejected };
}
