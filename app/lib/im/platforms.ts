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
}

export type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
};

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'telegram', name: 'Telegram', icon: '📱',
    guide: '1. Open Telegram → search @BotFather\n2. Send /newbot → follow prompts\n3. Copy the token below',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456789:AABBccDD-EeFfGgHh...', hint: 'Format: number:alphanumeric' },
    ],
  },
  {
    id: 'feishu', name: 'Feishu', icon: '🐦',
    guide: '1. open.feishu.cn → Create App\n2. Credentials page → copy App ID & Secret\n3. Enable Bot capability + add permissions',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_a5xxxxxxxxxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'discord', name: 'Discord', icon: '💬',
    guide: '1. discord.com/developers → New Application\n2. Bot tab → Reset Token → copy\n3. Enable Message Content Intent',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIxNzM...' },
    ],
  },
  {
    id: 'slack', name: 'Slack', icon: '💼',
    guide: '1. api.slack.com/apps → Create New App\n2. OAuth & Permissions → add chat:write scope\n3. Install to Workspace → copy Bot Token',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-xxxx-xxxx-xxxx', hint: 'Starts with xoxb-' },
    ],
  },
  {
    id: 'wecom', name: 'WeCom', icon: '🏢',
    guide: '1. Group chat → Add Robot → Custom\n2. Copy Webhook URL\n3. Extract the key parameter from URL',
    fields: [
      { key: 'webhook_key', label: 'Webhook Key', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'The key= value from webhook URL' },
    ],
  },
  {
    id: 'dingtalk', name: 'DingTalk', icon: '🔔',
    guide: '1. Group → Settings → Smart Assistant → Add Robot\n2. Select Custom (Webhook)\n3. Copy the full Webhook URL',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', hint: 'Full URL including access_token' },
    ],
  },
  {
    id: 'wechat', name: 'WeChat', icon: '💚',
    guide: '1. Visit ilinkai.weixin.qq.com\n2. Register & create a bot application\n3. QR login in the console → copy Bot Token from dashboard',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'wx_xxxxxxxxxxxxxxxx', hint: 'From iLink Bot console after QR login' },
    ],
  },
  {
    id: 'qq', name: 'QQ', icon: '🐧',
    guide: '1. q.qq.com → Create Bot\n2. Development tab → copy App ID & Secret\n3. Add group/C2C intents as needed',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: '102xxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
];

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find(p => p.id === id);
}
