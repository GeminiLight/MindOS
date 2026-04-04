# Spec: 多 Provider AI 支持 — 利用 pi-ai 原生注册表扩展 + 统一测试路径

## 目标

将 MindOS 的 AI provider 从硬编码的 2 个（Anthropic / OpenAI）扩展到 pi-ai 框架已支持的 20+ 个，同时统一 test-key 和 chat 的代码路径，彻底消灭"测试通过但聊天失败"的 bug 类。

## 现状分析

### 架构

MindOS 的 AI 调用栈：

```
用户设置 (~/.mindos/config.json)
  → readSettings() / effectiveAiConfig()         [app/lib/settings.ts]
  → getModelConfig()                              [app/lib/agent/model.ts]
  → POST /api/ask → pi-coding-agent session       [app/app/api/ask/route.ts]
```

底层依赖 `@mariozechner/pi-ai` (^0.60.0) + `@mariozechner/pi-coding-agent` (^0.61.1)。

### pi-ai 已原生支持的 provider（我们只暴露了 2 个）

pi-ai `getProviders()` 返回 **23 个** provider（验证于 v0.65.0）：

```
amazon-bedrock, anthropic, azure-openai-responses, cerebras,
github-copilot, google, google-antigravity, google-gemini-cli,
google-vertex, groq, huggingface, kimi-coding, minimax, minimax-cn,
mistral, openai, openai-codex, opencode, opencode-go, openrouter,
vercel-ai-gateway, xai, zai
```

按适合暴露的程度分级：

| Provider | pi-ai 注册名 | API 类型 | 模型数 | 认证方式 | 优先级 |
|----------|-------------|---------|--------|---------|-------|
| **Anthropic** | `anthropic` | `anthropic-messages` | 23 | API Key | ✅ 已接入 |
| **OpenAI** | `openai` | `openai-responses` / `openai-completions` | 40 | API Key | ✅ 已接入 |
| **Google Gemini** | `google` | `google-generative-ai` | 24 | API Key | P0 |
| **Groq** | `groq` | `openai-completions` | 15 | API Key | P0 |
| **xAI (Grok)** | `xai` | `openai-completions` | 25 | API Key | P1 |
| **OpenRouter** | `openrouter` | `openai-completions` | 246 | API Key | P1 |
| **Mistral** | `mistral` | `mistral-conversations` | 25 | API Key | P1 |
| **DeepSeek** | ⚠️ **不在 pi-ai 注册表** | `openai-completions` | — | API Key | P1 |
| **智谱 (ZAI/GLM)** | `zai` | `openai-completions` | 10 | API Key | P1 |
| **Kimi Coding** | `kimi-coding` | `anthropic-messages` | 2 | API Key | P2 |
| **Cerebras** | `cerebras` | `openai-completions` | 4 | API Key | P2 |
| **MiniMax** | `minimax` | `openai-completions` | 4 | API Key | P2 |
| **Hugging Face** | `huggingface` | `openai-completions` | 18 | API Key | P2 |
| **Amazon Bedrock** | `amazon-bedrock` | `bedrock-converse-stream` | 83 | AWS Creds | P3（认证复杂） |
| **Azure OpenAI** | `azure-openai-responses` | `azure-openai-responses` | 40 | Azure AD | P3（认证复杂） |
| **Google Vertex AI** | `google-vertex` | `google-vertex` | 12 | GCP OAuth | P3（认证复杂） |
| **GitHub Copilot** | `github-copilot` | OAuth | 25 | OAuth 流 | P3 |

> **注意**：DeepSeek 不在 pi-ai 原生注册表中，需通过 OpenAI-compatible API（`openai-completions`）+ 自定义 baseUrl 接入。这与 OpenCode 的处理方式一致。

### 当前问题

1. **`AiConfig.provider` 硬编码为 `'anthropic' | 'openai'`** — 类型、UI、effectiveAiConfig、migrateAi、test-key、list-models 全部围绕这两个值分支。

2. **test-key 用 `fetch` 直接调 API，chat 用 pi-ai** — 两条代码路径不一致：
   - test-key: 手写 `fetch('/chat/completions')` 或 `fetch('/v1/messages')`
   - chat: `piGetModel() → createAgentSession() → session.prompt()`
   - 差异点：request header 格式、token 参数名（`max_tokens` vs `max_completion_tokens`）、API variant 选择、compat 标记
   - 后果：之前 gpt-5.4 proxy bug 就是因为 test-key 发了 `max_tokens` 而 pi-ai 发的是 `max_completion_tokens`

3. **compat 标记一刀切** — 只要设了 `baseUrl` 就把 `supportsStore/supportsDeveloperRole/supportsReasoningEffort/supportsUsageInStreaming/supportsStrictMode` 全关。对 OpenRouter 这种高兼容代理是错误的。

4. **providers 配置只有 `apiKey/model/baseUrl`** — Google 需要不同的认证头，Groq/xAI 需要不同的默认 baseUrl，无法在当前 `ProviderConfig` 中表达。

5. **effectiveAiConfig() 返回扁平化结构** — `anthropicApiKey/anthropicModel/openaiApiKey/openaiModel/openaiBaseUrl` 硬编码字段名，无法扩展。

## 数据流 / 状态流

### 改动后的设置读取流

```
~/.mindos/config.json
  ├─ ai.provider: "google" | "groq" | "anthropic" | "openai" | ...
  ├─ ai.providers.google:  { apiKey, model }
  ├─ ai.providers.groq:    { apiKey, model }
  ├─ ai.providers.openai:  { apiKey, model, baseUrl? }
  └─ ...
         ↓
readSettings() → migrateAi()
  → 向后兼容：旧 anthropic/openai 配置自动迁移
  → 新 provider 字段按 PROVIDER_PRESETS 默认值填充
         ↓
effectiveAiConfig() → { provider, apiKey, model, baseUrl?, extraOptions? }
  → 统一接口，不再按 provider 硬编码字段名
         ↓
getModelConfig()
  → 按 provider 调 piGetModel(providerName, modelId)
  → 应用 PROVIDER_PRESETS[provider].compat 覆盖
  → 返回 { model, modelName, apiKey, provider }
```

### 改动后的 test-key 流

```
POST /api/settings/test-key
  ├─ body: { provider, apiKey?, model?, baseUrl? }
  ├─ 解析 → effectiveAiConfig() fallback
  ├─ getModelConfig() 构建 pi-ai Model（与 chat 完全一致的代码路径）
  └─ pi-ai complete(model, { messages: [{ role: 'user', content: 'hi' }] }, { apiKey, signal })
       ↓
     成功 → { ok: true, latency }
     失败 → classifyError(error.message) → { ok: false, code, error }
```

### 改动后的 chat 流（不变）

```
POST /api/ask → getModelConfig() → createAgentSession → session.prompt → SSE
```

**关键：test-key 和 chat 现在共享 `getModelConfig()`，不再有路径分歧。**

## 方案

### Phase 1: Provider 类型系统重构 + 测试路径统一

#### 1.1 定义 Provider 预设注册表

```typescript
// app/lib/agent/providers.ts (新文件)

export type ProviderId =
  | 'anthropic' | 'openai' | 'google' | 'groq'
  | 'xai' | 'openrouter' | 'mistral' | 'deepseek'
  | 'zai' | 'kimi-coding'
  | 'cerebras' | 'minimax' | 'huggingface';

export interface ProviderPreset {
  id: ProviderId;
  name: string;                 // 显示名: "Google Gemini"
  nameZh: string;               // 中文名: "Google Gemini"
  defaultModel: string;         // 默认模型 ID
  defaultBaseUrl?: string;      // 有些 provider 不需要 baseUrl (pi-ai 内置)
  supportsBaseUrl: boolean;     // 是否允许用户自定义 baseUrl
  authHeader: 'bearer' | 'x-api-key' | 'none';
  apiKeyEnvVar?: string;        // 可选的环境变量名
  modelEnvVar?: string;
  baseUrlEnvVar?: string;
  piProvider: string;           // pi-ai 的 provider 名 (传给 getModel)
  piApiDefault: string;         // pi-ai 的默认 API variant
  compat?: Partial<ModelCompat>;// 默认的 compat 标记
  supportsThinking: boolean;    // 是否支持 thinking/reasoning
  supportsListModels: boolean;  // 是否支持 /models 列表 API
  listModelsEndpoint?: string;  // 自定义 models API 地址
  signupUrl?: string;           // 获取 API key 的页面 URL
  category: 'primary' | 'secondary' | 'advanced';
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    nameZh: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    supportsBaseUrl: false,
    authHeader: 'x-api-key',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    modelEnvVar: 'ANTHROPIC_MODEL',
    piProvider: 'anthropic',
    piApiDefault: 'anthropic-messages',
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://console.anthropic.com/settings/keys',
    category: 'primary',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    nameZh: 'OpenAI',
    defaultModel: 'gpt-5.4',
    supportsBaseUrl: true,
    authHeader: 'bearer',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelEnvVar: 'OPENAI_MODEL',
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    piProvider: 'openai',
    piApiDefault: 'openai-responses',
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://platform.openai.com/api-keys',
    category: 'primary',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    nameZh: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    modelEnvVar: 'GOOGLE_MODEL',
    piProvider: 'google',
    piApiDefault: 'google-generative-ai',
    supportsThinking: true,
    supportsListModels: false,
    signupUrl: 'https://aistudio.google.com/apikey',
    category: 'primary',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    nameZh: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'GROQ_API_KEY',
    piProvider: 'groq',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://console.groq.com/keys',
    category: 'secondary',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    nameZh: 'xAI (Grok)',
    defaultModel: 'grok-3',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'XAI_API_KEY',
    piProvider: 'xai',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    nameZh: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    piProvider: 'openrouter',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    nameZh: 'Mistral',
    defaultModel: 'mistral-large-latest',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    piProvider: 'mistral',
    piApiDefault: 'mistral-conversations',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    nameZh: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    supportsBaseUrl: true,
    authHeader: 'bearer',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    piProvider: 'openai',  // DeepSeek uses OpenAI-compatible API
    piApiDefault: 'openai-completions',
    compat: { supportsDeveloperRole: false, supportsStore: false },
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    category: 'secondary',
  },
  zai: {
    id: 'zai',
    name: 'ZhipuAI (GLM)',
    nameZh: '智谱 AI (GLM)',
    defaultModel: 'glm-4.5',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'ZAI_API_KEY',
    piProvider: 'zai',
    piApiDefault: 'openai-completions',
    supportsThinking: true,
    supportsListModels: false,
    category: 'secondary',
  },
  'kimi-coding': {
    id: 'kimi-coding',
    name: 'Kimi Coding (Moonshot)',
    nameZh: 'Kimi Coding (月之暗面)',
    defaultModel: 'kimi-k2-thinking',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'KIMI_CODING_API_KEY',
    piProvider: 'kimi-coding',
    piApiDefault: 'anthropic-messages',  // Kimi uses Anthropic-compatible API
    supportsThinking: true,
    supportsListModels: false,
    category: 'secondary',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    nameZh: 'Cerebras',
    defaultModel: 'llama-4-scout-17b-16e',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    piProvider: 'cerebras',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'advanced',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    nameZh: 'MiniMax',
    defaultModel: 'MiniMax-M1',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    piProvider: 'minimax',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: false,
    category: 'advanced',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    nameZh: 'Hugging Face',
    defaultModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    piProvider: 'huggingface',
    piApiDefault: 'openai-completions',
    supportsThinking: true,
    supportsListModels: false,
    category: 'advanced',
  },
};

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];
export const PRIMARY_PROVIDERS = ALL_PROVIDER_IDS.filter(id => PROVIDER_PRESETS[id].category === 'primary');
export const SECONDARY_PROVIDERS = ALL_PROVIDER_IDS.filter(id => PROVIDER_PRESETS[id].category !== 'advanced');
```

#### 1.2 重构 settings.ts

```typescript
// AiConfig 扩展
export interface AiConfig {
  provider: ProviderId;            // 从 'anthropic' | 'openai' 扩展
  providers: Partial<Record<ProviderId, ProviderConfig>>;  // 动态 key
}

// effectiveAiConfig() 统一接口
export function effectiveAiConfig(): {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const s = readSettings();
  const preset = PROVIDER_PRESETS[s.ai.provider] ?? PROVIDER_PRESETS.anthropic;
  const provCfg = s.ai.providers[s.ai.provider] ?? {};

  return {
    provider: s.ai.provider,
    apiKey:  provCfg.apiKey || (preset.apiKeyEnvVar ? process.env[preset.apiKeyEnvVar] : '') || '',
    model:   provCfg.model || (preset.modelEnvVar ? process.env[preset.modelEnvVar] : '') || preset.defaultModel,
    baseUrl: provCfg.baseUrl || (preset.baseUrlEnvVar ? process.env[preset.baseUrlEnvVar] : '') || preset.defaultBaseUrl || '',
  };
}
```

**向后兼容**：`migrateAi()` 保持不变，能识别旧的 `'anthropic' | 'openai'` 格式并正常迁移。新 provider 在 `providers` dict 中新增 key 即可。

#### 1.3 重构 model.ts — 通用化 getModelConfig

`getModelConfig()` 接受可选的 overrides 参数，用于 test-key/list-models 传入用户尚未保存的配置值（API key、model、baseUrl），确保测试时使用的 Model 对象与正式 chat 完全一致：

```typescript
export interface ModelConfigOverrides {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  hasImages?: boolean;
}

export function getModelConfig(options?: ModelConfigOverrides): {
  model: Model<any>;
  modelName: string;
  apiKey: string;
  provider: ProviderId;
} {
  const saved = effectiveAiConfig();
  // Overrides take priority over saved config (for test-key / list-models)
  const cfg = {
    provider: options?.provider ?? saved.provider,
    apiKey: options?.apiKey ?? saved.apiKey,
    model: options?.model ?? saved.model,
    baseUrl: options?.baseUrl ?? saved.baseUrl,
  };
  const preset = PROVIDER_PRESETS[cfg.provider];
  const modelName = cfg.model;

  let model: Model<any>;

  // 1) 尝试从 pi-ai 注册表获取
  try {
    const resolved = piGetModel(preset.piProvider as any, modelName as any);
    if (!resolved) throw new Error('Not in registry');
    model = resolved;
  } catch {
    // 2) 未在注册表 → 手动构造 Model literal
    model = {
      id: modelName,
      name: modelName,
      api: preset.piApiDefault as any,
      provider: preset.piProvider,
      baseUrl: preset.defaultBaseUrl || '',
      reasoning: false,
      input: ['text'] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }

  // 3) 自定义 baseUrl 覆盖 + compat
  if (cfg.baseUrl) {
    model = {
      ...model,
      baseUrl: cfg.baseUrl,
      api: preset.piApiDefault as any,  // proxy 一般只支持 completions
      compat: {
        ...(model as any).compat,
        ...preset.compat,
        supportsStore: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
      },
    };
  } else if (preset.compat) {
    model = { ...model, compat: { ...(model as any).compat, ...preset.compat } };
  }

  // 4) Vision
  if (options?.hasImages) model = ensureVisionCapable(model);

  return { model, modelName, apiKey: cfg.apiKey, provider: cfg.provider };
}
```

#### 1.4 统一 test-key — 用 pi-ai 的 `complete()` 测试

```typescript
// app/app/api/settings/test-key/route.ts (重写)
import { complete } from '@mariozechner/pi-ai';
import { getModelConfig } from '@/lib/agent/model';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider, apiKey, model, baseUrl } = body;

  // 解析实际 key：用户可能传 '***set***' 表示使用已保存配置
  const cfg = effectiveAiConfig();
  const resolvedKey = (apiKey && apiKey !== '***set***') ? apiKey : cfg.apiKey;

  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    // 通过 overrides 传入用户尚未保存的值 — 与 chat 使用完全一致的 Model 构建逻辑
    const { model: piModel } = getModelConfig({
      provider: provider ?? cfg.provider,
      apiKey: resolvedKey,
      model: model || undefined,
      baseUrl: baseUrl || undefined,
    });

    await complete(piModel, {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, {
      apiKey: resolvedKey,
      signal: ctrl.signal,
    });
    return NextResponse.json({ ok: true, latency: Date.now() - start });
  } catch (e) {
    return NextResponse.json({ ok: false, ...classifyPiAiError(e) });
  } finally {
    clearTimeout(timer);
  }
}
```

**关键设计**：`getModelConfig({ provider, apiKey, model, baseUrl })` 的 overrides 参数让 test-key 能传入用户界面上尚未保存的配置，同时复用与 chat 完全一致的 Model 构建逻辑（piGetModel → fallback → compat → baseUrl 覆盖）。**消灭了"测试通过但聊天失败"的 bug 类根源。**

#### 1.5 适配 list-models — 多 provider

对不同 provider 的 `/models` API 差异进行适配：
- OpenAI-compatible（openai/groq/xai/openrouter/deepseek/cerebras）: `GET /models`
- Anthropic: `GET /v1/models` with `x-api-key`
- Google: pi-ai `getModels('google')` 返回静态列表（Google 无 REST models API）
- Mistral: `GET /v1/models` with `Authorization: Bearer`

### Phase 2: UI/UX 全面适配

> 设计原则：用户在 3 个触点与 AI provider 交互——**Onboarding（首次）**、**Settings（调整）**、**Chat（使用中）**。三处的交互语言和信息密度应逐层递进，但核心控件（Provider 选择器）共享同一组件。

#### 2.1 共享组件：ProviderSelect

提取一个复用的 `<ProviderSelect>` 组件，供 StepAI 和 AiTab 共用：

```typescript
// app/components/shared/ProviderSelect.tsx

interface ProviderSelectProps {
  value: ProviderId | 'skip';
  onChange: (id: ProviderId | 'skip') => void;
  showSkip?: boolean;           // Onboarding 显示 skip，Settings 不显示
  compact?: boolean;            // Onboarding 紧凑模式
  configuredProviders?: Set<ProviderId>;  // 已配置 API key 的 provider（显示 ✓ 徽标）
}
```

**交互设计**：

```
┌─────────────────────────────────────────┐
│ [▾ Google Gemini                    ✓ ] │  ← 当前选中，✓ = 已配置
│  ┌────────────────────────────────────┐ │
│  │ ♦ 推荐                             │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │ ● Anthropic            ✓     │  │ │  ← ✓ 表示该 provider 已有 API key
│  │  │   Claude — claude-sonnet-4-6  │  │ │  ← 副标题显示默认模型
│  │  │ ● OpenAI               ✓     │  │ │
│  │  │   GPT — gpt-5.4              │  │ │
│  │  │ ● Google Gemini        ●     │  │ │  ← ● 当前选中
│  │  │   Gemini — gemini-2.5-flash  │  │ │
│  │  └──────────────────────────────┘  │ │
│  │ ♦ 更多                             │ │
│  │   Groq · xAI · OpenRouter ·       │ │
│  │   Mistral · DeepSeek · 智谱 AI ·  │ │
│  │   Kimi Coding                     │ │
│  │ ♦ 高级                             │ │
│  │   Cerebras · MiniMax ·            │ │
│  │   Hugging Face                    │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**关键 UX 决策**：
- Primary providers 展开显示（名称 + 默认模型 + 配置状态），占据最多视觉空间
- Secondary/Advanced providers 紧凑显示（仅名称），点击后才展开
- 已配置 API key 的 provider 显示 ✓ 勾号——让用户快速识别哪些可用
- 切换 provider 不丢失其他 provider 的已填配置
- 用自定义 Popover 实现（与 ModelInput 的 list-models 下拉风格一致），不用原生 `<select>`

#### 2.2 Settings — AiTab 重构

**现状**：两个并排按钮卡片切换 Anthropic / OpenAI，下方展开对应配置。

**改为**：`<ProviderSelect>` + 配置区 + 获取 API Key 引导链接。

```
┌─ SettingCard: AI Provider ──────────────┐
│                                         │
│ Provider:  <ProviderSelect />           │
│                                         │
│ Model:  [gemini-2.5-flash  ] [List ▾]  │
│                                         │
│ API Key: [••••••••]  [Test ✓ 320ms]    │
│  ↳ 🔗 Get API key from Google AI Studio│  ← 每个 provider 可配 signupUrl
│  ↳ ENV: GOOGLE_GENERATIVE_AI_API_KEY   │  ← hover 显示环境变量名
│                                         │
│ ⚠️ Base URL                 (仅部分)    │
│  [https://api.deepseek.com/v1      ]   │
└─────────────────────────────────────────┘

┌─ SettingCard: Agent Behavior ───────────┐
│ ... (不变)                               │
│                                         │
│ Thinking:  [  ○ ]    ← 根据              │
│            supportsThinking 动态显隐     │
└─────────────────────────────────────────┘
```

**新增字段 `ProviderPreset.signupUrl`**：

```typescript
export interface ProviderPreset {
  // ...existing fields...
  signupUrl?: string;  // 注册/获取 API key 的页面
}

// 示例
anthropic: { signupUrl: 'https://console.anthropic.com/settings/keys' },
openai:    { signupUrl: 'https://platform.openai.com/api-keys' },
google:    { signupUrl: 'https://aistudio.google.com/apikey' },
groq:      { signupUrl: 'https://console.groq.com/keys' },
deepseek:  { signupUrl: 'https://platform.deepseek.com/api_keys' },
```

用户首次选择一个新 provider 后，配置区底部展示一行引导链接 "🔗 Get API key from xxx"（仅在 apiKey 为空时显示），降低用户获取 key 的摩擦。

**Thinking/Reasoning 改动**：AiTab.tsx line 310 的 `provider === 'anthropic'` 改为 `PROVIDER_PRESETS[provider].supportsThinking`。

**环境变量 Badge 改动**：`EnvBadge` 的 `overridden` prop 从硬编码的 `env.ANTHROPIC_API_KEY` 改为 `env[preset.apiKeyEnvVar]`。API Key hint 中动态显示环境变量名 `preset.apiKeyEnvVar`。

#### 2.3 Onboarding (Setup Wizard) — StepAI 重构

**现状**：三个全宽卡片（Anthropic / OpenAI / Skip），仅 2+1 个选项。

硬编码位置 6 处：
- `StepAI.tsx` line 33-37: `providers` 数组只有 3 个条目
- `StepAI.tsx` line 64-81: `state.provider === 'anthropic' ? ... : ...` 条件分支
- `types.ts` line 14: `provider: 'anthropic' | 'openai' | 'skip'`
- `index.tsx` line 57-62: 保存时只写 `anthropic` 和 `openai`
- `index.tsx` line 160: 只接受 `'anthropic' | 'openai'` 作为合法 provider
- `StepReview.tsx` line 282: 硬编码 provider 显示名

**方案**：

```
┌──────────────────────────────────────────┐
│ 选择你的 AI 服务商                         │
│                                          │
│  🟢 检测到环境变量 ANTHROPIC_API_KEY      │  ← 条件显示：auto-detect
│                                          │
│  Provider: <ProviderSelect compact />    │
│                                          │
│  API Key:  [sk-ant-•••••••••]            │
│    ↳ 🔗 Get key from Anthropic Console   │  ← apiKey 为空时显示
│  Model:    [claude-sonnet-4-6     ]      │
│                                          │
│  ───────────────────────────────────     │
│  [ ⏭ 跳过，稍后在设置中配置 ]              │  ← 文本按钮，非卡片
└──────────────────────────────────────────┘
```

**2.3.1 环境变量自动检测**

Setup Wizard 初始化时，`GET /api/setup` 返回已检测到的环境变量列表：

```typescript
// api/setup/route.ts GET handler 新增返回字段
{
  // ...existing fields...
  detectedEnvProviders: ['anthropic', 'openai'],  // 有对应 apiKeyEnvVar 的 provider
}
```

前端逻辑：
- 如果检测到环境变量 → 自动预选该 provider + 显示提示 "检测到环境变量 ANTHROPIC_API_KEY，已自动选择"
- 如果检测到多个 → 预选第一个 primary 级别的
- 如果没检测到 → 默认选 Anthropic（现有行为不变）

这让有经验的开发者（已在 `.bashrc` 中设好环境变量的用户）在 Onboarding 时零输入就能完成 AI 配置步骤。

**2.3.2 SetupState 类型重构**

```typescript
// types.ts
export interface SetupState {
  mindRoot: string;
  template: Template;
  provider: ProviderId | 'skip';
  // 替换 anthropicKey/anthropicModel/openaiKey/... 为通用结构
  providerConfigs: Partial<Record<ProviderId, {
    apiKey: string;
    model: string;
    baseUrl?: string;
  }>>;
  apiKeyMasks: Partial<Record<ProviderId, string>>;  // 服务端返回的 mask
  webPort: number;
  mcpPort: number;
  authToken: string;
  webPassword: string;
}
```

**2.3.3 saveConfig 保存逻辑**

```typescript
// index.tsx saveConfig()
const payload = {
  // ...
  ai: state.provider === 'skip' ? undefined : {
    provider: state.provider,
    providers: {
      [state.provider]: state.providerConfigs[state.provider] ?? {},
    },
  },
};
```

只保存当前选中 provider 的配置（Onboarding 场景用户只配一个）。

**2.3.4 api/setup/route.ts 适配**

GET handler：
- 返回 `provider: ProviderId`（不再限制 `'anthropic' | 'openai'`）
- 返回 `providerConfigs: { [provider]: { model, apiKeyMask } }` 替代硬编码的 `anthropicModel/openaiModel/...`
- 新增 `detectedEnvProviders: ProviderId[]`

POST handler：
- 接受 `ai.providers` 为 `Partial<Record<ProviderId, ProviderConfig>>`
- 合并逻辑：`mergedAi.providers = { ...current.providers, ...incoming.providers }`（深合并每个 provider 的字段）

#### 2.4 Chat 面板 — Provider/Model 指示器

**现状**：Chat 面板（AskContent）不显示当前使用的 AI provider 和 model。用户不知道自己在跟哪个模型聊天。

**方案**：在 Chat 输入框上方添加一个轻量级状态栏：

```
┌─ Ask AI ────────────────────────────────┐
│  Sessions │ + │                    ⚙ ✕ │
│─────────────────────────────────────────│
│                                         │
│  (消息区域)                              │
│                                         │
│─────────────────────────────────────────│
│  Anthropic · claude-sonnet-4-6          │  ← 新增：底部状态行
│  ┌─────────────────────────────── ↑ ┐  │
│  │ Ask anything...                  │  │
│  └──────────────────────────── Send ┘  │
└─────────────────────────────────────────┘
```

实现方式：
- 从 `GET /api/settings` 缓存的 `SettingsData` 中读取 `ai.provider` 和当前 model
- 或新增轻量 API `GET /api/settings/ai-status` 返回 `{ provider, model }`
- 显示为 `PROVIDER_PRESETS[provider].name · modelName`，灰色小字 `text-xs text-muted-foreground`
- 点击可跳转到 Settings AI 页面

这个功能可以放在 Phase 2 末期或 Phase 3 实现，不阻塞核心功能。

#### 2.5 StepReview (Health Check) — 动态 provider 显示

**现状**：line 282 硬编码 `state.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'`。

**方案**：改为从 `PROVIDER_PRESETS` 取显示名：

```typescript
const preset = PROVIDER_PRESETS[state.provider as ProviderId];
const providerDisplayName = preset?.name ?? state.provider;
const modelDisplayName = state.providerConfigs[state.provider as ProviderId]?.model || preset?.defaultModel || 'default';

// detail 渲染
detail: aiOk ? `${providerDisplayName} (${modelDisplayName})` : ...
```

#### 2.6 SettingsContent — 重置默认值适配

**现状**：line 148 硬编码 `defaults` 只有 anthropic/openai。

**方案**：重置时清空 `providers` dict 中当前 provider 的配置，或整体重置为只保留 `provider: 'anthropic'` + 空 `providers`。

#### 2.7 settings-ai-client.ts — 客户端 API 可用性检测

**现状**：`isAiConfiguredForAsk()` 硬编码检查 `anthropic.apiKey` 或 `openai.apiKey`。

**方案**：

```typescript
export function isAiConfiguredForAsk(data: SettingsJsonForAi): boolean {
  const provider = data.ai?.provider;
  if (!provider) return false;
  const providerConfig = data.ai?.providers?.[provider];
  const preset = PROVIDER_PRESETS[provider];
  // 有 API key（手动配置或环境变量）
  return !!(
    providerConfig?.apiKey ||
    (preset?.apiKeyEnvVar && data.envOverrides?.[preset.apiKeyEnvVar])
  );
}
```

`SettingsJsonForAi.providers` 类型从 `{ anthropic?, openai? }` 改为 `Partial<Record<ProviderId, { apiKey?: string }>>`。

#### 2.8 ModelInput 组件通用化

**现状**：`ModelInput` 的 `provider` prop 类型为 `'anthropic' | 'openai'`。

**方案**：改为 `ProviderId`，内部根据 `PROVIDER_PRESETS[provider].supportsListModels` 决定是否显示 "List models" 按钮。不支持的 provider 隐藏该按钮，避免用户困惑。

`fetchModels` 请求体改为传 `{ provider: ProviderId, apiKey, baseUrl }`（不再硬编码 provider 取值）。

#### 2.9 错误信息人性化

当 test-key 失败时，根据 provider 给出更具体的建议：

```typescript
// classifyPiAiError 增加 provider-aware 建议
function getErrorSuggestion(code: ErrorCode, provider: ProviderId): string {
  if (code === 'auth_error') {
    const preset = PROVIDER_PRESETS[provider];
    if (preset.signupUrl) return `Check your API key. Get one at ${preset.signupUrl}`;
    return 'Check your API key.';
  }
  if (code === 'model_not_found') return 'Try using the "List Models" button to select a valid model.';
  // ...
}
```

### Phase 3: 进阶体验优化（后续迭代）

Phase 3 的内容不阻塞 Phase 1/2，可在后续版本逐步推出。

#### 3.1 OpenAI-compatible 代理商预设

为常见中转站内置 compat 预设模板：

```typescript
const PROXY_PRESETS = {
  'siliconflow': { baseUrl: 'https://api.siliconflow.cn/v1', compat: { supportsStore: false } },
  'oneapi':      { baseUrl: '', compat: { supportsDeveloperRole: false, supportsStore: false } },
  'newapi':      { baseUrl: '', compat: { supportsDeveloperRole: false, supportsStore: false } },
};
```

用户可在 Provider 为 OpenAI 时选择 "代理商预设"，自动填入 baseUrl + compat，减少手动配置。

#### 3.2 Chat 面板 Provider 快速切换

在 Chat 输入框旁或状态栏中添加 provider/model 快速切换入口（小型下拉），让用户在对话中直接切换 AI 而无需打开 Settings。仅切换已配置好 API key 的 provider。

#### 3.3 多 Provider 同时对比

支持用户同时向两个 provider 发送同一个 prompt，并排显示结果。适用于评估不同模型的响应质量。这是一个探索性功能，优先级最低。

#### 3.4 Provider 健康监控

在 Settings AI 页面显示每个已配置 provider 的最近一次 API 调用状态（成功/失败/延迟），帮助用户快速诊断问题。数据来源可以是 test-key 的历史结果或 chat 的实际调用记录。

## 影响范围

### 变更文件列表

**Phase 1 — 类型系统 + 测试路径统一（后端）**

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/agent/providers.ts` | **新建** | Provider 预设注册表（`PROVIDER_PRESETS`、`ProviderId` 类型） |
| `app/lib/settings.ts` | 重构 | `AiConfig` 类型扩展、`effectiveAiConfig()` 通用化 |
| `app/lib/agent/model.ts` | 重构 | `getModelConfig()` 通用化，移除 provider 分支 |
| `app/app/api/settings/test-key/route.ts` | **重写** | 改为通过 pi-ai `complete()` 测试 |
| `app/app/api/settings/list-models/route.ts` | 重构 | 支持多 provider 的 models API |
| `app/__tests__/api/test-key.test.ts` | **重写** | 适配新的 pi-ai complete() 测试逻辑 |
| `app/__tests__/setup.ts` | 更新 | `effectiveAiConfig()` mock 返回值格式变更 |

**Phase 2 — UI/UX 全面适配**

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/components/shared/ProviderSelect.tsx` | **新建** | 共享 Provider 选择器组件（Onboarding + Settings 复用） |
| `app/components/settings/types.ts` | 重构 | `AiSettings.provider` 类型扩展至 `ProviderId` |
| `app/components/settings/AiTab.tsx` | 重构 | 用 `<ProviderSelect>` 替换双按钮卡片，配置区动态渲染 |
| `app/components/setup/StepAI.tsx` | **重构** | 用 `<ProviderSelect>` 替换 3 个卡片，配置区通用化 |
| `app/components/setup/types.ts` | 重构 | `SetupState` 从硬编码字段改为 `providerConfigs` dict |
| `app/components/setup/index.tsx` | 重构 | 初始值、保存逻辑、env 自动检测均适配动态 provider |
| `app/components/setup/StepReview.tsx` | 微调 | Health Check provider 显示名动态化 |
| `app/components/settings/SettingsContent.tsx` | 微调 | 重置默认值逻辑不再硬编码 |
| `app/lib/settings-ai-client.ts` | 重构 | `isAiConfiguredForAsk()` 动态化 |
| `app/app/api/setup/route.ts` | 重构 | GET 返回动态 provider 配置 + `detectedEnvProviders`；POST 接受动态 `providers` dict |
| `app/lib/i18n/modules/onboarding.ts` | 更新 | Setup 步骤新增 provider 相关文案 |
| `app/lib/i18n/modules/settings.ts` | 更新 | Settings 新增 provider 名称、signupUrl 相关文案 |
| `wiki/80-known-pitfalls.md` | 更新 | 记录 provider 扩展注意事项 |

**Phase 2.5 — Chat 面板指示器（可延后）**

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/components/ask/AskContent.tsx` | 微调 | 底部输入框上方显示 `provider · model` 状态行 |

### 受影响的其他模块

| 模块 | 影响 | 原因 |
|------|------|------|
| `app/app/api/ask/route.ts` | **微调** | `getModelConfig()` 签名变更，`{ hasImages }` → `ModelConfigOverrides`（向后兼容） |
| `app/lib/acp/session.ts` | **无需改动** | ACP 走独立路径，不经过 getModelConfig |
| `app/components/settings/SettingsModal.tsx` | **微调** | env override 检测逻辑需适配动态 provider |

### 破坏性变更

**后端（Phase 1）**：
- `effectiveAiConfig()` 返回值从 `{ provider, anthropicApiKey, anthropicModel, openaiApiKey, openaiModel, openaiBaseUrl }` 改为 `{ provider, apiKey, model, baseUrl }`。已确认调用方清单：`model.ts`、`test-key/route.ts`、`list-models/route.ts`、`__tests__/setup.ts` mock。
- `getModelConfig()` 签名从 `(options?: { hasImages?: boolean })` 改为 `(options?: ModelConfigOverrides)`。`ask/route.ts` 调用 `getModelConfig({ hasImages: ... })` 向后兼容（`hasImages` 是 `ModelConfigOverrides` 的字段）。

**前端（Phase 2）**：
- `settings-ai-client.ts` 的 `isAiConfiguredForAsk()` 从硬编码 `anthropic | openai` 改为按 `provider` 动态查找。
- `SetupState` 接口破坏性变更：移除 `anthropicKey/anthropicModel/openaiKey/openaiModel/openaiBaseUrl/anthropicKeyMask/openaiKeyMask`，替换为 `providerConfigs: Partial<Record<ProviderId, ProviderConfig>>` + `apiKeyMasks: Partial<Record<ProviderId, string>>`。所有引用 `state.anthropicKey` 等的代码需迁移。
- `api/setup/route.ts` GET 返回结构变更：从 `{ anthropicApiKey, anthropicModel, openaiApiKey, ... }` 改为 `{ providerConfigs: { [id]: { model, apiKeyMask } }, detectedEnvProviders: [...] }`。
- `AiTab` 中 `patchProvider` / `handleTestKey` / `renderTestButton` 的 `'anthropic' | 'openai'` 参数类型改为 `ProviderId`。

**数据持久化**：
- `~/.mindos/config.json` 格式向后兼容：旧的 `providers: { anthropic, openai }` 会被 `migrateAi()` 正确读取。新增的 provider 字段不影响旧版本（未识别的 key 被忽略）。

## 边界 case 与风险

### 边界 case

| # | Case | 处理 |
|---|------|------|
| 1 | 用户从旧版升级，config 中只有 anthropic/openai | `migrateAi()` 保持不变，正常迁移。新 provider 不会被自动创建，仅在用户切换时写入 |
| 2 | pi-ai 注册表中无该 provider 的模型（自定义模型名） | 走 fallback 分支，手动构造 Model literal，使用 preset 的 `piApiDefault` |
| 3 | 用户为 Google Gemini 填了 baseUrl（不应该支持） | `preset.supportsBaseUrl === false` → UI 不渲染 baseUrl 字段；后端忽略 |
| 4 | pi-ai 版本更新添加了新 provider，但我们 PROVIDER_PRESETS 没更新 | 不影响已有功能。用户无法在 UI 选择新 provider，但可通过手动编辑 config 使用 |
| 5 | test-key 通过 `complete()` 测试时消耗 token | 使用 `{ messages: [{ role: 'user', content: 'hi' }] }` 最小 prompt，消耗 <10 token（约 $0.00001）。可接受 |
| 6 | `complete()` 超时（某些 provider 冷启动慢） | 保持 10s 超时 + AbortController，与当前行为一致 |
| 7 | 并发测试多个 provider 的 key | 每次 test 独立创建 Model，无共享状态，无竞态风险 |
| 8 | 环境变量名冲突（用户设了 `GROQ_API_KEY` 但选的是 OpenAI provider） | `effectiveAiConfig()` 只读取当前 provider 对应的环境变量，不交叉 |
| 9 | OpenAI-compatible proxy 但用户选了 DeepSeek provider | DeepSeek 配有 `compat` 预设，会正确处理 `supportsDeveloperRole: false` 等。如果用户的 proxy 行为不同，可通过 baseUrl 微调 |
| 10 | Kimi Coding 使用 `anthropic-messages` API 但不是 Anthropic | pi-ai 原生支持，`kimi-coding` provider 的 `piApiDefault` 设为 `anthropic-messages`，pi-ai 会自动使用正确的 API 格式和认证头 |
| 11 | test-key 传入未保存的 API key（用户在 UI 输入后直接点 Test） | `getModelConfig()` 的 `ModelConfigOverrides` 接受 `apiKey` 覆盖，`complete()` 的 options 也单独传 `apiKey`。不依赖 config 文件中的值 |
| 12 | 用户在 config.json 中手动写入 PROVIDER_PRESETS 不包含的 provider 名 | `migrateAi()` 将 fallback 到 `'anthropic'`；`effectiveAiConfig()` 中 `PROVIDER_PRESETS[provider]` 取不到时 fallback 到 anthropic preset |
| 13 | Onboarding 时检测到多个环境变量（如 ANTHROPIC_API_KEY + OPENAI_API_KEY 同时存在） | 预选第一个 primary 级别的 provider；UI 提示 "检测到多个 API key"，用户可切换 |
| 14 | 用户在 Onboarding 选了 Google，在 Settings 改为 OpenAI，再回 Onboarding | Onboarding 不会重置 Settings 的配置。Onboarding 只在首次运行（无 config 时）触发 |
| 15 | `<ProviderSelect>` 在 Onboarding（compact 模式）和 Settings（完整模式）中的行为差异 | compact 模式不显示 "已配置" 徽标（Onboarding 时还没有配置），Settings 完整模式显示 |
| 16 | 用户选了一个 `supportsListModels: false` 的 provider，点击 List Models | List Models 按钮不渲染，用户只能手动输入模型名 |
| 17 | signupUrl 过期或 provider 关闭注册 | signupUrl 仅作为便利链接，不影响功能。链接在新窗口打开，即使 404 也不影响 MindOS |

### 风险与 Mitigation

| 风险 | 严重度 | Mitigation |
|------|--------|------------|
| pi-ai `complete()` 在 test-key 场景下行为与 `session.prompt()` 仍有细微差异（如 tool 定义） | 中 | `complete()` 不传 tools，但实际 chat 传 tools。Phase 1 先不带 tools 测试；如有 bug 可在 Phase 2 给 test-key 加 tool 定义 |
| 大量 provider 增加 UI 复杂度，用户困惑 | 低 | `category` 分组：primary 默认展示，secondary 折叠，advanced 更深层折叠。progressive disclosure |
| pi-ai 版本更新可能改变 provider API 行为 | 低 | lockfile 锁版本；升级时走正常测试流程 |
| Google Gemini 的 API key 与环境变量名 (`GOOGLE_GENERATIVE_AI_API_KEY`) 较长 | 低 | UI 中只显示 "API Key"，环境变量名在 hint 文案中说明 |
| `complete()` 测试会使 pi-ai 内部初始化 HTTP 连接池（首次 provider 调用） | 低 | 10s 超时足够覆盖冷启动；pi-ai 内部有 retry 逻辑 |
| DeepSeek 不在 pi-ai 注册表中，`piGetModel('openai', 'deepseek-chat')` 必然 fallback | 无 | fallback 分支已正确处理，使用 preset.defaultBaseUrl 构造 Model literal。这是预期行为 |

## 验收标准

### Phase 1 — 后端类型系统 + 测试路径统一

- [ ] `PROVIDER_PRESETS` 注册表包含 13 个 provider（3 primary + 7 secondary + 3 advanced），每个都有完整的 `ProviderPreset` 字段
- [ ] `AiConfig.provider` 类型为 `ProviderId`，不再硬编码 union
- [ ] `effectiveAiConfig()` 返回统一接口 `{ provider, apiKey, model, baseUrl }`
- [ ] `getModelConfig()` 对所有 provider 都能正确构建 pi-ai Model（注册表命中 + fallback 两条路径均有覆盖）
- [ ] `test-key` 改为使用 pi-ai `complete()` 而非手写 `fetch`
- [ ] 对 Anthropic + OpenAI 的现有功能完全向后兼容（旧 config 正常读取）
- [ ] `migrateAi()` 能正确迁移旧格式，不丢失数据
- [ ] 全量测试通过（`npm test`）

### Phase 2 — UI/UX 全面适配

**Settings**：
- [ ] `<ProviderSelect>` 组件显示 3 个分组（推荐 / 更多 / 高级），primary 展开 + secondary/advanced 紧凑
- [ ] 已配置 API key 的 provider 显示 ✓ 徽标
- [ ] 选中 provider 后动态渲染该 provider 需要的配置字段（API Key、Model、Base URL 按 preset 控制）
- [ ] API Key 为空时显示 "Get API key" 引导链接（`signupUrl`）
- [ ] Thinking 开关根据 `preset.supportsThinking` 动态显示，不再硬编码 `provider === 'anthropic'`
- [ ] List models 按钮根据 `preset.supportsListModels` 动态显示/隐藏
- [ ] 环境变量 Badge 根据 preset 的 envVar 动态检测和显示

**Onboarding**：
- [ ] StepAI 使用 `<ProviderSelect>` 而非硬编码卡片
- [ ] 环境变量自动检测：如果 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 等存在，自动预选该 provider 并提示
- [ ] `SetupState` 使用 `providerConfigs` dict 替代硬编码字段
- [ ] 保存时只写入当前选中 provider 的配置
- [ ] Skip 选项作为文本按钮保留，不再占据卡片位
- [ ] StepReview Health Check 动态显示 provider 名称

**i18n**：
- [ ] 所有新增 UI 文案（provider 名、引导链接文案、env 检测提示）中英文完整

### Phase 2.5 — Chat 指示器（可选延后）

- [ ] Chat 面板底部输入框上方显示当前 `provider · model`
- [ ] 点击可跳转到 Settings AI 页面

### Bug 修复验证

- [ ] 使用 OpenAI-compatible proxy (baseUrl) + gpt-5.4 模型，test-key 和 chat 行为一致（不再出现"测试通过但聊天失败"）
- [ ] 使用 Google Gemini API key，test-key 通过后 chat 也能正常工作
- [ ] 使用 Groq API key，test-key 通过后 chat 也能正常工作
- [ ] 切换 provider 后，旧 provider 的配置不丢失（持久化在 `providers` dict 中）
- [ ] Onboarding 完成后，Settings 页能正确显示 Onboarding 中选择的 provider 和配置
- [ ] 环境变量自动检测的 provider 在 Onboarding 和 Settings 中表现一致
