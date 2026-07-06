export type MindosHumanSignalKind =
  | 'observation'
  | 'value'
  | 'principle'
  | 'long-term-direction'
  | 'decision'
  | 'boundary'
  | 'rule'
  | 'commitment'
  | 'preference'
  | 'workflow'
  | 'method'
  | 'strategy'
  | 'checklist'
  | 'practice'
  | 'tool'
  | 'asset'
  | 'template'
  | 'resource'
  | 'episode'
  | 'imprint'
  | 'open-loop'
  | 'correction';

export type MindosHumanModelTarget = 'dao' | 'fa' | 'shu' | 'qi' | 'echo';
export type MindosHumanModelProjection = 'global' | 'workspace';
export type MindosHumanSignalScope = 'global' | 'workspace' | 'project' | 'session';
export type MindosHumanModelSignalStatus = 'candidate' | 'accepted' | 'rejected' | 'deprecated';
export type MindosHumanModelStability = 'stable' | 'candidate' | 'episodic' | 'rejected' | 'deprecated';
export type MindosHumanModelUpdateAction = 'promote' | 'review' | 'keep-episodic' | 'ignore' | 'deprecate';
export type MindosHumanModelUpdateReason =
  | 'empty-content'
  | 'explicitly-rejected'
  | 'explicitly-deprecated'
  | 'user-confirmed'
  | 'repeated-evidence'
  | 'single-evidence'
  | 'low-evidence'
  | 'episodic-kind'
  | 'unknown-kind'
  | 'high-impact-review'
  | 'workspace-projection';

export type MindosHumanEvidenceSource =
  | 'user-message'
  | 'assistant-message'
  | 'agent-run'
  | 'manual-note'
  | 'mind-file'
  | 'echo-card'
  | 'external';

export interface MindosHumanEvidenceRef {
  readonly id?: string;
  readonly source: MindosHumanEvidenceSource;
  readonly uri?: string;
  readonly quote?: string;
  readonly observedAt?: string;
  readonly confirmedByUser?: boolean;
}

export interface MindosHumanModelSignal {
  readonly id?: string;
  readonly kind: MindosHumanSignalKind | (string & {});
  readonly content: string;
  readonly subject?: string;
  readonly scope?: MindosHumanSignalScope;
  readonly workspaceId?: string;
  readonly tags?: readonly string[];
  readonly evidence?: readonly MindosHumanEvidenceRef[];
  readonly confidence?: number;
  readonly userConfirmed?: boolean;
  readonly status?: MindosHumanModelSignalStatus;
  readonly createdAt?: string;
}

export interface MindosNormalizedHumanModelSignal extends Omit<MindosHumanModelSignal, 'kind' | 'content' | 'tags' | 'evidence' | 'confidence'> {
  readonly kind: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly evidence: readonly MindosHumanEvidenceRef[];
  readonly confidence: number;
}

export interface MindosHumanModelRoute {
  readonly target: MindosHumanModelTarget;
  readonly projection: MindosHumanModelProjection;
  readonly workspaceId?: string;
  readonly confidence: number;
  readonly reviewRequired: boolean;
  readonly reason: string;
}

export interface MindosHumanModelStabilityScore {
  readonly stability: MindosHumanModelStability;
  readonly confidence: number;
  readonly evidenceCount: number;
  readonly confirmed: boolean;
  readonly reasons: readonly MindosHumanModelUpdateReason[];
}

export interface MindosHumanModelSignalAssessment {
  readonly signal: MindosNormalizedHumanModelSignal;
  readonly route: MindosHumanModelRoute;
  readonly stability: MindosHumanModelStabilityScore;
  readonly action: MindosHumanModelUpdateAction;
  readonly reasons: readonly MindosHumanModelUpdateReason[];
}

export interface BuildMindosHumanModelUpdatesInput {
  readonly signals: readonly MindosHumanModelSignal[];
  readonly dedupe?: boolean;
}

export interface BuildMindosHumanModelUpdatesOutput {
  readonly updates: readonly MindosHumanModelSignalAssessment[];
  readonly stats: {
    readonly totalSignals: number;
    readonly modeledSignals: number;
    readonly ignoredSignals: number;
    readonly byTarget: Readonly<Record<MindosHumanModelTarget, number>>;
    readonly byAction: Readonly<Record<MindosHumanModelUpdateAction, number>>;
  };
}

export const HUMAN_MODEL_TARGETS = ['dao', 'fa', 'shu', 'qi', 'echo'] as const satisfies readonly MindosHumanModelTarget[];
export const HUMAN_MODEL_UPDATE_ACTIONS = ['promote', 'review', 'keep-episodic', 'ignore', 'deprecate'] as const satisfies readonly MindosHumanModelUpdateAction[];

const TARGET_BY_KIND: Record<MindosHumanSignalKind, MindosHumanModelTarget> = {
  observation: 'echo',
  value: 'dao',
  principle: 'dao',
  'long-term-direction': 'dao',
  decision: 'dao',
  boundary: 'fa',
  rule: 'fa',
  commitment: 'fa',
  preference: 'fa',
  workflow: 'shu',
  method: 'shu',
  strategy: 'shu',
  checklist: 'shu',
  practice: 'shu',
  tool: 'qi',
  asset: 'qi',
  template: 'qi',
  resource: 'qi',
  episode: 'echo',
  imprint: 'echo',
  'open-loop': 'echo',
  correction: 'echo',
};

const KIND_ALIASES: Record<string, MindosHumanSignalKind> = {
  values: 'value',
  belief: 'principle',
  direction: 'long-term-direction',
  longterm: 'long-term-direction',
  'long-term-judgment': 'long-term-direction',
  judgment: 'decision',
  'boundary-rule': 'boundary',
  protocol: 'rule',
  policy: 'rule',
  habit: 'practice',
  sop: 'workflow',
  playbook: 'workflow',
  process: 'workflow',
  capability: 'tool',
  dataset: 'resource',
  source: 'resource',
  moment: 'episode',
  memory: 'imprint',
  todo: 'open-loop',
};

const KNOWN_KINDS = new Set<MindosHumanSignalKind>(Object.keys(TARGET_BY_KIND) as MindosHumanSignalKind[]);
const EPISODIC_KINDS = new Set<string>(['observation', 'episode', 'imprint', 'open-loop', 'correction']);
const HIGH_IMPACT_TARGETS = new Set<MindosHumanModelTarget>(['dao', 'fa']);

export function isMindosHumanSignalKind(kind: string): kind is MindosHumanSignalKind {
  return KNOWN_KINDS.has(kind as MindosHumanSignalKind);
}

export function normalizeMindosHumanSignal(signal: MindosHumanModelSignal): MindosNormalizedHumanModelSignal {
  const kind = normalizeKind(signal.kind);
  return {
    ...signal,
    kind,
    content: signal.content.trim(),
    tags: normalizeStringList(signal.tags ?? []),
    evidence: normalizeEvidence(signal.evidence ?? []),
    confidence: clampConfidence(signal.confidence ?? 0.5),
  };
}

export function routeMindosHumanSignal(signal: MindosHumanModelSignal): MindosHumanModelRoute {
  const normalized = normalizeMindosHumanSignal(signal);
  const knownKind = isMindosHumanSignalKind(normalized.kind);
  const target = knownKind ? TARGET_BY_KIND[normalized.kind] : 'echo';
  const projection = normalized.workspaceId || normalized.scope === 'workspace' ? 'workspace' : 'global';
  const confirmed = isUserConfirmed(normalized);
  const reviewRequired = HIGH_IMPACT_TARGETS.has(target) && !confirmed;
  const confidence = knownKind ? 0.82 : 0.35;

  return compactRoute({
    target,
    projection,
    workspaceId: normalized.workspaceId?.trim() || undefined,
    confidence,
    reviewRequired,
    reason: knownKind
      ? `kind:${normalized.kind}->${target}`
      : `kind:${normalized.kind || 'unknown'}->echo`,
  });
}

export function scoreMindosHumanSignalStability(signal: MindosHumanModelSignal): MindosHumanModelStabilityScore {
  const normalized = normalizeMindosHumanSignal(signal);
  const evidenceCount = normalized.evidence.length;
  const confirmed = isUserConfirmed(normalized);
  const knownKind = isMindosHumanSignalKind(normalized.kind);

  if (normalized.status === 'rejected') {
    return {
      stability: 'rejected',
      confidence: 1,
      evidenceCount,
      confirmed,
      reasons: ['explicitly-rejected'],
    };
  }

  if (normalized.status === 'deprecated') {
    return {
      stability: 'deprecated',
      confidence: 1,
      evidenceCount,
      confirmed,
      reasons: ['explicitly-deprecated'],
    };
  }

  if (!normalized.content) {
    return {
      stability: 'rejected',
      confidence: 1,
      evidenceCount,
      confirmed,
      reasons: ['empty-content'],
    };
  }

  if (confirmed || normalized.status === 'accepted') {
    return {
      stability: 'stable',
      confidence: Math.max(0.86, normalized.confidence),
      evidenceCount,
      confirmed: true,
      reasons: ['user-confirmed'],
    };
  }

  if (!knownKind) {
    return {
      stability: 'candidate',
      confidence: Math.min(0.55, normalized.confidence),
      evidenceCount,
      confirmed,
      reasons: ['unknown-kind'],
    };
  }

  if (EPISODIC_KINDS.has(normalized.kind)) {
    return {
      stability: 'episodic',
      confidence: Math.max(0.5, Math.min(0.78, normalized.confidence)),
      evidenceCount,
      confirmed,
      reasons: ['episodic-kind'],
    };
  }

  if (evidenceCount >= 2 && normalized.confidence >= 0.65) {
    return {
      stability: 'stable',
      confidence: Math.max(0.78, normalized.confidence),
      evidenceCount,
      confirmed,
      reasons: ['repeated-evidence'],
    };
  }

  if (evidenceCount >= 1 || normalized.confidence >= 0.45) {
    return {
      stability: 'candidate',
      confidence: Math.max(0.45, normalized.confidence),
      evidenceCount,
      confirmed,
      reasons: evidenceCount >= 1 ? ['single-evidence'] : ['low-evidence'],
    };
  }

  return {
    stability: 'candidate',
    confidence: normalized.confidence,
    evidenceCount,
    confirmed,
    reasons: ['low-evidence'],
  };
}

export function recommendMindosHumanModelUpdateAction(
  signal: MindosHumanModelSignal,
  route = routeMindosHumanSignal(signal),
  stability = scoreMindosHumanSignalStability(signal),
): MindosHumanModelUpdateAction {
  const normalized = normalizeMindosHumanSignal(signal);
  if (!normalized.content) return 'ignore';

  switch (stability.stability) {
    case 'rejected':
      return 'ignore';
    case 'deprecated':
      return 'deprecate';
    case 'episodic':
      return 'keep-episodic';
    case 'stable':
      return route.reviewRequired ? 'review' : 'promote';
    case 'candidate':
      return 'review';
  }
}

export function assessMindosHumanSignal(signal: MindosHumanModelSignal): MindosHumanModelSignalAssessment {
  const normalized = normalizeMindosHumanSignal(signal);
  const route = routeMindosHumanSignal(normalized);
  const stability = scoreMindosHumanSignalStability(normalized);
  const action = recommendMindosHumanModelUpdateAction(normalized, route, stability);
  const reasons = uniqueReasons([
    ...stability.reasons,
    ...(route.reviewRequired ? ['high-impact-review' as const] : []),
    ...(route.projection === 'workspace' ? ['workspace-projection' as const] : []),
  ]);

  return {
    signal: normalized,
    route,
    stability,
    action,
    reasons,
  };
}

export function buildMindosHumanModelUpdates({
  signals,
  dedupe = true,
}: BuildMindosHumanModelUpdatesInput): BuildMindosHumanModelUpdatesOutput {
  const seen = new Set<string>();
  const updates: MindosHumanModelSignalAssessment[] = [];

  for (const signal of signals) {
    const assessment = assessMindosHumanSignal(signal);
    if (dedupe) {
      const signature = humanSignalSignature(assessment);
      if (seen.has(signature)) continue;
      seen.add(signature);
    }
    updates.push(assessment);
  }

  return {
    updates,
    stats: {
      totalSignals: signals.length,
      modeledSignals: updates.length,
      ignoredSignals: updates.filter((update) => update.action === 'ignore').length,
      byTarget: countByTarget(updates),
      byAction: countByAction(updates),
    },
  };
}

function normalizeKind(kind: string): string {
  const normalized = kind
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return KIND_ALIASES[normalized] ?? normalized;
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeEvidence(evidence: readonly MindosHumanEvidenceRef[]): readonly MindosHumanEvidenceRef[] {
  return evidence.map((ref) => ({
    ...ref,
    id: ref.id?.trim() || undefined,
    uri: ref.uri?.trim() || undefined,
    quote: ref.quote?.trim() || undefined,
    observedAt: ref.observedAt?.trim() || undefined,
  }));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isUserConfirmed(signal: MindosNormalizedHumanModelSignal): boolean {
  return signal.userConfirmed === true || signal.status === 'accepted' || signal.evidence.some((ref) => ref.confirmedByUser === true);
}

function compactRoute(route: MindosHumanModelRoute): MindosHumanModelRoute {
  return route.workspaceId
    ? route
    : {
        target: route.target,
        projection: route.projection,
        confidence: route.confidence,
        reviewRequired: route.reviewRequired,
        reason: route.reason,
      };
}

function uniqueReasons(reasons: readonly MindosHumanModelUpdateReason[]): readonly MindosHumanModelUpdateReason[] {
  return [...new Set(reasons)];
}

function humanSignalSignature(assessment: MindosHumanModelSignalAssessment): string {
  return [
    assessment.route.target,
    assessment.route.projection,
    assessment.route.workspaceId ?? '',
    assessment.signal.kind,
    assessment.signal.content.toLowerCase(),
  ].join('\u0000');
}

function countByTarget(updates: readonly MindosHumanModelSignalAssessment[]): Readonly<Record<MindosHumanModelTarget, number>> {
  const counts: Record<MindosHumanModelTarget, number> = { dao: 0, fa: 0, shu: 0, qi: 0, echo: 0 };
  for (const update of updates) {
    counts[update.route.target] += 1;
  }
  return counts;
}

function countByAction(updates: readonly MindosHumanModelSignalAssessment[]): Readonly<Record<MindosHumanModelUpdateAction, number>> {
  const counts: Record<MindosHumanModelUpdateAction, number> = {
    promote: 0,
    review: 0,
    'keep-episodic': 0,
    ignore: 0,
    deprecate: 0,
  };
  for (const update of updates) {
    counts[update.action] += 1;
  }
  return counts;
}
