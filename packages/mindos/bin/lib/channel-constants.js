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

export const CHANNEL_CREDENTIAL_SETS = {
  telegram: [['bot_token']],
  discord: [['bot_token']],
  feishu: [['app_id', 'app_secret']],
  slack: [['bot_token']],
  wecom: [['webhook_key'], ['corp_id', 'corp_secret']],
  dingtalk: [['webhook_url'], ['client_id', 'client_secret']],
  wechat: [['bot_token']],
  qq: [['app_id', 'app_secret']],
};

export const CHANNEL_REQUIRED_FIELDS = Object.fromEntries(
  Object.entries(CHANNEL_CREDENTIAL_SETS).map(([platform, sets]) => [platform, sets[0]]),
);

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
  wecom: {
    webhook_key: /^[A-Za-z0-9_-]{6,}$/,
  },
  dingtalk: {
    webhook_url: /^https:\/\//,
  },
};

export const CHANNEL_FIELD_EXAMPLES = {
  telegram: {
    bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
  },
  slack: {
    bot_token: 'xoxb-1234567890-1234567890-abcdef',
  },
  wecom: {
    webhook_key: '3f9f7f6d-robot-key',
  },
  dingtalk: {
    webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=...',
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
    webhook_key: 'Simplest mode: group robot webhook key from WeCom admin',
    corp_id: 'Alternative mode: enterprise corp_id',
    corp_secret: 'Alternative mode: enterprise corp_secret',
  },
  dingtalk: {
    webhook_url: 'Simplest mode: group robot webhook URL from DingTalk Developer Console',
    client_id: 'Alternative mode: app bot client_id',
    client_secret: 'Alternative mode: app bot client_secret',
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
