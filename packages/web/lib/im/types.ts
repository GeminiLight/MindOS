// ─── IM Platform Types ────────────────────────────────────────────────────────
// Core type definitions for the cross-platform IM integration system.
// All platform-specific format conversion happens inside each Adapter.

export type IMPlatform =
  | 'telegram'
  | 'discord'
  | 'feishu'
  | 'slack'
  | 'wecom'
  | 'dingtalk'
  | 'wechat'
  | 'qq';

export type IMMessageFormat = 'text' | 'markdown' | 'html';

export interface IMAttachment {
  type: 'image' | 'file' | 'audio' | 'video';
  /** URL or local file path */
  url: string;
  filename?: string;
  mimeType?: string;
}

export interface IMMessage {
  platform: IMPlatform;
  /** Chat/Channel/Group ID on the platform */
  recipientId: string;
  text: string;
  format?: IMMessageFormat;
  /** Thread/Topic ID for threaded replies */
  threadId?: string;
  attachments?: IMAttachment[];
}

export interface IMSendResult {
  ok: boolean;
  /** Platform-specific message ID */
  messageId?: string;
  error?: string;
  timestamp: string;
}

export interface IMAdapter {
  readonly platform: IMPlatform;
  send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult>;
  /** Verify credentials are valid */
  verify(): Promise<boolean>;
  dispose(): Promise<void>;
}

// ─── Per-Platform Config Types ────────────────────────────────────────────────

export interface TelegramConfig {
  bot_token: string;
}

export type FeishuConversationTransport = 'webhook' | 'long_connection';

export interface FeishuConversationConfig {
  enabled?: boolean;
  transport?: FeishuConversationTransport;
  encrypt_key?: string;
  verification_token?: string;
  public_base_url?: string;
  allow_group_mentions?: boolean;
}

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  conversation?: FeishuConversationConfig;
}

export interface DiscordConfig {
  bot_token: string;
}

export interface SlackConfig {
  bot_token: string;
  signing_secret?: string;
}

export interface WeComConfig {
  webhook_key?: string;
  corp_id?: string;
  corp_secret?: string;
}

export interface DingTalkConfig {
  client_id?: string;
  client_secret?: string;
  webhook_url?: string;
  webhook_secret?: string;
}

export interface WeChatConfig {
  /** bot_token obtained via ClawBot QR code scan */
  bot_token: string;
}

export interface QQConfig {
  /** QQ 开放平台 AppID */
  app_id: string;
  /** QQ 开放平台 AppSecret (clientSecret) */
  app_secret: string;
}

export interface IMConfig {
  providers: Partial<{
    telegram: TelegramConfig;
    feishu: FeishuConfig;
    discord: DiscordConfig;
    slack: SlackConfig;
    wecom: WeComConfig;
    dingtalk: DingTalkConfig;
    wechat: WeChatConfig;
    qq: QQConfig;
  }>;
}

// ─── Platform Feature Limits ──────────────────────────────────────────────────

export interface PlatformLimits {
  maxTextLength: number;
  supportsMarkdown: boolean;
  supportsHtml: boolean;
  supportsThreads: boolean;
  supportsAttachments: boolean;
}

export const PLATFORM_LIMITS: Record<IMPlatform, PlatformLimits> = {
  telegram:  { maxTextLength: 4096,  supportsMarkdown: true,  supportsHtml: true,  supportsThreads: true,  supportsAttachments: true },
  discord:   { maxTextLength: 2000,  supportsMarkdown: true,  supportsHtml: false, supportsThreads: true,  supportsAttachments: true },
  feishu:    { maxTextLength: 30000, supportsMarkdown: true,  supportsHtml: false, supportsThreads: true,  supportsAttachments: true },
  slack:     { maxTextLength: 4000,  supportsMarkdown: true,  supportsHtml: false, supportsThreads: true,  supportsAttachments: true },
  wecom:     { maxTextLength: 2048,  supportsMarkdown: true,  supportsHtml: false, supportsThreads: false, supportsAttachments: true },
  dingtalk:  { maxTextLength: 20000, supportsMarkdown: true,  supportsHtml: false, supportsThreads: false, supportsAttachments: true },
  wechat:    { maxTextLength: 4096,  supportsMarkdown: false, supportsHtml: false, supportsThreads: false, supportsAttachments: true },
  qq:        { maxTextLength: 4096,  supportsMarkdown: true,  supportsHtml: false, supportsThreads: false, supportsAttachments: true },
};

// ─── Recipient ID Validation ──────────────────────────────────────────────────

const RECIPIENT_ID_PATTERNS: Record<IMPlatform, RegExp> = {
  telegram:  /^-?\d+$/,                          // numeric chat ID
  discord:   /^\d{17,20}$/,                       // Snowflake ID
  feishu:    /^(oc_|ou_|on_|[\w.+-]+@[\w.-]+)/, // chat_id / open_id / union_id / email
  slack:     /^[A-Z0-9]{9,12}$/,                  // Slack channel/user ID
  wecom:     /^.{1,256}$/,                         // non-empty
  dingtalk:  /^.{1,256}$/,                         // non-empty
  wechat:    /^.{1,256}$/,                         // non-empty (WeChat user/chat ID)
  qq:        /^.{1,256}$/,                         // non-empty (QQ openid or group_openid)
};

export function isValidRecipientId(platform: IMPlatform, recipientId: string): boolean {
  return RECIPIENT_ID_PATTERNS[platform].test(recipientId);
}

// ─── Activity Types ───────────────────────────────────────────────────────────

export type IMActivityType = 'test' | 'agent' | 'manual' | 'conversation_inbound' | 'conversation_reply';
export type IMActivityStatus = 'success' | 'failed';

export interface IMActivity {
  id: string;
  platform: IMPlatform;
  type: IMActivityType;
  status: IMActivityStatus;
  recipient: string;
  /** Truncated to 50 chars */
  messageSummary: string;
  error?: string;
  timestamp: string;
}

export interface IMActivityStore {
  version: 1;
  activities: Partial<Record<IMPlatform, IMActivity[]>>;
}

export interface IncomingIMMessage {
  platform: IMPlatform;
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType: 'dm' | 'group';
  text: string;
  messageId: string;
  threadId?: string;
  mentionsBot?: boolean;
  rawEvent: unknown;
}

export interface IMSessionKey {
  platform: IMPlatform;
  chatId: string;
}

export interface IMSessionState {
  key: IMSessionKey;
  sessionId: string;
  lastActiveAt: string;
}

export type IMWebhookState = 'disabled' | 'pending' | 'ready' | 'error';

export interface IMWebhookStatus {
  platform: IMPlatform;
  state: IMWebhookState;
  transport?: FeishuConversationTransport;
  webhookUrl?: string;
  publicBaseUrl?: string;
  lastVerifiedAt?: string;
  lastInboundAt?: string;
  lastError?: string;
  activeSessions?: number;
}

export interface FeishuWebhookChallengeBody {
  challenge?: string;
  token?: string;
  type?: string;
}

export interface FeishuWebhookEventEnvelope {
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    tenant_key?: string;
    create_time?: string;
    token?: string;
    app_id?: string;
  };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: 'p2p' | 'group';
      content?: string;
      mentions?: Array<{ key?: string; id?: { open_id?: string; union_id?: string; user_id?: string } }>;
    };
    sender?: {
      sender_id?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
  };
}

export interface FeishuSdkMessageEvent {
  event_type?: string;
  message?: NonNullable<FeishuWebhookEventEnvelope['event']>['message'];
  sender?: NonNullable<FeishuWebhookEventEnvelope['event']>['sender'];
}

export interface FeishuWebhookDispatchResult {
  status: number;
  body: Record<string, unknown>;
}

