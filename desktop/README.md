# MindOS Desktop

Electron 桌面客户端，支持 macOS / Windows / Linux。

## Quick Commands

```bash
# ── 开发 ──
cd desktop && npm run dev                    # 本地开发（热重载）
MINDOS_OPEN_DEVTOOLS=1 /Applications/MindOS.app/Contents/MacOS/MindOS  # 调试已安装的应用

# ── 安装依赖 ──
cd app && npm install && cd .. && cd mcp && npm install && cd .. && cd desktop && npm install

# ── 打包 macOS（需要在 Mac 上运行）──
./scripts/build-mac.sh                       # 签名 + 公证
./scripts/build-mac.sh --no-notarize         # 仅签名
./scripts/build-mac.sh --no-sign             # 无签名

# ── 打包其他平台 ──
npm run dist:win                             # Windows
npm run dist:linux                           # Linux
npm run dist:with-bundled                    # 一键（含 runtime）

# ── 安装 DMG（命令行）──
DMG=~/Downloads/MindOS-0.1.0-arm64.dmg
VOL=$(hdiutil attach "$DMG" -nobrowse | grep '/Volumes/' | sed 's/.*\/Volumes/\/Volumes/')
cp -R "$VOL/MindOS.app" /Applications/ && hdiutil detach "$VOL"
xattr -cr /Applications/MindOS.app          # 未签名版本才需要

# ── 安装 Linux ──
chmod +x MindOS-*.AppImage && ./MindOS-*.AppImage   # AppImage
sudo dpkg -i mindos-desktop_*_amd64.deb             # deb

# ── CI 触发（需要 gh CLI）──
gh workflow run build-desktop.yml -R GeminiLight/MindOS -f sign_mac=false -f publish=true
gh workflow run build-desktop.yml -R GeminiLight/MindOS -f sign_mac=true -f publish=true

# ── Secrets 生成 ──
base64 -i cert.p12 | tr -d '\n'             # 证书 → APPLE_CERTIFICATE_BASE64
base64 -i AuthKey_XXXXXXXX.p8 | tr -d '\n'  # API Key → APPLE_API_KEY_BASE64
```

---

## CI/CD（GitHub Actions）

三平台并行打包，通过 `build-desktop.yml` workflow 触发。

### 触发参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `publish` | false | 是否发布到 GitHub Releases + CDN |
| `sign_mac` | true | 是否签名 + 公证 macOS 构建 |
| `tag` | 自动 | Release tag 名称 |

### CI 流程（macOS）

```
Install deps → Build Next.js (webpack) → Build Electron → Prepare runtime
  → Package (签名，不公证)
  → Notarize (xcrun notarytool, 3 次重试, 2h 超时)
  → Staple (xcrun stapler staple)
  → Upload artifacts
```

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

## 内置 MindOS 运行时

安装包将已构建的 MindOS 打进 `Resources/mindos-runtime`，离线时也能启动本地模式。

手动准备：`cd app && ./node_modules/.bin/next build --webpack && cd .. && cd desktop && npm run prepare-mindos-runtime`

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
