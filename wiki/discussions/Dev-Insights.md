# Dev Insights

> 开发过程中的深度洞察和方法论沉淀。比 known-pitfalls 更抽象——pitfalls 记录具体 bug，这里记录思维模式。

## 静默失败链：最难排查的 bug 类型

**日期：** 2026-03-21 | **耗时：** ~2 小时 | **严重度：** P0（功能完全不可用）

### 案例

MindOS Agent 发消息后零回复，前端显示 "No response from AI"。API 连通性正常（curl 直接调代理返回正确数据），568 个单元测试全绿。

### 失败链条（5 层静默）

```
① pi-ai getModel('openai', 'claude-sonnet-4-6')
  → 模型不在 registry → 返回 undefined（不抛异常）

② model.ts: try { model = getModel(...) } catch { fallback }
  → catch 没触发 → model = undefined

③ { ...undefined, api: 'openai-completions' }
  → JS 对 undefined spread 不报错 → 产生 { api: 'openai-completions' }（缺 id/baseUrl/name）

④ pi-ai detectCompat(): model.baseUrl.includes(...)
  → undefined.includes() → throw TypeError
  → 被 lazy load 的 .catch() 捕获 → 发 { type: "error" } 事件

⑤ pi-agent-core agent-loop: case "error" → stopReason: "error"
  → message_end → turn_end → agent_end
  → agent.prompt() 正常 resolve，无 text 输出
```

**用户看到的：** 空白回复
**日志看到的：** `Step 1/N`，然后 done
**测试看到的：** 568 passed

### 洞察

1. **每一层的错误处理都"合理"，但组合后完全静默**
   - `getModel` 返回 undefined → 库的设计选择，不一定是 bug
   - `spread undefined` → JS 语言特性，合法操作
   - `lazy load catch` → 正确的错误降级
   - `agent-loop error case` → 正确的状态机转换
   - 单看任何一层都没问题，串起来就是灾难

2. **try-catch 的盲区：函数返回 undefined 不等于失败**
   ```typescript
   // 这是个幻觉——getModel 返回 undefined 时不进 catch
   try { model = getModel(...); } catch { model = fallback(); }
   ```

3. **单元测试无法发现运行时集成问题**
   - 单测 mock 了依赖，不会触发真实的 `getModel` 调用
   - 即使不 mock，测试用的 model 配置可能恰好在 registry 里
   - 只有端到端测试（真实 API + 真实 config）才能发现

### 防御规则

```typescript
// 规则 1：调用第三方库后同时检查异常和返回值
const resolved = thirdPartyLib.lookup(key);
if (!resolved) throw new Error(`${key} not found`);

// 规则 2：关键路径的 error event 必须有用户可见输出
case "error":
  console.error('[agent] Stream error:', event.error?.errorMessage);
  send({ type: 'error', message: event.error?.errorMessage ?? 'Unknown error' });
  break;

// 规则 3：引入/升级依赖后必须做端到端验证
// 不只是 vitest run，而是真正发一条消息看有没有回复
```

### 排查方法论

| 步骤 | 方法 | 本次用时 |
|------|------|---------|
| 1 | 确认外部 API 正常（curl 直调） | 5 min |
| 2 | 确认请求到达服务端（server 日志） | 5 min |
| 3 | 全量事件打印（subscribe 回调） | 10 min |
| 4 | **直接 patch node_modules 加日志** | 10 min → 定位根因 |
| ~~5~~ | ~~猜测 bundler / compat / 版本问题~~ | ~~90 min 浪费~~ |

**关键教训：步骤 4 应该在步骤 3 之后立即做，而非先猜 1.5 小时。**

直接 patch `node_modules/@mariozechner/pi-ai/dist/providers/register-builtins.js` 的 `.catch` 块加一行 `console.error`，10 分钟内定位到 `Cannot read properties of undefined (reading 'includes')`，反推到 `getModel` 返回 undefined。

---

## Turbopack 与第三方包的兼容性边界

**日期：** 2026-03-21

### 问题模式

Turbopack（Next.js 16+ 默认 bundler）在编译阶段**静态分析所有 import/require**，包括：
- `import(variable)` — 报 `expression is too dynamic`
- `createRequire()(variable)` — 同上
- 第三方包内部的条件动态 import — 被编译成 throw

### 经验

| 方法 | Turbopack 是否穿透 | 适用场景 |
|------|:---:|------|
| `import(variable)` | ✅ 会分析，报错 | ❌ 不能用 |
| `/* webpackIgnore: true */ import(v)` | ✅ 无效（只对 webpack） | ❌ 不能用 |
| `createRequire()(variable)` | ✅ 会分析，报错 | ❌ 不能用 |
| `new Function('id', 'return require(id)')` | ❌ 不穿透 | ✅ 唯一可靠方式 |
| `serverExternalPackages: ['pkg']` | N/A（不 bundle） | ✅ 但需验证运行时加载正常 |

### 陷阱

`serverExternalPackages` 让包不被 bundle，运行时从 `node_modules` 直接加载。听起来完美，但：
- 如果包 A 被 external，包 B import 包 A，Turbopack 可能在 B 的 chunk 里生成错误的引用
- 加了 `pi-ai` + `pi-agent-core` 为 external 后，build 时 `Cannot find module` 消失了，但 Agent **完全无法工作**（模块加载链断裂）
- 最终只能回滚，接受无害的日志警告

**规则：** `serverExternalPackages` 只用于真正的 Node native 模块（chokidar、pdfjs-dist），不要用于纯 JS 包。

---

## 端到端验证 > 单元测试覆盖率

**日期：** 2026-03-21

### 数字对比

| 指标 | 值 | 发现 bug？ |
|------|-----|:---:|
| 单元测试 | 568 passed | ❌ |
| TypeScript 编译 | 0 production errors | ❌ |
| Next.js build | ✓ Compiled successfully | ❌ |
| **curl 发一条消息** | 空回复 | **✅** |

### 为什么单测没用

1. **mock 隔离了真实依赖** — 测试里 `getModel` 被 mock 或用已知模型，不触发 undefined 路径
2. **config 不同** — 测试用默认 config，生产用用户自定义 config（`claude-sonnet-4-6` via OpenAI proxy）
3. **bundler 行为不同** — vitest 直接跑 TypeScript，生产代码经过 Turbopack 编译

### 规则

改动涉及以下任一条时，必须做端到端验证（不只是 `vitest run`）：

- [ ] 修改了 `lib/agent/model.ts`（LLM 初始化）
- [ ] 修改了 `api/ask/route.ts`（Agent 请求链路）
- [ ] 升级了 `pi-ai` / `pi-agent-core`
- [ ] 修改了 `next.config.ts`（bundler 配置）
- [ ] 修改了 `instrumentation.ts`（启动时加载）

验证方法：
```bash
# 重建 + 启动
mindos stop && rm -rf app/.next && mindos start

# 发一条消息，确认有文本回复
curl -s -N -X POST http://localhost:3003/api/ask \
  -H "Sec-Fetch-Site: same-origin" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"say hi"}],"maxSteps":1}'
# 期望看到 text_delta 事件
```
