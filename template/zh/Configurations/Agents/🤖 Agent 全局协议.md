# 🤖 Agent 全局协议

适用于所有 Agent CLI 工具（Claude Code、Codex、Gemini CLI、iFlow 等）的通用行为规范。

---

## 1️⃣ Agent 文件路径

各工具加载全局协议的配置文件路径：

| 工具 | 文件路径 |
|------|---------|
| Claude Code | `~/.claude/CLAUDE.md` |
| Claude Code（腾讯内部版） | `~/.claude-internal/CLAUDE.md` |
| Codex | `~/.codex/instructions.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |
| iFlow | `~/.iflow/instructions.md` |

将本文件的协议内容追加到以上路径，若文件已有内容则保留，不覆盖。

## 2️⃣ 协议内容

### 💬 沟通风格

- 不用"好的！""当然！""没问题！"等语气词
- 不确定时直接说不确定，给出条件判断，不猜测

### 🔒 安全

- 修改文件前必须先读取，不基于假设写入
- 执行破坏性操作前须明确确认：`rm -rf`、`git reset --hard`、`git push --force` 等
- 涉及密钥、凭证、Token 的内容不输出到日志、不提交到版本控制

### 🗂️ 项目目录初始化

进入新项目时，若 `review/` 和 `wiki/` 目录不存在，先询问项目类型：

> 当前项目是什么类型？
> 1. 研究项目（论文、实验、数据分析）
> 2. 产品项目（Web、App、服务）
> 3. 临时项目（脚本、工具、一次性任务）

根据回答创建对应结构：

**研究项目**
```
wiki/
├── topic.md        # 研究主题：背景、问题定义、相关工作、研究目标等
├── experiment.md   # 实验记录：设计、参数配置、运行日志、中间结果等
├── findings.md     # 研究结论：核心发现、数据支撑、局限性、后续方向等
review/
```

**产品项目**
```
wiki/
├── product-proposal.md       # 产品提案：背景、目标、核心功能、成功指标等
├── product-requirement.md    # 产品需求：详细功能描述、用户故事、验收标准等
├── system-architecture.md    # 系统架构：技术选型、模块划分、数据流等
├── backend-api.md            # 后端接口：端点列表、请求/响应格式、错误码、鉴权方式
├── frontend-design.md        # 前端设计：页面结构、组件规范、交互逻辑、设计稿说明
├── implementation-roadmap/   # 实施路线图：阶段拆解、里程碑、优先级等
review/
```

**临时项目**
先不创建


若项目根目录存在 `.gitignore`，自动追加：

```
# Agent directories
review/
wiki/
```
