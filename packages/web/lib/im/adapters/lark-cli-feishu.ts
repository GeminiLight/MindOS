import { randomUUID } from 'node:crypto';
import {
  parseLarkCliFailure,
  runLarkCli,
  type LarkCliRunner,
  type LarkCliRunResult,
} from '@geminilight/mindos/server';
import type { FeishuConfig, IMAdapter, IMMessage, IMSendResult } from '../types';

export class LarkCliFeishuAdapter implements IMAdapter {
  readonly platform = 'feishu' as const;
  private appName: string | null = null;

  constructor(
    private readonly config: FeishuConfig,
    private readonly run: LarkCliRunner = runLarkCli,
  ) {
    if (config.credential_ref?.kind !== 'lark-cli-profile') {
      throw new Error('A lark-cli profile reference is required.');
    }
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    if (signal?.aborted) return failure('Message send was canceled.');
    const ref = this.config.credential_ref!;
    const recipientFlag = message.recipientId.startsWith('oc_') ? '--chat-id' : '--user-id';
    const contentFlag = message.format === 'markdown' ? '--markdown' : '--text';
    const idempotencyKey = normalizeIdempotencyKey(message.idempotencyKey ?? randomUUID());
    try {
      const result = await this.run(ref.executablePath, [
        '--profile', ref.profile,
        'im', '+messages-send',
        '--as', 'bot',
        recipientFlag, message.recipientId,
        contentFlag, message.text,
        '--idempotency-key', idempotencyKey,
        '--json',
      ]);
      const payload = parseJson(result.stdout);
      if (!cliSucceeded(result, payload)) {
        return failure(formatCliFailure(result, payload, 'lark-cli returned invalid JSON output.'));
      }
      const messageId = readMessageId(payload);
      return { ok: true, ...(messageId ? { messageId } : {}), timestamp: new Date().toISOString() };
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'lark-cli message send failed.');
    }
  }

  async verify(): Promise<boolean> {
    const ref = this.config.credential_ref!;
    try {
      const result = await this.run(ref.executablePath, [
        '--profile', ref.profile, 'auth', 'status', '--json', '--verify',
      ]);
      const payload = parseJson(result.stdout);
      if (!cliSucceeded(result, payload) || !isRecord(payload)) return false;
      const identities = recordField(payload, 'identities');
      const bot = recordField(identities, 'bot');
      this.appName = stringField(bot, 'appName') || null;
      return bot?.status === 'ready' && bot.available === true && bot.verified === true;
    } catch {
      return false;
    }
  }

  getAppName(): string | null {
    return this.appName;
  }

  async dispose(): Promise<void> {
    this.appName = null;
  }
}

function cliSucceeded(result: LarkCliRunResult, payload: unknown): boolean {
  if (result.exitCode !== 0) return false;
  return isRecord(payload) && payload.ok !== false;
}

function formatCliFailure(result: LarkCliRunResult, payload: unknown, fallback = 'lark-cli command failed.'): string {
  const issue = parseLarkCliFailure(payload, result.stderr || fallback);
  const scopeHint = issue.missingScopes?.length
    ? ` (missing scopes: ${issue.missingScopes.join(', ')})`
    : '';
  return `${issue.message}${scopeHint}${issue.hint ? ` ${issue.hint}` : ''}`;
}

function failure(error: string): IMSendResult {
  return { ok: false, error, timestamp: new Date().toISOString() };
}

function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function readMessageId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = recordField(payload, 'data');
  const message = recordField(payload, 'message');
  return stringField(data, 'message_id')
    || stringField(message, 'message_id')
    || stringField(payload, 'message_id')
    || undefined;
}

function normalizeIdempotencyKey(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9._:-]/g, '-');
  return (safe || randomUUID()).slice(0, 50);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordField(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return isRecord(nested) ? nested : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string {
  const nested = value?.[key];
  return typeof nested === 'string' ? nested.trim() : '';
}
