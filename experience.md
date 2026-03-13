# MindOS 项目经验复盘

> **触发 Prompt**
> ```
> 帮我把我们的全部聊天历史沉淀复盘到，要注意我的human feedback，experience-n.md（n是指如果1，存在了就2），分成MindOS项目强相关的和通用的两类，可以抽象下 注重通用性
> ```
> ```
> 帮我把这个新的笔记 experience-2.md 增量式更新到experience.md，用来提高群体智慧，但不要遗漏太多细节
> ```
> ```
> 你再回忆下还有没有需要补充的重要信息
> ```

> 累计迭代：营销素材 3 轮 + CLI 重构 2 轮 + 组件拆分 2 轮 + demo-flow 文本修正 + aha-moment 网页 + 前端诊断修复 + MCP Bug 修复链 + Sync Workflow 优化 + 搜索优化 + Hydration/配置修复（2026-03-14）
> 产出：封面图、安装指南图、demo-flow 中英文、landing page、Marketing.md 全版本文案（A-E 新旧对照）、小红书笔记终版、sync workflow commit message 优化 + 版本号自动 changelog + 同步范围补全、CLI 模块化重构（1219→746 行 + 14 个 lib 模块）、MCP CLI 4 连 bug 修复、CsvRenderer 拆分（693→68 行）、SettingsModal 拆分（588→182 行）、release 脚本、aha-moment 营销网页中英文、前端 production 部署修复、Fuse.js 搜索优化（索引缓存+CJK+大文件截断+snippet 质量）、React hydration monkey-patch、AI provider 配置优先级修复、Playwright E2E 搜索测试

---

# Part A: MindOS 专属经验

## 1. Human Feedback 记录

### 沟通效率（第 1-2 轮）

**F0a: "继续" / "继续啊" / "你在干吗 直接回答我"**
- 指令明确 → 直接做；只在有歧义或破坏性操作时才暂停确认

**F0b: "不是 我的意思是应该更加通用来增加用户体感"**
- Agent 提议"做个 AI 知识库"太贴近 MindOS 自身，不够通用

**F0c: "不要用写小红书文案，还是用讨论项目写文档"**
- 痛点描述要匹配工具核心功能，不能拿一个具体场景概括通用工具

**F0d: "记一次 → 所有 Agent 自动知道 后面再加个 → 自动复盘经验"**
- MindOS 三价值每个触点都要体现

**F0e: "复盘经验回流 改成 复盘经验"**
- 封面文案要在给定字号下保持单行。先定字号，再裁文案长度

### 视觉与字号（第 1-2 轮）

**F0f: "下面关于 MindOS 之后的字体都应该更大些" + "字体可以再大一点"**
- 小红书 1080×1440 在手机上会缩放，底部重点信息字号要比直觉大 1.5-2 倍

**F0g: "想好了新项目还是应该独立一行的，不过字体可以小些"**
- 信息层级用字号差异表达：标题行 28px+淡色 vs 正文行 32px+主色

**F0h: "开源可以更明显些"**
- 重要标签独立元素化：描边+颜色+独立 `.opensource-tag`

### 数据一致性与文件状态（第 1-2 轮）

**F0i: "已粘贴 ×4 改成 ×3"**
- 修改一个数据点时，必须全局搜索所有关联引用

**F0j: 用户手动修改了 cover-zh.html**
- 用户可能在 Agent 工作间隙自己动手改文件，修改前务必 Read 最新内容

**F0k: "好的，另外再 commits 前帮我运行下测试" / "我的意思是 tests 文件夹和 app/__test__"**
- 提交前跑测试是标配流程，主动问清测试目录

### 文案策略（第 3 轮）

**F1: "更偏普通用户日常使用 Agent 的经历" → "应该是重要、普遍、且痛点的事情"**
- 第一轮 case 太偏产品/创业场景，用户连续两次否定
- **原则：营销 case 三要素——重要、普遍、痛点。缺一不可**

**F2: 用户选择会议纪要 case 并补充 "OpenClaw 还应当加上自动沉淀经验和总结其他人回复的功能"**
- 用户选 case 时会同时补充产品差异化点
- **原则：case 选择是产品定位的关键决策，要给用户充足选项 + 空间补充**

**F3: "Claude Code 和 Cursor 有点重复了"**
- 两个都是写代码的工具，场景重叠。换成 ChatGPT 覆盖面更广
- **原则：Agent 阵容覆盖不同类型（规划/实现/协作），不同类重复**

**F4: "开完会" → "有一个新的想法" 更通用**
- 绑死单一场景（会议）会限制代入感。"有新想法"人人都有

**F5: "搬运上下文" vs "重复介绍自己"**
- 用户偏好"搬运上下文"——更准确描述痛点动作

**F6: "你和AI看同一份笔记——这句话不是价值？看是透明化，而且不止看还可以编辑"**
- 透明可控本身是核心卖点，不是附属的"安全保障"

**F7: "你得再想想，体现下我们的优势特色"**
- 标题"开完会记一句话，3个AI同时帮我干活了"只描述了结果，没点明机制
- 最终标题：让多个AI共享大脑！随手记一句，全自动执行了🧠

**F8: "手机随手记一句，自动关联更新——你也得考虑这个"**
- 功能点列表不能漏掉核心入口（手机随手记）

**F9: "版本 A B C 也用新旧版本格式更新下"**
- 用 `####` 区分新旧版本，保留历史对照

**F10: "配图计划也同步更新下，图5 Token那张删掉"**
- 正文删了 Token 段，配图计划没同步 → 被用户发现

**F11: "你运行它了吗 capture-demo.mjs"**
- 更新完 HTML 内容后忘了重新生成截图

### demo-flow 与 aha-moment（第 4 轮）

**F12: "这个可以当核心卖点" → "方便用户直接上手"**
- 不要替用户做价值判断（"核心卖点"），描述实际功能（"方便上手"）

**F13: "文件名英文版不加后缀，中文版加-zh"**
- **命名规范：英文 = 默认（无后缀），中文 = `-zh` 后缀**

**F14: "你的想法" → "你的思考"**
- 中文用词精准度：「想法」(casual idea) 太轻，「思考」(thinking/reflection) 更有分量和意图感

**F15: "第一步只是随手记录，第二步是智能归档，第三步是人类可读"**
- MindOS 价值链严格四步：(1) 无门槛记录 (2) AI 归档 (3) 人类可读 (4) Agent 调用
- **不能合并或重排这些步骤**

**F16: "你应该在网页里面引用图片，然后写标题和适当标注帮忙理解，而不是完全自己生成"**
- 营销页面应引用真实产品截图 + 标注，不要生成合成 mockup
- **真实性 > 精致度**

**F17: "第 4 步先加文本示例吧"**
- 截图还没准备好时，用文本占位而不是阻塞等待素材

### 前端诊断（第 4 轮）

**F18: "我是在本地电脑ssh了这台服务器"**
- 开发环境 = 本地笔记本 SSH 到远程服务器。dev mode 在 SSH tunnel 下极慢

**F19: "Unauthorized 为什么现在和MindOS Agent聊天是报错Unauthorized"**
- Shell 环境变量 `AUTH_TOKEN` 被 Next.js 继承，导致中间件意外启用鉴权
- 清空方法：`AUTH_TOKEN= nohup npm run start`

### 测试与架构（第 4 轮）

**F20: "先抽取 shared-core"**
- 重复代码先抽取为 packages/core，再写测试，而不是对重复代码分别测试

**F21: "核心逻辑+API + MCP, 但Playwright 前端 E2E 写在TODO里面"**
- 测试优先级：核心逻辑 > API 路由 > MCP 集成 > 前端 E2E
- E2E 记录在 TODO，不阻塞当前迭代

### 代码拆分与 Bug 修复（第 5 轮）

**F22: "这个文件现在太长了，你可以合理拆分下，一定要确保正确性！"**
- 强调正确性 → 大文件拆分必须先做完整结构分析再动手

**F23: MCP CLI 报错 `ERR_MODULE_NOT_FOUND`，"按道理应该回下拉式让我选择哪个agent工具，其他自动点yes"**
- 用户一次报告包含两层信息：(1) 错误症状 (2) 期望行为
- 最终发现 4 个串联 bug，要沿调用链全部修复

**F24: 用户在 Agent 规划 cli.js 拆分期间，自己完成了拆分 + sync + open + token 增强**
- Agent 动作慢于用户预期时，用户会自己动手
- **原则：规划阶段如果用户没明确说"等你计划好再做"，要尽快给出结论**

### Sync Workflow 优化（第 6 轮）

**F25: "我的mindos里面的git记录全只能体现从mindos-dev的哪个分支下载，没办法看出来具体更新了哪些"**
- 原 commit message：`sync: from mindos-dev @ <hash>` — 只有来源，没有变更内容
- **原则：跨仓库同步时，commit message 必须携带变更语义，不能只写来源引用**

**F26: "'synced from mindos-dev @ abc1234' 我觉得，这种文本可以删除"**
- 用户认为来源追溯文本是噪音，主 message 已经足够定位
- **原则：commit message 信噪比优先。辅助追溯信息如果不增加理解价值就是噪音**

**F27: 用户主动补了 `bin/`、`scripts/`、`tests/` 到 paths 触发和 rsync 列表（在 Agent 修改 commit message 期间）**
- 用户自己发现 workflow 的 paths 和 rsync 列表不包含新增的目录
- **原则：新增顶层目录后，必须同步检查 CI workflow 的 paths 触发列表和 rsync 同步列表**

**F28: "你再看看现在的项目架构和README，看看还有什么需要从mindos-dev同步到MindOS里面的不"**
- 用户要求系统性审查同步范围，不只修一个点
- 审查发现缺 `TROUBLESHOOTING.md` 和 `package-lock.json`
- **原则：同步范围审查要对比"发布仓库应有的文件"和"当前实际同步的文件"，不能只看增量**

### 搜索优化与前端修复（第 7 轮）

**F29: "继续优化"**
- 初始 Fuse.js 实现已到位，用户要求进一步优化
- Agent 需主动识别优化点：每次搜索重建索引（→缓存）、require→ES import（→类型安全）、大文件全文索引（→截断）、snippet 取第一个匹配（→取最长）、CJK 支持弱（→extended search）

**F30: "帮我测试下"**
- Agent 写完代码后用户要求验证——意味着之前验证不够充分
- **原则：功能完成后主动用实际数据跑完整测试，不等用户催**

**F31: "我在哪个端口可以测试下前端"**
- Agent 应主动检查 dev server 状态并告知端口，不等用户问

**F32: 报 `removeChild` 错误，wrapper div 修复后 "还是有问题"**
- wrapper div + `suppressHydrationWarning` 不彻底——只处理文本差异，不处理 DOM 结构差异
- **正确修复：monkey-patch Node.prototype.removeChild/insertBefore**
- 参考：https://github.com/facebook/react/issues/17256

**F33: 用户贴了完整问题分析（AI provider 默认值短路 bug），"看看有没有这个问题，有的话fix下"**
- 用户已做完 root cause 分析，Agent 只需验证并执行
- **原则：用户给出诊断时，先验证准确性，准确就直接修复，不重复分析**

**F34: "app/tsconfig.tsbuildinfo 这是啥文件 可以删除吗"**
- **原则：构建产物/缓存文件不应被 git 跟踪。发现后立即 .gitignore + git rm --cached**

---

## 2. 产品定位与文案

### MindOS 四步价值链（更新版）
1. **随手记录** — 无门槛，任何设备随时输入
2. **智能归档** — Agent 自动归档到正确位置，关联更新
3. **人类可读** — Markdown 结构化存储，网页界面浏览编辑，透明可控
4. **Agent 即刻调用** — 任意 Agent 通过 MCP 读取，零重复解释

每个触点（封面、正文、aha-moment、landing page）都要体现这四步。

### Agent 阵容选择

| 渠道 | 规划 | 实现 | 协作 |
|------|------|------|------|
| Marketing.md（面向大众） | ChatGPT | Cursor | OpenClaw |
| demo-flow HTML（面向技术用户） | Gemini | Cursor | OpenClaw |

- 阵容覆盖"规划→实现→推广"全流程，不同类重复
- 不放 Claude Code：MindOS 跑在 Claude Code 上，放在"痛点"位逻辑矛盾
- 面向大众用 ChatGPT（知名度最高），面向技术用户用 Gemini

### 场景 case 迭代路径

| 轮次 | case | 结果 |
|------|------|------|
| 初始 | 用户增长策略 | 太偏产品/创业 |
| 第二轮 | 会议纪要（开完需求评审） | 场景太具体 |
| 第三轮 | 新项目想法（想好了新项目） | 最通用，最终版 |

### 标题迭代路径（5 轮，小红书版本 E）

1. "开完会记一句话，3个AI同时帮我干活了" — 有场景但没特色
2. "让AI共享大脑后，开完会记一句全自动了" — 加了特色但场景绑死
3. "让AI共享大脑后，随手记一句，全自动执行了" — 场景泛化
4. "让多个AI共享大脑！随手记一句，全自动执行了🧠" — "多个"更具体
5. 关于"你的大脑" vs "大脑" → 不加"你的"，省字更紧凑

### 封面信息层级（最终版）

```
[场景标签] 32px 次级色 → "你是不是也这样？"
[笔记卡片]
  标题行: 28px 次级色 → "想好了新项目："
  正文行: 32px 主色   → "先理清思路，代码开搞，顺便发个帖宣传下"
[痛点列表] 30px 工具名 + 26px 描述
─── 分割线 ───
[MindOS logo 80px] [名称 66px] [开源标签 40px 描边]
[主标题 88px] "和所有 Agent 共享你的大脑"
[副标题 40px] "随手记录 → 所有 Agent 自动知道 → 复盘经验"
```

### 安装指南图
- 双路径：一键安装（推荐）vs 手动 4 步
- 一键安装用聊天窗口 mock，降低心理门槛
- 第三步 MCP install 不指定具体工具，MindOS 支持所有 MCP 客户端

### 小红书专项

**6 维度分析框架：**
1. 关键词分析 — 搜索热度、布局、标签
2. 标题/首段吸引力 — 爆款公式、黄金50字
3. 敏感内容风险 — 违规词、限流风险
4. 商业化程度 — 自然度、自推限流风险
5. 互动触发潜力 — 讨论点、分享动机、收藏价值
6. 内容结构 — 排版、长度、节奏

**关键优化点：**

| 问题 | 解决 |
|------|------|
| "于是我做了MindOS" 暴露自推 | 改成"最近发现一个开源项目MindOS"，用户视角 |
| Token 1B+ 用量段——炫耀感 | 直接删除 |
| "📌 图2/3/4" 图片说明段冗余 | 删除，用户自己会翻图 |
| 标签 #MCP #Agent 搜索量低 | 换成 #AI提效 #AI神器 #打工人效率 |
| 正文 450 字过长 | 压缩到 ~320 字 |

评论区置顶模板：链接汇总 + 一句话安装命令 + 支持工具列表。正文用"🔗评论区找链接"引导。

**小红书配图结构（最新版）：**
1. 一图看懂（系统全景） — demo-flow 截图
2. aha-moment（四步流程） — aha-moment 网页截图
3. 使用证明 — Token 一周消耗 1B+ 截图（社交证明）

### 跨文件同步清单

更新场景/文案/case 时必须同步：

| 文件 | 内容 |
|------|------|
| `marketing/Marketing.md` | 文案（Version A-E 新旧版本） |
| `marketing/cover-zh.html` | 封面 |
| `marketing/install-guide-zh.html` | 安装引导 |
| `marketing/aha-moment/index.html` | 英文 aha-moment 网页 |
| `marketing/aha-moment/index-zh.html` | 中文 aha-moment 网页 |
| `assets/demo-flow-zh.html` | 中文 demo 流程图 |
| `assets/demo-flow.html` | 英文 demo 流程图 |
| `landing/index.html` | Landing page "一图看懂" section |
| 所有对应 `.png` 截图 | 改了 HTML 必须重跑截图 |

Landing page 标题不加"MindOS："前缀（有 context），独立页面标题要加。

### CLI 架构（0.1.9+ 重构后）

- `bin/cli.js`（主入口，746 行，命令路由 + help）+ `bin/lib/`（14 个模块，按职责划分）
- 模块划分：constants, colors, utils, config, build, port, pid, stop, gateway, startup, mcp-spawn, mcp-install, sync
- 环境变量映射：配置层写 `MINDOS_MCP_PORT`，MCP 服务读 `MCP_PORT`，需显式映射
- `-y` 免交互模式：`choose()` 的 `forcePrompt` 参数控制哪些选择不可跳过（如 agent 选择）
- 版本升级：`cleanNextDir()` 清理整个 `.next` 目录，不是只删 lock 文件
- 发版：`npm run release [patch|minor|major]`，自动跑测试 → bump → commit → tag → push → 等 CI

### MCP CLI Bug 修复链（4 连 bug）

```
症状：mindos mcp -g -y → ERR_MODULE_NOT_FOUND
  ↓
Bug 1: npm global install 不包含 mcp/node_modules → first-run auto-install
Bug 2: argv[3] 是 "-g" 不是 "install" → 检测 install flags 路由
Bug 3: -y 跳过了 agent 选择 → forcePrompt 模式
Bug 4: args 解析起始位置错误 → 动态 startIdx
```

### 组件拆分记录

| 组件 | 拆分前 | 拆分后 | 子文件数 |
|------|--------|--------|---------|
| CsvRenderer.tsx | 693 行 | 68 行 | 7（types + 5 views + index） |
| SettingsModal.tsx | 588 行 | 182 行 | 9（types + primitives + 6 tabs + index） |
| bin/cli.js | 1219 行 | 746 行 | 14 个 lib 模块 |

### 前端部署（远程 SSH 场景）

- **dev mode vs production**：SSH tunnel 下 Turbopack dev 模式加载数十个 chunk JS，每个文件一次 round-trip，极慢。production build（`npm run build && npm run start`）响应 26ms vs 150ms
- **Turbopack 静态分析干扰**：`path.resolve(process.cwd(), 'scripts/x.cjs')` 被 Turbopack 识别为模块引用。解法：`[process.cwd(), 'scripts', 'x.cjs'].join(path.sep)` 完全动态化
- **环境变量继承**：Next.js production server 继承 shell 的 `AUTH_TOKEN`。清空方法：`AUTH_TOKEN= nohup npm run start`
- **端口冲突**：`lsof -i :3000` 查不到但 `ss -tlnp` 能找到 → 老进程残留，需 kill

### Sync Workflow 设计决策

**Commit Message 策略演进：**

| 版本 | 格式 | 问题 |
|------|------|------|
| v1 | `sync: from mindos-dev @ <hash>` | 没有变更语义 |
| v2 | `<原始 message>` + body `synced from mindos-dev @ <hash>` | body 是噪音 |
| v3（最终） | 直接用 `<原始 commit message>` | 干净，语义完整 |

**版本号 Commit 特殊处理：** bare 版本号（如 `0.1.9`）信息量不足，workflow 自动检测并附上一个 tag 到当前的 changelog。

**同步范围清单（完整版）：**

目录同步（rsync --delete）：`app/`（排除 node_modules/.next）、`mcp/`（排除 node_modules）、`skills/`（排除 node_modules）、`templates/`、`assets/`、`bin/`、`scripts/`、`tests/`

单文件复制：`package.json`、`package-lock.json`、`README.md`、`README_zh.md`、`LICENSE`、`.env.local.example`、`TROUBLESHOOTING.md`

特殊处理：`.gitignore.prod` → 复制为 `.gitignore`（生产仓库的 gitignore 不同于开发仓库）

不同步的（开发专用）：`marketing/`、`my-mind/`、`wiki/`、`review/`、`experience*.md`、`note.md`、`cli-note.md`、`TODO.md`、`TASKS.md`、`GIT_UPDATE.md`、`Claude.md`、`landing/`（走单独的 gh-pages 部署）

### Fuse.js 搜索架构

**索引缓存设计：** `SearchIndex { fuse, documents, timestamp }` 与 FileTreeCache 共享 TTL（5s），文件写操作统一失效。冷启动 16ms，缓存命中 13ms。

**CJK 搜索策略：** Fuse.js 默认字符级模糊匹配对 CJK 效果差（每个汉字独立 token）。检测到 CJK 字符时切换到 extended search 的 include-match 模式（`'` 前缀），做精确子串匹配。

**大文件截断：** `MAX_CONTENT_LENGTH = 50_000`（50KB），超过的在索引时截断。避免大 CSV 拖慢整体搜索。

**Snippet 改进：** 遍历所有 match indices 选最长匹配段（而非第一个），最能代表搜索意图。

**Fuse.js 配置：** fileName 权重 0.3、path 0.2、content 0.5。`threshold: 0.4`，`ignoreLocation: true`，`useExtendedSearch: true`，`minMatchCharLength: 2`。

### AI Provider 配置优先级 Bug

```
根因：DEFAULTS.ai.provider = 'anthropic'（truthy）
→ effectiveAiConfig(): s.ai.provider || process.env.AI_PROVIDER || 'anthropic'
→ 'anthropic' 直接短路，.env.local 的 AI_PROVIDER=openai 永远不生效
```

修复：DEFAULTS 所有字段改为空字符串（falsy），优先级链变为：settings 文件显式值 > .env.local > 代码兜底默认值。同时给 `streamText()` 加 `onError` 回调输出到 console。

### React Hydration removeChild 修复

浏览器扩展在 SSR→hydration 间修改 DOM → React `removeChild` 找不到节点。

- `suppressHydrationWarning`：只处理文本差异，无效
- wrapper div：扩展照样修改内层 DOM，无效
- **有效方案**：`<head>` 最早执行的 `<script>` monkey-patch `Node.prototype.removeChild`/`insertBefore`，当 `child.parentNode !== this` 时自动修正到正确 parent

---

# Part B: 通用经验

## 1. 沟通与执行效率

**指令明确就直接做，不反问确认。** 多余的确认是浪费时间。只在有歧义或破坏性操作时才暂停。

**修改文件前先 Read。** 用户可能在 Agent 工作间隙手动改过文件，不能假设文件状态不变。

**Edit 前先 Grep 确认当前内容。** 用户手动修改可能导致 `old_string` 匹配失败。

**提交前跑测试是标配。** 主动确认测试目录和命令。

**Agent 必须自检输出。** 生成了截图/图片，要主动查看验证结果，不能只信代码逻辑。

## 2. 营销文案通用原则

**场景通用 > 特定。** 让目标用户直接代入，不绑死单一场景。

**营销 case 三要素：重要、普遍、痛点。** 缺一不可，不能只追求"有趣"。

**标题要同时传达"机制"+"效果"。** 只有结果没有机制，用户不知道你是什么；只有机制没有效果，用户不知道你有什么用。

**标题/场景泛化 + 正文具体化。** 标题覆盖面广，正文讲具体故事，不重复不矛盾。

**痛点描述用动作词。** "搬运上下文" > "记忆散落"——动作比状态更有冲击力。

**价值点不要降级为保障点。** 想清楚每个特性是"价值"（用户因此选择你）还是"安心"（用户不因此离开你）。

**描述功能，不做价值判断。** "方便用户直接上手" > "这个可以当核心卖点"。让用户自己判断价值。

**case 早期不要过度投入细节。** 改一个 case 可能涉及 6+ 文件同步，先确定方向再精修。

**文案迭代保留旧版本。** 方便 A/B 对比和回溯。

**标题打磨是高价值投入。** 每轮只改一个变量，20 字寸土寸金。

**中文用词精准度很重要。** "思考" > "想法"，"搬运" > "散落"——一个字的差异改变语义分量。

## 3. 小红书 / 社媒通用原则

**自推规避：** 用"发现"不用"做了"，用户视角不用创始人视角。

**标签选热搜词：** #AI提效 > #MCP，#打工人效率 > #程序员效率。受众面决定流量上限。

**封面字号宁大勿小。** 手机缩放后底部信息要比直觉大 1.5-2 倍。先定字号再裁文案长度，保证单行。

**投票设计：** 调研痛点而非功能偏好。前两项收割大众票，后两项筛出高价值用户。内容和正文痛点形成闭环。

**内容约束：** 标题 ≤ 20 字符，正文 ≤ 1000 字符，封面比例 3:4（1080×1440），配图最多 9 张（建议 6-7 张）。

**配图结构模板：** (1) 系统全景图 (2) 功能流程图 (3) 使用证明/社交证明。三张图讲完整故事。

## 4. 视觉设计通用原则

**信息层级用字号差异表达。** 不要一股脑挤一行。

**重要标签独立元素化。** 描边 + 颜色 + 独立组件，不混在描述文本里。

**营销页面用真实截图 + 标注，不用合成 mockup。** 真实性 > 精致度。

**设计系统从已有素材派生，不要凭空发明。** 参考现有 landing page 的配色和字体。

**柔和暖色调优先。** 用户偏好 amber 主色、Inter/Lora/JetBrains Mono 字体组合、深色背景 `#0a0906`。

**Playwright 截图注意事项：**
- 外部资源用 base64 内联（file:// 下相对路径会失败）
- 大 SVG base64 太长 → 手绘简化版 48×48 图标
- JS 渲染内容需 `waitForTimeout(2000)`，纯 CSS 页面 1000ms 足够
- 无 `.canvas` 容器的页面用 `full_page=True`
- Headless Chromium 需要系统级 CJK 字体（Noto Sans SC），CSS fallback 不够
- **不要在生成图片中使用 emoji**——headless Chromium 渲染异常

**CSS 变量主题切换：**
```css
:root { --bg: #0a0906; ... }
body.light { --bg: #f8f6f2; ... }
```
一份 HTML 通过 `body.classList.add('light')` 切换主题，Playwright 生成两版截图。

**Landing page section 丢失排查：**
- 空 `<section>` 没有 `</section>` → 后面的 section 被嵌套吞掉
- 排查：`git show COMMIT:file | grep -n "section-name"` 对比历史

## 5. 数据一致性

**修改数据时全局搜索关联引用。** 数字、计数、名称类信息尤其容易遗漏。

**删内容时全局搜索所有引用。** 正文、配图计划、评论区模板、标签——漏一个就会被用户发现。

**改 HTML → 重跑截图是原子操作。** 不可拆分。

**大文件编辑后检查关键 section 完整性。** 空 `<section>` 缺闭合标签会把后续 section 吞掉。

## 6. 命名规范

**双语文件命名：英文 = 默认（无后缀），中文 = `-zh` 后缀。** 例：`demo-flow.html`（英文默认）、`demo-flow-zh.html`（中文）。

**时间敏感词要剔除。** "明天写个方案" → "写个方案"——去掉容易过时的时间词。

## 7. 代码重构

**拆分先等价后迭代。** 重构不混入新功能。先保证行为等价、测试通过，再加新特性。

**重构后必须全量回归测试。** 不能只测改动的部分。

**测试覆盖组合场景。** 多个维度交叉测试（如 stdio/http × 有 token/无 token × 自动/交互 × 各 agent）。

**重复代码先抽共享模块再测试。** 不要对重复代码分别测试，先抽取 shared-core。

**测试优先级：核心逻辑 > API 路由 > 集成测试 > E2E。** 不紧急的 E2E 写入 TODO，不阻塞当前迭代。

## 8. 大文件拆分方法论

**先画依赖图，再定模块边界。** 拆之前做完整结构分析：哪些函数调用哪些函数、共享哪些变量、有无循环依赖。不分析就拆 = 拆完一堆循环导入。

**循环依赖的解法：合并或延迟导入。** 两个模块互相引用时，要么合并到一个文件（如 systemd + launchd + gateway），要么用延迟 `import()`。

**命令路由层（orchestrator）留在主文件。** 它引用所有模块但不被引用，天然是依赖图的根节点。

**React 组件拆分顺序固定：types → 共享 UI → 业务组件 → barrel export。** 先拆被依赖最多的。状态管理留在父组件，子组件纯 props。

## 9. Bug 链式追查

**用户报一个症状，沿调用链至少查 3 层。** 表面 bug 修了，底层 bug 还在 → 用户换个姿势又遇到。修完每一层都要用原始操作重新验证。

**免交互模式（-y）需要区分"可以跳过"和"必须交互"。** 有些选择（如选择 agent）即使在自动模式下也必须让用户做决定。用 `forcePrompt` 模式标记。

**npm 全局安装不包含 devDeps 和被排除的目录。** 全局安装后首次运行需要 auto-install 缺失依赖。

## 10. 环境变量与配置

**环境变量在写入方和读取方之间必须有显式映射。** 不能假设名称一致，这是隐蔽 bug 源。

**静默跳过必须有日志。** 免交互 ≠ 免反馈。任何自动跳过的步骤都应该有一行日志说明。

**Shell 环境变量会被子进程继承。** `AUTH_TOKEN` 等变量可能来自其他服务（如 claude-code-router），启动新服务时要显式清空或覆盖。

## 11. 构建与缓存

**版本变更 → 全量清理构建缓存 → 再构建。** 删 lock 文件不够，要清整个构建产物目录。

**Turbopack 静态分析会追踪 `path.resolve()` 参数。** 用完全动态的数组 join 避免：`[process.cwd(), 'scripts', 'x.cjs'].join(path.sep)`。

**远程 SSH 场景优先 production build。** dev mode 加载大量 chunk 文件，每个一次 round-trip，在高延迟网络下极慢。

## 12. 发布流程

**多步发布流程不要手动执行。** 封装成脚本，加前置检查（工作区干净、测试通过），用 `npm version` 让版本号 + commit + tag 原子完成，推送后等待 CI 结果确认发布成功。

**Git tag changelog：** 用 `git describe --tags --abbrev=0 TAG^` 沿 commit 图找上一个 tag，不要用 `git tag | sort -V`。

## 13. 跨平台兼容

**用 `process.platform` 做平台分支。** 将平台差异封装在同一模块的不同对象中。

**路径处理用 `node:path` 的 `resolve`。** 不要硬拼字符串。

**ESM 模块中获取 `__dirname`：** `dirname(fileURLToPath(import.meta.url))`。

**ESM 模块解析不走 `NODE_PATH`。** 脚本依赖的 `node_modules` 必须在脚本所在目录或其祖先目录中，或通过 symlink 解决。

## 14. 端口与进程诊断

**`lsof -i :PORT` 查不到但端口被占用时，用 `ss -tlnp | grep PORT`。** `lsof` 受权限限制，`ss` 更可靠。

**远程服务器残留进程要定期清理。** `nohup` 启动的进程不会随 SSH 断开终止。

## 15. 工作流沉淀

**成功的多轮迭代工作流要沉淀为 SOP。** 复杂流程（HTML → Playwright → README）做完一次就文档化，降低下次重复成本。

**对话历史是原始素材，要提炼为可复用经验。** 按"项目专属 vs 通用"分类，抽象出原则，注重通用性。

**素材还没准备好时用文本占位。** 不阻塞整体流程，等素材到了再替换。

## 16. 用户并行工作的应对

**用户在 Agent 规划期间可能自己完成实现。** Agent 花时间分析和写计划时，用户可能等不及直接动手。回来发现文件已大变样。

**任何操作前 Read 最新文件，不信任缓存。** 特别是在 plan → implement 之间可能过了很久。

**检测到文件已被修改时，分析差异而非覆盖。** 用户的修改可能引入了新功能（如 sync、open 命令），应理解并适配。

**规划阶段不要拖太久。** 用户没明确说"等计划好再做"时，尽快给出结论开始行动。

## 17. 跨仓库同步 Workflow

**Commit message 必须携带变更语义。** `sync: from repo-X @ hash` 对阅读者毫无价值——看不出改了什么、为什么改。直接透传源仓库的 commit message。

**来源追溯信息是可选的。** 如果源仓库的 commit message 本身就足够定位，额外的 `synced from ...` 就是噪音。需要追溯时 `git log --oneline` 对比两个仓库即可。

**版本号 commit 需要特殊处理。** bare 版本号（如 `0.1.9`）单独作为 commit message 信息量为零。自动附上 changelog（上一个 tag 到当前 tag 之间的 commit 列表）。

**`git describe --tags --abbrev=0 TAG^` 找上一个 tag。** 不要用 `git tag | sort -V`——它按字典序排，不按 commit 图排。`describe` 沿 commit 图回溯，语义正确。

**同步范围要显式维护。** 新增顶层目录后，必须同步更新三个地方：
1. CI workflow 的 `paths` 触发列表（控制何时触发 sync）
2. rsync 同步命令（控制同步哪些目录）
3. `package.json` 的 `files` 字段（控制 npm publish 包含哪些文件）

三处不一致 = 有东西不会被同步或发布，但你发现不了。

**生产仓库和开发仓库的 `.gitignore` 不同。** 开发仓库忽略 `my-mind/`、`review/`、`wiki/` 等个人目录；生产仓库不需要。用 `.gitignore.prod` 维护生产版本，sync 时覆盖。

## 18. 同步范围审查方法论

**审查同步范围 = "发布仓库应有的文件" − "当前实际同步的文件"。** 不要只看增量，要做全量对比。

**用户文档也需要同步。** `TROUBLESHOOTING.md` 这类文件容易被遗漏——它不是代码，但对用户必不可少。

**`package-lock.json` 必须同步。** 没有它，`npm ci` 无法复现精确的依赖版本树。

## 19. 营销素材网页设计

**aha-moment 类营销页的四步结构：** 每步一个编号圆点 + 标题 + tag + 描述 + 配图/mockup + callout 列表。大步骤间用时间线连接。

**"未来场景"用 chat mockup 代替截图。** Agent 调用步展示的是还没发生的交互，chat 形式（标题栏 + 用户消息 + Agent 回复 + 高亮引用标签）比截图更直观。保持 2 轮对话足够。

**中英文营销页共用 CSS，文案分开。** 样式放同一个 `<style>` 块，两个 HTML 文件只改文案部分。避免样式不同步。

## 20. 搜索引擎实现模式

**模糊搜索用 Fuse.js，但要注意 CJK。** 默认字符级模糊匹配对中日韩效果差。检测 CJK 字符时切换到 extended search 的 include-match 模式（`'` 前缀）。

**搜索索引必须缓存。** 每次搜索都读文件+建索引不可接受。索引与文件系统缓存共享 TTL，写操作统一失效。

**大文件索引要截断。** 前 50KB 足够搜索。不截断会让少数大文件拖慢所有搜索。

**多字段搜索要加权。** 文件名命中 > 路径命中 > 正文命中。典型：fileName 0.3, path 0.2, content 0.5。

**Snippet 取最长匹配段。** 不是第一个匹配——最长的最能代表相关性。

## 21. 配置优先级设计

**默认值必须是 falsy。** `||` 短路链中，非空默认值会短路掉所有后续来源。默认值用空字符串，真正的兜底放链最后。

**配置三层：UI 设置 > 环境变量 > 代码兜底。** UI 设置持久化到文件，环境变量在 `.env.local`，代码兜底在 `effectiveConfig()` 最后。

**流式 API 必须加 onError。** `streamText()` 等流式调用的错误不会 throw，会在流中静默失败。必须加 `onError` 回调输出到 console。

## 22. React Hydration 错误处理

**`suppressHydrationWarning` 只处理文本差异。** 不能解决 DOM 结构差异。浏览器扩展导致的结构差异需要 monkey-patch DOM API。

**Monkey-patch 比 wrapper div 更可靠。** wrapper div 只隔离一层，扩展仍修改内层 DOM。patch `removeChild`/`insertBefore` 从根本上消除 `NotFoundError`。

**Patch 脚本放 `<head>` 最早位置。** 必须在 React hydration 之前执行。

## 23. 构建产物管理

**构建缓存不应被 git 跟踪。** `*.tsbuildinfo`、`.next/`、`dist/` 等加入 `.gitignore`。已跟踪的用 `git rm --cached` 移除。

**glob 模式优于逐个列举。** `*.tsbuildinfo` 比 `app/tsconfig.tsbuildinfo` 更通用，覆盖所有子目录。

## 24. 功能验证标准

**后端用脚本直接调用。** 不启动 web server，用 `tsx -e` import 函数运行。注意环境变量需正确设置。

**前端用 Playwright E2E。** 覆盖：打开 modal → 搜索 → 结果验证 → 高亮检查 → 键盘导航 → 点击跳转。截图留证。

**覆盖边界场景。** 精确搜索、模糊搜索（拼错）、多词搜索、CJK、文件名优先级——每个都是独立测试用例。

**缓存性能要量化。** 对比冷启动 vs 热缓存耗时，确认缓存生效。

## 25. TypeScript 导入规范

**ES import 优于 require。** 获得类型安全、tree-shaking、编译时检查。

**类型用命名导入。** `import Fuse, { FuseResultMatch } from 'fuse.js'`。避免 `Fuse.FuseResultMatch` 命名空间引用——当 `Fuse` 是值导入时 TS 不允许作为命名空间使用。
