<!-- Last verified: 2026-03-22 | Current stage: 规划 -->

# Stage 13 — 局域网自动发现 (mDNS/Bonjour)

## 功能汇总

| # | 功能 | 状态 | 备注 |
|---|------|------|------|
| 13A | mDNS 服务广播 | 📋 | daemon 启动时自动广播 |
| 13B | `{hostname}.local` 域名访问 | 📋 | 替代手动输入 IP |
| 13C | 设备发现 API + UI | 📋 | 展示同网络下的 MindOS 实例 |

---

## 现状分析

### 当前跨设备连接方式

```
用户要从手机/平板/其他电脑访问 MindOS：
  1. 查本机 IP (ifconfig / Settings)
  2. 记住端口 (默认 3000)
  3. 手动输入 http://192.168.x.x:3000
  4. 配置 Bearer Token
  5. IP 变了 → 重来一遍
```

### 核心问题

| 问题 | 影响 |
|------|------|
| 手动查 IP + 记端口 | 非技术用户不会操作 |
| DHCP 重新分配 IP | 之前配好的连接失效 |
| MCP HTTP 配置依赖 IP | Agent 远程连接也要手动填 IP |

---

## 13A: mDNS 服务广播

### 用户场景

用户在电脑上运行 MindOS daemon，同 WiFi 下的手机自动发现这台 MindOS，无需任何配置。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 协议 | mDNS/DNS-SD (Bonjour) | macOS/iOS 原生支持，Linux avahi 兼容，最成熟 | SSDP/UPnP（复杂）/ 自定义 UDP 广播（非标准） |
| npm 包 | `bonjour-service` | 纯 JS，零原生依赖，ESM 兼容 | `mdns`（需编译 C++）/ `multicast-dns`（更底层） |
| 服务类型 | `_mindos._tcp` | 自定义服务类型，不与其他服务冲突 | `_http._tcp`（太通用，会混杂其他 HTTP 服务） |
| 生命周期 | daemon 启动时广播，停止时注销 | 自动管理，不留残留 | 常驻独立进程（过重） |
| 默认开关 | 默认开启（daemon 模式下） | 零配置体验 | 默认关闭（需手动开启则失去意义） |

### 广播信息

```typescript
{
  name: "MindOS - {hostname}",     // e.g. "MindOS - gemini-macbook"
  type: "mindos",
  protocol: "tcp",
  port: 3000,                       // 实际 Web 端口
  txt: {
    version: "0.2.0",               // MindOS 版本
    mcpPort: "8787",                // MCP HTTP 端口
    authRequired: "true",           // 是否需要 Token
    mindRoot: "my-mind"             // 知识库名称（不暴露完整路径）
  }
}
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `bin/lib/mdns.js` | 新增 | mDNS 广播 + 发现 + 注销 |
| `bin/lib/gateway.js` | 修改 | daemon 启动时调 `startBroadcast()`，停止时调 `stopBroadcast()` |
| `package.json` | 修改 | 添加 `bonjour-service` 依赖 |

---

## 13B: `{hostname}.local` 域名访问

### 用户场景

用户在手机浏览器输入 `gemini-macbook.local:3000`，直接打开 Web UI，不用记 IP。（`.local` 域名由系统 mDNS 自动解析，MindOS 不需要额外实现。）

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 域名格式 | `{hostname}.local` (系统自带) + 服务发现 | mDNS hostname 解析是系统级的，不需要额外实现 | 自定义 `mindos.local`（需要额外 A 记录广播） |
| 多实例冲突 | 用 hostname 区分：`gemini-macbook.local:3000` | 局域网内可能有多台 MindOS | 端口区分（用户记不住） |

### 平台兼容性

| 平台 | mDNS 支持 | 备注 |
|------|----------|------|
| macOS / iOS | ✅ 原生 Bonjour | 零配置 |
| Linux | ✅ avahi-daemon | 大多数发行版预装 |
| Windows | ⚠️ 需 Bonjour 服务 | iTunes 安装会带；或用 `dns-sd` |
| Android | ⚠️ 不稳定 | Chrome 不解析 `.local`，需走发现 API |

### Android / 不支持 mDNS 的降级方案

```
mindos token --qr
    → 生成一次性短期 auth code（有效期 5 分钟）
    → 终端输出 QR Code（包含 http://{ip}:{port}/auth?code=xxx）
    → 手机扫码 → /auth 页面用 code 换取 session cookie → 跳转首页
    → code 使用一次即失效，不暴露长期 Bearer Token
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `bin/cli.js` | 修改 | `token` 命令添加 `--qr` 选项 |
| `app/app/api/auth/route.ts` | 修改 | 新增一次性 auth code 换 session 逻辑 |
| `package.json` | 修改 | 添加 `qrcode-terminal` 依赖 (optionalDependencies) |

---

## 13C: 设备发现 API + UI

### 用户场景

在一台 MindOS 的 Settings 页面，查看同局域网内的其他 MindOS 实例列表，一键复制连接地址。

### API 契约

```
GET /api/discover?timeout=3
```

**说明：** mDNS browse 是异步的（设备响应需 1-3 秒），API 启动扫描并等待 `timeout` 秒后返回收集到的结果。daemon 进程和 Next.js 进程各自独立做 browse（不共享 bonjour 实例）。

**响应：**
```json
{
  "instances": [
    {
      "name": "MindOS - gemini-desktop",
      "host": "192.168.1.100",
      "port": 3000,
      "mcpPort": 8787,
      "version": "0.2.0",
      "authRequired": true,
      "url": "http://192.168.1.100:3000"
    }
  ],
  "self": {
    "hostname": "gemini-macbook",
    "port": 3000,
    "broadcasting": true
  }
}
```

### UI

Settings → Network Tab（或 Sync Tab 内新增 section）：

```
┌─ 局域网设备 ──────────────────────────────┐
│                                            │
│  📡 当前广播中: gemini-macbook:3000         │
│  [关闭广播]                                 │
│                                            │
│  发现的 MindOS 实例:                        │
│  ┌────────────────────────────────────┐    │
│  │ 🖥️ gemini-desktop                  │    │
│  │ http://192.168.1.100:3000          │    │
│  │ MCP: :8787 | v0.2.0 | 🔒          │    │
│  │ [复制 URL] [复制 MCP 配置]          │    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/api/discover/route.ts` | 新增 | 扫描局域网 mDNS 服务 |
| `app/components/settings/NetworkTab.tsx` | 新增 | 设备发现 UI |
| `app/components/SettingsModal.tsx` | 修改 | 添加 Network Tab |
| `app/components/settings/types.ts` | 修改 | 添加 Tab 类型 |

---

## 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `mdns.enabled` | `true` | 广播开关（daemon 模式下） |
| `mdns.name` | `MindOS - {hostname}` | 广播名称，用户可自定义 |

---

## 实施顺序

```
13A (mDNS 广播, 0.5 天)
    → 13B (QR 码降级方案, 0.5 天)
    → 13C (发现 API + UI, 1-2 天)
```

**总计：~2-3 天**

---

## 遗留项 / Backlog

- Windows Bonjour 服务检测 + 安装引导
- Android Chrome `.local` 不解析的 workaround（考虑 PWA 层代理）
- 多实例 MCP 配置自动生成（发现到的实例一键生成 Claude Code / Cursor MCP config）
