# Spec: Channel/Credentials UI Refinement

## 目标

将 Channel 配置界面从"功能完整但设计混乱"(6/10 UX) 升级到"精致、易用、无障碍达标"(8.5+/10)。重点：
1. 修复视觉层级混乱(标题权重、信息分组)
2. 统一表单设计(标签一致性、占位符、帮助文本)
3. 增强用户引导(空状态、Setup Guide 强调、错误反馈)
4. 完整无障碍(ARIA、keyboard nav、focus 管理)
5. 响应式适配(375px 移动端、768px 平板)

---

## 现状分析

### 问题根源(审计发现)

| 维度 | 当前评分 | 问题 |
|------|---------|------|
| 视觉层级 | 6/10 | 标题"Feishu"与状态"Set up"权重接近,用户分不出重点 |
| 间距排版 | 5/10 | 卡片间 8px vs 16px 混用,标签大小写混乱 |
| 色彩深度 | 7/10 | 系统色基本遵循,但状态显示不够清晰 |
| 可用性 | 6/10 | 表单验证滞后,密码按钮缺 aria-label |
| 产品质量 | 6/10 | 空状态无插图/CTA,Setup Guide 缺乏强调 |
| 无障碍 | 5/10 | 缺 ARIA、focus 管理、keyboard nav 不全 |
| 响应式 | 6/10 | 375px 两列网格严重拥挤 |

### 现有架构

```
AgentsContentChannels.tsx (overview)
  └── AgentsContentChannelDetail.tsx (detail)
      └── Platform form (未配置 | 已配置)
          ├── Setup Guide (static)
          ├── Configure Form (password fields + save)
          └── [Connected] Test Send + Disconnect

IMChannelsView.tsx (sidebar nav)
  └── Platform list with status dots

platforms.ts (platform metadata)
  └── Field definitions (label, placeholder, hint)
```

---

## 用户目标与流程

### User Flow 1: 配置新的 Bot 凭证(Feishu 示例)

**用户目标**: 在 MindOS 中连接 Feishu Bot,让 Agent 能发送消息

**前置条件**: 
- 用户已在 Feishu 开放平台创建了 App
- 已获得 App ID 和 App Secret
- 初次进入或上次配置失败

**完整流程**:

```
Step 1: 用户在侧边栏点击 "Channels"
  → 系统反馈: 跳转到 Channels Overview 页面(2 列平台网格)
  → 状态变化: 显示所有 8 个平台卡片,统计信息(0/8 connected)

Step 2: 用户在网格中找到并点击 Feishu 卡片
  → 系统反馈: 跳转到 Feishu 详情页,显示"🐦 Feishu"标题 + "配置"状态
  → 状态变化: 显示 Setup Guide 卡片(3 步+左边框强调) + Configure 表单(两个密码字段)

Step 3: 用户阅读 Setup Guide,理解 3 个步骤
  → 系统反馈: Setup Guide 卡片以左 4px amber 边框突出显示
  → 状态变化: 无(信息读取)

Step 4: 用户在第一个字段输入 App ID
  → 系统反馈:
     - 标签清晰: "App ID" (首字大写,text-xs font-medium)
     - (required) 灰色小字指示必填
     - 占位符: "CLI_XXXXXXXXX" (一致性)
     - 密码显示/隐藏 eye icon(有 aria-label)
  → 状态变化: 字段获得焦点,focus ring 显示(ring 色)

Step 5: 用户在第二个字段输入 App Secret
  → 系统反馈: 同 Step 4,字段标签"App Secret"
  → 状态变化: 两个字段已填,Save 按钮状态变更(从 disabled → enabled)

Step 6: 用户点击 [Save] 按钮
  → 系统反馈:
     - 按钮显示 loading spinner(Loader2 icon + animate-spin)
     - 按钮变为 disabled 防止重复点击
     - 顶部或表单下出现"保存中..."提示
  → 状态变化: 调用 API PUT /api/im/config

Step 7a (成功路径): API 返回 ok: true
  → 系统反馈:
     - 表单下显示 toast: "✓ 已保存,正在连接..." (text-success,inline)
     - 页面自动刷新,切换为 Connected View
     - 显示 Status 卡片(✅ Connected + Bot Name + Capabilities)
     - 显示 Test Send 卡片(可直接测试消息发送)
  → 状态变化: im.connected = true,form cleared

Step 7b (失败路径): API 返回 error
  → 系统反馈:
     - 表单下显示 inline error: "❌ {error message}" (text-error)
     - 错误消息包含具体原因(如"Invalid credentials")
     - [重试] 链接可用
  → 状态变化: im.connected = false,form 保持,用户可修改再试

Step 8: 用户看到 Connected View
  → 系统反馈:
     - 标题下状态 badge 显示"✅ 已连接"(绿色)
     - Status 卡片显示 Bot Name (e.g., "MindOS-Bot")
     - Capabilities 显示为标签(e.g., [send_message] [receive_message])
     - Test Send 卡片突出,鼓励用户测试
  → 状态变化: UI 完全切换,配置完成

成功结果: Feishu Bot 已连接,Agent 可发送消息,用户看到清晰的确认反馈

异常分支:

- 异常 A: 用户点 Save 但某字段为空
  触发: form validator 检测到 empty
  系统反馈: [Save] 按钮保持 disabled,字段上显示 "此字段必填" (上面已说 required,用户应看到)
  用户操作: 填写空字段 → Save 变 enabled → 可再次点击

- 异常 B: 网络断开,API 超时
  触发: fetch timeout > 3s
  系统反馈: 错误消息 "网络连接超时,请检查网络后重试"
  用户操作: 修正网络 → 点 [重试] 按钮

- 异常 C: 凭证无效(Feishu 服务返回 401)
  触发: API 返回 { ok: false, error: "Unauthorized" }
  系统反馈: 错误消息 "凭证无效,请检查 App ID 和 Secret 是否正确"
  用户操作: 返回 Setup Guide,确认步骤 → 重新输入 → Save

- 异常 D: 用户在 Configure 表单中切换显示/隐藏密码
  触发: 点击 Eye/EyeOff icon
  系统反馈: 字段 type 从 "password" 变 "text",内容显示为明文
  用户操作: 可复制文本,或再次隐藏

边界场景:

- 超长输入: 用户输入 >500 字符 App ID
  处理: 输入框限制最大长度,或服务端截断 + 提示

- 特殊字符: 用户粘贴包含空格/换行的凭证
  处理: 自动 trim() 空白

- 重复提交: 用户快速点击 Save 两次
  处理: 第一次点击后立即 disabled,防止重复请求

- 已配置状态下修改: 用户在 Connected View 中想修改凭证
  处理: 在 Disconnect 区域提示 "修改凭证? 先断开连接" (或添加 Edit 按钮)
```

### User Flow 2: Channels 总览页(Overview)

**用户目标**: 快速查看所有平台的配置状态

**前置条件**: 用户已进入 Agents tab

**流程** (简化版):

```
Step 1: 用户点击侧边栏 "Channels"
  → 显示 Overview 页面

Step 2: 用户看到 3 个统计卡片
  → "已连接 0/8" | "支持平台 8" | "状态 未配置"
  → 信息清晰,用户瞬间理解

Step 3: 用户看到 8 个平台网格(2 列 @1440px)
  → 每个平台卡片显示:
     - 图标 + 名称
     - 状态(未配置 | 已连接 + Bot Name)
     - Capabilities 前 3 个标签(如可见)
     - 右侧状态指示:○ (未配置) | ✓ (已连接)

Step 4: 用户点击任意平台卡片
  → 跳转到详情页

成功结果: 用户快速了解系统状态并可进入配置
```

### 状态转换图

```
[Overview]
  ├─ 统计卡片(0/8)
  └─ 8 个平台卡片
     ├─ [未配置]
     │  └─ Click → [Detail: Setup + Form]
     │     ├─ Fill → [Detail: Form Filled]
     │     │  └─ Save (loading) → [Saving...]
     │     │     ├─ Success → [Connected View] → [Test Send] → [Disconnect]
     │     │     └─ Error → [Detail: Form + Error] → [重试]
     │     │
     │     └─ Cancel → [Overview]
     │
     └─ [已连接]
        └─ Click → [Detail: Connected View]
           ├─ [Status + Bot Name + Capabilities]
           ├─ [Test Send] → 输入接收者 + 消息 → [Send] → [Success/Error]
           └─ [Disconnect] → [确认] → [API DELETE] → [返回 Overview]
```

---

## UI 线框图(各状态)

### 状态 1: Overview (1440px Desktop)

```
┌─────────────────────────────────────────────────────────────────┐
│ max-w-3xl                                                       │
│                                                                 │
│ ┌─ 统计行 (grid-cols-3 gap-4) ───────────────────────────┐     │
│ │ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐     │
│ │ │ CONNECTED    ↑ │ │ SUPPORTED    ↑ │ │ STATUS       ↑ │     │
│ │ │ 0/8          │ │ │ 8            │ │ │ Not config   │ │     │
│ │ └────────────────┘ └────────────────┘ └────────────────┘     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ Platforms (h2, text-sm font-medium)                            │
│                                                                 │
│ ┌─ Platform Grid (2 columns, gap-3) ────────────────────┐     │
│ │                                                        │     │
│ │ ┌──────────────────────┐  ┌──────────────────────┐   │     │
│ │ │ 📱 Telegram          │  │ 🐦 Feishu            │   │     │
│ │ │ Set up               │  │ Set up               │   │     │
│ │ │                      │  │                      │   │     │
│ │ │ ○ (not connected)    │  │ ○ (not connected)    │   │     │
│ │ └──────────────────────┘  └──────────────────────┘   │     │
│ │                                                        │     │
│ │ ┌──────────────────────┐  ┌──────────────────────┐   │     │
│ │ │ 💬 Discord           │  │ 💼 Slack             │   │     │
│ │ │ Set up               │  │ Set up               │   │     │
│ │ │ ○                    │  │ ○                    │   │     │
│ │ └──────────────────────┘  └──────────────────────┘   │     │
│ │                                                        │     │
│ │ [... 4 more platforms ...]                           │     │
│ │                                                        │     │
│ └────────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

改进点:
- 统计卡片背景略微不同(subtle shadow)
- 平台网格每张卡片 hover:border-amber/40
- 已连接的卡片显示 ✓ 而非 ○
```

### 状态 2: Feishu Detail - 未配置(1440px)

```
┌─────────────────────────────────────────────────────────────────┐
│ max-w-2xl                                                       │
│                                                                 │
│ ← Back to Channels (text-sm text-muted hover:text-foreground)  │
│                                                                 │
│ 🐦 Feishu (h2, text-xl font-semibold)                          │
│ 📍 配置 (badge, text-xs, low-sat background)                  │
│ [or: "Set up" as light text]                                   │
│                                                                 │
│ ┌─ Setup Guide (border-l-4 border-amber, bg-card p-4) ┐       │
│ │ Setup Guide (h3, text-sm font-medium)                │       │
│ │                                                       │       │
│ │ 1. open.feishu.cn → Create App                        │       │
│ │ 2. Credentials page → copy App ID & Secret            │       │
│ │ 3. Enable Bot capability + add permissions            │       │
│ │                                                       │       │
│ └─────────────────────────────────────────────────────┘       │
│                                                                 │
│ ┌─ Configure (bg-card p-4) ───────────────────────────┐        │
│ │ Configure (h3, text-sm font-medium)                  │        │
│ │                                                       │        │
│ │ App ID (text-xs font-medium)                         │        │
│ │ (required) (text-muted-foreground/50)                │        │
│ │ [CLI_XXXXXXXXX___]  [eye icon]                       │        │
│ │ Get it from: open.feishu.cn (text-xs muted, link)   │        │
│ │                                                       │        │
│ │ App Secret (text-xs font-medium)                     │        │
│ │ (required)                                            │        │
│ │ [XXXXXXXXXXXXXXXXXXXX___]  [eye icon]                │        │
│ │ From Credentials page (text-xs muted)                │        │
│ │                                                       │        │
│ │ [⚙ Save] (bg-amber, hover:opacity-90)               │        │
│ │ (initially disabled if form empty)                   │        │
│ │                                                       │        │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

改进vs当前:
✓ 标题权重明确(text-xl font-semibold vs 状态 badge)
✓ Setup Guide 左边框 4px amber 强调
✓ 标签"App ID" vs "APP ID"(当前)
✓ (required) 明确指示必填
✓ 占位符统一大小写(CLI_XXXXXXXXX vs cli_a5xxx当前)
✓ 帮助文本可见(text-xs muted 而非 text-2xs/60)
✓ Eye icon 有 aria-label
```

### 状态 3: Feishu Detail - 表单已填,保存中

```
┌─────────────────────────────────────────────────────────────────┐
│ [same header]                                                   │
│                                                                 │
│ ┌─ Setup Guide ─────────────────────────────────────┐          │
│ │ [same content]                                     │          │
│ └───────────────────────────────────────────────────┘          │
│                                                                 │
│ ┌─ Configure ────────────────────────────────────────┐          │
│ │ App ID                                              │          │
│ │ (required)                                          │          │
│ │ [••••••••••••••]  [eye icon]                        │          │
│ │                                                     │          │
│ │ App Secret                                          │          │
│ │ (required)                                          │          │
│ │ [••••••••••••••••••••]  [eye icon]                  │          │
│ │                                                     │          │
│ │ [⚙ 保存中... 🔄] (disabled, opacity-70)            │          │
│ │ 💬 "连接中,请稍候..." (text-sm text-muted)         │          │
│ │                                                     │          │
│ └─────────────────────────────────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

改进:
✓ 加载中显示 spinner 和文本提示
✓ 按钮 disabled 防止重复
```

### 状态 4: Feishu Detail - 已连接(Connected View)

```
┌─────────────────────────────────────────────────────────────────┐
│ max-w-2xl                                                       │
│                                                                 │
│ ← Back to Channels                                              │
│                                                                 │
│ 🐦 Feishu (h2 text-xl font-semibold)                           │
│ ✅ 已连接 (badge, text-success, green-bg)                       │
│                                                                 │
│ ┌─ Status (bg-card p-4, 微妙不同背景) ─────────────┐           │
│ │ Status (h3 text-sm font-medium)                   │           │
│ │                                                   │           │
│ │ Bot        MindOS-Bot (text-foreground font-mono) │           │
│ │ Caps       [send] [receive] [mention]             │           │
│ │            (text-2xs px-2 py-0.5 rounded bg-muted)           │
│ │                                                   │           │
│ └───────────────────────────────────────────────────┘           │
│                                                                 │
│ ┌─ Test Send (bg-card p-4) ──────────────────────────┐          │
│ │ Test Send (h3)                                     │          │
│ │                                                    │          │
│ │ Recipient ID (text-xs font-medium)                │          │
│ │ (required)                                         │          │
│ │ [ou_XXXXXXXXX____]                                 │          │
│ │ Your Feishu user ID (text-xs muted)               │          │
│ │                                                    │          │
│ │ Message (text-xs font-medium)                      │          │
│ │ [Hello from MindOS_________]                       │          │
│ │                                                    │          │
│ │ [📤 Send Test] (bg-amber hover:opacity-90)         │          │
│ │                                                    │          │
│ │ ✓ Sent (ID: msg_xxx) (text-success) [if sent]     │          │
│ │                                                    │          │
│ └────────────────────────────────────────────────────┘          │
│                                                                 │
│ ┌─ Disconnect (border border-error/20 bg-card p-4) ┐          │
│ │ Disconnect (h3)                                   │          │
│ │ Remove credentials and disconnect (text-2xs muted)│          │
│ │ [⚠ Disconnect] (text-error border-error/30)       │          │
│ │ → on click → [确认?] [Confirm?] state            │          │
│ │    → [⚠ Confirm Disconnect] [cancel]              │          │
│ │                                                    │          │
│ └────────────────────────────────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

改进:
✓ Status 卡片视觉不同(subtle 背景区分)
✓ ✅ Connected badge 清晰
✓ Test Send 突出(鼓励测试)
✓ Disconnect 区域用警告色(border-error/20)
```

### 状态 5: 移动端 (375px)

```
┌─────────────────────────────┐
│ ← Back to Channels          │
│                             │
│ 🐦 Feishu (h2 text-xl)      │
│ 📍 配置                     │
│                             │
│ ┌─ Setup Guide ────────────┐│
│ │ Setup Guide (h3)          ││
│ │                           ││
│ │ 1. open.feishu...        ││
│ │ 2. Credentials...        ││
│ │ 3. Enable Bot...         ││
│ │                           ││
│ └─────────────────────────┘│
│                             │
│ ┌─ Configure ───────────────┐│
│ │ App ID                     ││
│ │ (required)                 ││
│ │ [_______________]  [eye]   ││
│ │ Get it from... (text-xs)   ││
│ │                            ││
│ │ App Secret                 ││
│ │ (required)                 ││
│ │ [_______________]  [eye]   ││
│ │ From Credentials... (xs)   ││
│ │                            ││
│ │ [⚙ Save]                  ││
│ │                            ││
│ └────────────────────────────┘│
│                             │
└─────────────────────────────┘

改进 vs 当前:
✓ 单列布局(不挤)
✓ padding-x 16px
✓ 字号和间距适配小屏
✓ 触控目标 ≥44px(按钮 h-8 = 32px... 需改 h-9)
```

---

## 方案选择与对比

### 方案 A: 目标方案(已选)

**描述**: 完整的视觉层级重建 + 表单标签统一 + 无障碍完整 + 响应式 3 断点

- 用户体验: ⭐⭐⭐⭐⭐ (精致、清晰、无障碍)
- 实现复杂度: 中 (主要是 CSS/类型改动,逻辑无变)
- 可维护性: 高 (Design Token 遵循,易维护)
- 风险: 低 (改动仅在 UI 层,后端 API 不变)

**具体改动**:
1. 标题权重: `text-lg` → `text-xl font-semibold`
2. 标签统一: "APP ID" → "App ID" + "(required)" 小字
3. 占位符一致: `cli_a5xxx` → `CLI_XXXXXXXXX`
4. Setup Guide: 加 `border-l-4 border-amber`
5. 间距: 统一到 `gap-6` (24px) 卡片间, `gap-3` 字段间
6. ARIA: 所有按钮加 `aria-label`,字段加 `aria-required="true"` 等
7. 响应式: `grid-cols-1 sm:grid-cols-2` (overview)
8. 移动端字段高度: h-8 → h-9 (触控友好)

### 方案 B: 最小化改进(未选)

**描述**: 只修复最严重的 3 个问题,避免大改

- 问题: UX 只能从 6 → 6.5/10,用户感受有限
- 为什么不选: 不符合"精心实现"目标,半成品感

### 方案 C: 彻底重设计(未选)

**描述**: 用完全不同的 UI 模式(tabs、wizard、modal 等)

- 问题: 风险高,改动大,后端适配成本
- 为什么不选: 当前架构已可达到 8.5+/10,不需彻底改

---

## 数据流 / 状态流

```
Component State Flow:
─────────────────────

[AgentsContentChannelDetail]
  ├─ platformId (URL param)
  ├─ status (from API /im/status)
  ├─ loading, error (fetch states)
  ├─ formValues (form input)
  ├─ showSecrets (toggle password visibility)
  ├─ saving (save button state)
  ├─ saveResult (success/error message)
  ├─ testRecipient, testMsg (test send inputs)
  ├─ testStatus (idle | sending | success | error)
  ├─ deleting, confirmDelete (disconnect flow)
  │
  ├─ Action: fetchStatus()
  │  └─ GET /api/im/status → setStatus
  │
  ├─ Action: handleSave()
  │  └─ PUT /api/im/config { platform, credentials }
  │     ├─ setSaving(true)
  │     ├─ if ok → setSaveResult({ok:true}) → clearForm → refetchStatus → UI切为Connected
  │     └─ if err → setSaveResult({ok:false, msg:error})
  │
  ├─ Action: handleTest()
  │  └─ POST /api/im/test { platform, recipient_id, message }
  │     └─ setTestResult
  │
  ├─ Computed: isFormComplete = platform.fields.every(f => formValues[f.key]?.trim())
  │  └─ Save 按钮 disabled={saving || !isFormComplete}
  │
  └─ Computed: isConnected = status?.connected ?? false
     └─ 切换 UI (form + Setup Guide | status + test + disconnect)

Rendering Logic:
────────────────

if (loading) → Skeleton loader
else if (error) → Error card with retry button
else if (isConnected) → Connected View (3 cards)
else → Unconfigured View (Setup Guide + Form)
```

---

## 边界 Case & 风险

### 边界 Case

| Case | 当前处理 | 改进后处理 |
|------|---------|----------|
| 空字段提交 | Save 按钮 disabled ✓ | 保持 + 字段上显示 inline hint |
| 无效凭证 | API 返回 error,显示 inline | ✓ 错误消息 + 重试按钮 |
| 网络超时 | 显示 generic error | ✓ "网络超时,检查后重试" |
| 超长输入 | 无限制 | 添加 maxLength validator(待 backend 定) |
| 特殊字符/空格 | 原样传 | auto trim() 后端 |
| 快速重复点击 | 第一次后立即 disabled | ✓ 保持 |
| 密码显示转换 | 支持 | ✓ 保持 + 优化 (改进 Eye icon 视觉反馈) |

### 风险

| 风险 | Mitigation |
|-----|-----------|
| 修改过程中破坏已连接平台 | 测试所有状态,review 关键渲染逻辑 |
| API 响应格式不符预期 | 检查 API 类型定义,mock 测试 |
| 响应式断点不合理 | 三断点实测 (375/768/1024/1440) |
| ARIA 属性遗漏 | checklist review(见验收标准) |
| 字体/间距不遵循 design system | 严格查表,禁止硬编码 |

---

## 验收标准

### Visual/UX

- [ ] 标题"Feishu" 权重明确高于状态(对比现状截图)
- [ ] 已连接状态用 ✅ 绿色 badge,未配置用灰色(视觉区分清晰)
- [ ] Setup Guide 有左 4px amber 边框(强调)
- [ ] 所有表单标签"首字大写" (不全大写),且有 (required) 小字
- [ ] 占位符统一格式 (CLI_XXX / XXXXXX,不混合)
- [ ] 帮助文本可见(text-xs 而非 text-2xs/60)
- [ ] 间距统一(卡片间 gap-6, 字段间 gap-3)

### Responsiveness

- [ ] 375px (mobile): 单列,不拥挤,所有字段可点
- [ ] 768px (tablet): 接近 desktop 但字体稍小
- [ ] 1440px (desktop): 两列网格 (Overview)

### Accessibility

- [ ] 所有 icon button 有 aria-label
- [ ] 所有 input 有 aria-required="true"
- [ ] 错误消息用 role="alert" aria-live="polite"
- [ ] Keyboard nav 完全: Tab → 所有元素可聚焦,Enter → 按钮触发,Esc → 关闭
- [ ] Focus ring 清晰可见 (focus-visible:ring-1)
- [ ] 屏幕阅读器可读(NVDA/JAWS 测试)

### Functional

- [ ] 表单验证: 空字段时 Save disabled
- [ ] 保存成功: 显示 toast + 切换为 Connected View
- [ ] 保存失败: 显示错误信息 + 可重试
- [ ] 密码显示/隐藏: 功能工作 + Eye icon 反馈清晰
- [ ] Test Send: 接收 ID + 消息必填, Send disabled 前
- [ ] Disconnect: 二次确认防误操作

### Code Quality

- [ ] 所有新样式来自 Design Token (禁硬编码)
- [ ] 类型定义完整 (no `any`)
- [ ] 代码行数 <200 per file,函数 <50 lines
- [ ] 注释清晰,变量命名语义化

---

## 关键决策

### Why 不全大写标签?

- 国际化友好(中文标签"应用ID"不全大写)
- 易读性更好(eye tracking 研究表明 Title Case 更易扫描)
- 与 design system 一致(其他表单标签遵循 Title Case)

### Why Setup Guide 要左边框 + amber 色?

- 视觉上"引导"用户关注(边框指向内容)
- 颜色与品牌一致
- 不过度打扰(相比 modal 或背景高亮)

### Why 移动端改 h-8 → h-9?

- Touch target 最小 44x44px(ADA 标准)
- h-8 = 32px, h-9 = 36px(接近但仍略小... 可考虑 padding-y 增加)
- 实测友好度改善

---

## Spec 对抗性审查(第 1 轮)

**审查员视角**:

🔴 **发现**: Setup Guide 步骤 3 "Enable Bot capability + add permissions" 太模糊
- 对 Feishu 不熟的用户可能卡住
- **修复**: 添加链接 "权限配置文档" 指向 open.feishu.cn 的权限指南

🔴 **发现**: Connected View 中没有"修改凭证"的方式
- 用户配置完后想修改 ID 怎么办?
- 当前设计强制先 Disconnect 再重新配置
- **修复**: 在 Disconnect 区域添加提示 "要修改凭证?先断开连接"(或添加直接 Edit 按钮)

🟡 **发现**: 没有处理"用户同时打开多个 Channel 详情页"的场景
- 如果用户分页签中打开 Telegram 和 Feishu,修改凭证会互相干扰吗?
- **修复**: 确认 formValues 和 showSecrets state 是 per-page instance(应该没问题,但需 verify)

🟡 **发现**: Test Send 中"Recipient ID" 对新用户可能不清楚
- 应该有 tooltip 或 "Learn more" 链接解释 Feishu "ou_xxx" 格式
- **修复**: 添加 hint text "如何找我的 ID? 点此查看"(链接到文档或例子)

---

## 后续(Phase 7+)

1. **测试**: 创建 Playwright 截图对比(before/after 验证改进)
2. **文档**: 更新 wiki/21-design-principle.md 表单设计规范
3. **经验沉淀**: 记录"表单标签统一化"的通用模式到 known-pitfalls.md

