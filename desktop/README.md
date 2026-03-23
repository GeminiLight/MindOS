# MindOS Desktop

Electron 桌面客户端

## 打包脚本

项目提供了两个打包脚本，分别用于不同平台：

| 脚本 | 运行环境 | 输出格式 | 签名支持 |
|------|---------|---------|---------|
| `build-linux.sh` | Linux 服务器 | `.zip` | ❌ 不支持 |
| `build-mac.sh` | macOS 本地 | `.dmg` | ✅ 可选 |

### 1. 在 Linux 服务器打包（zip 格式）

Linux 服务器只能打包 `.zip` 格式，无法创建 `.dmg`：

```bash
cd ~/code/sop_note/desktop
./scripts/build-linux.sh
```

输出文件：
- `dist/MindOS-0.1.0-arm64-mac.zip` - Apple Silicon (M1/M2/M3)
- `dist/MindOS-0.1.0-mac.zip` - Intel Mac

### 2. 在 Mac 本地打包（dmg 格式）

在你的 Mac 电脑上运行，默认**启用签名**：

```bash
cd ~/code/sop_note/desktop

# 默认：签名构建（需要 Apple Developer ID 证书）
./scripts/build-mac.sh

# 可选：无签名构建（无需开发者账号）
./scripts/build-mac.sh --no-sign
```

输出文件：
- `dist/MindOS-0.1.0-arm64.dmg` - Apple Silicon (M1/M2/M3)
- `dist/MindOS-0.1.0-x64.dmg` - Intel Mac

### 3. 启动 HTTP 服务供下载（Linux 服务器）

打完包后，在 Linux 服务器上启动 HTTP 服务：

```bash
cd dist && python3 -m http.server 8080
```

### 4. 下载（Mac 电脑）

在 Mac 终端执行以下命令下载：

```bash
# Apple Silicon (M1/M2/M3)
curl -L -o ~/Downloads/MindOS-0.1.0-arm64-mac.zip 'http://<服务器IP>:8080/MindOS-0.1.0-arm64-mac.zip'

# Intel Mac
curl -L -o ~/Downloads/MindOS-0.1.0-mac.zip 'http://<服务器IP>:8080/MindOS-0.1.0-mac.zip'
```

## 安装

### 从 zip 安装（Linux 打包的无签名版本）

```bash
cd ~/Downloads
unzip MindOS-0.1.0-arm64-mac.zip
sudo mv MindOS.app /Applications/

# 解除隔离（因为无签名）
xattr -cr /Applications/MindOS.app

# 启动
open /Applications/MindOS.app
```

### 从 dmg 安装（Mac 打包的版本）

双击 `.dmg` 文件，将应用拖到 Applications 文件夹即可。

如果无签名，首次打开需要运行：
```bash
xattr -cr /Applications/MindOS.app
```

## 签名说明

由于目前使用 `--sign` 需要 Apple Developer ID（$99/年），无签名打包是更经济的选择。

| 方案 | 成本 | 用户体验 |
|------|------|---------|
| 无签名打包 | 免费 | 需运行 `xattr -cr` 解除隔离 |
| 有签名打包 | $99/年 | 直接双击打开，无警告 |

更多签名设置参见：[Code Sign Setup](https://www.electron.build/code-signing)
