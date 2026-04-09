// ─── IM Extension Entry Point ─────────────────────────────────────────────────
// Registers IM tools via the pi Extension API.
// This file is loaded as an extension by DefaultResourceLoader in ask/route.ts.
//
// When no IM platforms are configured (~/.mindos/im.json empty or missing),
// the extension silently does nothing — no tools, no commands.

import type { ExtensionAPI, ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@sinclair/typebox';
import { hasAnyIMConfig, getConfiguredPlatforms } from './config';
import { sendIMMessage, listConfiguredIM } from './executor';
import { maskForLog } from './format';
import type { IMPlatform } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: undefined };
}

// ─── Extension Factory ────────────────────────────────────────────────────────

export default function imExtension(pi: ExtensionAPI) {
  if (!hasAnyIMConfig()) return;

  const platforms = getConfiguredPlatforms();
  if (platforms.length === 0) return;

  // ── send_im_message tool ──────────────────────────────────────────────────

  const sendSchema = Type.Object({
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

  pi.registerTool({
    name: 'send_im_message',
    label: 'Send IM',
    description: 'Send a message to a configured IM platform (Telegram, Discord, Feishu, Slack, WeChat, QQ, etc.).',
    promptSnippet: 'send_im_message: Send messages to IM platforms',
    parameters: sendSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any, signal?: AbortSignal): Promise<AgentToolResult<unknown>> => {
      const { platform, recipient_id, message, format, thread_id } = params as { platform: string; recipient_id: string; message: string; format?: string; thread_id?: string };
      const result = await sendIMMessage(
        {
          platform: platform as IMPlatform,
          recipientId: recipient_id,
          text: message,
          format: (format as 'text' | 'markdown' | undefined) ?? 'text',
          threadId: thread_id,
        },
        signal,
      );

      if (result.ok) {
        return textResult(
          `Message sent to ${platform} chat ${maskForLog(recipient_id)}.\nMessage ID: ${result.messageId ?? 'N/A'}\nTimestamp: ${result.timestamp}`,
        );
      }
      return textResult(`Failed to send message to ${platform}: ${result.error}`);
    },
  } as ToolDefinition<TSchema>);

  // ── list_im_channels tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: 'list_im_channels',
    label: 'List IM',
    description: 'List all configured IM platforms, their connection status, and capabilities.',
    parameters: Type.Object({}),
    execute: async (): Promise<AgentToolResult<unknown>> => {
      const results = await listConfiguredIM();
      if (results.length === 0) {
        return textResult(
          'No IM platforms configured.\nUsers can configure IM platforms by editing ~/.mindos/im.json.\n\nSupported: telegram, feishu, discord, slack, wecom, dingtalk, wechat, qq',
        );
      }
      const lines = results.map((p) => {
        const status = p.connected ? '\u2713 connected' : '\u2717 disconnected';
        const name = p.botName ? `  Bot: ${p.botName}` : '';
        return `- ${p.platform}: ${status} (supports ${p.capabilities.join(', ')})${name}`;
      });
      return textResult(`Configured IM platforms:\n\n${lines.join('\n')}`);
    },
  } as ToolDefinition<TSchema>);

  // ── /im command ───────────────────────────────────────────────────────────

  pi.registerCommand('im', {
    description: 'Show configured IM platforms and their status',
    handler: async (_args: string, ctx) => {
      const results = await listConfiguredIM();
      if (results.length === 0) {
        ctx.ui.notify('No IM platforms configured. Edit ~/.mindos/im.json to add platforms.', 'info');
        return;
      }
      const summary = results
        .map((p) => `${p.connected ? '\u2713' : '\u2717'} ${p.platform}${p.botName ? ` (${p.botName})` : ''}`)
        .join('\n');
      ctx.ui.notify(`IM Channels:\n${summary}`, 'info');
    },
  });
}
