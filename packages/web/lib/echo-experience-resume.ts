'use client';
import type { BranchStory, ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { restoreReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { refreshSessions, getSessions, getActiveSessionId, attachRuntimeSession } from './agent-session-store';
import { getMatchingRuntimeSessionBinding } from './ask-agent';
import { readRuntimeSessionHistory } from './runtime-session-history';
import { offerTaskDraft } from './chat-task-draft';
import { getMessages } from './agent-run-store';
import { restoreJudgments, judgmentKey } from '@/components/echo/replay/replay-judgments';
import { restoreReplayTakeaway } from '@/components/echo/replay/replay-takeaway';
import type { AgentRuntimeIdentity } from './types';

export function experienceContinuationDraft(source: ReplaySourceSummary, story?: BranchStory, currentTakeaway?: string) {
  const lines = ['我刚从回响重走了这段项目经历。请先核对当前项目状态，再讨论接下来怎么推进。', `原会话：${source.title}`];
  if (story && story.source.id === source.id && story.source.runtime === source.runtime) {
    try {
      const state = restoreReplayState(story, JSON.parse(localStorage.getItem(`mindos:branch-replay:${story.id}`) || 'null'));
      const judgments = restoreJudgments(story, JSON.parse(localStorage.getItem(`mindos:branch-replay:${story.id}:judgments`) || 'null'));
      for (const attempt of state.attempts.slice(-8)) {
        const scene = story.scenes.find(s => s.id === attempt.sceneId), choice = scene?.choices.find(c => c.id === attempt.choiceId);
        if (choice) {
          lines.push(`练习中尝试：${choice.label}（${choice.outcome.kind === 'unobserved' ? '原会话没有结果记录' : `已读 ${attempt.visibleSteps} 条后续记录`}）`);
          const note = judgments.entries[judgmentKey(attempt.sceneId, attempt.choiceId)];
          if (note?.prediction) lines.push(`我当时的预测：${note.prediction}`);
          if (note?.revision) lines.push(`回放后修正的判断：${note.revision}`);
          if (note?.nextCheck) lines.push(`我想在当前项目核对：${note.nextCheck}`);
        }
      }
    } catch { /* Unavailable browser notes do not prevent native continuation. */ }
    let takeaway = currentTakeaway;
    if (takeaway === undefined) {
      try { takeaway = restoreReplayTakeaway(story, JSON.parse(localStorage.getItem(`mindos:branch-replay:${story.id}:takeaway`) || 'null')); }
      catch { /* The current review can still pass an unsaved note directly. */ }
    }
    if (takeaway?.trim()) lines.push(`这次回放后，我想带回当前项目的判断与待验证问题：${takeaway.slice(0, 1200)}`);
  }
  lines.push('以上回放选择是练习，不是已确认的新标准。请指出当前仍未解决的关键取舍，提出一个最小验证动作；由我确认后再执行。');
  return lines.join('\n');
}
/** Reuse the native binding; never send automatically or replace existing local messages. */
export async function resumeExperience(source: ReplaySourceSummary, story?: BranchStory, signal?: AbortSignal, currentTakeaway?: string) {
  signal?.throwIfAborted();
  if (!['claude', 'codex'].includes(source.runtime) || source.archived) throw new Error('归档会话请先在原 Agent 中恢复；你仍可查看原文和回放。');
  const runtime: AgentRuntimeIdentity = { id: source.runtime, kind: source.runtime as 'claude' | 'codex', name: source.runtime === 'claude' ? 'Claude Code' : 'Codex' };
  await refreshSessions();
  signal?.throwIfAborted();
  const existing = getSessions().find(session => getMatchingRuntimeSessionBinding(session, runtime)?.externalSessionId === source.id);
  const hasCurrentMessages = () => !!existing && (getMessages(existing.id).length > 0 || existing.messages.length > 0);
  const history = hasCurrentMessages() ? null : await readRuntimeSessionHistory({ id: source.id, runtime, cwd: source.cwd, title: source.title });
  signal?.throwIfAborted();
  const attached = attachRuntimeSession(runtime, { externalSessionId: source.id, cwd: history?.entry.cwd || source.cwd, status: 'active', updatedAt: history?.entry.updatedAt || source.updatedAt }, { title: existing?.title || source.title, ...(history && !hasCurrentMessages() ? { messages: history.messages } : {}) });
  if (!attached) throw new Error('原会话正在运行，请等这一轮结束后再续接。');
  const sessionId = getActiveSessionId(); if (!sessionId) throw new Error('未能打开原会话，请重试。');
  const draft = experienceContinuationDraft(source, story, currentTakeaway);
  return { sessionId, draftOffered: offerTaskDraft(sessionId, draft), draft };
}
