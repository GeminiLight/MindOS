# MindOS Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          MindOS Platform                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  FRONTEND (React)              BACKEND (Next.js)                │
│  ┌────────────────┐            ┌──────────────────────────┐     │
│  │ Settings UI    │            │ API Routes               │     │
│  │ ⌘K Search      │◄──────────►│ /api/settings           │     │
│  │ File Browser   │            │ /api/search             │     │
│  └────────────────┘            │ /api/rag/* (NEW)        │     │
│                                 └──────────────────────────┘     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Reads/Writes
          ▼
┌─────────────────────────────────────────────────────────────────┐
│              ~/.mindos/config.json (Persistent)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  {                                                               │
│    "mindRoot": "/path/to/mind",                                 │
│    "ai": {                                                       │
│      "activeProvider": "p_esc9eiuh",                            │
│      "providers": [                                             │
│        {"id":"p_*","name":"...","protocol":"openai",...}        │
│      ]                                                           │
│    },                                                            │
│    "rag": { "enabled":true, "embeddingModel":"..." }  (NEW)    │
│  }                                                               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Contains provider references
          ▼
┌─────────────────────────────────────────────────────────────────┐
│           Settings System (lib/settings.ts)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  readSettings()          ┌─────────────────────────────────┐    │
│  writeSettings()         │ ServerSettings {               │    │
│  effectiveAiConfig()     │   ai: AiConfig;               │    │
│                          │   agent?: AgentConfig;        │    │
│  Parsing functions:      │   rag?: RagConfig; (NEW)      │    │
│  - parseAgent()          │   mindRoot: string;           │    │
│  - parseGuideState()     │   port?: number;              │    │
│  - parseNewField()       │   ...                         │    │
│                          │ }                             │    │
│                          └─────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Manages LLM credentials
          ▼
┌─────────────────────────────────────────────────────────────────┐
│        Provider System (lib/agent/providers.ts)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  interface Provider {                                           │
│    id: string;              // "p_" prefix (unique per entry)   │
│    name: string;            // User-visible name                │
│    protocol: ProviderId;    // "openai" | "anthropic" | ...     │
│    apiKey: string;                                              │
│    model: string;                                               │
│    baseUrl: string;         // Custom endpoint URL              │
│  }                                                               │
│                                                                   │
│  PROVIDER_PRESETS = {                                           │
│    anthropic: {...preset metadata...},                          │
│    openai: {...},                                               │
│    ollama: {...},                                               │
│    ...                                                           │
│  }                                                               │
│                                                                   │
│  Resolution Chain:                                              │
│  Config file → Environment variables → Preset defaults          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Calls AI APIs for embeddings (NEW)
          ▼
┌─────────────────────────────────────────────────────────────────┐
│         RAG System (lib/rag/* NEW)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────┐                                 │
│  │ EmbeddingClient            │                                 │
│  │ (lib/rag/embedding-client) │                                 │
│  │                            │                                 │
│  │ embed(text) → number[]     │                                 │
│  │ Uses provider from config  │                                 │
│  └────────────────────────────┘                                 │
│             │                                                    │
│             │ Calls external embedding API                      │
│             ▼                                                    │
│  ┌────────────────────────────┐                                 │
│  │ EmbeddingIndex             │                                 │
│  │ (lib/core/embedding-index) │                                 │
│  │                            │                                 │
│  │ rebuild(mindRoot)          │                                 │
│  │ search(query) → results    │                                 │
│  │ persist/load               │                                 │
│  └────────────────────────────┘                                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Coordinates searches
          ▼
┌─────────────────────────────────────────────────────────────────┐
│            Search System                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │ BM25 Search          │      │ EmbeddingIndex       │         │
│  │ (lib/core/search.ts) │      │ (lib/core/*.ts)      │         │
│  │                      │      │                      │         │
│  │ searchFiles(query)   │      │ search(query)        │         │
│  │ → BM25 ranking       │      │ → Semantic ranking   │         │
│  │                      │      │                      │         │
│  └──────────────────────┘      └──────────────────────┘         │
│             │                            │                       │
│             │                            │                       │
│             └────────────┬───────────────┘                       │
│                          │                                       │
│                    ┌─────▼──────┐                               │
│                    │ Hybrid      │                               │
│                    │ Search      │                               │
│                    │ Combines    │                               │
│                    │ results     │                               │
│                    └─────┬──────┘                               │
│                          │                                       │
│                    ┌─────▼──────────────┐                       │
│                    │ API Response       │                       │
│                    │ {path, snippet,    │                       │
│                    │  score, ...}       │                       │
│                    └────────────────────┘                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Returns
          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Frontend Search UI (React)                          │
├─────────────────────────────────────────────────────────────────┤
│ ⌘K Search → Results displayed with snippets & relevance scores  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Settings & Configuration Flow

```
┌─────────────────┐
│  User Updates   │
│  Settings UI    │
└────────┬────────┘
         │
         │ POST /api/settings
         ▼
┌──────────────────────────────┐
│  API Handler                 │
│  (app/api/settings/route.ts) │
├──────────────────────────────┤
│ • Validate input             │
│ • Parse providers[]          │
│ • Merge with existing config │
│ • Clear proxy compat cache   │
└────────┬─────────────────────┘
         │
         │ writeSettings()
         ▼
┌──────────────────────────────┐
│  lib/settings.ts             │
├──────────────────────────────┤
│ • Temp file write            │
│ • Atomic rename              │
│ • Merge to preserve fields   │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  ~/.mindos/config.json       │
│  (persistent storage)        │
└──────────────────────────────┘
         │
         ├─────────► invalidateCache()
         │
         └─────────► File watchers invalidate
                     search & tree index
```

---

## Search Index Lifecycle

```
┌──────────────────────────────────────────────────────┐
│          User performs search query                   │
│          GET /api/search?q=query                     │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │ Is index built?        │
        └────────────┬───────────┘
                     │
         ┌───────────┴────────────┐
         │ No                Yes  │
         ▼                        ▼
    ┌────────────┐     ┌──────────────────┐
    │ Try load   │     │ Use existing     │
    │ from disk  │     │ index            │
    └────┬───────┘     └────────┬─────────┘
         │                      │
    ┌────▼──────────┐           │
    │ Stale?        │           │
    └──┬───────┬────┘           │
   Yes │       │ No             │
       ▼       │                │
    ┌───┐     │                │
    │   │  Rebuild             │
    │   │     │                │
    └───┘     └────┬───────────┘
       │           │
       │    ┌──────▼────────────┐
       │    │ SearchIndex       │
       │    │ (in memory)       │
       │    └──────┬────────────┘
       │           │
       │           │ query
       │           ▼
       │    ┌──────────────────┐
       │    │ BM25 Scoring     │
       │    │ (O(candidates))  │
       │    └──────┬───────────┘
       │           │
       │    ┌──────▼────────────┐
       │    │ Return Results    │
       │    └──────┬────────────┘
       │           │
       └──────┬────┘
              │
        ┌─────▼─────────┐
        │ Lazy Persist  │
        │ (5s debounce) │
        └─────┬─────────┘
              │
        ┌─────▼──────────────────┐
        │ ~/.mindos/             │
        │ search-index.json      │
        └───────────────────────┘
```

---

## Provider Resolution Chain

```
REQUEST: effectiveAiConfig(providerOverride)
│
├─► providerOverride specified?
│   │
│   ├─► Yes: Use that provider ID
│   │        Find in providers[]
│   │
│   └─► No: Use activeProvider
│
▼
┌─────────────────────────────────┐
│ Provider found in config.json?  │
└────────┬────────────────────────┘
         │
    ┌────┴────┐
    │ Yes     │ No
    ▼         ▼
┌────────┐  ┌──────────────────┐
│ Use    │  │ Try env var:     │
│ config │  │ e.g., OPENAI_    │
│ value  │  │ API_KEY          │
└────┬───┘  └────────┬─────────┘
     │                │
     │           ┌────┴────────┐
     │           │ Set?        │
     │           │             │
     │           ├─► Yes: Use env var
     │           │
     │           └─► No: Check preset default
     │               (e.g., Ollama has fallback)
     │
     └──────────┬──────────────────┘
                │
         ┌──────▼──────────┐
         │ Return:         │
         │ {provider, key, │
         │  model, url}    │
         └─────────────────┘
```

---

## File Organization for RAG Extension

```
Current Structure:
lib/
├── core/
│   ├── search.ts           ← BM25 algorithm
│   ├── search-index.ts     ← Inverted index
│   └── types.ts            ← SearchResult interface
│
├── settings.ts
├── agent/
│   └── providers.ts

app/api/
└── search/
    └── route.ts


Proposed RAG Extension:
lib/
├── core/
│   ├── search.ts           (unchanged)
│   ├── search-index.ts     (unchanged)
│   ├── embedding-index.ts  ← NEW: Vector storage
│   ├── embedding-client.ts ← NEW: Embedding API
│   └── types.ts            (add RagResult type)
│
├── rag/                     ← NEW module
│   ├── config.ts           ← Config helpers
│   ├── search.ts           ← Unified search API
│   ├── index.ts            ← Exports
│   └── types.ts            ← RagConfig interface
│
├── settings.ts             (add rag field)
└── agent/
    ├── providers.ts        (optional: embedding providers)
    └── embedding-provider.ts ← NEW: Abstraction

app/api/
├── search/
│   └── route.ts            (add ?type=hybrid param)
│
├── rag/                     ← NEW routes
│   ├── rebuild/route.ts
│   ├── search/route.ts
│   └── status/route.ts

components/settings/
├── RagTab.tsx              ← NEW: RAG settings UI
└── AiTab.tsx               (possibly reuse for embedding provider selection)
```

---

## Settings Tab Wiring Pattern

```
RagTab.tsx (Component)
│
├─► GET /api/settings
│   │
│   └─► Returns: SettingsData
│        {
│          ai: {...current LLM providers...},
│          rag: {...RAG config...},
│          envOverrides: {RAG_EMBEDDING_API_KEY: boolean, ...}
│        }
│
├─► User changes setting
│   │
│   └─► POST /api/settings
│        {
│          rag: {
│            enabled: true,
│            embeddingProvider: "p_abc123",
│            ...
│          }
│        }
│
└─► API validates + persists
    │
    ├─► parseRagConfig() safe parsing
    │
    └─► writeSettings() atomic write
```

---

## Key Interfaces (TypeScript)

```typescript
// Settings
interface ServerSettings {
  ai: AiConfig;
  agent?: AgentConfig;
  rag?: RagConfig;        // NEW
  mindRoot: string;
  // ... others
}

// Provider
interface Provider {
  id: string;             // p_*
  name: string;
  protocol: ProviderId;   // "openai" | "anthropic" | ...
  apiKey: string;
  model: string;
  baseUrl: string;
}

// Search Results (existing)
interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}

// RAG Config (NEW)
interface RagConfig {
  enabled: boolean;
  embeddingProvider: string;  // provider ID from ai.providers
  embeddingModel: string;     // e.g., "text-embedding-3-small"
  embeddingApiKey?: string;   // optional if using env var
  indexType: 'bm25' | 'hybrid' | 'semantic';
  chunkSize: number;          // chars per chunk
  chunkOverlap: number;       // overlap between chunks
}

// Hybrid Search Result (NEW)
interface HybridSearchResult extends SearchResult {
  type: 'bm25' | 'semantic';
  semanticScore?: number;
}
```

---

## Summary: Data Flow for RAG Query

```
User Query
    │
    ▼
⌘K Search or /api/search?q=...
    │
    ├─► BM25 Search
    │   ├─► Tokenize query
    │   ├─► Index lookup → candidates
    │   ├─► BM25 scoring → results
    │   └─► Top 10
    │
    ├─► EmbeddingIndex Search (if enabled)
    │   ├─► Get embedding config from settings
    │   ├─► EmbeddingClient.embed(query)
    │   │   └─► Call external API (OpenAI, etc.)
    │   ├─► Vector similarity search
    │   └─► Top 10
    │
    └─► Combine Results (if hybrid)
        ├─► Merge scores (normalize + weight)
        ├─► Deduplicate
        ├─► Sort by combined score
        └─► Return Top N results
             │
             ├─► path: string
             ├─► snippet: string
             ├─► score: number
             ├─► type: 'bm25' | 'semantic'
             └─► semanticScore?: number
```

---

This architecture diagram shows:
1. How settings flow through the system
2. How providers are managed and resolved
3. How search indices are built, cached, and invalidated
4. How RAG would integrate alongside existing search
5. The modular, extensible design patterns used throughout

