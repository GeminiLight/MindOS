import { z } from 'zod';
import { extractExplicitRoutes } from './extract-options.js';
export { simulateRequestRace } from './race.js';

export interface ReplayMessage { id: string; role: 'user' | 'assistant'; text: string; timestamp?: string; }
export interface ReplaySource { id: string; runtime: 'codex' | 'claude' | 'example'; title: string; project?: string; updatedAt?: number; messages: ReplayMessage[]; }
export interface ReplaySourceSummary extends Omit<ReplaySource, 'messages'> { cwd?: string; }
export interface ReplayRef { messageId: string; quote: string; }
export interface ReplaySignal { label: string; value: string; }
export interface ReplayTradeoff { benefit: string; cost: string; check: string; refs: ReplayRef[]; }
export interface ReplayReconsideration { prompt: string; insight: string; refs: ReplayRef[]; }
export interface ReplayArtifact {
  id:string; title:string; fileName:string; sha256:string; capturedAt:string; modifiedAt:string;
  source:ReplayRef; columns:string[]; rows:string[][];
}
export interface ReplayPrediction { question:string; options:string[]; }
export interface ReplayTransfer { context:string; question:string; options:{id:string;label:string;feedback:string}[]; refs:ReplayRef[]; }
export interface ReplayStep { artifactIds?:string[]; title: string; text: string; refs: ReplayRef[]; signals?: ReplaySignal[]; }
export interface ReplayChoice {
  id: string; label: string; description: string; proposal: ReplayRef;
  outcome: { kind: 'recorded' | 'unobserved' | 'simulation'; title: string; steps: ReplayStep[] };
  nextSceneId?: string;
  tradeoff?: ReplayTradeoff;
  rejoin?: { note: string; refs: ReplayRef[] };
}
export interface ReplayScene { id: string; title: string; context: string; evidence: ReplayRef[]; choices: ReplayChoice[]; reconsideration?: ReplayReconsideration; historicalChoiceId?:string; prediction?:ReplayPrediction; }
export interface BranchStory { id: string; fingerprint: string; title: string; summary: string; source: ReplaySource; scenes: ReplayScene[]; artifacts?:ReplayArtifact[]; transfer?:ReplayTransfer; }
export interface ReplayAttempt { sceneId: string; choiceId: string; visibleSteps: number; selection?:'historical'; }
export interface ReplayState {
  fingerprint: string; sceneIndex: number; choiceId: string | null; visibleSteps: number;
  phase: 'choice' | 'result' | 'complete' | 'unobserved'; attempts: ReplayAttempt[]; historyFrom?:string;
}
export type ReplayAction = { type: 'choose'; choiceId: string } | { type: 'advance' | 'rewind' | 'restart' | 'follow-history' };

const RefSchema = z.object({ messageId: z.string().min(1).max(100), quote: z.string().min(1).max(600) });
const StepSchema = z.object({ artifactIds:z.array(z.string().regex(/^[\w-]{1,60}$/)).max(3).optional(), title: z.string().min(1).max(120), text: z.string().min(1).max(1800), refs: z.array(RefSchema).min(1).max(6), signals:z.array(z.object({label:z.string().min(1).max(70),value:z.string().min(1).max(80)})).min(1).max(4).optional() });
const ChoiceSchema = z.object({
  id: z.string().regex(/^[\w-]{1,60}$/), label: z.string().min(1).max(80), description: z.string().min(1).max(400),
  proposal: RefSchema, outcome: z.object({ kind: z.enum(['recorded', 'unobserved', 'simulation']), title: z.string().min(1).max(160), steps: z.array(StepSchema).max(8) }),
  nextSceneId: z.string().max(60).optional(),
  tradeoff:z.object({benefit:z.string().min(1).max(220),cost:z.string().min(1).max(220),check:z.string().min(1).max(260),refs:z.array(RefSchema).min(1).max(6)}).optional(),
  rejoin:z.object({note:z.string().min(1).max(400),refs:z.array(RefSchema).min(1).max(6)}).optional(),
});
const ArtifactSchema=z.object({
  id:z.string().regex(/^[\w-]{1,60}$/), title:z.string().min(1).max(160),fileName:z.string().min(1).max(160).regex(/^[^/\\]+$/),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),capturedAt:z.string().datetime(),modifiedAt:z.string().datetime(),source:RefSchema,
  columns:z.array(z.string().min(1).max(100)).min(1).max(4),rows:z.array(z.array(z.string().max(1000)).min(1).max(4)).min(1).max(8),
}).refine(a=>a.rows.every(r=>r.length===a.columns.length),'Artifact column counts must match');
const DraftSchema = z.object({
  artifacts:z.array(ArtifactSchema).max(8).optional(),
  transfer:z.object({context:z.string().min(1).max(800),question:z.string().min(1).max(300),options:z.array(z.object({id:z.string().regex(/^[\w-]{1,60}$/),label:z.string().min(1).max(200),feedback:z.string().min(1).max(600)})).min(2).max(4),refs:z.array(RefSchema).min(1).max(6)}).optional(), title: z.string().min(1).max(120), summary: z.string().min(1).max(500), scenes: z.array(z.object({
  id: z.string().regex(/^[\w-]{1,60}$/), title: z.string().min(1).max(160), context: z.string().min(1).max(1000),
  historicalChoiceId:z.string().regex(/^[\w-]{1,60}$/).optional(),
  prediction:z.object({question:z.string().min(1).max(300),options:z.array(z.string().min(1).max(150)).min(2).max(4)}).optional(),
  evidence: z.array(RefSchema).min(1).max(8), choices: z.array(ChoiceSchema).min(2).max(5),
  reconsideration:z.object({prompt:z.string().min(1).max(300),insight:z.string().min(1).max(600),refs:z.array(RefSchema).min(1).max(6)}).optional(),
})).min(1).max(8) });

/** Identity for browser progress only; it is not an integrity/security hash. */
export function replayFingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateBranchStory(source: ReplaySource, raw: unknown): BranchStory {
  if (!/^[\w-]{1,100}$/.test(source.id) || !['codex', 'claude', 'example'].includes(source.runtime)) throw new Error('Invalid source identity');
  const draft = DraftSchema.parse(raw);
  const messages = new Map(source.messages.map(m => [m.id, m]));
  if (messages.size !== source.messages.length) throw new Error('Source message identities must be unique');
  const ids = draft.scenes.map(scene => scene.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate scene identities');
  function checkRef(ref: ReplayRef) {
    const message = messages.get(ref.messageId);
    if (!message) throw new Error(`Source message is missing: ${ref.messageId}`);
    if (!message.text.includes(ref.quote)) throw new Error(`Quote is not present in source message: ${ref.messageId}`);
  }
  const artifacts=new Map(draft.artifacts?.map(a=>[a.id,a])??[]);
  if(artifacts.size!==(draft.artifacts?.length??0))throw new Error('Duplicate artifact identities');
  for(const artifact of artifacts.values()){
    checkRef(artifact.source);
    if(!artifact.source.quote.includes(artifact.fileName))throw new Error('Artifact file must be named in its source');
  }
  draft.transfer?.refs.forEach(checkRef);
  if(draft.transfer&&new Set(draft.transfer.options.map(o=>o.id)).size!==draft.transfer.options.length)throw new Error('Transfer option identities must be unique');
  draft.scenes.forEach((scene, index) => {
    if(scene.historicalChoiceId&&!scene.choices.some(c=>c.id===scene.historicalChoiceId&&c.outcome.kind==='recorded'))throw new Error('History route must be recorded');
    scene.evidence.forEach(checkRef);
    scene.reconsideration?.refs.forEach(checkRef);
    if (new Set(scene.choices.map(c => c.id)).size !== scene.choices.length) throw new Error('Choice identities must be unique');
    for (const choice of scene.choices) {
      checkRef(choice.proposal);
      choice.tradeoff?.refs.forEach(checkRef);
      if (choice.outcome.kind === 'recorded' && choice.outcome.steps.length === 0) throw new Error('Recorded outcomes require evidence refs');
      if (choice.outcome.kind === 'unobserved' && choice.outcome.steps.length !== 0) throw new Error('Unobserved outcomes cannot contain recorded results');
      if (choice.outcome.kind === 'simulation' && source.runtime !== 'example') throw new Error('Real sources cannot be relabelled as simulations');
      choice.outcome.steps.forEach(step => {
        step.refs.forEach(checkRef);
        for(const id of step.artifactIds??[])if(!artifacts.has(id))throw new Error('Missing artifact');
        for(const signal of step.signals??[])if(!step.refs.some(ref=>ref.quote.includes(signal.value)))throw new Error('Signal must be present in its step evidence');
      });
      if(choice.rejoin){
        if(choice.outcome.kind!=='recorded')throw new Error('Only recorded paths can rejoin');
        choice.rejoin.refs.forEach(ref=>{checkRef(ref);if(!choice.outcome.steps.some(step=>step.refs.some(seen=>seen.messageId===ref.messageId&&seen.quote.includes(ref.quote))))throw new Error('Rejoin must reference an observed step');});
      }
      if (choice.nextSceneId && ids.indexOf(choice.nextSceneId) <= index) throw new Error('Next scene must exist and move forward');
    }
  });
  return {
    id: `replay-${source.runtime}-${source.id}`,
    fingerprint: replayFingerprint(JSON.stringify({ draft, messages: source.messages })),
    ...draft, source,
  };
}

export function createReplayState(story: BranchStory): ReplayState {
  return { fingerprint: story.fingerprint, sceneIndex: 0, choiceId: null, visibleSteps: 0, phase: 'choice', attempts: [] };
}

/** A return to documented history is a separate action, never a simulated outcome. */
export function historicalReplayChoice(scene:ReplayScene):ReplayChoice|undefined {
  return scene.historicalChoiceId?scene.choices.find(c=>c.id===scene.historicalChoiceId&&c.outcome.kind==='recorded'):
    scene.choices.find(c=>c.outcome.kind==='recorded'&&c.nextSceneId)??scene.choices.find(c=>c.outcome.kind==='recorded');
}

export function transitionReplay(story: BranchStory, state: ReplayState, action: ReplayAction): ReplayState {
  if (state.fingerprint !== story.fingerprint) throw new Error('The story has changed; restart this replay');
  const scene = story.scenes[state.sceneIndex];
  if (!scene) throw new Error('Invalid replay scene');
  if (action.type === 'restart') return { ...createReplayState(story), attempts: state.attempts };
  if (action.type === 'rewind') return { ...state, historyFrom:undefined, choiceId: null, visibleSteps: 0, phase: 'choice' };
  if(action.type==='follow-history'){
    if(state.phase!=='unobserved'||!state.choiceId)return state;
    const historical=historicalReplayChoice(scene);if(!historical)return state;
    const before=state.attempts.find(a=>a.sceneId===scene.id&&a.choiceId===historical.id);
    const chosen=transitionReplay(story,transitionReplay(story,state,{type:'rewind'}),{type:'choose',choiceId:historical.id});
    const next=transitionReplay(story,chosen,{type:'advance'});
    return {...next,historyFrom:state.choiceId,attempts:next.attempts.map(a=>a.sceneId===scene.id&&a.choiceId===historical.id&&(!before||before.selection==='historical')?{...a,selection:'historical' as const}:a)};
  }
  if (action.type === 'choose') {
    if (state.phase !== 'choice') throw new Error('Return to the fork before selecting another route');
    const choice = scene.choices.find(c => c.id === action.choiceId);
    if (!choice) throw new Error('Unknown choice');
    const attempts = state.attempts.some(a => a.sceneId === scene.id && a.choiceId === choice.id)
      ? state.attempts.map(a=>a.sceneId===scene.id&&a.choiceId===choice.id?{...a,selection:undefined}:a) : [...state.attempts, { sceneId: scene.id, choiceId: choice.id, visibleSteps: 0 }];
    return { ...state, historyFrom:undefined, choiceId: choice.id, visibleSteps: 0, phase: choice.outcome.kind === 'unobserved' ? 'unobserved' : 'result', attempts };
  }
  const choice = scene.choices.find(c => c.id === state.choiceId);
  if (!choice || choice.outcome.kind === 'unobserved') return state;
  if (state.phase === 'complete' && choice.nextSceneId) {
    return { ...state, historyFrom:undefined, sceneIndex: story.scenes.findIndex(s => s.id === choice.nextSceneId), choiceId: null, visibleSteps: 0, phase: 'choice' };
  }
  const visibleSteps = Math.min(state.visibleSteps + 1, choice.outcome.steps.length);
  return {
    ...state, visibleSteps, phase: visibleSteps === choice.outcome.steps.length ? 'complete' : 'result',
    attempts: state.attempts.map(a => a.sceneId === scene.id && a.choiceId === choice.id ? { ...a, visibleSteps: Math.max(a.visibleSteps, visibleSteps) } : a),
  };
}

/** Resume only states possible in this story; never accept a stale/forged cursor. */
export function restoreReplayState(story: BranchStory, raw: unknown): ReplayState {
  try {
    const v = z.object({ fingerprint: z.string(), sceneIndex: z.number().int().nonnegative(), choiceId: z.string().nullable(), visibleSteps: z.number().int().nonnegative(),
      historyFrom:z.string().optional(), phase: z.enum(['choice', 'result', 'complete', 'unobserved']), attempts: z.array(z.object({ sceneId: z.string(), choiceId: z.string(), visibleSteps: z.number().int().nonnegative(), selection:z.literal('historical').optional() })).max(40),
    }).parse(raw);
    const scene = story.scenes[v.sceneIndex];
    const choice = scene?.choices.find(c => c.id === v.choiceId);
    if (v.fingerprint !== story.fingerprint || !scene || (v.phase !== 'choice' && !choice) || v.visibleSteps > (choice?.outcome.steps.length ?? 0)) return createReplayState(story);
    if (v.phase === 'choice' && (v.choiceId !== null || v.visibleSteps !== 0)) return createReplayState(story);
    if (choice && ((v.phase === 'unobserved') !== (choice.outcome.kind === 'unobserved') || (v.phase === 'complete' && v.visibleSteps !== choice.outcome.steps.length))) return createReplayState(story);
    if(v.historyFrom&&(!choice||historicalReplayChoice(scene)?.id!==choice.id||!v.attempts.some(a=>a.sceneId===scene.id&&a.choiceId===v.historyFrom&&scene.choices.find(c=>c.id===a.choiceId)?.outcome.kind==='unobserved')))return createReplayState(story);
    const seen = new Set<string>();
    for (const a of v.attempts) {
      const c = story.scenes.find(s => s.id === a.sceneId)?.choices.find(c => c.id === a.choiceId);
      const key = `${a.sceneId}:${a.choiceId}`;
      if (!c || (a.selection==='historical'&&c.outcome.kind!=='recorded') || a.visibleSteps > c.outcome.steps.length || seen.has(key)) return createReplayState(story);
      seen.add(key);
    }
    return v;
  } catch { return createReplayState(story); }
}

function compact(text: string, limit: number): string { return text.replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function ref(message: ReplayMessage): ReplayRef { return { messageId: message.id, quote: message.text.trim().slice(0, 400) }; }

/** Offline fallback: reconstruct explicit corrections, never invent executed alternatives. */
export function extractBranchStory(source: ReplaySource): BranchStory | null {
  const routes=extractExplicitRoutes(source);
  if(routes.length) return validateBranchStory(source,{title:compact(source.title,80),summary:'从会话明确提出的路径开始，回看有原文支持的后续。',scenes:routes});
  const scenes: ReplayScene[] = [];
  const rows = source.messages;
  for (let i = 1; i < rows.length - 1 && scenes.length < 5; i++) {
    const feedback = rows[i];
    if (!feedback) continue;
    if (feedback.role !== 'user' || !/(不是|不是什么|不想|不需要|好怪|变化.*大|不要|不合适|instead|too much|rather than)/i.test(feedback.text)) continue;
    const before = rows.slice(0, i).reverse().find(m => m.role === 'assistant' && m.text.length > 20);
    const after = rows.slice(i + 1).find(m => m.role === 'assistant' && m.text.length > 20);
    const context = rows.slice(0, i).reverse().find(m => m.role === 'user') ?? feedback;
    if (!before || !after) continue;
    const id = `fork-${scenes.length + 1}`;
    scenes.push({ id, title: '面对这次反馈，你会怎样调整？', context: compact(context.text, 360), evidence: [ref(context)], choices: [
      { id: 'original', label: '沿着最初的方向', description: compact(before.text, 180), proposal: ref(before),
        outcome: { kind: 'recorded', title: '会话里出现了新的约束', steps: [{ title: '用户提出了纠偏', text: compact(feedback.text, 700), refs: [ref(feedback)] }] } },
      { id: 'revised', label: '看看后来怎样调整', description: compact(after.text, 180), proposal: ref(after),
        outcome: { kind: 'recorded', title: '后续方案发生了变化', steps: [
          { title: '变化来自这条反馈', text: compact(feedback.text, 700), refs: [ref(feedback)] },
          { title: 'Agent 调整了方案', text: compact(after.text, 1000), refs: [ref(after)] },
        ] } },
    ] });
  }
  if (!scenes.length) return null;
  for (let i = 0; i < scenes.length - 1; i++) {
    const current = scenes[i]?.choices[1]; const next = scenes[i + 1];
    if (current && next) current.nextSceneId = next.id;
  }
  return validateBranchStory(source, { title: compact(source.title, 80), summary: '从原始会话中的反馈与调整，重新走一次判断过程。', scenes });
}
