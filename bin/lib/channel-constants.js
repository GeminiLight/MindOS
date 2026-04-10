/**
 * Shared channel CLI constants.
 * Keep this file data-only so command/config/validation layers stay aligned.
 */

export const CHANNEL_PLATFORMS = [
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
];

export const CHANNEL_REQUIRED_FIELDS = {
  telegram: ['bot_token'],
  discord: ['bot_token'],
  feishu: ['app_id', 'app_secret'],
  slack: ['bot_token'],
  wecom: [],
  dingtalk: [],
  wechat: ['bot_token'],
  qq: ['app_id', 'app_secret'],
};

export const CHANNEL_FIELD_PATTERNS = {
  telegram: {
    bot_token: /^\d+:[A-Za-z0-9_-]{25,}$/,
  },
  discord: {
    bot_token: /^[A-Za-z0-9._-]{20,}$/,
  },
  slack: {
    bot_token: /^xoxb-/,
  },
};

export const CHANNEL_FIELD_EXAMPLES = {
  telegram: {
    bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
  },
  slack: {
    bot_token: 'xoxb-1234567890-1234567890-abcdef',
  },
};

export const CHANNEL_PLATFORM_HELP = {
  telegram: {
    bot_token: 'Get from @BotFather on Telegram (https://core.telegram.org/bots)',
  },
  discord: {
    bot_token: 'Get from Discord Developer Portal (https://discord.com/developers)',
  },
  feishu: {
    app_id: 'Get from Feishu Admin Console',
    app_secret: 'Get from Feishu Admin Console',
  },
  slack: {
    bot_token: 'Get from Slack API settings (https://api.slack.com/apps)',
  },
  wecom: {
    webhook_key: 'Or use corp_id + corp_secret from WeCom admin',
  },
  dingtalk: {
    client_id: 'Or use webhook_url from DingTalk Developer Console',
    client_secret: 'Used with client_id when not using webhook_url',
  },
  wechat: {
    bot_token: 'Get via ClawBot QR scan',
  },
  qq: {
    app_id: 'Get from QQ Open Platform',
    app_secret: 'Get from QQ Open Platform',
  },
};

export const CHANNEL_PLATFORM_EMOJIS = {
  telegram: '✈️',
  discord: '🟣',
  feishu: '🎎',
  slack: '#️⃣',
  wecom: '💼',
  dingtalk: '🔔',
  wechat: '💬',
  qq: '🐧',
};
