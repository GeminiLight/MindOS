'use client';
import type { LearningLoop } from '@geminilight/mindos/knowledge';
import { readEchoDraft, useEchoDraft } from '../use-echo-draft';
import { initialLearningForm, type LearningFormMode, type LearningFormValues } from './EchoLearningForm';

type WorkspaceDraft = {
  snapshot: LearningLoop;
  values: LearningFormValues;
  editing: LearningFormMode | null;
  unversioned?: boolean;
};
const modes = ['reflect', 'plan', 'review'];
function validValues(value: unknown): value is LearningFormValues {
  return !!value && typeof value === 'object' && ['before', 'understanding', 'situation', 'experiment', 'check', 'reviewOn', 'outcome', 'observation', 'revisedRule']
    .every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}
function validSnapshot(value: unknown, id: string): value is LearningLoop {
  if (!value || typeof value !== 'object') return false;
  const item = value as LearningLoop;
  return item.id === id && Number.isSafeInteger(item.version) && item.version > 0 &&
    ['reflecting', 'planning', 'practicing', 'reviewed'].includes(item.stage) &&
    typeof item.archived === 'boolean' && typeof item.source?.title === 'string' &&
    Array.isArray(item.source.sessions) && Array.isArray(item.attempts) &&
    item.attempts.every(attempt => !!attempt && !!attempt.plan);
}
function initialDraft(loop: LearningLoop): WorkspaceDraft {
  const fallback = { snapshot: loop, values: initialLearningForm(loop), editing: null };
  // Keep existing unsent inputs. Old forms did not always persist their base version,
  // so never silently submit an unversioned legacy draft against a newer record.
  const legacy = readEchoDraft<unknown>(loop.id + ':personal', null);
  if (!validValues(legacy)) return fallback;
  const saved = readEchoDraft<unknown>(loop.id + ':snapshot', null);
  const known = validSnapshot(saved, loop.id);
  const editing = readEchoDraft(loop.id + ':editing', '');
  return { snapshot: known ? saved : loop, values: legacy,
    editing: modes.includes(editing) ? editing as LearningFormMode : null,
    unversioned: !known && loop.version > 1 };
}

/** One atomic local draft keeps the input, editing step and version it was written against together. */
export function useLearningWorkspaceDraft(loop: LearningLoop) {
  const key = loop.id + ':workspace';
  const [stored, setStored, storage] = useEchoDraft<WorkspaceDraft>(key, () => initialDraft(loop));
  const valid = stored && validSnapshot(stored.snapshot, loop.id) && validValues(stored.values) &&
    (stored.editing === null || modes.includes(stored.editing));
  const draft: WorkspaceDraft = valid ? stored : { snapshot: loop, values: initialLearningForm(loop), editing: null };
  function change(patch: Partial<WorkspaceDraft>) { setStored({ ...draft, ...patch }); }
  function adopt(snapshot: LearningLoop, reset: boolean) {
    setStored({ snapshot, values: reset ? initialLearningForm(snapshot) : draft.values,
      editing: reset ? null : draft.editing, unversioned: reset ? false : draft.unversioned });
    if (reset) {
      // A committed form is no longer a draft. Returning must load current server state.
      try {
        for (const suffix of ['workspace', 'snapshot', 'personal', 'editing']) localStorage.removeItem('mindos-echo-draft-v1:' + loop.id + ':' + suffix);
      } catch { /* useEchoDraft reports failed persistence; keep the in-memory form usable. */ }
    }
  }
  return { ...draft, change, adopt, storage };
}
