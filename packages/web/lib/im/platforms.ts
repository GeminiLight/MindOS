/** Shared IM platform definitions — used by sidebar nav, content page, and detail page. */

export interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
}

export interface PlatformDef {
  id: string;
  name: string;
  icon: string;
  fields: PlatformField[];
  guide?: string;
  guideUrl?: string;
  editHint?: string;
  purpose?: string;
  purposeZh?: string;
  useCases?: string[];
  useCasesZh?: string[];
  recipientExample?: string;
  recipientExampleZh?: string;
}

export type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
  webhook?: {
    state: 'disabled' | 'pending' | 'ready' | 'error';
    transport?: 'webhook' | 'long_connection';
    webhookUrl?: string;
    publicBaseUrl?: string;
    lastError?: string;
  };
};

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'telegram', name: 'Telegram', icon: '📱',
    guide: '1. Open Telegram → search @BotFather\n2. Send /newbot → follow prompts\n3. Copy the token below',
    purpose: 'Receive MindOS notifications and quick updates in Telegram.',
    purposeZh: '通过 Telegram 接收 MindOS 的通知和快速更新。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. chat ID like 123456789 or -1001234567890',
    recipientExampleZh: '例如 123456789 或 -1001234567890 这样的 chat ID',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456789:AABBccDD-EeFfGgHh...', hint: 'Format: number:alphanumeric' },
    ],
  },
  {
    id: 'feishu', name: 'Feishu', icon: '🐦',
    guide: '1. open.feishu.cn → Create App\n2. Credentials page → copy App ID & Secret\n3. Enable Bot capability + add permissions',
    guideUrl: 'https://open.feishu.cn/',
    editHint: 'Need to update credentials? Edit and save below — MindOS will reconnect automatically.',
    purpose: 'Receive MindOS results in Feishu, or let users message the bot directly when conversations are enabled.',
    purposeZh: '通过飞书接收 MindOS 的结果；开启对话后，也可以让用户直接在飞书里给机器人发消息。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages', 'Direct bot conversations in Feishu'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息', '在飞书里直接与机器人对话'],
    recipientExample: 'e.g. ou_xxx, oc_xxx, or a work email',
    recipientExampleZh: '例如 ou_xxx、oc_xxx，或企业邮箱',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'CLI_XXXXXXXXXXXXXXXXX', hint: 'From Credentials page on open.feishu.cn' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'XXXXXXXXXXXXXXXXXXXXXXXX', hint: 'Keep this secret — do not share' },
    ],
  },
  {
    id: 'discord', name: 'Discord', icon: '💬',
    guide: '1. discord.com/developers → New Application\n2. Bot tab → Reset Token → copy\n3. Enable Message Content Intent',
    purpose: 'Send MindOS updates into Discord channels and DMs.',
    purposeZh: '把 MindOS 的更新发送到 Discord 频道或私信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. Discord channel or user ID',
    recipientExampleZh: '例如 Discord 频道 ID 或用户 ID',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIxNzM...' },
    ],
  },
  {
    id: 'slack', name: 'Slack', icon: '💼',
    guide: '1. api.slack.com/apps → Create New App\n2. OAuth & Permissions → add chat:write scope\n3. Install to Workspace → copy Bot Token',
    purpose: 'Route MindOS notifications into Slack channels and direct messages.',
    purposeZh: '把 MindOS 的通知发送到 Slack 频道或私信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. Slack channel or user ID like C123... or U123...',
    recipientExampleZh: '例如 Slack 频道 ID 或用户 ID（如 C123... / U123...）',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-xxxx-xxxx-xxxx', hint: 'Starts with xoxb-' },
    ],
  },
  {
    id: 'wecom', name: 'WeCom', icon: '🏢',
    guide: '1. Group chat → Add Robot → Custom\n2. Copy Webhook URL\n3. Extract the key parameter from URL',
    purpose: 'Deliver MindOS notifications into WeCom group chats.',
    purposeZh: '把 MindOS 通知投递到企业微信群聊。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use your configured robot or WeCom target',
    recipientExampleZh: '使用你配置好的机器人或企业微信目标',
    fields: [
      { key: 'webhook_key', label: 'Webhook Key', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'The key= value from webhook URL' },
    ],
  },
  {
    id: 'dingtalk', name: 'DingTalk', icon: '🔔',
    guide: '1. Group → Settings → Smart Assistant → Add Robot\n2. Select Custom (Webhook)\n3. Copy the full Webhook URL',
    purpose: 'Push MindOS notifications into DingTalk groups.',
    purposeZh: '把 MindOS 通知发送到钉钉群。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use your configured DingTalk robot target',
    recipientExampleZh: '使用你配置好的钉钉机器人目标',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', hint: 'Full URL including access_token' },
    ],
  },
  {
    id: 'wechat', name: 'WeChat', icon: '💚',
    guide: '1. Visit ilinkai.weixin.qq.com\n2. Register & create a bot application\n3. QR login in the console → copy Bot Token from dashboard',
    purpose: 'Send MindOS updates to WeChat via your configured bot.',
    purposeZh: '通过你配置好的机器人把 MindOS 更新发送到微信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use the WeChat user or chat ID supported by your bot',
    recipientExampleZh: '使用你的机器人支持的微信用户或群聊 ID',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'wx_xxxxxxxxxxxxxxxx', hint: 'From iLink Bot console after QR login' },
    ],
  },
  {
    id: 'qq', name: 'QQ', icon: '🐧',
    guide: '1. q.qq.com → Create Bot\n2. Development tab → copy App ID & Secret\n3. Add group/C2C intents as needed',
    purpose: 'Deliver MindOS notifications through QQ bot channels.',
    purposeZh: '通过 QQ 机器人频道接收 MindOS 通知。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use the QQ openid or group_openid for your target',
    recipientExampleZh: '使用目标 QQ 的 openid 或 group_openid',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: '102xxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
];

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find(p => p.id === id);
}
