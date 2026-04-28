export type PermissionEffect = 'allow' | 'deny' | 'ask';

export type PermissionActorType = 'user' | 'agent' | 'system';

export interface PermissionRule {
  actor: string;
  op: string;
  path: string;
  effect: PermissionEffect;
  reason?: string;
}

export interface PermissionRequest {
  actor: {
    type: PermissionActorType;
    agentName?: string;
  };
  op: string;
  path: string;
  rules?: PermissionRule[];
  protectedRootFiles?: Iterable<string>;
}

export interface PermissionDecision {
  effect: PermissionEffect;
  reason: string;
  rule?: PermissionRule;
}

interface RankedRule {
  rule: PermissionRule;
  actorScore: number;
  opScore: number;
  pathScore: number;
  effectScore: number;
}

const DEFAULT_PROTECTED_ROOT_FILES = new Set([
  'INSTRUCTION.md',
  'README.md',
  'CONFIG.json',
  'CHANGELOG.md',
]);

const EFFECT_PRIORITY: Record<PermissionEffect, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isRootLevel(filePath: string): boolean {
  return !normalizePath(filePath).includes('/');
}

function basename(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern || '**');
  let source = '';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i] ?? '';
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`);
}

function matchesPath(pattern: string, filePath: string): boolean {
  return globToRegExp(pattern).test(normalizePath(filePath));
}

function pathSpecificity(pattern: string): number {
  return normalizePath(pattern).replace(/\*/g, '').length;
}

function actorKey(request: PermissionRequest): string {
  if (request.actor.type === 'agent' && request.actor.agentName?.trim()) {
    return request.actor.agentName.trim();
  }
  return request.actor.type;
}

function matchesActor(ruleActor: string, request: PermissionRequest): boolean {
  if (ruleActor === '*') return true;
  return ruleActor === actorKey(request);
}

function matchesOp(ruleOp: string, op: string): boolean {
  return ruleOp === '*' || ruleOp === op;
}

function rankRule(rule: PermissionRule, request: PermissionRequest): RankedRule | null {
  if (!matchesActor(rule.actor, request)) return null;
  if (!matchesOp(rule.op, request.op)) return null;
  if (!matchesPath(rule.path, request.path)) return null;

  return {
    rule,
    actorScore: rule.actor === '*' ? 0 : 1,
    opScore: rule.op === '*' ? 0 : 1,
    pathScore: pathSpecificity(rule.path),
    effectScore: EFFECT_PRIORITY[rule.effect],
  };
}

function compareRanked(a: RankedRule, b: RankedRule): number {
  return (
    b.actorScore - a.actorScore ||
    b.opScore - a.opScore ||
    b.pathScore - a.pathScore ||
    b.effectScore - a.effectScore
  );
}

function isProtectedRootFile(request: PermissionRequest): boolean {
  if (request.actor.type !== 'agent') return false;
  if (!isRootLevel(request.path)) return false;
  const protectedFiles = new Set(request.protectedRootFiles ?? DEFAULT_PROTECTED_ROOT_FILES);
  return protectedFiles.has(basename(request.path));
}

export function evaluatePermission(request: PermissionRequest): PermissionDecision {
  if (isProtectedRootFile(request)) {
    return {
      effect: 'deny',
      reason: `Root-level system file "${normalizePath(request.path)}" is protected and cannot be modified by agents`,
    };
  }

  const ranked = (request.rules ?? [])
    .map((rule) => rankRule(rule, request))
    .filter((rule): rule is RankedRule => rule !== null)
    .sort(compareRanked);

  const match = ranked[0];
  if (match) {
    return {
      effect: match.rule.effect,
      reason: match.rule.reason ?? `Matched permission rule for ${match.rule.op} on ${match.rule.path}`,
      rule: match.rule,
    };
  }

  return {
    effect: 'allow',
    reason: 'Default allow',
  };
}

function isPermissionEffect(value: unknown): value is PermissionEffect {
  return value === 'allow' || value === 'deny' || value === 'ask';
}

function normalizeRule(value: unknown): PermissionRule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.actor !== 'string' || !raw.actor.trim()) return null;
  if (typeof raw.op !== 'string' || !raw.op.trim()) return null;
  if (typeof raw.path !== 'string' || !raw.path.trim()) return null;
  if (!isPermissionEffect(raw.effect)) return null;

  return {
    actor: raw.actor.trim(),
    op: raw.op.trim(),
    path: raw.path.trim(),
    effect: raw.effect,
    reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : undefined,
  };
}

export function parsePermissionRules(raw: string | undefined): PermissionRule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRule)
      .filter((rule): rule is PermissionRule => rule !== null);
  } catch {
    return [];
  }
}
