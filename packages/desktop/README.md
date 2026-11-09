# MindOS Desktop

Electron 桌面客户端，支持 macOS / Windows / Linux。

## Quick Commands

```bash
# ── 开发 ──
cd packages/desktop && npm run dev               # 本地开发（热重载）
MINDOS_OPEN_DEVTOOLS=1 /Applications/MindOS.app/Contents/MacOS/MindOS  # 调试已安装的应用

# ── 安装依赖 ──
pnpm install

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

# ── CI 触发（需要 gh CLI；正式发布必须传 tag）──
gh workflow run build-desktop.yml -R GeminiLight/MindOS -f publish=false -f sign_mac=false
gh workflow run build-desktop.yml -R GeminiLight/MindOS -f publish=true -f sign_mac=true -f tag=desktop-v0.3.14

# ── Secrets 生成 ──
base64 -i cert.p12 | tr -d '\n'             # 证书 → APPLE_CERTIFICATE_BASE64
base64 -i AuthKey_XXXXXXXX.p8 | tr -d '\n'  # API Key → APPLE_API_KEY_BASE64
```

---

## 运行时开关（环境变量）

| 变量 | 作用 |
|------|------|
| `MINDOS_OPEN_DEVTOOLS=1` | 启动后打开 DevTools，并转发 web/MCP 子进程日志到主进程 console |
| `MINDOS_VERBOSE_CHILD_LOGS=1` | 只开子进程日志转发（默认关闭：每条 Next 请求日志都会压在 UI 线程上） |
| `MINDOS_DISABLE_GLOBAL_SHORTCUT=1` | 不注册全局 `Cmd/Ctrl+Shift+M`（该快捷键是系统级抢占，可能与其它应用冲突） |
| `MINDOS_DISABLE_CLI_SHIM_PATH_APPEND=1` | 安装 `~/.mindos/bin/mindos` 但不改写 shell 启动文件的 PATH |
| `MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER=1` | 关闭 Obsidian SecretStorage safeStorage broker |
| `MINDOS_NODE_BIN` | 指定 Node.js 可执行文件，跳过自动探测 |
| `MINDOS_RUNTIME_POLICY` | `prefer-newer`(默认) / `bundled-only` / `user-only` |
| `MINDOS_DESKTOP_CI_LOG` | 把主进程日志写入指定文件（CI smoke 用），同时开启子进程日志转发 |
| `MINDOS_TELEMETRY_ENDPOINT` | 配置后 `telemetry.flush()` 才真正上报；未配置时事件只在内存里保留并有上限 |

界面语言与 `app.getLocale()` 之外的显式选择保存在 `mindos-app-config` 的 `uiLang`（`system` / `zh` / `en`），
引导界面、connect 窗口、托盘、菜单与所有对话框共用这一个值（见 `src/i18n/lang.ts`）。
菜单「语言 / Language」子菜单可切换。

### 启动流程：单窗口

应用启动即创建主窗口（恢复上次的尺寸与位置），在其中加载 `connect.html?shell=boot` 作为**引导界面**：
首次运行的模式选择、启动进度、启动失败与恢复操作都在这个窗口内完成，服务就绪后**同一个窗口**导航到产品页面。
不再有独立的 splash 窗口或启动期模式选择窗口。详见 `src/boot-shell.ts` 与 `wiki/specs/spec-desktop-single-window-boot.md`。

会话中途的「切换模式」和「更换服务器」仍然使用独立窗口——那时主窗口里有用户的实时状态，不能卸载。

preload 只有一个（`src/preload.ts`），按文档 URL 分流三种 surface：

| 文档 | 暴露 | 说明 |
|------|------|------|
| `mindos-connect://…?shell=boot` | `mindosConnect`（含 `onStatus` / `action`） | 主窗口内的引导界面 |
| `mindos-connect://…` | `mindosConnect` | 独立的 connect / 模式选择对话框 |
| 其它（产品 origin） | `mindos` | Web 应用 |

产品 origin 永远拿不到 `mindosConnect`：协议判断不可伪造（该 scheme 只由自己的 protocol handler 提供），
且 `bootApp()` 在导航到产品页之前会先 `releaseBootShell()` 注销全部 `connect:*` handler。

远程模式会对服务器 `/api/health` 报告的 `version` 应用 `~/.mindos/config.json` 的 `minMindOsVersion`
（与本地 runtime 同一个阈值）；低于阈值时弹窗提示，可选择「仍然连接」。

---

## CI/CD（GitHub Actions）

三平台并行打包，通过 `build-desktop.yml` workflow 触发。

### 触发参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `publish` | true | 是否发布到 GitHub Releases + CDN |
| `sign_mac` | true | 是否签名 + 公证 macOS 构建 |
| `tag` | 空 | Release tag 名称；`publish=true` 时必填 |

发布时必须传 `tag=desktop-vX.Y.Z`。Workflow 会直接 checkout 这个 tag，并校验 `HEAD` 与 tag 指向一致；Finalize 只更新同一个 `desktop-vX.Y.Z` release，不再临时创建或重推 tag。Release notes 使用固定模板：下载表格（系统 / CPU / 推荐文件 / 直达链接）、版本表格（Desktop 壳版本 / 内置 MindOS Core 版本）、自动更新文件说明和 changelog 链接。

### CI 流程（macOS）

```
Install deps → Build Next.js (webpack) → Build Electron → Prepare runtime
  → Package (签名，不公证)
  → Smoke packaged app
  → Notarize (xcrun notarytool, 3 次重试, 2h 超时)
  → Staple + validate (xcrun stapler)
  → Upload artifacts
```

`publish=true` 时 `sign_mac=false` 会直接失败；未配置签名/公证凭证也会失败。`publish=false` 的调试构建可以跳过签名、公证、staple 步骤。

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

**Windows 签名（正式发布推荐）：**

| Secret | 说明 |
|--------|------|
| `WINDOWS_CERTIFICATE_BASE64` | Windows code signing 证书的 base64 编码 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 证书密码 |
| `WINDOWS_PUBLISHER_NAME` | 可选；用于校验 Authenticode signer subject |

`publish=true` 的 Windows x64 构建会启动真实 packaged Electron app 做 smoke；Windows ARM64 在 x64 runner 上保留 runtime-only smoke 与结构校验。有 `WINDOWS_CERTIFICATE_BASE64` / `WINDOWS_CERTIFICATE_PASSWORD` 时会签名并用 `Get-AuthenticodeSignature` 校验所有 `.exe` 产物；没有证书时会继续发布 unsigned artifacts，并在 workflow 日志中写 warning。NSIS 安装器会在安装/更新前停止 `MindOS.exe` 进程树和 MindOS-owned Node 子进程，避免文件锁导致 “MindOS cannot be closed” 重试弹窗；同一个 installer 生命周期只跑一次 runtime child cleanup，避免 Windows 上重复 PowerShell/WMI 扫描拖慢安装。安装完成默认不自动拉起 App。NSIS 卸载器会调用 `~/.mindos/uninstall.bat` 清理残留 runtime/cache、进程、SSH tunnel、PATH 和 app data；知识库不删除。

## 内置 MindOS 运行时

安装包将已构建的 MindOS 打进 `Resources/mindos-runtime`，离线时也能启动本地模式。

手动准备：`pnpm --filter @geminilight/mindos build && pnpm --filter @mindos/web build && pnpm --filter @mindos/desktop run prepare-mindos-runtime`

或一键：`npm run dist:with-bundled`

## 产物

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS ARM64 | `MindOS-{ver}-arm64.dmg` | Apple Silicon |
| macOS Intel | `MindOS-{ver}.dmg` | Intel Mac |
| macOS (更新用) | `MindOS-{ver}-arm64-mac.zip`, `MindOS-{ver}-mac.zip` + `latest-arm64-mac.yml` / `latest-mac.yml` | electron-updater 自动更新 |
| Windows x64 | `MindOS-Setup-{ver}.exe` | NSIS 安装程序 |
| Windows ARM64 | `MindOS-Setup-{ver}-arm64.exe` + `latest-arm64.yml` | Native ARM64 NSIS 安装程序 |
| Linux | `MindOS-{ver}.AppImage`, `mindos-desktop_{ver}_amd64.deb` | AppImage + deb |

## CDN 分发

CI publish 模式自动上传到：
- **Cloudflare R2**（国际）：`desktop/latest/MindOS-arm64.dmg`、`desktop/latest/mindos-desktop_amd64.deb` 等（去版本号）
- **阿里云 OSS**（中国）：同上
- **GitHub Releases**：原始文件名（带版本号）+ 官网 fallback 用稳定别名（如 `MindOS-Setup.exe`、`MindOS-arm64.dmg`）

Landing 页面下载链接指向 CDN `latest/` 路径，每次发版自动覆盖。
