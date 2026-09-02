import { getMindRoot } from '@/lib/fs';
import { readIMConfig } from '@/lib/im/config';
import type { IMConfig, IncomingIMMessage } from '@/lib/im/types';
import {
  handleAutomationApprovalDecisionPost,
  type MindosServerResponse,
} from '@geminilight/mindos/server';

type ApprovalDecisionResponse = MindosServerResponse<
  { ok: true; result: 'resolved' | 'unchanged'; jobTitle: string } | { error: string }
>;

export type FeishuAutomationApprovalServices = {
  readConfig?(): IMConfig;
  getMindRoot?(): string;
  resolveApproval?(
    body: { approvalId: string; decision: 'allow' | 'deny' },
    services: { mindRoot: string },
  ): ApprovalDecisionResponse;
};

export async function tryResolveFeishuAutomationApproval(
  incoming: IncomingIMMessage,
  services: FeishuAutomationApprovalServices = {},
): Promise<{ handled: false } | { handled: true; reply: string }> {
  const command = parseApprovalCommand(incoming.text);
  if (!command) return { handled: false };

  const config = (services.readConfig ?? readIMConfig)();
  const ownerOpenId = config.providers.feishu?.oauth?.status === 'connected'
    ? config.providers.feishu.oauth.user?.open_id
    : undefined;
  if (!ownerOpenId || incoming.senderId !== ownerOpenId) {
    return { handled: true, reply: '只有 MindOS 中已连接的飞书账号可以处理 Automation 审批。' };
  }
  if (incoming.chatType !== 'dm') {
    return { handled: true, reply: '请在与 MindOS 机器人的私聊中处理 Automation 审批。' };
  }

  const result = (services.resolveApproval ?? handleAutomationApprovalDecisionPost)(
    command,
    { mindRoot: (services.getMindRoot ?? getMindRoot)() },
  );
  if (result.status === 404) {
    return { handled: true, reply: '这条审批已失效或不存在，请回到 MindOS 查看最新待办。' };
  }
  if (result.status === 409) {
    return { handled: true, reply: '这条审批已经处理过，且当前状态与本次回复不一致。请回到 MindOS 查看。' };
  }
  const body = result.body;
  if (result.status !== 200 || !body || !('ok' in body)) {
    return { handled: true, reply: '审批暂时无法处理，请稍后重试或回到 MindOS 操作。' };
  }
  if (body.result === 'unchanged') {
    return { handled: true, reply: '这条审批已经处理过，无需重复操作。' };
  }
  return command.decision === 'allow'
    ? { handled: true, reply: `已批准 ${body.jobTitle}。本次决定只对这一轮 Automation 生效。` }
    : { handled: true, reply: `已拒绝 ${body.jobTitle}。Automation 将保留审计记录。` };
}

function parseApprovalCommand(text: string): { approvalId: string; decision: 'allow' | 'deny' } | null {
  const match = text.trim().match(/^(批准|同意|approve|拒绝|deny)\s+(approval-[A-Za-z0-9._:-]+)$/i);
  if (!match) return null;
  const decision = /^(批准|同意|approve)$/i.test(match[1]!) ? 'allow' : 'deny';
  return { approvalId: match[2]!, decision };
}
