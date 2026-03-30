# SPEC: API Key 连通性验证

> Settings AI Tab 新增 Test 按钮，用户主动点击后验证 API Key 是否有效。

## 动机

用户填写 API Key 后无法确认是否有效，直到实际使用 AI 功能才发现失败。在 Settings 提供一键测试，缩短反馈循环。

## 设计决策

| 决策 | 选项 | 结论 |
|------|------|------|
| 触发方式 | 失焦自动测试 vs 手动按钮 | **手动按钮**。自动测试在 key 未填完时触发浪费请求，且可能误报 |
| 放置位置 | Onboard StepAI vs Settings AiTab | **仅 Settings AiTab**。Onboard 是快速流程，不应引入额外等待；用户可 skip AI 配置后在 Settings 慢慢调试 |
| 阻断性 | 测试失败阻止保存 vs 仅提示 | **仅提示**。不阻断保存，用户可能有离线场景或代理 |

## API 端点

### `POST /api/settings/test-key`

**Request:**
```json
{
  "provider": "anthropic" | "openai",
  "apiKey": "sk-...",
  "model": "claude-sonnet-4-6",
  "baseUrl": ""  // OpenAI only, optional
}
```

**Response (200):**
```json
{
  "ok": true,
  "latency": 820
}
```

**Response (200, 验证失败):**
```json
{
  "ok": false,
  "error": "Invalid API key",
  "code": "auth_error" | "model_not_found" | "rate_limited" | "network_error" | "unknown"
}
```

**实现要点:**
- Anthropic: `POST https://api.anthropic.com/v1/messages` with `max_tokens: 1`, `messages: [{role:"user",content:"hi"}]`
- OpenAI: `POST {baseUrl}/v1/chat/completions` with `max_tokens: 1`, `messages: [{role:"user",content:"hi"}]`
- timeout: 10s
- 不走 `getModel()`（那个读 config，这里要测用户输入的 key，可能还没保存）
- 不存储测试请求/响应内容
- **masked key 处理**：前端传来的 key 可能是 `***set***`（用户未修改），此时从已保存的 config 读取真实 key 进行测试；若 config 中也无有效 key 则返回 `{ ok: false, code: "auth_error", error: "No API key configured" }`

**安全考虑:**
- 端点受现有 auth middleware 保护（需登录）
- apiKey 参数仅用于即时测试，不写入 config，不记录到日志
- 对外请求只发到 `api.anthropic.com` 或用户指定的 `baseUrl`，不做任意 URL 代理

## 前端改动

### Settings AiTab (`app/components/settings/AiTab.tsx`)

在每个 provider 的 API Key `<Field>` 内部，`<ApiKeyInput>` 下方新增一行 Test 按钮 + 结果反馈：

```
[API Key input ••••••••••]
[Test]  ✓ 820ms
```

布局：按钮左对齐，结果 inline 显示在按钮右侧。不改变 `ApiKeyInput` 组件本身，Test 按钮作为 `<Field>` 的额外子元素。

**env override 场景**：当 `env.ANTHROPIC_API_KEY` 为 true 时，Test 按钮仍可用（测试 env 注入的 key），此时请求不传 apiKey 字段，后端从 env/config 读取。

状态流转：
```
idle → testing → ok | error
         ↓ (10s)
       timeout → error(network_error)
```

UI 反馈：
- `idle`: 灰色 "Test" 按钮（`text-muted-foreground border-border`）
- `testing`: 按钮显示 spinner + "Testing..."，disabled
- `ok`: 绿色 ✓ + latency（如 "✓ 820ms"，`text-success`），5s 后回到 idle
- `error`: 红色 ✗ + error message（如 "✗ Invalid API key"，`text-error`），保持直到用户修改 key 或重新测试

**禁用条件:**
- Key 为空且无 env override
- 已在 testing 状态

**状态重置时机:**
- 用户修改 apiKey 输入 → 回到 idle（清除上次结果）
- 切换 provider → 回到 idle

### i18n 词条

词条放在 `t.settings.ai` 命名空间下（与现有 AI 设置词条一致）：

```typescript
// EN (settings.ai.*)
testKey: 'Test',
testKeyTesting: 'Testing...',
testKeyOk: (ms: number) => `✓ ${ms}ms`,
testKeyFailed: 'Test failed',
testKeyAuthError: 'Invalid API key',
testKeyModelNotFound: 'Model not found',
testKeyRateLimited: 'Rate limited, try again later',
testKeyNetworkError: 'Network error',
testKeyNoKey: 'No API key configured',

// ZH (settings.ai.*)
testKey: '测试',
testKeyTesting: '测试中...',
testKeyOk: (ms: number) => `✓ ${ms}ms`,
testKeyFailed: '测试失败',
testKeyAuthError: 'API Key 无效',
testKeyModelNotFound: '模型不存在',
testKeyRateLimited: '请求频率限制，稍后重试',
testKeyNetworkError: '网络错误',
testKeyNoKey: '未配置 API Key',
```

## 文件变更清单

| 文件 | 改动 |
|------|------|
| `app/app/api/settings/test-key/route.ts` | 新建。POST handler，轻量 API 调用验证，支持 masked key fallback 到 config |
| `app/components/settings/AiTab.tsx` | API Key Field 下方新增 Test 按钮 + 结果 inline 显示 + 状态管理 |
| `app/lib/i18n.ts` | `settings.ai` 下新增 test-key 相关词条（EN + ZH） |

## 验证

1. Settings → AI → 填入有效 Anthropic Key → 点 Test → 显示 ✓ + latency
2. 填入无效 Key → 点 Test → 显示 ✗ Invalid API key
3. Key 为空且无 env → Test 按钮 disabled
4. 切换 provider → 上次测试结果清除
5. OpenAI 自定义 baseUrl → 验证请求发到正确地址
6. 网络断开 → 10s 后显示 ✗ Network error
7. env override 模式 → 不填 key 也能测试（用 env 中的 key）
8. masked key（`***set***`，未修改）→ 后端读 config 中已保存的 key 测试
9. 修改 key 输入 → 上次 ✓/✗ 结果自动清除
