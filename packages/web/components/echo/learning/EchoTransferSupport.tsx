'use client';
import type { getTransferMethods, TransferView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
export type PracticeMethod = ReturnType<typeof getTransferMethods>[number];
export type MatchDraft = { selected: string; reason: string; confirmed: boolean };
export const emptyMatchDraft: MatchDraft = { selected: '', reason: '', confirmed: false };
const field = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const disclosure = 'min-h-11 cursor-pointer rounded py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const copy = {
  zh: {
    method: '这次想练习哪条方法？', sample: '先做普通示例练习',
    target: '这套材料练习：辨认比较方式、解释替代原因，并让结论与证据相称。其他能力需要不同的材料。',
    reason: '这条方法与上述能力有什么关系？', confirm: '我已核对适用范围，愿意用这套示例练习它',
    fit: '这是你确认的练习关联，不代表题包已经通过独立审核或难度校准。', linked: '关联的方法',
    help: '这次实际获得的帮助', refresh: '检查 Agent 是否已回复', empty: '尚未找到匹配的运行。请先在新会话中发送已准备的问题，再回来检查。',
    open: '查看并保存这条回复', failure: '查看并保存失败原因', viewed: '已留存', returned: '已返回，尚未查看', active: '正在运行', failed: '未收到可用回复',
    detail: '查看运行信息', failedHint: '这次没有获得可用帮助。可以检查 Agent 连接，再准备一次请教。',
    note: '查看会留存回复与请求时间，不证明已经阅读、采用或学会。仅匹配这条请教任务，最近运行可能过期。',
    limit: '最多留存八条结果；已有结果仍可回看。',
  },
  en: {
    method: 'Which method do you want to practice?', sample: 'Try the general sample practice',
    target: 'This material practices identifying comparisons, explaining alternatives and calibrating conclusions to evidence. Other abilities need different materials.',
    reason: 'How does this method relate to that ability?', confirm: 'I reviewed its scope and want to try this sample with it',
    fit: 'This is your declared practice match, not an independently reviewed or calibrated task pack.', linked: 'Linked method',
    help: 'Help actually received', refresh: 'Check for Agent replies', empty: 'No matching run yet. Send the prepared question in its new conversation, then check here.',
    open: 'View and save this reply', failure: 'View and save the failure', viewed: 'Saved for review', returned: 'Returned, not yet viewed', active: 'Running', failed: 'No usable reply',
    detail: 'View run information', failedHint: 'This attempt did not provide usable help. Check the Agent connection and prepare another question.',
    note: 'Viewing saves the reply and request time; it does not establish reading, adoption or learning. Only this question is matched, and recent runs can expire.',
    limit: 'Save up to eight results. Previously saved results remain available.',
  },
};
export function TransferMethodMatch({ methods, draft, change, locale, busy }: {
  methods: PracticeMethod[]; draft: MatchDraft; change: (value: MatchDraft) => void; locale: 'en' | 'zh'; busy: boolean;
}) {
  const p = copy[locale];
  const selected = methods.find(item => `${item.attemptIndex}:${item.revisionIndex}` === draft.selected);
  return <fieldset disabled={busy} className="min-w-0 space-y-3">
    <p className="text-sm leading-6 text-muted-foreground">{p.target}</p>
    {methods.length ? <>
      <label className="block space-y-2"><span className="text-sm">{p.method}</span><select name="transferMethod" className={field} value={draft.selected} onChange={event => change({ selected: event.target.value, reason: '', confirmed: false })}>
        <option value="">{p.sample}</option>
        {methods.map(item => <option key={`${item.attemptIndex}:${item.revisionIndex}`} value={`${item.attemptIndex}:${item.revisionIndex}`}>{item.behavior} · v{item.revisionIndex + 1}</option>)}
      </select></label>
      {selected ? <>
        <p className="border-l-2 border-border pl-3 text-sm leading-6">{selected.scope}</p>
        <label className="block space-y-2"><span className="text-sm">{p.reason}</span><textarea name="transferMatchReason" className={field} rows={3} maxLength={1600} value={draft.reason} onChange={event => change({ ...draft, reason: event.target.value })} /></label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input name="transferMatchConfirmed" type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring" checked={draft.confirmed} onChange={event => change({ ...draft, confirmed: event.target.checked })} /><span>{p.confirm}</span></label>
        <p className="text-xs leading-5 text-muted-foreground">{p.fit}</p>
      </> : null}
    </> : null}
  </fieldset>;
}
export function TransferMethodIdentity({ view, locale }: { view: TransferView; locale: 'en' | 'zh' }) {
  if (!view.method) return null;
  const p = copy[locale];
  return <details className="border-b border-border"><summary className={disclosure}>{p.linked} · {view.method.title} · v{view.method.revisionIndex + 1}</summary>
    <p className="whitespace-pre-wrap break-words text-sm leading-6">{view.method.reason}</p><p className="py-2 text-xs leading-5 text-muted-foreground">{p.fit}</p>
  </details>;
}
export function TransferHelpResults({ view, locale, busy, refresh, inspect }: {
  view: TransferView; locale: 'en' | 'zh'; busy: boolean; refresh: () => void; inspect: (runId: string) => void;
}) {
  const p = copy[locale]; const coaching = view.stage === 'coaching';
  const savedCount = view.helpRuns.filter(item => item.output !== undefined).length;
  return <section aria-label={p.help} className="space-y-3 border-t border-border pt-4">
    <h5 className="text-sm font-medium">{p.help}</h5>
    <p className="text-xs leading-5 text-muted-foreground">{p.note}</p>
    {coaching ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={refresh}>{p.refresh}</Button> : null}
    {!view.helpRuns.length ? <p className="text-sm leading-6 text-muted-foreground">{p.empty}</p> : null}
    {view.helpRuns.map(item => {
      const active = ['queued', 'running', 'streaming'].includes(item.status);
      const success = item.status === 'completed' && item.hasReply;
      return <div key={item.runId} className="space-y-2 border-l-2 border-border pl-3">
        <p className="text-sm">{item.runtimeId} · {item.viewRequestedAt ? p.viewed : active ? p.active : success ? p.returned : p.failed}</p>
        <p className="text-xs text-muted-foreground">{new Date(item.startedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</p>
        {item.output !== undefined ? <>
          {item.output ? <pre tabIndex={0} className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.output}</pre> : <p className="text-sm leading-6">{p.failedHint}</p>}
          {item.error ? <details><summary className={disclosure}>{p.detail}</summary><p className="whitespace-pre-wrap break-words text-xs leading-5">{item.error}</p></details> : null}
        </> : coaching ? <Button variant="ghost" className="min-h-11 h-auto whitespace-normal" disabled={busy || active || savedCount >= 8} onClick={() => inspect(item.runId)}>{success ? p.open : p.failure}</Button> : null}
      </div>;
    })}
    {savedCount >= 8 ? <p className="text-xs leading-5 text-muted-foreground">{p.limit}</p> : null}
  </section>;
}
