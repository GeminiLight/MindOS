'use client';
import { Input } from '@/components/ui/input';
import type { LearningLoop } from '@geminilight/mindos/knowledge';
import type { LearningCopy } from './learning-client';

export type LearningFormValues = {
  before: string; understanding: string; situation: string; experiment: string;
  check: string; reviewOn: string; outcome: string; observation: string; revisedRule: string;
};
export type LearningFormMode = 'reflect' | 'plan' | 'review';

export function initialLearningForm(loop: LearningLoop): LearningFormValues {
  const last = loop.attempts.at(-1);
  // A fresh attempt starts with a new situation, not an accidental duplicate of the old plan.
  const plan = loop.stage === 'practicing' ? last?.plan : undefined;
  return {
    before: loop.reflection?.before ?? '', understanding: loop.reflection?.understanding ?? '',
    situation: plan?.situation ?? '', experiment: plan?.action ?? '', check: plan?.check ?? '', reviewOn: plan?.reviewOn ?? '',
    outcome: '', observation: '', revisedRule: '',
  };
}

const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 font-sans text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export default function EchoLearningForm({ mode, values, onChange, p }: {
  mode: LearningFormMode;
  values: LearningFormValues;
  onChange: (name: keyof LearningFormValues, value: string) => void;
  p: LearningCopy;
}) {
  const field = (name: keyof LearningFormValues, label: string, placeholder: string) => (
    <label className="block space-y-2" key={name}>
      <span className="font-sans text-sm font-medium">{label}</span>
      <textarea name={name} rows={3} maxLength={4000} required value={values[name]} placeholder={placeholder}
        className={fieldClass + ' resize-y'} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
  if (mode === 'reflect') return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">{p.reflectHint}</p>
      {field('before', p.before, p.beforePlaceholder)}
      {field('understanding', p.understanding, p.understandingPlaceholder)}
    </div>
  );
  if (mode === 'plan') return (
    <div className="space-y-5">
      {field('situation', p.situation, p.situationPlaceholder)}
      {field('experiment', p.experiment, p.experimentPlaceholder)}
      {field('check', p.check, p.checkPlaceholder)}
      <label className="block space-y-2">
        <span className="font-sans text-sm font-medium">{p.reviewOn}</span>
        <Input type="date" name="reviewOn" required value={values.reviewOn} className="max-w-56 bg-background"
          onChange={(event) => onChange('reviewOn', event.target.value)} />
        <span className="block text-xs text-muted-foreground">{p.dateHint}</span>
      </label>
    </div>
  );
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">{p.practiceHint}</p>
      <label className="block space-y-2">
        <span className="font-sans text-sm font-medium">{p.outcome}</span>
        <select name="outcome" required value={values.outcome} className={fieldClass} onChange={(event) => onChange('outcome', event.target.value)}>
          <option value="">{p.chooseOutcome}</option>
          {Object.entries(p.outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {field('observation', p.observation, p.observationPlaceholder)}
      {field('revisedRule', p.revisedRule, p.revisedRulePlaceholder)}
    </div>
  );
}
