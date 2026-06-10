/** Shared IM platform definitions — used by sidebar nav, content page, and detail page. */

export interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  optional?: boolean;
}

export type PlatformSetupMethodKind =
  | 'official_console'
  | 'oauth_install'
  | 'bot_invite'
  | 'webhook_copy'
  | 'deep_link_bind'
  | 'manual_credentials';

export type PlatformSetupMethodAvailability =
  | 'available'
  | 'after_credentials'
  | 'planned'
  | 'manual_only';

export interface PlatformSetupMethod {
  id: string;
  kind: PlatformSetupMethodKind;
  title: string;
  titleZh?: string;
  description: string;
  descriptionZh?: string;
  actionLabel?: string;
  actionLabelZh?: string;
  href?: string;
  qr?: boolean;
  recommended?: boolean;
  availability: PlatformSetupMethodAvailability;
}

export interface PlatformDef {
  id: string;
  name: string;
  icon: string;
  iconFile?: string;
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
  setupMethods?: PlatformSetupMethod[];
}

export type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
  oauth?: {
    state: 'disconnected' | 'pending' | 'connected';
    expiresAt?: string;
    user?: {
      name?: string;
      en_name?: string;
      avatar_url?: string;
      open_id?: string;
      union_id?: string;
      user_id?: string;
      email?: string;
    };
  };
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
    id: 'telegram', name: 'Telegram', icon: '📱', iconFile: 'telegram.svg',
    guide: '1. Open Telegram → search @BotFather\n2. Send /newbot → follow prompts\n3. Copy the token below',
    purpose: 'Receive MindOS notifications and quick updates in Telegram.',
    purposeZh: '通过 Telegram 接收 MindOS 的通知和快速更新。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. chat ID like 123456789 or -1001234567890',
    recipientExampleZh: '例如 123456789 或 -1001234567890 这样的 chat ID',
    setupMethods: [
      {
        id: 'botfather',
        kind: 'official_console',
        title: 'Create bot with BotFather',
        titleZh: '用 BotFather 创建机器人',
        description: 'Open Telegram BotFather, create a bot, then paste the token here. MindOS shows the QR locally so you can continue on mobile.',
        descriptionZh: '打开 Telegram BotFather 创建机器人，然后把 token 粘贴到这里。MindOS 会在本地生成二维码，方便手机继续操作。',
        actionLabel: 'Open BotFather',
        actionLabelZh: '打开 BotFather',
        href: 'https://t.me/BotFather',
        qr: true,
        recommended: true,
        availability: 'available',
      },
      {
        id: 'deep-link-bind',
        kind: 'deep_link_bind',
        title: 'One-tap recipient binding',
        titleZh: '一键绑定接收对象',
        description: 'Telegram supports bot deep links. MindOS will use this for automatic chat binding after inbound updates are enabled.',
        descriptionZh: 'Telegram 支持机器人 deep link。MindOS 后续接入入站更新后，可用它自动绑定 chat。',
        availability: 'planned',
      },
    ],
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456789:AABBccDD-EeFfGgHh...', hint: 'Format: number:alphanumeric' },
    ],
  },
  {
    id: 'feishu', name: 'Feishu', icon: '🐦', iconFile: 'feishu.svg',
    guide: '1. open.feishu.cn → Create App\n2. Credentials page → copy App ID & Secret\n3. Enable Bot capability + add permissions',
    guideUrl: 'https://open.feishu.cn/',
    editHint: 'Need to update credentials? Edit and save below — MindOS will reconnect automatically.',
    purpose: 'Receive MindOS results in Feishu, or let users message the bot directly when conversations are enabled.',
    purposeZh: '通过飞书接收 MindOS 的结果；开启对话后，也可以让用户直接在飞书里给机器人发消息。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages', 'Direct bot conversations in Feishu'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息', '在飞书里直接与机器人对话'],
    recipientExample: 'e.g. ou_xxx, oc_xxx, or a work email',
    recipientExampleZh: '例如 ou_xxx、oc_xxx，或企业邮箱',
    setupMethods: [
      {
        id: 'open-platform',
        kind: 'official_console',
        title: 'Open Feishu developer console',
        titleZh: '打开飞书开放平台',
        description: 'Create or open a Feishu app, enable Bot capability, then paste App ID and App Secret.',
        descriptionZh: '创建或打开飞书应用，启用机器人能力，然后粘贴 App ID 和 App Secret。',
        actionLabel: 'Open console',
        actionLabelZh: '打开控制台',
        href: 'https://open.feishu.cn/app',
        qr: true,
        recommended: true,
        availability: 'available',
      },
      {
        id: 'oauth-user',
        kind: 'oauth_install',
        title: 'Authorize user after credentials',
        titleZh: '保存凭证后授权用户',
        description: 'After App ID and App Secret are saved, MindOS can open Feishu OAuth so you do not copy user IDs by hand.',
        descriptionZh: '保存 App ID 和 App Secret 后，MindOS 可以打开飞书 OAuth，避免手动复制用户 ID。',
        availability: 'after_credentials',
      },
      {
        id: 'device-create-app',
        kind: 'official_console',
        title: 'QR one-click app creation',
        titleZh: '扫码一键创建应用',
        description: 'Feishu/Lark documents a device authorization flow for creating apps. MindOS should adopt it next, but it is not wired into this local flow yet.',
        descriptionZh: '飞书/Lark 文档提供了设备授权创建应用流程。MindOS 后续应接入，但当前本地流程还未打通。',
        actionLabel: 'View docs',
        actionLabelZh: '查看文档',
        href: 'https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs',
        availability: 'planned',
      },
    ],
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'CLI_XXXXXXXXXXXXXXXXX', hint: 'From Credentials page on open.feishu.cn' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'XXXXXXXXXXXXXXXXXXXXXXXX', hint: 'Keep this secret — do not share' },
    ],
  },
  {
    id: 'discord', name: 'Discord', icon: '💬', iconFile: 'discord.svg',
    guide: '1. discord.com/developers → New Application\n2. Bot tab → Reset Token → copy\n3. Enable Message Content Intent',
    purpose: 'Send MindOS updates into Discord channels and DMs.',
    purposeZh: '把 MindOS 的更新发送到 Discord 频道或私信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. Discord channel or user ID',
    recipientExampleZh: '例如 Discord 频道 ID 或用户 ID',
    setupMethods: [
      {
        id: 'developer-portal',
        kind: 'official_console',
        title: 'Create bot in Developer Portal',
        titleZh: '在开发者平台创建机器人',
        description: 'Create a Discord application and bot, then paste the bot token. Server invite links require the application/client ID.',
        descriptionZh: '创建 Discord 应用和机器人，然后粘贴 bot token。邀请机器人进服务器还需要 application/client ID。',
        actionLabel: 'Open portal',
        actionLabelZh: '打开开发者平台',
        href: 'https://discord.com/developers/applications',
        qr: true,
        recommended: true,
        availability: 'available',
      },
      {
        id: 'bot-invite',
        kind: 'bot_invite',
        title: 'Bot invite link',
        titleZh: '机器人邀请链接',
        description: 'Discord supports OAuth2 bot invite URLs, but MindOS needs an application/client ID before generating a correct invite link.',
        descriptionZh: 'Discord 支持 OAuth2 机器人邀请链接，但 MindOS 需要先拿到 application/client ID 才能生成准确链接。',
        availability: 'after_credentials',
      },
    ],
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIxNzM...' },
    ],
  },
  {
    id: 'slack', name: 'Slack', icon: '💼', iconFile: 'slack.svg',
    guide: '1. api.slack.com/apps → Create New App\n2. OAuth & Permissions → add chat:write scope\n3. Install to Workspace → copy Bot Token',
    purpose: 'Route MindOS notifications into Slack channels and direct messages.',
    purposeZh: '把 MindOS 的通知发送到 Slack 频道或私信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'e.g. Slack channel or user ID like C123... or U123...',
    recipientExampleZh: '例如 Slack 频道 ID 或用户 ID（如 C123... / U123...）',
    setupMethods: [
      {
        id: 'create-app',
        kind: 'official_console',
        title: 'Create Slack app',
        titleZh: '创建 Slack App',
        description: 'Create an app, add chat:write, install it to a workspace, then paste the xoxb bot token.',
        descriptionZh: '创建应用，添加 chat:write，安装到 workspace，然后粘贴 xoxb bot token。',
        actionLabel: 'Open Slack apps',
        actionLabelZh: '打开 Slack Apps',
        href: 'https://api.slack.com/apps?new_app=1',
        qr: true,
        recommended: true,
        availability: 'available',
      },
      {
        id: 'oauth-install',
        kind: 'oauth_install',
        title: 'OAuth install',
        titleZh: 'OAuth 安装',
        description: 'Slack supports OAuth install links. MindOS needs a hosted or user-created Slack app before this can be a true one-click flow.',
        descriptionZh: 'Slack 支持 OAuth 安装链接。MindOS 需要官方托管或用户自建 Slack App 后，才能变成真正的一键流程。',
        availability: 'planned',
      },
    ],
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-xxxx-xxxx-xxxx', hint: 'Starts with xoxb-' },
    ],
  },
  {
    id: 'wecom', name: 'WeCom', icon: '🏢', iconFile: 'wecom.svg',
    guide: '1. Group chat → Add Robot → Custom\n2. Copy Webhook URL\n3. Extract the key parameter from URL',
    purpose: 'Deliver MindOS notifications into WeCom group chats.',
    purposeZh: '把 MindOS 通知投递到企业微信群聊。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use your configured robot or WeCom target',
    recipientExampleZh: '使用你配置好的机器人或企业微信目标',
    setupMethods: [
      {
        id: 'group-robot',
        kind: 'webhook_copy',
        title: 'Paste the full group robot webhook',
        titleZh: '粘贴完整群机器人 Webhook',
        description: 'MindOS accepts the full WeCom webhook URL and extracts the key automatically, so you do not need to split the URL by hand.',
        descriptionZh: 'MindOS 支持直接粘贴完整企业微信 Webhook URL，并自动提取 key，无需手工拆 URL。',
        actionLabel: 'Open docs',
        actionLabelZh: '打开文档',
        href: 'https://developer.work.weixin.qq.com/document/path/91770',
        recommended: true,
        availability: 'available',
      },
    ],
    fields: [
      { key: 'webhook_key', label: 'Webhook Key or URL', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...', hint: 'Paste the full webhook URL or only the key= value' },
    ],
  },
  {
    id: 'dingtalk', name: 'DingTalk', icon: '🔔', iconFile: 'dingtalk.svg',
    guide: '1. Group → Settings → Smart Assistant → Add Robot\n2. Select Custom (Webhook)\n3. Copy the full Webhook URL',
    purpose: 'Push MindOS notifications into DingTalk groups.',
    purposeZh: '把 MindOS 通知发送到钉钉群。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use your configured DingTalk robot target',
    recipientExampleZh: '使用你配置好的钉钉机器人目标',
    setupMethods: [
      {
        id: 'custom-robot',
        kind: 'webhook_copy',
        title: 'Create custom robot webhook',
        titleZh: '创建自定义机器人 Webhook',
        description: 'DingTalk custom robots expose a webhook URL. Paste the full URL here; add the signing secret only if the robot security mode uses signing.',
        descriptionZh: '钉钉自定义机器人会提供 Webhook URL。把完整 URL 粘贴到这里；如果机器人安全设置启用了加签，再填写 Signing Secret。',
        actionLabel: 'Open docs',
        actionLabelZh: '打开文档',
        href: 'https://open.dingtalk.com/document/robots/custom-robot-access',
        recommended: true,
        availability: 'available',
      },
    ],
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', hint: 'Full URL including access_token' },
      { key: 'webhook_secret', label: 'Signing Secret (optional)', placeholder: 'SECxxxxxxxxxxxxxxxx', hint: 'Only needed when DingTalk robot signing is enabled', optional: true },
    ],
  },
  {
    id: 'wechat', name: 'WeChat', icon: '💚', iconFile: 'wechat.svg',
    guide: '1. Visit ilinkai.weixin.qq.com\n2. Register & create a bot application\n3. QR login in the console → copy Bot Token from dashboard',
    purpose: 'Send MindOS updates to WeChat via your configured bot.',
    purposeZh: '通过你配置好的机器人把 MindOS 更新发送到微信。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use the WeChat user or chat ID supported by your bot',
    recipientExampleZh: '使用你的机器人支持的微信用户或群聊 ID',
    setupMethods: [
      {
        id: 'ilink-console',
        kind: 'official_console',
        title: 'QR login in third-party bot console',
        titleZh: '在第三方机器人控制台扫码登录',
        description: 'The current WeChat bridge flow depends on a third-party bot console token. Official Account OAuth is a different advanced flow.',
        descriptionZh: '当前微信桥接流程依赖第三方机器人控制台 token。公众号 OAuth 是另一套高级流程。',
        actionLabel: 'Open console',
        actionLabelZh: '打开控制台',
        href: 'https://ilinkai.weixin.qq.com/',
        qr: true,
        recommended: true,
        availability: 'available',
      },
      {
        id: 'official-account-oauth',
        kind: 'oauth_install',
        title: 'Official Account OAuth',
        titleZh: '公众号 OAuth',
        description: 'WeChat supports Official Account webpage authorization, but it requires a verified account and a different app model.',
        descriptionZh: '微信支持公众号网页授权，但需要已认证公众号和不同的应用模型。',
        href: 'https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/Wechat_webpage_authorization.html',
        availability: 'planned',
      },
    ],
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'wx_xxxxxxxxxxxxxxxx', hint: 'From iLink Bot console after QR login' },
    ],
  },
  {
    id: 'qq', name: 'QQ', icon: '🐧', iconFile: 'qq.svg',
    guide: '1. q.qq.com → Create Bot\n2. Development tab → copy App ID & Secret\n3. Add group/C2C intents as needed',
    purpose: 'Deliver MindOS notifications through QQ bot channels.',
    purposeZh: '通过 QQ 机器人频道接收 MindOS 通知。',
    useCases: ['Agent completion alerts', 'Error notifications', 'Test messages'],
    useCasesZh: ['Agent 完成提醒', '错误通知', '测试消息'],
    recipientExample: 'Use the QQ openid or group_openid for your target',
    recipientExampleZh: '使用目标 QQ 的 openid 或 group_openid',
    setupMethods: [
      {
        id: 'qq-bot-portal',
        kind: 'official_console',
        title: 'Create QQ bot',
        titleZh: '创建 QQ 机器人',
        description: 'Create a QQ bot and copy App ID / App Secret. QQ recipient IDs still come from the bot event context.',
        descriptionZh: '创建 QQ 机器人并复制 App ID / App Secret。QQ 接收者 ID 仍需来自机器人事件上下文。',
        actionLabel: 'Open QQ bot portal',
        actionLabelZh: '打开 QQ 机器人平台',
        href: 'https://q.qq.com/',
        qr: true,
        recommended: true,
        availability: 'available',
      },
    ],
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: '102xxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
];

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find(p => p.id === id);
}
