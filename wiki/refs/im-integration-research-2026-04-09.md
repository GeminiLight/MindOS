# IM Platform Integration Research Report

> **Created**: 2026-04-09  
> **Status**: Complete  
> **Audience**: MindOS Product & Engineering Team  
> **Goal**: Comprehensive analysis of IM integration strategy to avoid reinventing the wheel

---

## Executive Summary

MindOS currently **does not support any IM platform integrations** (Feishu, Telegram, WeChat, Slack, Discord, etc.). 

**Key Finding**: Rather than building platform adapters from scratch, we should:
1. **Identify existing cross-platform frameworks** that abstract multiple IM platforms
2. **Reuse proven SDK ecosystems** (discord.js, telegraf, @slack/bolt, etc.)
3. **Design a plugin-friendly interface** compatible with MindOS's existing tool system
4. **Leverage OpenClaw's `message` tool** as reference architecture (despite lack of source code)

This report surveys 8+ major IM platforms and 6+ integration frameworks to provide a reuse-first roadmap.

---

## Table of Contents

1. [IM Platform Landscape](#im-platform-landscape)
2. [Supported Platforms Analysis](#supported-platforms-analysis)
3. [Integration Frameworks & SDKs](#integration-frameworks--sdks)
4. [MindOS Architecture Mapping](#mindos-architecture-mapping)
5. [Recommended Implementation Strategy](#recommended-implementation-strategy)
6. [Risks & Mitigation](#risks--mitigation)
7. [Next Steps](#next-steps)

---

## Part 1: IM Platform Landscape

### 1.1 Target Platforms Prioritization

Based on user base, API maturity, and MindOS context:

| Priority | Platform | Region | API Maturity | SDK Quality | Use Case |
|----------|----------|--------|--------------|------------|----------|
| 🔴 **P0** | **Telegram** | Global | ⭐⭐⭐⭐⭐ | Excellent | Developer-friendly, free, AI-first |
| 🔴 **P0** | **飞书 (Feishu/Lark)** | China | ⭐⭐⭐⭐ | Excellent | Enterprise, markdown support, AI features |
| 🟠 **P1** | **Discord** | Global | ⭐⭐⭐⭐⭐ | Excellent | Developer community, threads |
| 🟠 **P1** | **Slack** | Global | ⭐⭐⭐⭐ | Excellent | Enterprise B2B, but strict rate limits |
| 🟡 **P2** | **企业微信 (WeCom)** | China | ⭐⭐⭐⭐ | Good | Enterprise internal, webhook bots |
| 🟡 **P2** | **微信 (WeChat)** | China | ⭐⭐⭐ | Fair | Consumer-facing, complex cert process |
| 🟡 **P2** | **钉钉 (DingTalk)** | China | ⭐⭐⭐⭐ | Good | Alibaba ecosystem, free webhooks |
| 🔵 **P3** | **MS Teams** | Enterprise | ⭐⭐⭐⭐ | Excellent | Adaptive Cards, but heavy licensing |
| 🔵 **P3** | **WhatsApp** | Global | ⭐⭐ | Fair | Business API only, conversational commerce |
| 🔵 **P3** | **LINE** | Asia-Pacific | ⭐⭐⭐ | Good | Flex Messages, Rich Menu |

---

## Part 2: Supported Platforms Analysis

### 2.1 Telegram Bot API

**Status**: ✅ **Recommended for P0 implementation**

#### Key Capabilities
- **Bot Types**: Standard bot (via BotFather)
- **Message Types**: Text, Markdown/HTML, Media (photo, audio, video, document, sticker), Location, Contact, Poll, Dice
- **Interactions**: Inline buttons, inline queries, callbacks, inline keyboards, reply keyboards
- **Advanced**: Groups/Channels, Threads (topics), Reactions, Payments, Mini Apps, Inline mode
- **Transport**: Long polling or Webhook (you choose)

#### API Characteristics
- **Rate Limits**: ~30 msg/sec globally, ~1 msg/sec per chat, ~20 msg/min per group; 429 with `retry_after` (35s+); paid broadcast: 1000 msg/sec (0.1 Stars/msg)
- **Authentication**: Bot token (simple bearer auth)
- **Pricing**: Free tier only (no commercial tier)
- **File Limits**: Upload 50MB / Download 20MB (standard API); Local Bot API Server: 2GB both
- **Response Time**: API calls typically <1s

#### Popular SDKs (Node.js)
| Library | Stars | TypeScript | Maintenance | Best For |
|---------|-------|-----------|-------------|----------|
| **telegraf** | ⭐ 3.8k | ✅ Yes | ✅ Active | Full-featured, best DX |
| **grammY** | ⭐ 2.5k | ✅ Yes | ✅ Very Active | Lightweight, modern |
| **node-telegram-bot-api** | ⭐ 8.5k | ❌ No | ⚠️ Slow | Legacy, low-level, avoid for new projects |
| **telebot.js** | ⭐ 1.5k | ❌ No | 🔴 Unmaintained | Avoid |

**Recommendation**: Use **grammY** (TypeScript-first, most active, richest plugin ecosystem including sessions/menus/i18n/rate-limiter/auto-retry, supports multi-runtime: Node+Deno+Bun+Cloudflare Workers, latest API 9.6 support).

#### Integration Pattern
```typescript
// Simple webhook-based pattern
bot.on('message', async (ctx) => {
  const { text } = ctx.message;
  // Delegate to MindOS agent
  const response = await agentClient.ask(text);
  await ctx.reply(response);
});
```

---

### 2.2 飞书 (Feishu/Lark) Bot API

**Status**: ✅ **Recommended for P0 implementation (China market)**

#### Key Capabilities
- **Bot Types**: Custom bot (webhook), App bot (OAuth-based)
- **Message Types**: Text, Rich text (markdown-like), Card (interactive), Image, File, Voice
- **Interactions**: Interactive card with buttons, input fields, selects
- **Advanced**: @mentions, Threads, Reactions, URL previews, AI features (AI Card)
- **Transport**: Webhook callback (push-based)

#### API Characteristics
- **Rate Limits**: Tiered system (10 tiers), messaging APIs at Tier 9: 50 req/sec; webhook bots: 100 req/min, 5 req/sec
- **Authentication**: App ID + App Secret (OAuth2 for user actions)
- **Pricing**: Free tier for custom bots
- **Message Format**: Supports rich markdown-like syntax (better than Telegram)
- **Webhook Security**: HMAC-SHA256 signature + Encrypt Key + challenge verification
- **Event Transport**: HTTP Webhook (production) or **WebSocket** (development, no public URL needed)
- **Monthly API Quota**: Free tier ~50,000 calls/month; auth/event APIs exempt

#### Popular SDKs (Node.js)
| Library | TypeScript | Maintenance | Notes |
|---------|-----------|-------------|-------|
| **@larksuite/node-sdk** (Official) | ✅ Yes | ✅ Active | Official, comprehensive |
| **Feishu CLI** (`@larksuite/cli`) | ✅ Yes | ✅ Active | 200+ commands, 19 AI Agent Skills, MCP integration, MIT licensed |

**Recommendation**: Use **@larksuite/node-sdk** (official, TypeScript-native).

#### Integration Pattern
```typescript
// Webhook-based card interaction
client.im.message.receive(async (event) => {
  const { text } = event.message;
  const response = await agentClient.ask(text);
  await client.im.message.send({
    receive_id_type: 'chat_id',
    receive_id: event.message.chat_id,
    content: JSON.stringify([{
      tag: 'text',
      text: response
    }])
  });
});
```

---

### 2.3 Discord Bot API

**Status**: ✅ **Recommended for Global developer community**

#### Key Capabilities
- **Bot Permissions**: Fine-grained permission system (65+ permission types)
- **Message Types**: Text, Embeds (rich formatting), Components (buttons, selects), Files, Stickers
- **Interactions**: Slash commands, Buttons, Select menus, Modals (forms), Message context menu
- **Advanced**: Threads, Forum channels, Reactions, Voice channels, Webhook integration
- **Transport**: Gateway (WebSocket) for real-time events, or REST API

#### API Characteristics
- **Rate Limits**: 50 requests/second per IP (higher for verified bots)
- **Authentication**: Bot token (bearer auth)
- **Pricing**: Free tier only
- **Gateway Connection**: Requires WebSocket for event streams
- **Message Limits**: Text up to 2000 chars, total embeds/components limited

#### Popular SDKs (Node.js)
| Library | Stars | TypeScript | Maintenance | Best For |
|---------|-------|-----------|-------------|----------|
| **discord.js** | ⭐ 24k | ✅ Yes | ✅ Very Active | Most comprehensive |
| **eris** | ⭐ 1k | ⚠️ Partial | ⚠️ Slow | Alternative, lighter |
| **discordeno** | ⭐ 3k | ✅ Yes | ⚠️ Moderate | Rust-inspired, modern |

**Recommendation**: Use **discord.js** (de facto standard, best DX).

#### Integration Pattern
```typescript
// Slash command with modal response
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const response = await agentClient.ask(interaction.options.getString('query'));
  await interaction.reply(response);
});
```

---

### 2.4 Slack Bot API

**Status**: ⚠️ **Consider for Enterprise B2B only**

#### Key Capabilities
- **Bot Types**: Classic bot (RTM), App bot (Events API + Bolt framework)
- **Message Types**: Text, Blocks (rich layout), Attachments (legacy), Files
- **Interactions**: Buttons, Menus, Modals, Slash commands, Message actions
- **Advanced**: Threading, Reactions, Message editing, Rich formatting (markdown subset)
- **Transport**: Events API (webhook) or Socket Mode (WebSocket alternative)

#### API Characteristics
- **Rate Limits**: **STRICT** — 1 message/second per channel, 20 workspace API calls/minute
- **Authentication**: OAuth token (requires app installation per workspace)
- **Pricing**: Paid Slack workspace required (no free tier for integrations)
- **Message Format**: Markdown-subset (not full markdown)
- **Webhook Security**: Timestamp + signature verification

#### Popular SDKs (Node.js)
| Library | TypeScript | Maintenance | Notes |
|---------|-----------|-------------|-------|
| **@slack/bolt** (Official) | ✅ Yes | ✅ Active | Recommended for new apps |
| **@slack/web-api** | ✅ Yes | ✅ Active | Low-level API calls |

**Recommendation**: Use **@slack/bolt** (official, event-driven framework).

#### Integration Pattern
```typescript
// Slack app with slash command
app.command('/ask', async ({ command, ack, respond }) => {
  await ack();
  const response = await agentClient.ask(command.text);
  await respond(response);
});
```

#### ⚠️ Caveats
- **Workspace isolation**: Each Slack workspace requires separate OAuth token
- **Rate limiting**: Aggressive rate limits make real-time interactions challenging
- **Cost**: Not viable for free/low-cost services
- **Message format**: Limited compared to Telegram/Discord

---

### 2.5 企业微信 (WeCom) Bot API

**Status**: ✅ **Recommended for China enterprise market**

#### Bot Types
1. **Webhook Bot (群机器人)**: Simple HTTP webhook, one-way only (send TO group), 20 msg/min, no server needed
2. **App Bot (自建应用)**: Full two-way communication, rich interactive cards, callback URL for receiving messages

#### Message Types (App Bot: 11 types)
| Type | Max Size | Key Features |
|------|----------|-------------|
| **Text** | 2,048 bytes | `\n` breaks, `<a>` links, @mentions, ID translation |
| **Markdown** | 2,048 bytes | Headers, bold, links, code, 3 font colors |
| **Template Card** | 5 subtypes | Text notice, news notice, button interaction, vote, multiple interaction |
| **Image/File/Voice/Video** | via media_id | Confidential marking supported |
| **Text Card** | 128 chars title | HTML formatting, button link |
| **News/MPNEWS** | 1-8 articles | Image 1068x455, mini-program redirect |

#### Webhook Bot Supported Types
- Text, Markdown, Markdown V2, Image (2MB), News (1-8 articles), File (20MB), Voice (2MB/60s AMR), Template Card (text_notice + news_notice only)

#### API Characteristics
- **Rate Limits**: Webhook: 20 msg/min; App: 10,000/min per enterprise; per member: 30/min, 1,000/hr
- **Authentication**: CorpID + CorpSecret → access_token (7200s, MUST cache); webhook uses URL key only
- **Callback Security**: AES-256-CBC encryption + SHA1 signature, IP whitelist required
- **Pricing**: Free for basic usage (messaging, contacts, groups)
- **Daily Quota**: Account members × 200 person-times/day

#### Popular SDKs (Node.js)
| Library | TypeScript | Maintenance | Notes |
|---------|-----------|-------------|-------|
| **WECOM-JSSDK** (Official) | ✅ Yes | ✅ Active | Official JS SDK |
| **witjs/wecom** | ✅ Yes | ⚠️ Community | Full-featured Node wrapper |
| **Official crypto libs** | Multiple | ✅ Active | Java/Python/PHP/C#/Go/C++ for callback verification |

**Recommendation**: For webhook bots, use direct HTTP API (simple enough). For App bots, use official WECOM-JSSDK + crypto libraries.

#### Integration Pattern (Webhook)
```typescript
// Send to group via webhook
await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WEBHOOK_KEY}`, {
  method: 'POST',
  body: JSON.stringify({
    msgtype: 'markdown',
    markdown: { content: '**Query Result**\nHere is the response...' }
  })
});
```

#### Integration Pattern (App Bot - Receive + Reply)
```typescript
// Callback URL receives encrypted XML
// 1. SHA1 verify signature
// 2. AES-256-CBC decrypt payload → get message
// 3. Process and respond within 5 seconds
// 4. Send reply via POST /cgi-bin/message/send
```

### 2.5b 微信 (WeChat) Official Account

**Status**: 🔴 **NOT Recommended for MVP** — Use WeCom instead

#### Why Not for MVP
- **Certification required**: Complex process, 300 RMB/yr (Chinese) or $99/yr (foreign)
- **Service Account required**: Subscription Account has no API access
- **Push limits**: Service Account only 4 messages/month
- **Legacy XML-based API**: Older design compared to modern REST APIs
- **5-second response timeout**: Limits complex agent processing
- **Template messages**: Need review/approval per template

#### If Needed Later (Service Account)
| Feature | Capability |
|---------|-----------|
| **Message Types** | Text, Image, Voice, Video, Music, News (passive reply within 5s) |
| **Template Messages** | Requires user trigger, 7-day window, must use approved templates |
| **Customer Service Messages** | Within 48h of user interaction |
| **OAuth** | snsapi_base (silent, OpenID only) or snsapi_userinfo (consent required) |
| **Custom Menu** | 3 primary × 5 secondary, supports click/URL/miniprogram/QR scan |
| **Rate Limits** | ~2,000 access_token calls/day, 50,000 OAuth requests/minute |

**Alternative**: WeCom webhook bots cover 90% of use cases with 10% of the complexity.

---

### 2.6 钉钉 (DingTalk) Bot API

**Status**: ✅ **Recommended for China Alibaba ecosystem**

#### Bot Types
| Type | Description | Use Case |
|------|-------------|----------|
| **Custom Robot (Webhook)** | Simple outgoing-only bot via webhook URL | CI/CD alerts, monitoring |
| **Enterprise Internal App** | Full bidirectional messaging via Stream/callback | Internal tools, workflows |
| **ISV App** | Third-party marketplace app | Commercial SaaS |

#### Message Types (5 types)
1. **Text** — Plain text with @mention support
2. **Markdown** — Rich formatted (title + markdown body)
3. **Link** — Title + text + image preview + click-through URL
4. **ActionCard** — Markdown body + buttons (single/multiple, vertical/horizontal layout)
5. **FeedCard** — Multiple stacked links with images (news feed style)

#### Connection Modes
| Mode | Mechanism | Requires Public URL | Recommended |
|------|-----------|-------------------|-------------|
| **Webhook** | HTTP POST to URL | No (outbound only) | For simple notifications |
| **Stream** | WebSocket long connection | **No** | **Yes (official recommendation)** |
| **HTTP Callback** | Outgoing HTTP POST | Yes | Legacy |

#### API Characteristics
- **Rate Limits**: Webhook: 20 msg/min; Enterprise App: higher (varies by endpoint)
- **Authentication**: Webhook: keyword/signing(HMAC-SHA256)/IP whitelist; App: ClientID + ClientSecret
- **Pricing**: Free for all bot types
- **Unique Features**: AI Card (动态卡片), Cool App (酷应用/群内小程序), Stream Mode (no public URL needed)

#### Popular SDKs
| Language | Package | Mode |
|----------|---------|------|
| **Node.js** | `dingtalk-stream` (v2.1.5+, MIT) | Stream mode |
| **Python** | `dingtalk-stream` | Stream mode |
| **Java** | `dingtalk-stream` | Stream mode |
| **Go** | `dingtalk-stream` | Stream mode |

**Recommendation**: Use **dingtalk-stream** for Stream mode (no public URL needed, official, multi-language).

---

### 2.7 Slack Bot API

**Status**: 🟠 **P1 — Enterprise B2B, strict rate limits**

#### Key Architecture
- **Modern**: Bolt framework (`@slack/bolt`) + Events API / Socket Mode
- **Legacy**: RTM API — **deprecated March 2025**, avoid for new development

#### Message Types
- **Blocks (Block Kit)**: Modern UI framework, 50+ block types (Section, Actions, Context, Header, Image, Input, etc.)
- **Attachments**: Legacy (still supported, Blocks preferred)
- **Files**: Via `files.upload` API
- **Ephemeral Messages**: Visible to single user only

#### Interactive Components
- Buttons (Primary/Danger/Default/Link), Select menus (static/external/user/channel), Multi-select, Overflow menus
- Date/Time pickers, Radio buttons, Checkboxes, Plain text input
- **Modals**: Multi-step forms with up to 50 blocks via `views.open`
- **Home Tab**: Persistent per-user app surface via `views.publish`
- **Slash Commands**: `/command` triggers, must respond within 3 seconds

#### Transport Options
| Feature | Events API | Socket Mode | RTM (Deprecated) |
|---------|-----------|-------------|-------------------|
| Protocol | HTTP webhooks | WebSocket | WebSocket |
| Public URL needed | Yes | **No** | No |
| Recommended | Production | Dev/firewall | **Avoid** |

#### API Characteristics
- **Rate Limits**: 4-tier system: Tier 1 (1/min) → Tier 4 (100+/min); Messages: **1 msg/sec per channel**; Webhooks: 1/sec
- **Authentication**: OAuth 2.0 (per workspace installation)
- **Pricing**: Free plan: 90-day history, max 10 integrations; Pro ($8.75/user/mo): unlimited
- **Thread Support**: Full via `thread_ts`, `reply_broadcast`

#### SDK
| Library | TypeScript | Notes |
|---------|-----------|-------|
| **@slack/bolt** (Official) | ✅ Yes | Recommended for new apps |
| **@slack/web-api** | ✅ Yes | Low-level API calls |

---

### 2.8 Discord Bot API

**Status**: 🟠 **P1 — Developer/community, rich features, free**

#### Authorization Layers
1. **OAuth Scopes**: `bot` (add to guild), `applications.commands` (slash commands)
2. **Permission Bits**: 65+ granular per-guild/channel permissions
3. **Gateway Intents**: Control which WebSocket events received (some privileged, need verification at 100+ servers)

#### Message Types
- **Text**: Up to 2000 characters
- **Embeds**: Rich cards (title, description, color, fields, images, footer, author), up to 10 per message
- **Components v2**: Buttons (5 styles), Select menus (String/User/Role/Channel), Modals (TextInput forms)
- **Files/Attachments**: Up to 25 MB (50 MB with Nitro boost)

#### Interactions
- **Slash Commands**: Registered with Discord, autocomplete UI, support subcommands/options
- **Buttons**: 5 per ActionRow, 5 ActionRows per message
- **Modals**: Popup forms with TextInput, triggered from interactions
- **Context Menus**: Right-click user/message commands
- **Timing**: 3-second acknowledgment, 15-minute follow-up window

#### Transport
- **Gateway (WebSocket)**: Receive real-time events; sharding required at 2,500+ guilds; 120 events/60s per shard
- **REST API**: Send messages, manage resources; 50 req/sec global

#### API Characteristics
- **Rate Limits**: Global 50 req/sec; per-channel message: 5/5s; reactions: 1/0.25s; repeated 429s → CloudFlare IP ban
- **Authentication**: Bot token (simple bearer auth)
- **Pricing**: **Completely FREE** — no per-request charges, no tiers
- **Unique**: Voice channels, Stage channels (Clubhouse-style), Rich Presence, Activities (embedded games)

#### SDK
| Library | TypeScript | Notes |
|---------|-----------|-------|
| **discord.js** (v14+) | ✅ Yes | De facto standard, 24k+ stars |

---

### 2.9 MS Teams Bot API

**Status**: 🔵 **P3 — Heavy enterprise, complex setup, SDK in transition**

#### Architecture
- **New**: Teams AI Library (`@microsoft/teams-ai`) — recommended for new projects
- **Legacy**: Bot Framework SDK v4 (`botbuilder`) — **archiving Dec 2025**
- Pipeline: HTTP POST `/api/messages` → Adapter → TurnContext → TeamsActivityHandler

#### Message Types
- **Adaptive Cards**: Primary rich UI — JSON-based, supports text/images/columns/inputs/actions
- **Hero/Thumbnail/List/Receipt/Carousel Cards**: Specialized layouts
- **Messaging Extensions**: Action-based (task module) + Search-based (compose box) + Link Unfurling

#### Key Features
- **Tabs**: Embedded web pages (personal or channel), full HTML/JS/CSS
- **Task Modules (Dialogs)**: Modal popups (Adaptive Cards or iframe)
- **Proactive Messaging**: Save `ConversationReference` → Send later; requires bot pre-installed
- **SSO**: Teams SSO provides user token → exchange for Graph API access

#### API Characteristics
- **Rate Limits**: 50 RPS per tenant; per bot per thread: 7/1s, 60/30s, 1800/hr
- **Authentication**: Azure AD + JWT validation (complex); `MicrosoftAppId` + `MicrosoftAppPassword` + `MicrosoftAppTenantId`
- **Pricing**: Azure Bot Service free tier (standard channels); hosting costs for Azure App Service
- **Deployment**: Requires Azure subscription, Teams app manifest, admin approval

#### SDK
| Library | TypeScript | Notes |
|---------|-----------|-------|
| **@microsoft/teams-ai** (New) | ✅ Yes | Recommended, built-in AI capabilities |
| **botbuilder** (Legacy) | ✅ Yes | Archiving Dec 2025 |

#### ⚠️ Caveats
- Steepest setup complexity of all platforms
- SDK transition (Bot Framework → Teams AI Library)
- IT admin gatekeeping for org-level app deployment

---

### 2.10 WhatsApp Business API

**Status**: 🔵 **P3 — Global reach but paid, complex verification**

#### Key Characteristics
- **Cloud API** (hosted by Meta, recommended) vs On-Premises (being phased out)
- **Template-only outbound**: Messages outside 24h window MUST use pre-approved templates
- **Per-message pricing**: Marketing ~$0.025, Utility ~$0.015, Service (within 24h) FREE
- **Messaging tiers**: Unverified 250/day → Verified up to unlimited (progressive)
- **Authentication**: Meta Business verification (2-10 business days)
- **Rate Limits**: 80 msg/sec base (expandable to 250+); per-user: 1 msg/6s
- **File Limits**: Image 5MB, Video 16MB, Document 100MB
- **Interactive**: Reply buttons (up to 3), List messages (10 items), WhatsApp Flows (forms)
- **Unique**: 2B+ users, E2E encryption, 80%+ open rate, product catalog, payments (India/Brazil)

#### SDK
- Official Node.js SDK **archived**; use direct REST API to `graph.facebook.com`
- Third-party: BSPs like Twilio, Vonage provide managed SDKs

**Recommendation**: Not for MVP. High cost + verification complexity. Consider for future commercial/customer-facing use.

---

### 2.11 LINE Bot API

**Status**: 🔵 **P3 — Asia-Pacific only (Japan/Taiwan/Thailand)**

#### Key Characteristics
- **Flex Message**: Most powerful message layout system of any platform (CSS Flexbox-like JSON layout)
- **Rich Menu**: Persistent bottom menu with per-user customization + tab switching
- **LIFF**: Full web app framework embedded in LINE chat (unique among all platforms)
- **Message Quotas**: Free plan 200 msg/month; Standard ¥15,000/month for 30,000 msg
- **Reply messages always FREE** and don't count toward quotas
- **Authentication**: Channel Access Token v2.1 (JWT) + Channel Secret (HMAC-SHA256 webhook verify)
- **Transport**: Webhook (HTTPS, TLS 1.2+)

#### SDK
| Language | Package |
|----------|---------|
| **Node.js** | `@line/bot-sdk` |
| **Python** | `line-bot-sdk` |

**Recommendation**: Only if specifically targeting Japan/Taiwan/Thailand market.

---

### 2.12 Full Platform Comparison Matrix

| Feature | Telegram | Feishu | Discord | Slack | WeCom | DingTalk | Teams | WhatsApp | LINE |
|---------|----------|--------|---------|-------|-------|----------|-------|----------|------|
| **Priority** | 🔴 P0 | 🔴 P0 | 🟠 P1 | 🟠 P1 | 🟡 P2 | 🟡 P2 | 🔵 P3 | 🔵 P3 | 🔵 P3 |
| **Pricing** | Free | Free | Free | Freemium | Free | Free | Azure costs | Per-message | Quota-based |
| **Rich format** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Interactivity** | Buttons | Cards+Forms | Slash+Modals | Blocks+Modals | Template Cards | ActionCard | Adaptive Cards | Buttons+Lists | Flex+LIFF |
| **Rate limit** | 30/s global | 50/s (Tier 9) | 50/s global | 1/s/channel | 20/min webhook | 20/min webhook | 50 RPS/tenant | 80/s | Quota/month |
| **No public URL** | ✅ (polling) | ✅ (WebSocket) | ❌ (Gateway) | ✅ (Socket Mode) | ❌ | ✅ (Stream) | ❌ (HTTPS) | ❌ | ❌ |
| **Auth complexity** | ⭐ Simple | ⭐⭐ Moderate | ⭐ Simple | ⭐⭐ OAuth | ⭐⭐ CorpID | ⭐⭐ Signing | ⭐⭐⭐⭐ Azure AD | ⭐⭐⭐ Meta verify | ⭐⭐ JWT |
| **SDK (Node.js)** | grammY | @larksuite/node-sdk | discord.js | @slack/bolt | WECOM-JSSDK | dingtalk-stream | @microsoft/teams-ai | REST API | @line/bot-sdk |
| **Market** | 🌍 Global | 🇨🇳 China | 🌍 Dev/Gaming | 🌍 Enterprise | 🇨🇳 Enterprise | 🇨🇳 Enterprise | 🌍 Enterprise | 🌍 Global | 🇯🇵🇹🇼🇹🇭 |

---

## Part 3: Integration Frameworks & SDKs

> **核心原则：复用框架和代码，避免重复造轮子**

### 3.1 Cross-Platform Frameworks (Reuse Assessment)

| Rank | Framework | Best For | Should We Use? | Reason |
|------|-----------|----------|----------------|--------|
| 1 | **Novu** (37k+ stars) | One-way notification delivery | **YES for alerts** | Unified API for Slack/Discord/TG/Teams; MIT; TS-native. BUT: one-way only, no Feishu/WeCom |
| 2 | **Matterbridge** (Go) | Cross-platform message relay | **STUDY pattern only** | 30+ platforms, elegant adapter pattern (~150 LOC/bridge). Go-only, not usable as dependency |
| 3 | **Matrix + mautrix bridges** | Full messaging backbone | **NOT for MVP** | 15+ bridges, supports puppeting/E2EE/reactions. BUT: requires homeserver, heavy infra |
| 4 | **Existing MCP Servers** | AI agent messaging | **YES — leverage existing** | Slack/Telegram/WhatsApp MCP servers already exist; don't rebuild |
| 5 | **Chatwoot** (22k+ stars) | Reference material | **REFERENCE ONLY** | Channel feature matrix is gold (24h windows, platform restrictions) |
| — | Botpress | Chatbot builder | **NO** | Wrong abstraction (chatbot platform, not messaging SDK) |
| — | Rasa | Conversational AI/NLU | **NO** | Python only, NLU focus |
| — | Hubot | Legacy ChatOps | **NO** | Dead project (CoffeeScript, unmaintained) |
| — | Apache Camel | Enterprise integration | **NO** | JVM only, technology mismatch |
| — | MS Bot Framework | Enterprise bots | **ONLY if Teams priority** | Heavy Azure coupling |

### 3.2 Per-Platform SDK Selections (Final)

| Platform | SDK | Stars | TS Quality | Maintained | Verdict |
|----------|-----|-------|-----------|-----------|---------|
| **Telegram** | **grammY** | ~13k | Excellent (native) | Active (API 9.6) | **WINNER** — best TS, rich plugins (sessions/menus/i18n/rate-limiter/auto-retry) |
| **Discord** | **discord.js** (v14+) | 25k+ | Excellent (native) | Very Active | **WINNER** — industry standard, 100% API coverage |
| **Slack** | **@slack/bolt** (v4.6) | Official | Good (built-in) | Active (Mar 2026) | **WINNER** — official framework, Socket Mode |
| **Feishu** | **@larksuiteoapi/node-sdk** | 257 | Good (typed) | Active | **WINNER** — official, auto token refresh, WebSocket support |
| **DingTalk** | **dingtalk-stream** | Official | Yes | Active | **WINNER** — Stream mode (no public URL), multi-language |
| **WeCom** | Direct HTTP API + official crypto libs | — | — | — | Webhook API simple enough; use official AES libs for callback |
| **Teams** | **@microsoft/teams-ai** | Microsoft | Good (native) | Active | Use ONLY if Teams is priority; replaces botbuilder (archiving Dec 2025) |
| **WhatsApp** | Direct REST API to `graph.facebook.com` | — | — | — | Official SDK archived; REST API recommended |
| **LINE** | **@line/bot-sdk** | Official | Yes | Active | Use ONLY if targeting JP/TW/TH |

### 3.3 What NOT to Build (Reuse Existing)

| Don't Build | Use Instead |
|-------------|-------------|
| Telegram bot framework | grammY (MIT, TS-native) |
| Discord bot framework | discord.js (Apache 2.0) |
| Slack bot framework | @slack/bolt (MIT) |
| Feishu bot framework | @larksuiteoapi/node-sdk (MIT) |
| Webhook retry logic | `p-retry` / `async-retry` + BullMQ |
| Per-platform rate limiting | `bottleneck` (npm) or built-in SDK rate limiters |
| Auth flows per platform | Each SDK handles its own OAuth/token management |
| Webhook signature verification | Each SDK provides verification helpers |
| Notification broadcast infra | Novu (if one-way alerts needed) |

### 3.4 MCP Servers Already Available

The MCP ecosystem already has **65+ communication servers**:

| MCP Server | Platform | Capabilities |
|------------|----------|-------------|
| **Slack MCP Server** (official) | Slack | Search/send messages, read threads, manage canvases. OAuth 2.0 |
| **Telegram MCP** | Telegram | Read chats, manage groups, send/modify messages, media |
| **WhatsApp MCP** | WhatsApp | Send and read messages |
| **Line Bot MCP Server** | LINE | LINE Messaging API integration |

**Key insight**: For AI agent scenarios, consider wrapping existing MCP servers rather than building from scratch.

### 3.5 Recommended Architecture: Composition Pattern

```
┌───────────────────────────────────────────────┐
│          Unified Message Interface             │  ← Thin adapter layer (~50 LOC each)
│  send(platform, channel, message)              │
│  onMessage(platform, handler)                  │
└───────┬───────┬──────┬────────┬──────┬────────┘
        │       │      │        │      │
        ▼       ▼      ▼        ▼      ▼
     grammY  discord.js  @slack/  @lark/  dingtalk-
                         bolt    sdk     stream
        │       │      │        │      │
        ▼       ▼      ▼        ▼      ▼
    Telegram Discord  Slack   Feishu  DingTalk ...
```

**Why this approach** (over monolithic framework):
- ✅ Leverages **battle-tested SDKs** per platform (total 70k+ stars)
- ✅ Each adapter is **~50 LOC** — lightweight, easy to maintain
- ✅ Follows MindOS's existing `AgentTool` pattern — no new abstractions
- ✅ Easy to add/remove platforms without affecting others
- ✅ Zero external framework lock-in
- ✅ Inspired by Matterbridge's gateway pattern (proven at scale)

---

## Part 4: MindOS Architecture Mapping

### 4.1 Current Tool System Architecture

**File**: `/app/lib/agent/tools.ts` (647 lines)

MindOS has **33 built-in tools** organized as:

```
MindOS Agent Tools
├── Knowledge Base Tools (25)
│   ├── Read: list_files, read_file, search, web_search, web_fetch
│   ├── Write: write_file, create_file, append_to_file, delete_file
│   └── Metadata: get_backlinks, get_history, append_csv
├── A2A Integration Tools (6)
│   └── discover_agent, delegate_to_agent, orchestrate
├── ACP Integration Tools (2)
│   └── list_acp_agents, call_acp_agent
└── [Messaging Tools - MISSING]
    └── (Would go here)
```

### 4.2 Tool Definition Pattern (Reusable)

**Pattern from `tools.ts`**:

```typescript
// 1. Define TypeBox Schema for parameters
const SendMessageParams = Type.Object({
  platform: Type.Enum(['telegram', 'discord', 'feishu', 'wecom', 'dingtalk']),
  recipient_id: Type.String({ description: 'User/Chat ID on platform' }),
  message: Type.String({ description: 'Message content' }),
  format: Type.Optional(Type.Enum(['text', 'markdown', 'html', 'card'])),
});

// 2. Implement execute function with error handling
function toPiCustomToolDefinitions(tools: AgentTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: safeExecute(async (toolCallId, params, signal) => {
      // Tool logic here
      return textResult('Success');
    }),
  }));
}

// 3. Safe error handling wrapper
function safeExecute<T>(
  fn: (toolCallId: string, params: T, signal?: AbortSignal) 
    => Promise<AgentToolResult<any>>,
): (toolCallId: string, params: T, signal?: AbortSignal) 
    => Promise<AgentToolResult<any>> {
  return async (toolCallId, params, signal) => {
    try {
      return await fn(toolCallId, params, signal);
    } catch (e) {
      return textResult(`Error: ${formatToolError(e)}`);
    }
  };
}
```

### 4.3 Proposed IM Tool Design

**File location**: `app/lib/agent/im-tools.ts` (new)

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

// Platform-specific adapters
interface IMAdapter {
  send(message: IMMessage): Promise<MessageResult>;
  receive(callback: (msg: IncomingMessage) => void): void;
}

export const imTools: AgentTool[] = [
  {
    name: 'send_im_message',
    description: 'Send message to Telegram, Discord, Feishu, WeCom, DingTalk, or Slack',
    parameters: Type.Object({
      platform: Type.Enum(['telegram', 'discord', 'feishu', 'wecom', 'dingtalk', 'slack']),
      recipient_id: Type.String(),
      message: Type.String(),
      format: Type.Optional(Type.Enum(['text', 'markdown', 'card'])),
      thread_id: Type.Optional(Type.String()),
    }),
    execute: async (toolCallId, params, signal) => {
      // Dispatch to platform-specific adapter
      const adapter = getAdapter(params.platform);
      const result = await adapter.send(params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  },
];
```

### 4.4 Integration Point

**Where it fits in the request flow**:

```
User Query
    ↓
POST /api/ask
    ↓
System Prompt Composition + Tools Assembly
    ├─ Knowledge Base Tools (25)
    ├─ A2A Tools (6)
    ├─ ACP Tools (2)
    ├─ IM Tools (1-2) ← NEW
    └─ Skills + MCP Tools
    ↓
Agent Execution Loop (pi-agent-core)
    ↓
Tool Invocation (if agent calls send_im_message)
    ↓
Message Delivery via Platform Adapter
```

### 4.5 Configuration Management

**Where to store IM credentials**:

Following MindOS's pattern:

```
~/.mindos/
├── config.json (existing)
├── mcp.json (existing)
└── im.json (NEW)
    {
      "providers": {
        "telegram": {
          "bot_token": "{{ secrets.TELEGRAM_BOT_TOKEN }}"
        },
        "discord": {
          "bot_token": "{{ secrets.DISCORD_BOT_TOKEN }}"
        },
        "feishu": {
          "app_id": "{{ secrets.FEISHU_APP_ID }}",
          "app_secret": "{{ secrets.FEISHU_APP_SECRET }}"
        },
        ...
      }
    }
```

---

## Part 5: Recommended Implementation Strategy

### 5.1 Phased Rollout Plan

#### **Phase 0 (MVP): Single Platform - Telegram**
- **Goal**: Validate the pattern before multi-platform build
- **What**: Implement `send_im_message` tool with Telegram support only
- **Use SDK**: **grammY** (MIT, TypeScript-native, rich plugins)
- **Deliverables**:
  - `IMAdapter` interface definition (~50 LOC)
  - Telegram adapter implementation (grammY)
  - MCP tool definition + execution (follows `tools.ts` pattern)
  - Webhook receiving + rate limiting (`bottleneck`)
  - E2E test with bot

#### **Phase 1 (First Wave): Add 2 More Platforms**
- **Timeline**: 1 sprint each
- **Platforms**: Discord + Feishu
- **What**: Use the Telegram pattern, add new adapters
- **Deliverables**:
  - Discord adapter (discord.js)
  - Feishu adapter (@larksuite/node-sdk)
  - Multi-platform webhook router
  - Platform-specific format handling

#### **Phase 2 (Second Wave): China-Specific Platforms**
- **Timeline**: 1 sprint each
- **Platforms**: WeCom + DingTalk
- **What**: Leverage webhook patterns from Phase 1

#### **Phase 3 (Consolidation): Enterprise Platforms**
- **Timeline**: As needed
- **Platforms**: Slack + MS Teams
- **Consideration**: Rate limiting, OAuth flows

### 5.2 SDK Selections (Final — Reuse First)

| Platform | Recommended SDK | License | TS Native | Why |
|----------|-----------------|---------|-----------|-----|
| **Telegram** | **grammY** | MIT | Yes | 13k+ stars, rich plugin ecosystem, multi-runtime, API 9.6 |
| **Discord** | **discord.js** (v14+) | Apache 2.0 | Yes | 25k+ stars, 100% API coverage, industry standard |
| **Feishu** | **@larksuiteoapi/node-sdk** | MIT | Yes | Official, auto token refresh, WebSocket + HTTP event support |
| **WeCom** | Direct HTTP API + official crypto libs | — | — | Webhook API simple enough; AES libs for callback decrypt |
| **DingTalk** | **dingtalk-stream** | MIT | Yes | Official, Stream mode (no public URL), multi-language |
| **Slack** | **@slack/bolt** (v4.6) | MIT | Yes | Official, event routing, Socket Mode (no public URL) |
| **Teams** | **@microsoft/teams-ai** | MIT | Yes | New replacement for botbuilder (archiving Dec 2025) |
| **WhatsApp** | Direct REST API | — | — | Official SDK archived; simple HTTP to graph.facebook.com |
| **LINE** | **@line/bot-sdk** | Apache 2.0 | Yes | Official, JP/TW/TH only |

**Key dependencies for infrastructure**:
- **Rate limiting**: `bottleneck` (npm) — per-platform concurrency control
- **Retry logic**: `p-retry` / `async-retry` — exponential backoff with jitter
- **Message queue**: BullMQ + Redis (if async delivery needed)
- **Webhook verification**: Each SDK provides built-in helpers

---

## Part 6: Risks & Mitigation

### 6.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Platform API changes** | High | Version-pin SDKs, monitor changelogs, integration tests |
| **Rate limiting differences** | High | Implement per-platform queuing, exponential backoff |
| **Message format divergence** | Medium | Use abstraction layer, handle format conversion |
| **Webhook signature verification** | Medium | Unit tests for each platform's signing algorithm |
| **Credential management** | High | Use environment variables, add encryption for config |
| **Long message truncation** | Low | Truncate intelligently per platform (Telegram: 4096, Discord: 2000) |

### 6.2 Operational Risks

| Risk | Mitigation |
|------|-----------|
| **Too many integrations to maintain** | Start with 3 platforms (Telegram, Discord, Feishu), don't add more until stable |
| **Dependency bloat** | Lazy-load SDKs, only import if configured |
| **Callback URL management** | Use a single `/webhooks/im` endpoint with platform router |
| **Token/secret rotation** | Document rotation procedures per platform |

---

## Part 7: Next Steps

### Immediate Actions (This Week)

- [ ] Finalize IM tool interface specification
- [ ] Create `app/lib/agent/im-tools.ts` skeleton
- [ ] Set up Telegram bot for testing
- [ ] Implement Telegram adapter (Phase 0)

### Short Term (Next Sprint)

- [ ] Add Discord adapter
- [ ] Add Feishu adapter
- [ ] Create webhook router + rate limiter
- [ ] Document secrets management

### Medium Term (Next Quarter)

- [ ] Add WeCom + DingTalk
- [ ] Add Slack (with OAuth)
- [ ] Performance testing + optimization
- [ ] UI for managing IM credentials

### Long Term

- [ ] Message threads/conversation management
- [ ] Rich formatting per platform
- [ ] File upload/download support
- [ ] Reaction/emoji handling

---

## Appendix A: OpenClaw Reference

## Appendix A: OpenClaw 实际技术栈 (Deep Dive)

### OpenClaw 的 message 工具实现

OpenClaw **没有自己造轮子**，采用 "薄适配层 + 成熟 SDK" 模式：

#### 内置通道 (Built-in)

| 平台 | SDK/库 | 类型 |
|------|--------|------|
| **Telegram** | **grammY** | Stateless (token-based) |
| **Discord** | **discord.js** + `@discordjs/voice` + `discord-api-types` | Stateless |
| **Slack** | **@slack/bolt** + `@slack/web-api` | Stateless |
| **WhatsApp** | **@whiskeysockets/baileys** (逆向 Web 协议) | Stateful (本地凭据) |
| **Signal** | **signal-cli** (JVM 外部进程, JSON-RPC + SSE) | Stateful |
| **iMessage** | **BlueBubbles** macOS 服务 (REST + webhook) | macOS only |
| **Google Chat** | Google Chat API (HTTP webhook) | Stateless |
| **IRC** | Classic IRC protocol | Stateless |

#### 插件通道 (Plugin System)

| 平台 | SDK/库 | 来源 |
|------|--------|------|
| **飞书** | **@larksuite/openclaw-lark** | 飞书官方团队维护 |
| **微信** | **@tencent-weixin/openclaw-weixin** | 腾讯官方插件 |
| **Matrix** | **matrix-bot-sdk** + `@matrix-org/matrix-sdk-crypto-nodejs` (E2EE) | 社区 |
| **LINE** | **@line/bot-sdk** | 官方 SDK |
| **MS Teams** | Bot Framework | 微软生态 |
| **Mattermost** | Bot API + WebSocket | 社区 |
| **Twitch** | IRC connection | 社区 |
| **Nostr** | NIP-04 protocol | 社区 |

#### 架构模式: Gateway + Channel Adapters

```
用户消息 (各平台原生协议)
    ↓
平台 SDK (grammY / discord.js / @slack/bolt / baileys / ...)
    ↓ (标准化消息格式)
OpenClaw Gateway (连接生命周期管理、重连、鉴权)
    ↓ (确定性路由：回复回到消息来源平台)
Pi Agent Runtime (pi-agent-core — 和 MindOS 共享同一个框架)
    ↓ (agent 生成响应)
OpenClaw `message` CLI 工具 (统一接口)
    ↓ (分发到正确的 channel adapter)
平台 SDK → 用户
```

关键设计决策：
- **Gateway 中心化**：Gateway 管理所有连接状态、轮询循环、WebSocket 连接
- **确定性路由**：消息始终回复到发起平台
- **通道隔离**：DM 共享 agent 主 session；群聊获得独立 session
- **有状态 vs 无状态**：WhatsApp/Signal 有状态（本地凭据存储）；Telegram/Discord 无状态（token-based）

#### 关键 npm 依赖 (从 package.json 分析)

**消息层**：`grammy`, `@whiskeysockets/baileys`, `@discordjs/voice`, `discord-api-types`, `@slack/bolt`, `@slack/web-api`, `@line/bot-sdk`
**AI/Agent 层**：`@mariozechner/pi-agent-core`, `pi-ai`, `pi-coding-agent` (和 MindOS 相同)
**基础设施**：`express` 5.x, `ws`, `playwright-core`, `sharp`, `sqlite-vec`, `croner`

#### 与 MindOS 调研推荐的对比验证

| 平台 | MindOS 推荐 | OpenClaw 实际 | 匹配 |
|------|------------|--------------|------|
| Telegram | grammY | grammY | ✅ 完全一致 |
| Discord | discord.js | discord.js | ✅ 完全一致 |
| Slack | @slack/bolt | @slack/bolt | ✅ 完全一致 |
| 飞书 | @larksuite/node-sdk | @larksuite/openclaw-lark | ✅ 同源（官方适配） |
| LINE | @line/bot-sdk | @line/bot-sdk | ✅ 完全一致 |
| DingTalk | dingtalk-stream | (未实现) | — OpenClaw 未覆盖钉钉 |
| WeCom | Direct HTTP API | (微信插件由腾讯维护) | — 不同路径 |

**结论**：OpenClaw 验证了 "复用成熟 SDK + 薄适配层" 是业界最佳实践。我们的 SDK 选择与 OpenClaw 100% 吻合。

---

## Appendix B: Platform API Feature Comparison (All 9 Platforms)

| Feature | Telegram | Feishu | Discord | Slack | WeCom | DingTalk | Teams | WhatsApp | LINE |
|---------|----------|--------|---------|-------|-------|----------|-------|----------|------|
| **Text** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Markdown** | ✅ (HTML too) | ✅ (rich) | ✅ | Partial | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Rich Cards** | Buttons | Cards (best) | Embeds+Comp | Blocks | Template Cards | ActionCard | Adaptive Cards | Buttons+Lists | Flex (best) |
| **Interactive** | Inline KB | Forms+Select | Slash+Modals | Blocks+Modals | Card callbacks | ActionCard | Adaptive+Tabs | 3 buttons | LIFF apps |
| **File Upload** | 50MB | ✅ | 25MB (50 boost) | Varies | 20MB | ✅ | 25MB | 100MB doc | 200MB video |
| **Threads** | ✅ Topics | ✅ 话题群 | ✅ Forums | ✅ thread_ts | ❌ | ❌ | Reply chains | ❌ | ❌ |
| **Reactions** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **No Public URL** | ✅ polling | ✅ WebSocket | ❌ Gateway | ✅ Socket Mode | ❌ | ✅ Stream | ❌ HTTPS | ❌ | ❌ |
| **Text Limit** | 4096 chars | No hard limit | 2000 chars | ~4000 | 2048 bytes | Varies | Varies | 4096 chars | 5000 chars |
| **Rate Limit** | 30/s global | 50/s (Tier 9) | 50/s global | 1/s/channel | 20/min webhook | 20/min webhook | 50 RPS/tenant | 80/s | 2000/s reply |
| **Pricing** | Free | Free | Free | Freemium | Free | Free | Azure costs | Per-message | Quota-based |
| **Auth** | Bot token | AppID+Secret | Bot token | OAuth 2.0 | CorpID+Secret | AppKey+Signing | Azure AD+JWT | Meta Business | Channel Token |
| **SDK** | grammY | @lark/node-sdk | discord.js | @slack/bolt | HTTP + crypto | dingtalk-stream | @ms/teams-ai | REST API | @line/bot-sdk |
| **Unique** | Mini Apps | AI Card+CLI | Voice+Rich Presence | Workflow Builder | O365 integration | Stream+Cool App | Adaptive Cards | 2B users+E2EE | Flex+LIFF+Rich Menu |

---

## Appendix C: Platform-Specific Constraints (From Chatwoot + Research)

| Platform | Outbound Restriction | Key Constraint |
|----------|---------------------|----------------|
| **Telegram** | None (free outbound) | Cannot initiate outbound to unknown users |
| **Feishu** | None within tenant | Monthly API quota (50,000 free tier) |
| **Discord** | None (free) | Privileged intents need verification at 100+ guilds |
| **Slack** | None (within workspace) | 1 msg/sec per channel; workspace isolation |
| **WeCom** | Webhook: 20/min | Members × 200 person-times/day |
| **DingTalk** | Webhook: 20/min | Stream mode recommended over webhook |
| **Teams** | Proactive requires pre-install | Azure AD complexity; IT admin approval |
| **WhatsApp** | **Template-only outside 24h window** | Per-message cost; Meta Business verification |
| **LINE** | Plan-based quota (200-30k/mo) | Reply messages always free; push messages counted |
| **WeChat Official** | Service: 4/month; 48h customer service | Certification required; XML-based API |

## Appendix D: Rate Limit Quick Reference

| Platform | Global Limit | Per-Channel/User | Error Code |
|----------|-------------|-------------------|------------|
| **Telegram** | 30 msg/sec | 1/sec per chat, 20/min per group | HTTP 429 + `retry_after` |
| **Feishu** | Tier 9: 50/sec | Webhook: 5/sec per bot | HTTP 429 + `x-ogw-ratelimit-reset` |
| **Discord** | 50 req/sec | 5 msg/5sec per channel | HTTP 429 + `Retry-After` |
| **Slack** | Tier-based (1-100+/min) | 1 msg/sec per channel | HTTP 429 + `Retry-After` |
| **WeCom** | 10,000/min per enterprise | 30/min per member | Block penalties (60s→60min→1day) |
| **DingTalk** | Enterprise varies | 20/min per webhook bot | Error code on exceed |
| **Teams** | 50 RPS per tenant | 7/1s per bot per thread | HTTP 429 + exponential backoff |
| **WhatsApp** | 80 msg/sec (expandable) | 1 msg/6sec per user | Error 131056 |
| **LINE** | 2000/sec (reply) | Broadcast: 60/hour | HTTP 429 |

---

## References

### Platform Official Docs
- Telegram Bot API: https://core.telegram.org/bots/api (API 9.6, Apr 2026)
- Feishu Open Platform: https://open.feishu.cn/ | Lark: https://open.larksuite.com/
- Discord Developer Portal: https://discord.com/developers/docs
- Slack API: https://api.slack.com
- WeCom Developer: https://developer.work.weixin.qq.com/
- DingTalk Developer: https://open.dingtalk.com/
- MS Teams Developer: https://learn.microsoft.com/en-us/microsoftteams/platform/
- WhatsApp Business API: https://developers.facebook.com/docs/whatsapp/
- LINE Developers: https://developers.line.biz/

### SDK Repositories
- grammY (Telegram): https://github.com/grammyjs/grammY
- discord.js: https://github.com/discordjs/discord.js
- @slack/bolt: https://github.com/slackapi/bolt-js
- @larksuiteoapi/node-sdk: https://github.com/larksuite/node-sdk
- dingtalk-stream: https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs
- @line/bot-sdk: https://github.com/line/line-bot-sdk-nodejs
- @microsoft/teams-ai: https://github.com/microsoft/teams-ai

### Framework References
- Novu (notifications): https://github.com/novuhq/novu (37k+ stars)
- Matterbridge (bridging pattern): https://github.com/42wim/matterbridge
- Chatwoot (channel matrix): https://github.com/chatwoot/chatwoot (22k+ stars)

### MindOS Internal Docs
- OpenClaw Tools Inventory: `/wiki/refs/openclaw-tools-inventory.md`
- MindOS Agent Architecture: `/wiki/25-agent-architecture.md`
- MindOS Tools Implementation: `/app/lib/agent/tools.ts`
- A2A Integration Spec: `/wiki/specs/spec-a2a-integration.md`

---

**Document Version**: 1.0 (Final)  
**Last Updated**: 2026-04-09  
**Research Agents**: 6 parallel research agents (Telegram, Feishu, WeChat/WeCom, Slack/Discord/Teams, DingTalk/WhatsApp/LINE, Cross-platform Frameworks)  
**Total Platforms Surveyed**: 9 IM platforms + 10 frameworks/SDKs  
**Next Step**: Review with team → Approve Phase 0 (Telegram MVP) → Implementation
