import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryResolveFeishuAutomationApproval } from '@/lib/im/webhook/feishu-automation-approval';

const incoming = {
  platform: 'feishu' as const,
  senderId: 'ou_owner',
  chatId: 'oc_owner_dm',
  chatType: 'dm' as const,
  text: '批准 approval-release-1',
  messageId: 'om_1',
  rawEvent: {},
};

describe('Feishu automation approval commands', () => {
  const resolveApproval = vi.fn();
  const readConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readConfig.mockReturnValue({
      providers: { feishu: { oauth: { status: 'connected', user: { open_id: 'ou_owner' } } } },
    });
  });

  it('lets only the connected OAuth owner approve or deny an exact approval id', async () => {
    resolveApproval.mockReturnValue({ status: 200, body: { ok: true, result: 'resolved', jobTitle: 'Release observer' } });
    await expect(tryResolveFeishuAutomationApproval(incoming, {
      readConfig, getMindRoot: () => '/mind', resolveApproval,
    })).resolves.toEqual({
      handled: true,
      reply: '已批准 Release observer。本次决定只对这一轮 Automation 生效。',
    });
    expect(resolveApproval).toHaveBeenCalledWith(
      { approvalId: 'approval-release-1', decision: 'allow' },
      { mindRoot: '/mind' },
    );

    resolveApproval.mockReturnValue({ status: 200, body: { ok: true, result: 'unchanged' } });
    await expect(tryResolveFeishuAutomationApproval({
      ...incoming, text: '拒绝 approval-release-1', messageId: 'om_2',
    }, { readConfig, getMindRoot: () => '/mind', resolveApproval }))
      .resolves.toEqual({ handled: true, reply: '这条审批已经处理过，无需重复操作。' });
  });

  it('rejects command-shaped messages from another sender without invoking the state machine', async () => {
    await expect(tryResolveFeishuAutomationApproval({ ...incoming, senderId: 'ou_other' }, {
      readConfig, getMindRoot: () => '/mind', resolveApproval,
    })).resolves.toEqual({ handled: true, reply: '只有 MindOS 中已连接的飞书账号可以处理 Automation 审批。' });
    expect(resolveApproval).not.toHaveBeenCalled();

    await expect(tryResolveFeishuAutomationApproval({ ...incoming, chatType: 'group' }, {
      readConfig, getMindRoot: () => '/mind', resolveApproval,
    })).resolves.toEqual({ handled: true, reply: '请在与 MindOS 机器人的私聊中处理 Automation 审批。' });
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it('reports stale approvals and leaves ordinary chat messages to the agent', async () => {
    resolveApproval.mockReturnValue({ status: 404, body: { error: 'not found' } });
    await expect(tryResolveFeishuAutomationApproval(incoming, {
      readConfig, getMindRoot: () => '/mind', resolveApproval,
    })).resolves.toEqual({ handled: true, reply: '这条审批已失效或不存在，请回到 MindOS 查看最新待办。' });

    await expect(tryResolveFeishuAutomationApproval({ ...incoming, text: '帮我总结今天的进展' }, {
      readConfig, getMindRoot: () => '/mind', resolveApproval,
    })).resolves.toEqual({ handled: false });
    expect(readConfig).toHaveBeenCalledTimes(1);
  });
});
