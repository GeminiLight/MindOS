# 🤖 Agent 工具配置

安装并配置常用 AI Agent CLI 工具。Agent 可按章节顺序执行。

## 🙋 执行前澄清

- 无需澄清

## 🔍 前置条件检测

```bash
uname -s      # 确认系统类型（Darwin = Mac，Linux = 服务器）
node -v       # 确认 Node.js 版本（需 22+）
```

## 1️⃣ 前置依赖

- 确认 Node.js 版本：`node -v`（需 22+）
- 如未安装：Mac 用 `brew install node`，服务器用 `apt install nodejs`

## 2️⃣ 工具安装

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g @google/gemini-cli
npm i -g @iflow-ai/iflow-cli@latest
```

设置 Alias（zsh）：

```bash
cat << 'EOF' >> ~/.zshrc
alias cc='claude'
alias gc='gemini-cli'
alias cx='codex'
EOF
source ~/.zshrc
```

## 3️⃣ 配置偏好

- Claude Code：[Agents/🤖 Claude Code 配置.md](Agents/🤖 Claude Code 配置.md)（含权限配置、Router 配置）

## 4️⃣ MCP 配置

参考 [Agents/🤖 Agent 常用MCP.md](Agents/🤖 Agent 常用MCP.md)，对每个工具全局安装。

## 5️⃣ Skill 配置

参考 [Agents/🤖 Agent 常用Skill.md](Agents/🤖 Agent 常用Skill.md)

## ✅ 验证清单

- `claude --version`
- `codex --version`
- `gemini --version`
- `iflow --version`
