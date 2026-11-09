# MindOS 架构图

`index.html` 是一个自包含的单页（无外部依赖），浏览器直接打开即可：

```bash
open docs/architecture/index.html
```

五个标签页：总览（各端 / 外部 agent / 产品核心 / 存储，点模块看职责、关键文件和连线）、产品核心分层、Agent 怎么跑（四条 lane）、数据流、代码规模。

文字版架构说明在 `wiki/20-system-architecture.md`，两者冲突时以代码为准。

## 更新数字

页面里所有数字都写在 `index.html` 底部脚本的 `SNAPSHOT` / `NODES` / `CHARTS` 里，是某个 commit 的实测值。架构有变化时按下面的方法重测，再改 `SNAPSHOT.commit` 和 `SNAPSHOT.date`。

**代码行数**（源码，不含测试和生成物）：

```bash
loc() {
  git ls-files "$1" | grep -E '\.(ts|tsx|js|mjs)$' \
    | grep -vE '\.test\.|__tests__|/generated/' | xargs cat | wc -l
}
loc packages/web
loc packages/mindos/src/agent
```

**路由、MCP 工具、MCP agent 数**：先 `pnpm --filter @geminilight/mindos build`，再从 dist 读真值，不要 grep：

```bash
cd packages/mindos && node --input-type=module -e "
const s = await import('./dist/server/index.js');
console.log('routes', s.MINDOS_SERVER_ROUTES.length);
"
```

MCP 工具数取 `MINDOS_MCP_TOOL_COUNT`（`src/protocols/mcp-server/tool-names.ts`），MCP agent 数取 `DEFAULT_MCP_AGENTS` 的条目数（`src/agent/config/registry.ts`）。

改完后用浏览器分别看浅色、深色和 390px 宽度，确认没有标签重叠和横向滚动。
