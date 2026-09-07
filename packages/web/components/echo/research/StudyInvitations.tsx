'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { studyControl, studyNote } from './StudyFields';
const copy = {
    en: { configuration: 'Agent configuration does not match the frozen protocol. Check every condition’s provider, model, endpoint and credentials in AI settings, then reload invitations.', configured: 'Local configuration matches all conditions. This does not verify a real model response.', title: 'Participant invitations', limit: 'For workflow pilots. Only protocols with isolated chat enabled can run the assisted stage. Independent reviewers receive separate, fixed work packets.', private: 'Keep this link private. Anyone holding it can act as this participant. Each invitation is for one person.', days: 'Invitation lifetime (days)', create: 'Create private invitation', creating: 'Working…', link: 'Private invitation link', copy: 'Copy link', copied: 'Copied', manual: 'Select and copy the link above.', once: 'Copy before leaving. If you lose the link, revoke the invitation and create another.', revoke: 'Revoke', confirm: 'Revoke this invitation? Access will stop; existing answers will remain.', retry: 'Reload invitations', empty: 'No invitations yet.', protect: 'Protect this instance with a Web password and API access token before inviting participants. Use HTTPS or a local address.', failed: 'The result was not confirmed. Retry the same action before creating another invitation.', expired: 'Expired', revoked: 'Revoked', active: 'Active', joined: 'Joined', unused: 'Not joined', daysHint: 'Allow time for the delayed task. Expiry stops new task access; submitted answers can still be erased.' },
    zh: { configuration: 'Agent 配置与冻结协议不一致。请在 AI 设置中核对每个条件的提供方、模型、接口地址和凭据，再重新读取邀请。', configured: '本机配置与所有条件一致，但尚不能据此确认真实模型已成功回复。', title: '参与者邀请', limit: '用于流程试跑；仅启用了独立聊天的协议可运行帮助阶段，独立评审使用单独发放的固定作品包。', private: '请保密这份链接，持有者能以该参与者身份操作。每份邀请仅供一人使用。', days: '邀请有效天数', create: '创建私人邀请', creating: '正在处理…', link: '私人邀请链接', copy: '复制链接', copied: '已复制', manual: '请选中上方链接并复制。', once: '请在离开前复制链接。若遗失，可撤销原邀请再创建。', revoke: '撤销', confirm: '撤销这份邀请吗？之后不能再访问，已有回答仍保留。', retry: '重新读取邀请', empty: '还没有邀请。', protect: '邀请参与者前，请先设置网页访问密码和 API 访问令牌，并使用 HTTPS 或本机地址。', failed: '尚未确认操作结果，请先重试同一操作，避免重复创建邀请。', expired: '已过期', revoked: '已撤销', active: '有效', joined: '已加入', unused: '尚未加入', daysHint: '请为延迟任务留出时间。过期会关闭新任务，已有回答仍可删除。' },
};
type Invitation = {
    id: string;
    createdAt: string;
    expiresAt: string;
    status: 'active' | 'revoked' | 'expired';
    enrolled: boolean;
};
export function StudyInvitations({ studyId, protocolHash, delayDays, locale }: {
    studyId: string;
    protocolHash: string;
    delayDays: number;
    locale: 'en' | 'zh';
}) {
    const p = copy[locale];
    const [open, setOpen] = useState(false);
    const [invitations, setInvitations] = useState<Invitation[] | null>(null);
    const [execution, setExecution] = useState<{ configured: boolean }[]>([]);
    const configured = execution.every(condition => condition.configured);
    const [days, setDays] = useState(String(Math.min(180, delayDays + 14)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [link, setLink] = useState('');
    const [newId, setNewId] = useState('');
    const [feedback, setFeedback] = useState('');
    const pending = useRef<{
        id: string;
        requestId: string;
        protocolHash: string;
        expiresAt: string;
    } | null>(null);
    const request = useRef<AbortController | null>(null);
    async function send(method = 'GET', input?: unknown) {
        if (request.current)
            return null;
        const abort = new AbortController();
        request.current = abort;
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/echo/research/invitations' + (method === 'GET' ? '?id=' + encodeURIComponent(studyId) : ''), { method, cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
            const data = await response.json();
            if (abort.signal.aborted)
                return null;
            if (!response.ok) {
                setError(data.code ?? 'storage');
                return null;
            }
            return data;
        }
        catch {
            if (!abort.signal.aborted)
                setError('storage');
            return null;
        }
        finally {
            if (request.current === abort) {
                request.current = null;
                if (!abort.signal.aborted)
                    setBusy(false);
            }
        }
    }
    async function load() { const data = await send(); if (data) { setInvitations(data.invitations); setExecution(data.execution ?? []); } }
    useEffect(() => { if (open && invitations === null)
        void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
    async function create() {
        const count = Number(days);
        if (busy || !configured || !Number.isInteger(count) || count < 1 || count > 180)
            return;
        pending.current ??= { id: studyId, protocolHash, requestId: crypto.randomUUID(), expiresAt: new Date(Date.now() + count * 86400000).toISOString() };
        const data = await send('POST', pending.current);
        if (!data)
            return;
        pending.current = null;
        setNewId(data.invitation.id);
        setLink(window.location.origin + '/study/participate/' + studyId + '#invite=' + data.invitation.token);
        setFeedback('');
        await load();
    }
    return <details className="border-t border-border pt-1" onToggle={e => setOpen(e.currentTarget.open)}><summary className="min-h-11 cursor-pointer rounded py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.title}</summary>
  {open ? <div className="space-y-5 pb-4"><p className={studyNote}>{p.limit}</p>
   {error ? <div role="alert" className="space-y-3"><p className={studyNote}>{error === 'configuration' ? p.configuration : error === 'unavailable' ? p.protect : p.failed}</p><Button variant="outline" className={studyControl} disabled={busy} onClick={() => void load()}>{p.retry}</Button></div> : null}
   {execution.length ? <div className="space-y-3"><p className={studyNote}>{configured ? p.configured : p.configuration}</p><Button variant="outline" className={studyControl} disabled={busy} onClick={() => void load()}>{p.retry}</Button></div> : null}
   {busy ? <p role="status" className={studyNote}>{p.creating}</p> : null}
   {invitations && error !== 'unavailable' ? <><label className="block space-y-2 text-sm"><span>{p.days}</span><Input name="invitationDays" className={studyControl} type="number" min={1} max={180} step={1} value={days} disabled={busy || !!pending.current} onChange={e => setDays(e.target.value)}/></label><p className={studyNote}>{p.daysHint}</p>
    <Button className="min-h-11" disabled={busy || !configured || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 180} onClick={() => void create()}>{p.create}</Button>
    {!invitations.length ? <p className={studyNote}>{p.empty}</p> : <ul className="divide-y divide-border">{invitations.map((i, index) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm">{index + 1} · {p[i.status]} · {i.enrolled ? p.joined : p.unused}</p><p className={studyNote}><time dateTime={i.expiresAt}>{new Date(i.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></p></div>{i.status !== 'revoked' ? <Button variant="ghost" className="min-h-11" disabled={busy} aria-label={p.revoke + ' ' + (index + 1)} onClick={async () => { if (!window.confirm(p.confirm))
                return; const data = await send('PATCH', { id: studyId, invitationId: i.id }); if (data) {
                setInvitations(data.invitations);
                if (newId === i.id)
                    setLink('');
            } }}>{p.revoke}</Button> : null}</li>)}</ul>}
   </> : null}
   {link ? <section className="space-y-3"><p className={studyNote}>{p.private}</p><label className="block space-y-2 text-sm"><span>{p.link}</span><textarea name="invitationLink" readOnly value={link} rows={3} className={studyControl + ' block w-full border resize-none rounded-md bg-background px-3 py-2 break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'} onFocus={e => e.target.select()}/></label><Button variant="outline" className={studyControl} onClick={async () => { try {
            await navigator.clipboard.writeText(link);
            setFeedback(p.copied);
        }
        catch {
            setFeedback(p.manual);
        } }}>{p.copy}</Button>{feedback ? <p role="status" className={studyNote}>{feedback}</p> : null}<p className={studyNote}>{p.once}</p></section> : null}
  </div> : null}
 </details>;
}
