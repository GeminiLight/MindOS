# TASKS — 待办优先级清单

> 最近更新：2026-03-31 | 来源：UX 审计 + 代码审查 + Backlog 分析

## 🔴 高优先（影响用户体验 / 产品可用性）

- [ ] **Ask Panel 文件上下文不跟随切换** — 文件变了但 panel 保持开启时，AI 仍在聊旧文件的上下文。`AskContent` 的 effect 是边缘触发的（仅 visible false→true），不响应 `currentFile` 变化。Tab bar 和自动退出最大化缓解了一部分，但非最大化时直接点击另一个文件，panel 上下文仍是旧的。建议：检测 `currentFile` 变化时提示用户"文件已切换，是否刷新上下文？"或自动新建 session。
  - 相关文件：`app/components/ask/AskContent.tsx:200-224`

- [ ] **Electron Desktop App（Phase 1）** — spec 已写好（`wiki/specs/spec-electron-desktop-app.md`），但还未实施。本地+远程双模式桌面端，含共享连接 SDK、系统托盘/快捷键/自动更新。发桌面版的阻塞项。

- [ ] **Help 页面浮动目录** — `/help` 是长内容页（6 section + FAQ），没有 TOC 用户难以导航。添加浮动目录或锚点跳转。
  - 相关文件：`app/components/HelpContent.tsx`

## 🟡 中优先（技术债 / 产品打磨）

- [ ] **Toast/Snackbar 全局系统** — Copy 反馈各组件自管 `setCopied`（5+ 处重复）。文件删除没有 undo 操作反馈。引入 Sonner 或自建全局 Toast provider，统一操作反馈出口。
  - 触发条件：需要 undo 操作或批量操作结果反馈时

- [ ] **⌘K Command Palette 扩展** — 当前只搜文件。可扩展为：快捷操作（Toggle dark mode / Restart walkthrough）+ Skill 开关 + 最近 AI 对话。目标用户是键盘驱动型开发者，快速操作入口很重要。
  - 相关文件：`app/components/SearchModal.tsx`

- [ ] **Echo 侧边栏利用不足** — 5 项只占 ~200px，下方大片空白。可加最近活动摘要、快捷统计（本周笔记数、AI 对话次数）、或将 Echo insight 预览卡直接嵌入侧边栏。

- [ ] **i18n 文件膨胀** — `i18n-en.ts` 已 1500+ 行，`i18n-zh.ts` 已 1540+ 行（预警线 1000 行）。当前单文件+TypeScript 类型系统保证一致性。加第三语言或超 2000 行时应拆模块。
  - 相关文件：`app/lib/i18n-en.ts`, `app/lib/i18n-zh.ts`

## 🟢 低优先（待验证 / 等需求驱动）

- [ ] **Windows WSL daemon 稳定性** — 待验证 systemd 在 WSL 下是否稳定运行。等 Windows 用户反馈再处理。

- [ ] **Git sync 大知识库性能** — >1000 文件下未测。需要 benchmark 确认是否存在性能瓶颈。

- [ ] **Zustand/Jotai 替代 Context 嵌套** — 当前 4 层 Provider，已用 `useMemo` 缓解。profiler 显示 Context re-render 成瓶颈或 Provider 超 6 层时再做。

- [ ] **Capacitor 移动端（Phase 2）** — iOS/Android 原生壳，复用 Desktop Phase 1 连接 SDK。等桌面版稳定后再启动。

---

## ✅ 今日已完成（2026-03-31）

- [x] UX 审计 5 类全部修复（静默错误 19 + 加载态 3 + truncate tooltip 22 + disabled 说明 16 + cursor 复查）
- [x] 第四类 disabled 按钮提示完全本地化（20 个 i18n key，中英双语）
- [x] Ask Panel 最大化模式修复（保留 Rail/Sidebar 可见可操作）
- [x] 导航时自动退出 Ask Panel 最大化
- [x] Ask Panel header 按钮 i18n + 新建图标改为 SquarePen
- [x] Session Tab Bar（最近 3 个对话，浏览器风格标签页）
- [x] 惰性 session 持久化（空 session 永不保存到服务端）
