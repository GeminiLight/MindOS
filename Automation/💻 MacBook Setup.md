# 💻 MacBook Setup

一键式 MacBook 初始化流程。Agent 可按章节顺序执行。

## 🙋 执行前澄清

- 是否已有代理工具？（影响软件下载、镜像源选择）
- 是否需要配置 GPU 环境？（Apple Silicon / CUDA 相关）

## 🔍 前置条件检测

```bash
brew --version        # 检查 Homebrew 是否已安装
node -v               # 检查 Node.js 版本
docker --version      # 检查 Docker 是否已安装
```

## 1️⃣ 系统基础

- 安装 Homebrew
- 安装常用 CLI 工具：`brew install git curl wget vim tmux htop tree unzip`

## 2️⃣ 代理配置

- 安装代理工具
- 配置终端代理：`export https_proxy=http://127.0.0.1:{port} http_proxy=http://127.0.0.1:{port}`
- 写入 `~/.zshrc`，按需开关

## 3️⃣ Python 环境 🐍

参考 [Tools/🐍 Python 环境配置.md](Tools/🐍 Python 环境配置.md)

## 4️⃣ 开发工具 🛠️

- 安装 Docker Desktop
- 安装 Node.js (LTS)：`brew install node`
- 安装 VS Code：`brew install --cask visual-studio-code`
- 安装终端：`brew install --cask warp`

## 5️⃣ Git & SSH 🔑

- 配置 Git 全局信息：`git config --global user.name "GeminiLight" && git config --global user.email "wtfly2018@163.com"`
- 配置 SSH 密钥，参考 [Tools/🔑 SSH 密钥.md](Tools/🔑 SSH 密钥.md)
- 配置 `~/.ssh/config`，参考 [Tools/🔑 SSH Hosts.md](Tools/🔑 SSH Hosts.md)

## 6️⃣ 常用软件

参考 [Apps/📦 Mac 常用软件.md](Apps/📦 Mac 常用软件.md)

## 7️⃣ 目录结构 📁

- 创建标准目录：`mkdir -p ~/code ~/research ~/data`
- 克隆常用仓库

## ✅ 验证清单

- `brew --version`
- `python --version` / `conda info`
- `docker --version`
- `node --version`
- `git config --list`
- `ssh -T git@github.com`
