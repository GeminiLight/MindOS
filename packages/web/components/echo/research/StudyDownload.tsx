'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { studyControl, studyNote } from './StudyFields';
const copy = {
  en: { title: 'Download study records', note: 'Includes the protocol, submitted answers, help conversations, scores and revision history. Store this file privately. Invitation credentials and private reviewer notes are excluded.', busy: 'Preparing download…', failed: 'Could not download study records. Retry when the connection is available.', done: 'Download started. Check your browser’s downloads.' },
  zh: { title: '下载研究记录', note: '包含协议、已提交回答、帮助对话、评分及修订历史。请妥善保管文件，不含邀请凭据和评审者私人备注。', busy: '正在准备下载…', failed: '暂时无法下载研究记录，请在连接恢复后重试。', done: '已发起下载，请查看浏览器的下载记录。' },
};
export function StudyDownload({ studyId, locale }: { studyId: string; locale: 'en' | 'zh' }) {
  const p = copy[locale]; const [status, setStatus] = useState(''); const controller = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function download() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort; setStatus('busy');
    try {
      const response = await fetch('/api/echo/research/export?id=' + encodeURIComponent(studyId), { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      if (!response.ok) throw new Error('Export unavailable');
      const data = await response.blob(); if (abort.signal.aborted) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url.current; anchor.download = studyId + '.json'; document.body.append(anchor); anchor.click(); anchor.remove();
      setStatus('done');
    } catch { if (!abort.signal.aborted) setStatus('failed'); }
    finally { if (controller.current === abort) controller.current = null; }
  }
  return <section className="space-y-3 border-t border-border pt-5"><p className={studyNote}>{p.note}</p><Button variant="outline" className={studyControl} disabled={status === 'busy'} onClick={() => void download()}>{p.title}</Button>
    {status ? <p role={status === 'failed' ? 'alert' : 'status'} className={studyNote}>{p[status as 'busy' | 'failed' | 'done']}</p> : null}
  </section>;
}
