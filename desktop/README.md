# MindOS Desktop

Electron 桌面客户端，支持 macOS / Windows / Linux。

## 快速开始

### 前置条件

```bash
# 仓库根目录安装依赖
cd app && npm install && cd ..
cd mcp && npm install && cd ..
cd desktop && npm install
```

### 本地开发

```bash
cd desktop && npm run dev
```

### 调试已安装的应用

```bash
MINDOS_OPEN_DEVTOOLS=1 /Applications/MindOS.app/Contents/MacOS/MindOS
```

### 本地打包

macOS（需要在 Mac 上运行）：

```bash
# 签名 + 公证（需要 Apple Developer ID 证书 + API Key）
./scripts/build-mac.sh

# 仅签名，跳过公证
./scripts/build-mac.sh --no-notarize

# 无签名（无需开发者账号）
./scripts/build-mac.sh --no-sign
```

其他平台：

```bash
npm run dist:win     # Windows
npm run dist:linux   # Linux
```

### 一键打包（含 runtime）

```bash
npm run dist:with-bundled
```

## CI/CD（GitHub Actions）

三平台并行打包，通过 `build-desktop.yml` workflow 触发。

### 触发方式

GitHub Actions → Build Desktop → Run workflow，有三个选项：

| 参数 | 默认 | 说明 |
|------|------|------|
| `publish` | false | 是否发布到 GitHub Releases + CDN |
| `sign_mac` | true | 是否签名 + 公证 macOS 构建 |
| `tag` | 自动 | Release tag 名称 |

### CI 流程（macOS）

```
Install deps → Build Next.js (webpack) → Build Electron → Prepare runtime
  → Package (签名，不公证)
  → Notarize (xcrun notarytool, 3 次重试)
  → Staple (xcrun stapler staple)
  → Upload artifacts
```

签名和公证分离，公证有 3 次重试 + 30s 间隔，避免 Apple 服务器网络抖动导致整个 build 失败。

`sign_mac=false` 时跳过签名、公证、staple 步骤。

### CI 所需 GitHub Secrets

**签名（必需）：**

| Secret | 说明 |
|--------|------|
| `APPLE_CERTIFICATE_BASE64` | .p12 证书的 base64 编码 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 导出密码 |

**公证 — API Key 方式（推荐）：**

| Secret | 说明 |
|--------|------|
| `APPLE_API_KEY_BASE64` | .p8 API Key 文件的 base64 编码 |
| `APPLE_API_KEY_ID` | App Store Connect Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |

**公证 — Apple ID 方式（备选）：**

| Secret | 说明 |
|--------|------|
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 |
| `APPLE_TEAM_ID` | Team ID |

API Key 和 Apple ID 同时配置时优先使用 API Key。

### 生成 Secrets

```bash
# 证书 → base64
base64 -i cert.p12 | tr -d '\n'

# API Key → base64
base64 -i AuthKey_XXXXXXXX.p8 | tr -d '\n'
```

## 内置 MindOS 运行时

安装包将已构建的 MindOS 打进 `Resources/mindos-runtime`，离线时也能启动本地模式。

```bash
# 手动准备 runtime
cd app && npx next build --webpack && cd ..
cd desktop && npm run prepare-mindos-runtime
```

或一键：`npm run dist:with-bundled`

## 产物

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS ARM64 | `MindOS-{ver}-arm64.dmg` | Apple Silicon |
| macOS Intel | `MindOS-{ver}.dmg` | Intel Mac |
| macOS (更新用) | `MindOS-{ver}-arm64-mac.zip`, `MindOS-{ver}-mac.zip` | electron-updater 自动更新 |
| Windows | `MindOS-Setup-{ver}.exe` | NSIS 安装程序 |
| Linux | `MindOS-{ver}.AppImage`, `mindos-desktop_{ver}_amd64.deb` | AppImage + deb |

## CDN 分发

CI publish 模式自动上传到：
- **Cloudflare R2**（国际）：`desktop/latest/MindOS-arm64.dmg` 等（去版本号）
- **阿里云 OSS**（中国）：同上
- **GitHub Releases**：原始文件名（带版本号）

Landing 页面下载链接指向 CDN `latest/` 路径，每次发版自动覆盖。

## 安装

### 从 DMG 安装（命令行）

```bash
# 替换 <dmg文件> 为实际文件名，如 MindOS-0.1.0-arm64.dmg
hdiutil attach ~/Downloads/<dmg文件> -nobrowse && \
cp -R /Volumes/MindOS/MindOS.app /Applications/ && \
hdiutil detach /Volumes/MindOS && \
xattr -cr /Applications/MindOS.app
```

签名 + 公证过的 DMG 不需要 `xattr -cr`，双击拖入 Applications 即可。

### 从 DMG 安装（图形界面）

双击 `.dmg` 文件，将 MindOS.app 拖到 Applications 文件夹。

### Linux

```bash
# AppImage
chmod +x MindOS-0.1.0.AppImage && ./MindOS-0.1.0.AppImage

# deb
sudo dpkg -i mindos-desktop_0.1.0_amd64.deb
```
