import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
const timestamp = z.string().datetime();
export const learningIdSchema = z.string().regex(/^learn-[a-f0-9]{24}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export const learningSourceSchema = z.object({
  cardId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  content: text,
  sessions: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().max(200).optional(),
    messageRefs: z.array(z.object({
      messageIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      role: z.string().min(1).max(40),
      quote: z.string().trim().min(1).max(1000),
    })).min(1).max(100),
  })).min(1).max(50),
});
const reflectionSchema = z.object({ before: text, understanding: text });
const planSchema = z.object({ situation: text, action: text, check: text, reviewOn: day });
// Self-reported outcomes describe a particular attempt, never a score for the person.
const reviewSchema = z.object({
  outcome: z.enum(['helped', 'mixed', 'did-not-help', 'not-tried']),
  observation: text,
  revisedRule: text,
});
export const agentText = z.string().trim().min(1).max(1600);
const agentOutcome = z.enum(['followed', 'mixed', 'not-followed', 'uncertain']);
export const methodTransitionSchema = z.object({
  id: z.string().uuid(), action: z.enum(['pause-agent', 'resume-agent']), reason: agentText, recordedAt: timestamp,
});
export const inquiryRevisionOriginSchema = z.object({
  inquiryId: z.string().regex(/^inquiry-[a-f0-9]{24}$/),
  decisionId: z.string().regex(/^decision-[1-9][0-9]{0,2}$/),
  linkId: z.string().regex(/^method-[1-9][0-9]{0,2}$/),
  commandHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const methodVersionSchema = z.object({
  inquiryOrigin: inquiryRevisionOriginSchema.optional(),
  behavior: agentText, scope: agentText, check: agentText, proposedAt: timestamp,
  review: z.object({
    cardId: z.string(), decision: z.enum(['approved', 'rejected']), reviewedAt: timestamp,
    candidateHash: z.string(), assetId: z.string().optional(), targetPath: z.string().optional(),
  }).optional(),
  availability: z.enum(['active', 'deprecated', 'unavailable']).optional(),
  transitions: z.array(methodTransitionSchema).max(100).optional(),
  counterexamples: z.array(z.object({ observation: text, recordedAt: timestamp, receiptId: z.string().max(120).optional() })).max(100).optional(),
  observations: z.array(z.object({ receiptId: z.string().min(1).max(120), outcome: agentOutcome, observation: text, recordedAt: timestamp })).max(100),
});
export const agentChangeSchema = methodVersionSchema.extend({
  revisions: z.array(methodVersionSchema.extend({ revisionReason: agentText })).max(99).optional(),
});
const attemptSchema = z.object({
  agentChange: agentChangeSchema.optional(),
  rule: text,
  plan: planSchema,
  plannedAt: timestamp,
  review: reviewSchema.extend({ reviewedAt: timestamp }).optional(),
});
export const learningLoopSchema = z.object({
  schemaVersion: z.literal(1),
  id: learningIdSchema,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: timestamp,
  updatedAt: timestamp,
  stage: z.enum(['reflecting', 'planning', 'practicing', 'reviewed']),
  archived: z.boolean(),
  source: learningSourceSchema,
  reflection: reflectionSchema.optional(),
  directMethod: agentChangeSchema.optional(),
  attempts: z.array(attemptSchema).max(100),
}).refine((loop) => {
  const last = loop.attempts.at(-1);
  if (loop.stage === 'reflecting') return !loop.reflection && loop.attempts.length === 0;
  if (!loop.reflection) return false;
  if (loop.attempts.slice(0, -1).some((attempt) => !attempt.review)) return false;
  if (loop.stage === 'planning') return !last || !!last.review;
  return !!last && (loop.stage === 'reviewed' ? !!last.review : !last.review);
}, 'Inconsistent learning state');

const attemptIndex = z.number().int().min(-1).max(99);
const revisionIndex = z.number().int().min(0).max(99).optional();
const receiptId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const learningCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('propose-agent'), version, attemptIndex, behavior: agentText, scope: agentText, check: agentText }),
  z.object({ action: z.literal('approve-agent'), version, attemptIndex, revisionIndex }),
  z.object({ action: z.literal('reject-agent'), version, attemptIndex, revisionIndex }),
  z.object({ action: z.literal('observe-agent'), version, attemptIndex, revisionIndex, receiptId, outcome: agentOutcome, observation: text }),
  z.object({ action: z.literal('counterexample-agent'), version, attemptIndex, revisionIndex, observation: text, receiptId: receiptId.optional() }),
  z.object({ action: z.literal('pause-agent'), version, attemptIndex, revisionIndex, reason: agentText }),
  z.object({ action: z.literal('resume-agent'), version, attemptIndex, revisionIndex, reason: agentText }),
  z.object({ action: z.literal('revise-agent'), version, attemptIndex, revisionIndex, reason: agentText, behavior: agentText, scope: agentText, check: agentText }),
  reflectionSchema.extend({ action: z.literal('reflect'), version }),
  // "action" is the command discriminant; the plan's action travels as "experiment".
  z.object({ action: z.literal('plan'), version, situation: text, experiment: text, check: text, reviewOn: day }),
  reviewSchema.extend({ action: z.literal('review'), version }),
  z.object({ action: z.literal('retry'), version }),
  z.object({ action: z.literal('archive'), version }),
  z.object({ action: z.literal('restore'), version }),
]);
export type LearningLoop = z.infer<typeof learningLoopSchema>;
export type LearningSource = z.infer<typeof learningSourceSchema>;
export type LearningCommand = z.infer<typeof learningCommandSchema>;
export type LearningAttempt = LearningLoop['attempts'][number];
export type LearningMethod = NonNullable<LearningAttempt['agentChange']>;
export function learningMethodAt(loop: LearningLoop, index: number, revisionIndex = 0): LearningMethod | undefined {
  const family = index === -1 ? loop.directMethod : loop.attempts[index]?.agentChange;
  return revisionIndex === 0 ? family : family?.revisions?.[revisionIndex - 1];
}
export function learningMethods(loop: LearningLoop): Array<{ attemptIndex: number; revisionIndex: number; method: LearningMethod }> {
  const families = [
    ...(loop.directMethod ? [{ attemptIndex: -1, method: loop.directMethod }] : []),
    ...loop.attempts.flatMap((attempt, attemptIndex) => attempt.agentChange ? [{ attemptIndex, method: attempt.agentChange }] : []),
  ];
  return families.flatMap(({ attemptIndex, method }) => [method, ...(method.revisions ?? [])].map((item, revisionIndex) => ({ attemptIndex, revisionIndex, method: item })));
}

export class LearningError extends Error {
  constructor(public code: 'invalid' | 'not-found' | 'conflict' | 'storage', message: string) {
    super(message);
    this.name = 'LearningError';
  }
}

export function applyLearningCommand(loop: LearningLoop, command: LearningCommand, now: string): LearningLoop {
  if (command.version !== loop.version) throw new LearningError('conflict', 'This record changed. Reload before saving.');
  const next = structuredClone(loop);
  const last = next.attempts.at(-1);
  const requireState = (allowed: boolean) => {
    if (!allowed) throw new LearningError('conflict', 'This action is unavailable at the current learning step.');
  };
  if (command.action === 'archive' || command.action === 'restore') {
    next.archived = command.action === 'archive';
  } else {
    requireState(!loop.archived);
    switch (command.action) {
      case 'propose-agent': {
        const attempt = next.attempts[command.attemptIndex];
        requireState(!!attempt?.review && !attempt.agentChange);
        attempt!.agentChange = { behavior: command.behavior, scope: command.scope, check: command.check, proposedAt: now, observations: [] };
        break;
      }
      case 'approve-agent':
      case 'reject-agent':
        requireState(!!learningMethodAt(next, command.attemptIndex, command.revisionIndex) && !learningMethodAt(next, command.attemptIndex, command.revisionIndex)!.review);
        break; // The store performs the authorized publication under the record lock.
      case 'revise-agent': {
        const family = learningMethodAt(next, command.attemptIndex);
        const versions = family ? [family, ...(family.revisions ?? [])] : [];
        const base = learningMethodAt(next, command.attemptIndex, command.revisionIndex);
        requireState(!!base?.review && (command.revisionIndex ?? 0) === versions.length - 1 && versions.every((item) => !!item.review) && versions.length < 100);
        requireState(['behavior', 'scope', 'check'].some((key) => base![key as 'behavior'] !== command[key as 'behavior']));
        (family!.revisions ??= []).push({ behavior: command.behavior, scope: command.scope, check: command.check, revisionReason: command.reason, proposedAt: now, observations: [] });
        break;
      }
      case 'pause-agent':
      case 'resume-agent': {
        const method = learningMethodAt(next, command.attemptIndex, command.revisionIndex);
        requireState(method?.review?.decision === 'approved' && (method.transitions?.length ?? 0) < 100);
        requireState(method!.availability === (command.action === 'pause-agent' ? 'active' : 'deprecated'));
        break; // Registry status and recovery marker commit together in the store.
      }
      case 'counterexample-agent': {
        const method = learningMethodAt(next, command.attemptIndex, command.revisionIndex);
        requireState(method?.review?.decision === 'approved' && (method.counterexamples?.length ?? 0) < 100);
        requireState(!method!.counterexamples?.some((item) => item.observation === command.observation && item.receiptId === command.receiptId));
        (method!.counterexamples ??= []).push({ observation: command.observation, recordedAt: now, ...(command.receiptId ? { receiptId: command.receiptId } : {}) });
        break;
      }
      case 'observe-agent': {
        const change = learningMethodAt(next, command.attemptIndex, command.revisionIndex);
        requireState(change?.review?.decision === 'approved');
        requireState(change!.observations.length < 100 && !change!.observations.some((item) => item.receiptId === command.receiptId));
        change!.observations.push({ receiptId: command.receiptId, outcome: command.outcome, observation: command.observation, recordedAt: now });
        break; // The store validates receipt provenance before persisting.
      }
      case 'reflect':
        requireState(loop.stage === 'reflecting' || (loop.stage === 'planning' && !last));
        next.reflection = { before: command.before, understanding: command.understanding };
        next.stage = 'planning';
        break;
      case 'plan': {
        requireState(loop.stage === 'planning' || loop.stage === 'practicing');
        const plan = { situation: command.situation, action: command.experiment, check: command.check, reviewOn: command.reviewOn };
        if (loop.stage === 'practicing' && last) {
          last.plan = plan;
        } else {
          if (next.attempts.length >= 100) throw new LearningError('invalid', 'This record has reached 100 attempts. Export it before starting a new insight.');
          next.attempts.push({ rule: last?.review?.revisedRule ?? loop.reflection!.understanding, plan, plannedAt: now });
        }
        next.stage = 'practicing';
        break;
      }
      case 'review':
        requireState(loop.stage === 'practicing' && !!last);
        last!.review = { outcome: command.outcome, observation: command.observation, revisedRule: command.revisedRule, reviewedAt: now };
        next.stage = 'reviewed';
        break;
      case 'retry':
        requireState(loop.stage === 'reviewed');
        next.stage = 'planning';
        break;
    }
  }
  next.version += 1;
  next.updatedAt = now;
  return learningLoopSchema.parse(next);
}

export function learningMarkdown(loop: LearningLoop, locale: 'en' | 'zh' = 'en'): string {
  const p = locale === 'zh' ? {
    intro: '实践记录 · 记录自己的观察，不代表已测量的能力提升。',
    identity: '记录', card: '来源洞察', created: '创建时间', source: '起始洞察', understanding: '我的理解',
    before: '原先的判断', now: '现在的理解', attempt: '尝试', rule: '要检验的理解',
    situation: '实践情境', action: '这一次的行动', check: '观察标准', reviewOn: '回看日期',
    outcome: '自己记录的结果', observation: '实际发生的事', revisedRule: '下次的方法', reviewedAt: '复盘时间',
    waiting: '等待复盘。',
    outcomes: { helped: '有帮助', mixed: '部分有帮助', 'did-not-help': '没有帮助', 'not-tried': '还没尝试' },
  } : {
    intro: 'Learning journal · User-reported observations, not a measured ability score.',
    identity: 'Record', card: 'Source card', created: 'Created at', source: 'Source insight', understanding: 'My understanding',
    before: 'Before', now: 'Now', attempt: 'Attempt', rule: 'Rule',
    situation: 'Situation', action: 'Action', check: 'What to observe', reviewOn: 'Review on',
    outcome: 'Self-reported outcome', observation: 'Observed', revisedRule: 'Revised rule', reviewedAt: 'Reviewed at',
    waiting: 'Awaiting reflection.',
    outcomes: { helped: 'Helped', mixed: 'Partly helped', 'did-not-help': 'Did not help', 'not-tried': 'Not tried yet' },
  };
  const quote = (value: string) => value.split('\n').map((line) => '> ' + line).join('\n');
  const field = (label: string, value: string) => [label + ':', value, ''];
  const renderMethod = (family: LearningMethod, level: string) => [family, ...(family.revisions ?? [])].flatMap((method, index) => [
    level + ' ' + (locale === 'zh' ? '方法版本' : 'Method version') + ' ' + (index + 1), '',
    ...field(locale === 'zh' ? '行为' : 'Behavior', method.behavior),
    ...field(locale === 'zh' ? '适用范围与例外' : 'Scope and exceptions', method.scope),
    ...field(locale === 'zh' ? '观察标准' : 'Check', method.check),
    ...('revisionReason' in method ? field(locale === 'zh' ? '修订原因' : 'Revision reason', String(method.revisionReason)) : []),
    ...field(locale === 'zh' ? '审核' : 'Review', method.review?.decision ?? 'pending'),
    ...(method.availability ? field(locale === 'zh' ? '使用资格' : 'Availability', method.availability) : []),
    ...(method.review?.targetPath ? [method.review.targetPath, ''] : []),
    ...method.observations.flatMap((item) => [
      (locale === 'zh' ? '用户观察（不代表自动验证）' : 'User observation (not automatic verification)') + ': ' + item.outcome,
      item.receiptId + ' · ' + item.recordedAt, item.observation, '',
    ]),
    ...(method.transitions ?? []).flatMap((item) => [item.action + ' · ' + item.recordedAt, item.reason, '']),
    ...(method.counterexamples ?? []).flatMap((item) => [
      locale === 'zh' ? '用户记录的反例（未经独立评估）' : 'User-reported counterexample (not independently assessed)',
      item.observation, item.receiptId ?? '', item.recordedAt, '',
    ]),
  ]);
  return [
    '# ' + loop.source.title, '',
    p.intro, '', p.identity + ': ' + loop.id, p.card + ': ' + loop.source.cardId, p.created + ': ' + loop.createdAt, '',
    '## ' + p.source, '', quote(loop.source.content), '',
    ...loop.source.sessions.flatMap((session) => [
      '### ' + (session.title || session.id), '',
      ...session.messageRefs.map((ref) => session.id + ' · ' + ref.role + ' #' + (ref.messageIndex + 1) + '\n\n' + quote(ref.quote) + '\n'),
    ]),
    ...(loop.directMethod ? [
      '## ' + (locale === 'zh' ? '来自工作现场的方法' : 'Method from a work correction'), '',
      ...renderMethod(loop.directMethod, '###'),
    ] : []),
    ...(loop.reflection ? ['## ' + p.understanding, '', ...field(p.before, loop.reflection.before), ...field(p.now, loop.reflection.understanding)] : []),
    ...loop.attempts.flatMap((attempt, index) => [
      '## ' + p.attempt + ' ' + (index + 1), '', ...field(p.rule, attempt.rule),
      ...field(p.situation, attempt.plan.situation), ...field(p.action, attempt.plan.action),
      ...field(p.check, attempt.plan.check), ...field(p.reviewOn, attempt.plan.reviewOn),
      ...(attempt.review ? [
        ...field(p.outcome, p.outcomes[attempt.review.outcome]), ...field(p.observation, attempt.review.observation),
        ...field(p.revisedRule, attempt.review.revisedRule), ...field(p.reviewedAt, attempt.review.reviewedAt),
      ] : [p.waiting, '']),
      ...(attempt.agentChange ? [
        '### ' + (locale === 'zh' ? 'Agent 的方法' : 'Agent method'), '',
        ...renderMethod(attempt.agentChange, '####'),
      ] : []),
    ]),
  ].join('\n');
}
