# Mobile 构建指南

> MindOS 移动端（React Native + Expo）的本地开发、CI 构建和分发指南。

## 概览

| 项 | 值 |
|----|-----|
| 框架 | Expo SDK 52 + React Native 0.76.9 |
| 源码目录 | `mobile/` |
| iOS Bundle ID | `com.geminilight.mindos` |
| Android Package | `com.geminilight.mindos` |
| EAS Project ID | `b24f8ff1-a88d-4501-884d-e15fe60855b0` |
| GitHub Workflow | `.github/workflows/build-mobile.yml` |

## 前置条件

### 所有人都需要

| 项 | 说明 |
|----|------|
| Node.js 22+ | `node -v` 确认 |
| npm | 随 Node 安装 |
| Expo 账号 | 注册 [expo.dev](https://expo.dev) |
| EAS CLI | `npm install --global eas-cli` |

### GitHub CI 额外需要

| GitHub Secret | 用途 | 如何获取 |
|---------------|------|----------|
| `EXPO_TOKEN` | EAS 云编译认证（**必需**） | [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) → Create Token |
| `APPLE_API_KEY_BASE64` | iOS 证书修复（推荐） | 已配置在 `GeminiLight/MindOS` |
| `APPLE_API_KEY_ID` | iOS 证书修复（推荐） | 同上 |
| `APPLE_API_ISSUER` | iOS 证书修复（推荐） | 同上 |
| `APPLE_TEAM_ID` | iOS 证书修复（推荐） | 同上 |

> 注意：Apple secrets 目前只在 `GeminiLight/MindOS` (public) 仓库配置。如果要在 `GeminiLight/mindos-dev` 跑 iOS 构建，需要同步这些 secrets。

### 添加 EXPO_TOKEN

```bash
# 添加到 dev 仓库
gh secret set EXPO_TOKEN --repo GeminiLight/mindos-dev

# 如果也要在 public 仓库构建
gh secret set EXPO_TOKEN --repo GeminiLight/MindOS
```

## 本地开发

### 启动开发服务器

```bash
cd mobile
npm install
npm start
```

Expo 会启动 Metro bundler，扫描终端二维码或按提示键选择平台：

- `a` → Android 模拟器 / 设备
- `i` → iOS 模拟器（需 macOS + Xcode）
- `w` → Web 浏览器

### 在真机上运行

1. 安装 Expo Go（[iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)）
2. 手机和电脑在同一局域网
3. 用 Expo Go 扫描终端里的二维码

### 运行检查

```bash
cd mobile
npm run typecheck   # TypeScript 类型检查
npm test            # Vitest 单元测试
```

## CI 构建（GitHub Actions）

### 触发方式

1. 打开 GitHub 仓库 → **Actions** → **Build Mobile**
2. 点 **Run workflow**
3. 选择参数：

| 参数 | 选项 | 说明 |
|------|------|------|
| `platform` | `android` / `ios` / `all` | 构建平台 |
| `profile` | `development` / `preview` / `production` | EAS 构建配置 |

### Workflow 流程

```
verify job                          build job
──────────                          ─────────
checkout                            checkout
npm ci                              npm ci
typecheck ────→ 通过 ────→          setup expo/eas
test      ────→ 通过 ────→          prepare apple creds (iOS)
                                    eas build (cloud)
                                    upload metadata artifact
                                    write step summary
```

### 构建产物

Workflow 完成后：

1. **GitHub Step Summary** — 显示 EAS build metadata（JSON）
2. **Artifacts** — 下载 `mobile-eas-build-metadata`（构建元信息）
3. **Expo Dashboard** — 登录 [expo.dev](https://expo.dev) 下载 APK / IPA

### 查看和下载构建产物

```bash
# 列出最近的 EAS 构建
npx eas-cli build:list --limit 5

# 下载特定构建
npx eas-cli build:download
```

## EAS 构建配置

配置文件：`mobile/eas.json`

### 三种 Profile

| Profile | Android 产物 | iOS 产物 | 用途 |
|---------|-------------|---------|------|
| `development` | APK | 模拟器 build | 本地开发调试 |
| `preview` | APK | Ad Hoc IPA | 内部测试分发 |
| `production` | AAB (App Bundle) | App Store build | 上架应用商店 |

### 本地手动触发 EAS 构建

```bash
cd mobile

# Android APK（最常用）
npm run build:android:preview

# iOS 内部测试
npm run build:ios:preview

# Android 商店包
npm run build:android:production

# iOS 商店包
npm run build:ios:production

# 同时构建 Android + iOS
npm run build:preview
```

## iOS 特别说明

### Ad Hoc 分发（preview profile）

`preview` profile 使用 `distribution: internal`，即 Ad Hoc 分发模式：

- 只有**预先注册 UDID 的设备**才能安装
- 需要先注册测试设备

### 注册测试设备

```bash
# 交互式注册（会生成一个链接让测试者打开）
npx eas-cli device:create

# 注册后需要重新构建才能包含新设备
npm run build:ios:preview
```

### Apple 证书管理

EAS 会自动管理 iOS 签名证书和 provisioning profile。首次构建时：

1. EAS 会要求你登录 Apple Developer 账号
2. 自动生成 distribution certificate
3. 自动创建 provisioning profile

后续构建会复用已缓存的证书。如果证书过期或需要修复，CI 里配置的 Apple secrets 会自动介入。

## Android 特别说明

### APK vs AAB

- `preview` → 生成 APK，可直接安装到手机
- `production` → 生成 AAB (App Bundle)，用于上传 Google Play

### 直接安装 APK

1. 从 Expo Dashboard 下载 APK
2. 传到 Android 手机
3. 打开 → 允许安装未知来源 → 安装

## 目录结构

```
mobile/
├── app/                    # Expo Router 页面
│   ├── (tabs)/             # Tab 导航页面
│   │   ├── index.tsx       # Home
│   │   ├── files.tsx       # Files
│   │   ├── chat.tsx        # Chat
│   │   ├── search.tsx      # Search
│   │   └── settings.tsx    # Settings
│   ├── connect.tsx         # 连接页
│   └── view/[...path].tsx  # 文件查看/编辑
├── assets/                 # 图标和启动图
│   ├── icon.png            # App 图标 (1024x1024)
│   ├── adaptive-icon.png   # Android 自适应图标
│   ├── splash.png          # 启动屏
│   └── favicon.png         # Web favicon
├── components/             # UI 组件
├── hooks/                  # React Hooks
├── lib/                    # 业务逻辑
├── __tests__/              # 测试
├── app.json                # Expo 配置
├── eas.json                # EAS Build 配置
├── package.json            # 依赖和脚本
└── tsconfig.json           # TypeScript 配置
```

## Troubleshooting

### `EXPO_TOKEN is not configured`

Workflow 失败并提示此消息 → 需要添加 `EXPO_TOKEN` 到 GitHub Secrets。

### `projectId not found`

EAS 提示找不到项目 → 确认 `mobile/app.json` 中有：
```json
"extra": {
  "eas": {
    "projectId": "b24f8ff1-a88d-4501-884d-e15fe60855b0"
  }
}
```

### iOS 构建成功但无法安装

原因：测试设备的 UDID 没有注册到 provisioning profile。

修复：
```bash
npx eas-cli device:create
npm run build:ios:preview  # 重新构建以包含新设备
```

### Android APK 安装失败

可能原因：
- 手机未开启"允许安装未知来源应用"
- APK 架构不匹配（罕见）

### 构建排队很久

EAS 免费套餐有并发限制。可以：
- 等待队列
- 升级 EAS 套餐
- 使用 `--local` 本地构建（需要 Android SDK / Xcode）

### 资源文件缺失

如果 EAS 报 icon/splash 找不到 → 确认 `mobile/assets/` 下有：
- `icon.png`
- `adaptive-icon.png`
- `splash.png`
- `favicon.png`

## 版本管理

| 文件 | 字段 | 说明 |
|------|------|------|
| `mobile/app.json` | `expo.version` | 用户可见版本号 |
| `mobile/app.json` | `expo.ios.buildNumber` | iOS 构建号（production 自动递增） |
| `mobile/app.json` | `expo.android.versionCode` | Android 版本码（production 自动递增） |

`production` profile 配置了 `autoIncrement: true`，每次构建会自动递增构建号。

## 相关文档

- [Expo 官方文档](https://docs.expo.dev/)
- [EAS Build 文档](https://docs.expo.dev/build/introduction/)
- [EAS Submit 文档](https://docs.expo.dev/submit/introduction/)
- 项目 Spec: `wiki/specs/spec-mobile-chat-session-management.md`
- 项目 Spec: `wiki/specs/spec-mobile-files-feedback-and-rename.md`
