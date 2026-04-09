// ─── IM Agent Tools ───────────────────────────────────────────────────────────
// Defines Agent tools for sending messages via IM platforms.
// Tools are conditionally loaded: only when im.json has at least one provider.

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { getConfiguredPlatforms } from './config';
import { sendIMMessage, listConfiguredIM } from './executor';
import { maskForLog } from './format';
import type { IMPlatform } from './types';

// ─── Schemas ──────────────────────────────────────────────────────────────────

function buildSendParams() {
  const platforms = getConfiguredPlatforms();
  if (platforms.length === 0) return null;

  return Type.Object({
    platform: Type.Union(
      platforms.map((p) => Type.Literal(p)),
      { description: 'Target IM platform (only configured platforms shown)' },
    ),
    recipient_id: Type.String({
      description: 'Chat/Channel/Group ID on the platform. Use list_im_channels to discover available targets.',
    }),
    message: Type.String({
      description: 'Message content to send. Supports markdown if the platform allows it.',
    }),
    format: Type.Optional(
      Type.Union([Type.Literal('text'), Type.Literal('markdown')], {
        description: 'Message format. Default: text.',
      }),
    ),
    thread_id: Type.Optional(
      Type.String({ description: 'Thread/Topic ID for threaded replies (platform-dependent).' }),
    ),
  });
}

const ListIMChannelsParams = Type.Object({});

// ─── Tool Builder ─────────────────────────────────────────────────────────────

type SendParams = {
  platform: string;
  recipient_id: string;
  message: string;
  format?: string;
  thread_id?: string;
};

function textResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} as Record<string, never> };
}

/** Build the IM tools array. Returns empty if no platforms configured. */
export function getIMTools(): AgentTool[] {
  const sendSchema = buildSendParams();
  if (!sendSchema) return []; // no platforms configured

  const tools: AgentTool[] = [
    {
      name: 'send_im_message',
      label: 'Send IM',
      description: 'Send a message to a configured IM platform (Telegram, Discord, Feishu, Slack, etc.).',
      parameters: sendSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (_toolCallId: string, params: any, signal?: AbortSignal) => {
        const p = params as SendParams;

        const result = await sendIMMessage(
          {
            platform: p.platform as IMPlatform,
            recipientId: p.recipient_id,
            text: p.message,
            format: (p.format as 'text' | 'markdown' | undefined) ?? 'text',
            threadId: p.thread_id,
          },
          signal,
        );

        if (result.ok) {
          return textResult(
            `Message sent to ${p.platform} chat ${maskForLog(p.recipient_id)}.\nMessage ID: ${result.messageId ?? 'N/A'}\nTimestamp: ${result.timestamp}`,
          );
        }
        return textResult(`Failed to send message to ${p.platform}: ${result.error}`);
      },
    },
    {
      name: 'list_im_channels',
      label: 'List IM',
      description: 'List all configured IM platforms, their connection status, and capabilities.',
      parameters: ListIMChannelsParams,
      execute: async () => {
        const platforms = await listConfiguredIM();
        if (platforms.length === 0) {
          return textResult(
            'No IM platforms configured.\nUsers can configure IM platforms by editing ~/.mindos/im.json.\n\nSupported platforms: telegram, feishu, discord, slack, wecom, dingtalk',
          );
        }
        const lines = platforms.map((p) => {
          const status = p.connected ? '\u2713 connected' : '\u2717 disconnected';
          const name = p.botName ? `  Bot: ${p.botName}` : '';
          return `- ${p.platform}: ${status} (supports ${p.capabilities.join(', ')})${name}`;
        });
        return textResult(`Configured IM platforms:\n\n${lines.join('\n')}`);
      },
    },
  ];

  return tools;
}
