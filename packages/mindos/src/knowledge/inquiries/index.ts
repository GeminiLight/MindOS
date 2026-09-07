import { withPrivateRecordLock } from '../private-records.js';
import { startLearningCorrection } from '../learning/index.js';
import {
  createSchema,
  commandSchema,
  prepareSchema,
  frameContentSchema,
  fingerprint,
  hashText,
  type Inquiry,
} from './model.js';
import { read, write, checkTime, fail, mutate } from './storage.js';
import { inquiryRuns, captureRuns } from './runs.js';
import {
  linkInquiryMethod,
  linkedInquiryMethod,
  prepareLinkedInquiryMethod,
  reviseInquiryMethod,
} from './methods.js';
export { inquiryMethodOptions } from './methods.js';
export { listInquiries } from './storage.js';
export { inquiryRuns } from './runs.js';
export type { Inquiry, InquiryDraft, InquiryRun } from './model.js';
export const getInquiry = read;
export function createInquiry(
  root: string,
  input: unknown,
  now = new Date(),
): Inquiry {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid', 'Choose a completed reply as the source.');
  checkTime(now);
  return withPrivateRecordLock(root, () => {
    const command = parsed.data;
    const id = 'inquiry-' + fingerprint(command.requestId).slice(0, 24);
    const creationHash = fingerprint(command);
    const existing = read(root, id);
    if (existing) {
      if (existing.creationHash !== creationHash)
        fail('conflict', 'This request already has a different source.');
      return existing;
    }
    const q: Inquiry = {
      schemaVersion: 1,
      id,
      version: 1,
      creationHash,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      locale: command.locale,
      source: command.source,
      archived: false,
      draft: {
        question: command.source.question,
        explanationA: '',
        explanationB: '',
        distinction: '',
        capability: '',
      },
      frames: [],
      plans: [],
      preparations: [],
      runs: [],
      observations: [],
      decisions: [],
      commands: [],
    };
    write(root, q);
    return q;
  });
}
export function updateInquiry(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
): Inquiry {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      'invalid',
      'Complete the required question fields with valid text.',
    );
  const c = parsed.data;
  return mutate(root, id, c, now, (q) => {
    if (q.archived && c.action !== 'archive')
      fail('conflict', 'Restore this question before changing it.');
    const at = now.toISOString();
    switch (c.action) {
      case 'link-method':
        linkInquiryMethod(root, q, c, now);
        break;
      case 'method-revision':
        reviseInquiryMethod(root, q, c, now);
        break;
      case 'save-draft':
        if (!q.draft)
          fail('conflict', 'Start a revision before editing this saved frame.');
        q.draft = c.draft;
        break;
      case 'commit-frame': {
        const value = frameContentSchema.safeParse(q.draft);
        if (
          !value.success ||
          value.data.explanationA === value.data.explanationB
        )
          fail(
            'invalid',
            'Write two different explanations and evidence that distinguishes them.',
          );
        q.frames.push({
          ...value.data,
          id: 'frame-' + (q.frames.length + 1),
          authorship: 'human',
          createdAt: at,
          ...(q.draftOf ? { basedOn: q.draftOf } : {}),
        });
        q.draft = null;
        delete q.draftOf;
        break;
      }
      case 'revise': {
        if (q.draft)
          fail('conflict', 'Save and commit the current draft first.');
        const f = q.frames.find((f) => f.id === c.frameId);
        if (!f) fail('invalid', 'Choose a saved frame.');
        const last = q.decisions.filter((d) => d.frameId === f.id).at(-1);
        q.draft = {
          question: last?.nextQuestion ?? f.question,
          explanationA: f.explanationA,
          explanationB: f.explanationB,
          distinction: f.distinction,
          capability: f.capability,
        };
        q.draftOf = f.id;
        break;
      }
      case 'plan': {
        if (
          c.methodLinkId &&
          linkedInquiryMethod(q, c.methodLinkId).frameId !== c.frameId
        )
          fail('invalid', 'Choose a method linked to this framing.');
        if (q.draft || !q.frames.some((f) => f.id === c.frameId))
          fail('conflict', 'Commit your frame before planning a test.');
        if (c.supportsA === c.supportsB)
          fail(
            'invalid',
            'Describe different observations that would support each explanation.',
          );
        const {
          action: _action,
          requestId: _requestId,
          version: _version,
          ...content
        } = c;
        q.plans.push({
          ...content,
          id: 'plan-' + (q.plans.length + 1),
          createdAt: at,
        });
        break;
      }
      case 'capture':
        captureRuns(root, q);
        break;
      case 'observe': {
        if (!q.plans.some((p) => p.id === c.planId))
          fail('invalid', 'Choose a saved test plan.');
        if (c.kind === 'run') {
          if (!c.runId || c.sourceLabel)
            fail('invalid', 'Choose an actual run as the observation source.');
          const run = inquiryRuns(root, q).find((r) => r.runId === c.runId);
          if (
            !run ||
            run.status !== 'completed' ||
            !run.completedAt ||
            !run.output.includes(c.quote) ||
            !q.preparations.some(
              (p) => p.id === run.preparationId && p.planId === c.planId,
            )
          )
            fail(
              'conflict',
              'Quote a completed matching run. Failed or unrelated runs cannot support this observation.',
            );
          if (!q.runs.some((r) => r.runId === run.runId)) {
            const { source: _source, ...saved } = run;
            q.runs.push(saved);
          }
        } else if (!c.sourceLabel || c.runId)
          fail('invalid', 'Identify this user-provided observation.');
        const {
          action: _action,
          requestId: _requestId,
          version: _version,
          ...content
        } = c;
        q.observations.push({
          ...content,
          id: 'observation-' + (q.observations.length + 1),
          recordedAt: at,
        });
        break;
      }
      case 'decide': {
        if (!q.frames.some((f) => f.id === c.frameId) || q.draft)
          fail(
            'conflict',
            'Commit your current frame before recording a decision.',
          );
        if (
          new Set(c.evidenceIds).size !== c.evidenceIds.length ||
          c.evidenceIds.some((id) => {
            const o = q.observations.find((o) => o.id === id);
            return (
              !o ||
              !q.plans.some((p) => p.id === o.planId && p.frameId === c.frameId)
            );
          })
        )
          fail('invalid', 'Choose observations for this frame.');
        if (
          (c.outcome !== 'open' && !c.evidenceIds.length) ||
          (c.outcome === 'reframe' ? !c.nextQuestion : !!c.nextQuestion)
        )
          fail(
            'invalid',
            'Link evidence to a decision, and write the new question when reframing.',
          );
        const {
          action: _action,
          requestId: _requestId,
          version: _version,
          ...content
        } = c;
        q.decisions.push({
          ...content,
          id: 'decision-' + (q.decisions.length + 1),
          recordedAt: at,
        });
        break;
      }
      case 'method-draft': {
        const decision = q.decisions.find((d) => d.id === c.decisionId);
        if (decision?.methodRevision)
          fail(
            'conflict',
            'This decision already proposed a revision of an existing method.',
          );
        if (
          !decision ||
          decision.outcome === 'open' ||
          !decision.evidenceIds.length ||
          q.draft
        )
          fail('conflict', 'Record an evidence-linked decision first.');
        const f = q.frames.find((f) => f.id === decision.frameId)!;
        const loop = startLearningCorrection(
          root,
          {
            cardId: q.id + ':' + decision.id,
            title: c.behavior.slice(0, 100),
            content:
              'Question excerpt:\n' +
              f.question.slice(0, 2200) +
              '\nDecision:\n' +
              decision.reason +
              '\nSource: ' +
              q.id +
              '/' +
              decision.id,
            sessions: [
              {
                id: q.source.sessionId,
                messageRefs: [
                  {
                    messageIndex: q.source.messageIndex,
                    role: 'assistant',
                    quote: q.source.quote,
                  },
                ],
              },
            ],
          },
          { behavior: c.behavior, scope: c.scope, check: c.check },
          now,
        );
        decision.methodDraftId = loop.id;
        break;
      }
      case 'archive':
        q.archived = c.archived;
        break;
    }
  }).inquiry;
}
export function prepareInquiry(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid', 'Choose a saved frame or test to prepare.');
  const command = { ...parsed.data, action: 'prepare' };
  const c = parsed.data;
  const { inquiry, result } = mutate(root, id, command, now, (q) => {
    if (q.archived || q.draft)
      fail('conflict', 'Commit your own frame before asking for help.');
    const plan = c.planId ? q.plans.find((p) => p.id === c.planId) : undefined;
    const frame = q.frames.find(
      (f) => f.id === (plan?.frameId ?? c.frameId ?? q.frames.at(-1)?.id),
    );
    if (
      !frame ||
      (c.kind === 'test'
        ? !plan || (c.frameId && c.frameId !== plan.frameId)
        : !!c.planId)
    )
      fail('invalid', 'Choose a matching saved frame and test.');
    const methodPath = plan?.methodLinkId
      ? prepareLinkedInquiryMethod(
          root,
          linkedInquiryMethod(q, plan.methodLinkId),
        )
      : undefined;
    const prepId = 'preparation-' + (q.preparations.length + 1);
    const prompt =
      (q.locale === 'zh'
        ? c.kind === 'test'
          ? '请执行下面的检验，明确实际完成的部分、观察和局限。不要把计划或无法获取的结果当作已经执行的证据。'
          : '请审视用户保存的竞争解释，指出遗漏条件并提出可区分解释的证据。保留有依据的分歧，不替用户下最终结论。'
        : c.kind === 'test'
          ? 'Carry out the test below. Distinguish what you actually executed, observed and could not verify. Do not present a plan or unavailable results as execution evidence.'
          : 'Examine the user-authored competing explanations. Identify missing conditions and discriminating evidence. Preserve grounded disagreement and leave the final decision to the user.') +
      '\n\n' +
      (plan
        ? [plan.task, plan.scope, plan.budget].join('\n\n')
        : [
            frame.question,
            'A: ' + frame.explanationA,
            'B: ' + frame.explanationB,
            frame.distinction,
          ].join('\n\n')) +
      '\n\n[inquiry: ' +
      q.id +
      '; preparation: ' +
      prepId +
      ']';
    q.preparations.push({
      id: prepId,
      requestId: c.requestId,
      frameId: frame.id,
      ...(plan ? { planId: plan.id } : {}),
      ...(plan?.methodLinkId ? { methodLinkId: plan.methodLinkId } : {}),
      kind: c.kind,
      preparedAt: now.toISOString(),
      prompt,
      queryHash: hashText(prompt),
    });
    return methodPath;
  });
  const prep = inquiry.preparations.find((p) => p.requestId === c.requestId)!;
  if (inquiry.archived)
    fail('conflict', 'Restore this question before preparing a task.');
  const attachedFiles = prep.methodLinkId
    ? [
        result ??
          prepareLinkedInquiryMethod(
            root,
            linkedInquiryMethod(inquiry, prep.methodLinkId),
          ),
      ]
    : undefined;
  return {
    inquiry,
    draft: {
      prompt: prep.prompt,
      preparationId: prep.id,
      ...(attachedFiles ? { attachedFiles } : {}),
    },
  };
}
