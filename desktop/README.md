# MindOS Desktop

Electron 桌面客户端

## 打包（Linux 服务器）

在 Linux 服务器上执行以下命令打包 Mac 应用：

```bash
# 1. 进入桌面客户端目录
cd ~/code/sop_note/desktop

# 2. 清理旧构建
rm -rf dist/

# 3. 重新打包（Apple Silicon + Intel）
npm run build
npm run dist:mac

# 4. 启动 HTTP 服务供下载
cd dist && python3 -m http.server 8080
```

打包完成后，产物位于 [`dist/`](./dist/) 目录：
- `MindOS-0.1.0-arm64-mac.zip` - Apple Silicon (M1/M2/M3)
- `MindOS-0.1.0-mac.zip` - Intel Mac
- `MindOS-0.1.0.dmg` - 通用安装包

## 下载（Mac 电脑）

在 Mac 终端执行以下命令下载：

```bash
# Apple Silicon (M1/M2/M3)
curl -L -o ~/Downloads/MindOS-0.1.0-arm64-mac.zip 'http://<服务器IP>:8080/MindOS-0.1.0-arm64-mac.zip'

# Intel Mac
curl -L -o ~/Downloads/MindOS-0.1.0-mac.zip 'http://<服务器IP>:8080/MindOS-0.1.0-mac.zip'
```

## 安装

```bash
cd ~/Downloads
unzip MindOS-0.1.0-arm64-mac.zip
open MindOS-0.1.0-arm64.dmg
```
