# MindOS Infrastructure Analysis: Settings, LLM API Management, and Search

## Executive Summary

MindOS uses a unified, extensible architecture for managing user settings (including API keys), LLM provider configurations, and search infrastructure. The system is designed to support optional features through modular plugin patterns and configuration-driven behavior. Below is a detailed analysis of the three pillars required for adding embedding-based RAG search.

---

## 1. SETTINGS SYSTEM

### 1.1 Settings Storage Location & Format

**Path:** `~/.mindos/config.json` (platform-independent)
- Stored in user's home directory under `.mindos/` directory
- Single JSON file, atomic writes via rename (prevents corruption on crash)
- Synced from multiple sources (CLI, API, UI)

**Example structure:**
```json
{
  "mindRoot": "/path/to/mind",
  "port": 3003,
  "mcpPort": 8700,
  "authToken": "token-here",
  "webPassword": "password",
  "ai": {
    "activeProvider": "p_esc9eiuh",
    "providers": [...]
  },
  "agent": {
    "maxSteps": 20,
    "enableThinking": true
  },
  "baseUrlCompat": {},
  "connectionMode": {"cli": true, "mcp": true},
  "guideState": {...},
  "disabledSkills": [],
  "installedSkillAgents": []
}
```

### 1.2 Settings API Surface

**File:** `lib/settings.ts` (core interface)

**Key Functions:**
```typescript
readSettings(): ServerSettings
  // Reads from ~/.mindos/config.json, auto-migrates old formats
  // Returns typed ServerSettings interface
  // Handles corruption gracefully (returns defaults + setupPending=true)

writeSettings(settings: ServerSettings): void
  // Atomic JSON write via temp file + rename
  // Merges with existing config to preserve unknown fields
  // Non-critical failures silently caught
```

**Key Types:**
```typescript
interface ServerSettings {
  ai: AiConfig;
  agent?: AgentConfig;
  mindRoot: string;
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  startMode?: 'dev' | 'start' | 'daemon';
  setupPending?: boolean;
  disabledSkills?: string[];
  guideState?: GuideState;
  acpAgents?: Record<string, AcpAgentOverride>;
  baseUrlCompat?: Record<string, 'streaming' | 'non-streaming'>;
  connectionMode?: { cli: boolean; mcp: boolean };
  customAgents?: CustomAgentDef[];
}

interface AiConfig {
  activeProvider: string;  // e.g., "p_esc9eiuh" (provider entry ID)
  providers: Provider[];   // Unified array of all configured providers
}

interface AgentConfig {
  maxSteps?: number;        // 1-30, default 20
  enableThinking?: boolean; // Anthropic only, default false
  thinkingBudget?: number;  // default 5000
  contextStrategy?: 'auto' | 'off';
  reconnectRetries?: number;
}
```

### 1.3 Settings I/O Patterns

**File:** `lib/sync-config.ts` (companion functions)
```typescript
atomicWriteJSON(filePath, data)    // Temp file + rename pattern
loadConfig(): Record<string, any>   // Load config.json
saveConfig(config)                  // Save config.json
loadSyncState(): Record<string, any> // Load sync-state.json
```

**Constants:**
```typescript
SETTINGS_PATH = ~/.mindos/config.json
SYNC_STATE_PATH = ~/.mindos/sync-state.json
```

### 1.4 Settings UI Flow

**File:** `components/settings/AiTab.tsx` (example)
- Settings UI component (React)
- Fetches settings via `GET /api/settings`
- Updates settings via `POST /api/settings`
- Auto-saves individual field changes

**API Routes:**
```
GET  /api/settings           → Returns all settings + env overrides
POST /api/settings           → Writes full settings object
POST /api/settings/test-key  → Tests LLM provider connectivity
GET  /api/settings/list-models → Lists available models for a provider
POST /api/settings/reset-token  → Regenerates auth token
```

**File:** `app/api/settings/route.ts`
```typescript
GET()  // Returns settings + masking for tokens, env var detection
POST() // Validates, merges, writes to settings file
```

### 1.5 Extension Point: Adding New Settings Fields

**Pattern:**
1. Add new field to `ServerSettings` interface in `lib/settings.ts`
2. Add read/write logic in `readSettings()` / `writeSettings()`
3. Add parsing function (e.g., `parseNewField()`) with safe type coercion
4. Add default value to `DEFAULTS` object
5. Add UI component in `components/settings/` (e.g., `NewFeatureTab.tsx`)
6. Wire up API route `/api/settings` to pass field through

**Example for RAG embeddings:**
```typescript
interface RagConfig {
  enabled: boolean;
  embeddingModel: string;      // e.g., "text-embedding-3-small"
  embeddingProvider: ProviderId; // e.g., "openai"
  embeddingApiKey: string;
  indexType: 'bm25' | 'hybrid' | 'semantic'; // BM25 vs embeddings
  chunkSize: number;
  chunkOverlap: number;
}

interface ServerSettings {
  // ... existing fields
  rag?: RagConfig;
}
```

---

## 2. LLM API KEY MANAGEMENT

### 2.1 Provider Configuration Architecture

**File:** `lib/agent/providers.ts`

**Provider Types:**
- `ProviderId`: Union type of all supported providers
  - Primary: `'anthropic'`, `'openai'`, `'google'`, `'groq'`
  - Extended: `'xai'`, `'openrouter'`, `'mistral'`, `'deepseek'`, `'zai'`, `'kimi-coding'`, `'cerebras'`, `'ollama'`, etc.

**Unified Provider Entry:**
```typescript
interface Provider {
  id: string;           // "p_" + 8 random chars (e.g., "p_esc9eiuh")
  name: string;         // User-visible name (e.g., "My OpenAI")
  protocol: ProviderId; // Which API protocol to use
  apiKey: string;       // Actual API key
  model: string;        // Model ID (e.g., "gpt-5.4")
  baseUrl: string;      // Custom endpoint URL (for self-hosted, proxies)
}
```

**Provider Presets (Metadata):**
```typescript
interface ProviderPreset {
  id: ProviderId;
  name: string;          // e.g., "Anthropic"
  nameZh: string;        // Chinese name
  shortLabel: string;    // Capsule label (3-8 chars)
  defaultModel: string;
  fixedBaseUrl?: string; // For Ollama, DeepSeek (can't override)
  apiKeyFallback?: string; // For Ollama (no auth needed)
  supportsBaseUrl: boolean;
  supportsThinking: boolean;
  supportsListModels: boolean;
  signupUrl?: string;
  category: 'primary' | 'more';
}
```

**Constants:**
```typescript
PROVIDER_PRESETS[ProviderId] // Registry of all provider metadata
ALL_PROVIDER_IDS: ProviderId[] // All supported IDs
```

### 2.2 API Key Resolution Priority Chain

**Function:** `effectiveAiConfig(providerOverride?: string)` in `lib/settings.ts`

**Resolution order (highest to lowest priority):**
1. Saved config file (`config.json` → `ai.providers[]`)
2. Environment variable (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
3. Preset default/fallback (e.g., Ollama has `apiKeyFallback`)

```typescript
effectiveAiConfig(providerOverride?: string): {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
}
```

### 2.3 Environment Variable Mapping

**Function:** `getApiKeyEnvVar(providerId: ProviderId)` in `lib/agent/providers.ts`

**Examples:**
- `anthropic` → `ANTHROPIC_API_KEY`
- `openai` → `OPENAI_API_KEY`
- `google` → `GOOGLE_API_KEY`
- `groq` → `GROQ_API_KEY`
- etc.

**Detection:** `GET /api/settings` response includes:
```typescript
envOverrides: Record<string, boolean>  // Which env vars are set
envValues: Record<string, string>      // Values (masked if set)
```

### 2.4 Provider Validation & Parsing

**Function:** `parseProviders(raw: unknown): Provider[]` in `lib/custom-endpoints.ts`

**Validation:**
- ID must start with `"p_"`
- name must be non-empty string
- protocol must be valid `ProviderId`
- Filters invalid entries (silent skip)

**Usage in API:**
```typescript
// POST /api/settings calls parseProviders on incoming data
const resolvedAi = body.ai ? {
  activeProvider: body.ai.activeProvider,
  providers: parseProviders(body.ai.providers)
} : current.ai;
```

### 2.5 Migration from Old Format

**Function:** `migrateProviders(parsed)` in `lib/custom-endpoints.ts`

**Old format:**
```json
{ "ai": { 
  "provider": "openai",
  "providers": { "openai": {...}, "anthropic": {...} }
}}
```

**New format:**
```json
{ "ai": {
  "activeProvider": "p_abc12345",
  "providers": [
    {"id": "p_abc12345", "protocol": "openai", ...},
    {"id": "p_xyz98765", "protocol": "anthropic", ...}
  ]
}}
```

**Auto-migration:** `readSettings()` detects old format and auto-migrates on first read, then persists new format back to disk.

### 2.6 Extension Point: Adding a New Embedding Provider

**Steps:**
1. Add to `ProviderId` type in `lib/agent/providers.ts`
2. Add entry to `PROVIDER_PRESETS` with metadata
3. Add env var mapping in `getApiKeyEnvVar()`
4. If OpenAI-compatible, use `deepseek` pattern (override via `baseUrl`)
5. If new protocol, add support to pi-ai (upstream dependency)

**Example for local Ollama embedding service:**
```typescript
// lib/agent/providers.ts
export type ProviderId = ... | 'ollama-embed';

PROVIDER_PRESETS.ollama-embed = {
  id: 'ollama-embed',
  name: 'Ollama (Local)',
  nameZh: 'Ollama (本地)',
  shortLabel: 'Ollama',
  defaultModel: 'nomic-embed-text',
  fixedBaseUrl: 'http://localhost:11434/api/embed',
  apiKeyFallback: 'dummy', // No auth
  supportsBaseUrl: false,
  supportsThinking: false,
  supportsListModels: false,
  category: 'more',
};
```

---

## 3. SEARCH INFRASTRUCTURE

### 3.1 Current Search Architecture

**Two parallel systems:**

1. **Core Search (BM25)** - Backend, MCP/API focused
   - File: `lib/core/search.ts`
   - Scoring: BM25 (Best Matching 25) algorithm
   - Used by: MCP tools, agent search, REST API

2. **App Search (Fuse.js)** - Frontend, UI-focused
   - File: `lib/fs.ts` → `searchFiles(query: string)`
   - Scoring: Fuzzy matching
   - Used by: ⌘K search overlay in UI

### 3.2 Core Search (BM25)

**File:** `lib/core/search.ts`

**API:**
```typescript
searchFiles(
  mindRoot: string,
  query: string,
  opts?: SearchOptions
): SearchResult[]

interface SearchOptions {
  limit?: number;          // default 20
  scope?: string;          // directory prefix filter
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string; // ISO date filter
}

interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}
```

**BM25 Parameters:**
```typescript
const BM25_K1 = 1.2;  // Term frequency saturation
const BM25_B = 0.75;  // Document length normalization

function bm25Score(
  tf: number,      // term frequency in doc
  df: number,      // document frequency
  docLength: number,
  avgDocLength: number,
  totalDocs: number
): number
```

**Features:**
- Multi-term queries (terms scored independently, summed)
- CJK support (word boundaries vs. substring matching)
- Latin term word boundaries (prevents partial matches)
- Snippet extraction around first match

### 3.3 Search Index (Inverted Index)

**File:** `lib/core/search-index.ts`

**Class:** `SearchIndex`

```typescript
class SearchIndex {
  rebuild(mindRoot: string): void
    // Full rebuild: read all files, tokenize, invert

  load(mindosDir, mindRoot): boolean
    // Load from disk (~/.mindos/search-index.json)
    // Returns false if stale/corrupt

  persist(mindosDir: string): void
    // Serialize to JSON for next cold start

  // Incremental updates (O(tokens) instead of O(all-files))
  addFile(mindRoot, filePath): void
  updateFile(mindRoot, filePath): void
  removeFile(filePath): void

  // Query interface
  getCandidatesUnion(query): string[] | null
    // UNION semantics: any file matching any token

  getCandidates(query): string[] | null
    // INTERSECTION semantics: files matching all tokens

  getFileCount(): number
  getAvgDocLength(): number
  getDocLength(filePath): number
  getDocFrequency(token): number
}
```

**Persistence:**
- Stored at: `~/.mindos/search-index.json`
- Format: Serialized inverted index + BM25 stats
- Staleness detection: file count, mtime sampling
- Auto-rebuild on staleness

**Tokenization:**
```typescript
function tokenize(text: string): Set<string>
  // Latin: split on non-alphanumeric, min 2 chars
  // CJK: Intl.Segmenter word boundaries (or bigrams if unavailable)
  // Combined: both strategies applied
```

### 3.4 Search Index Lifecycle & Caching

**File:** `lib/fs.ts` (app layer)

**Module-level singleton:**
```typescript
// Private module state
let _cache: FileTreeCache | null = null;
let _searchIndex: SearchIndexState | null = null;
let _treeVersion = 0;

// Called after file mutations
invalidateCache(): void // Full invalidate
invalidateCacheForFile(filePath): void // Incremental
invalidateCacheForNewFile(filePath): void
invalidateCacheForDeletedFile(filePath): void
```

**Invalidation triggers:**
- Write/edit file → `updateSearchIndexFile()`
- Create file → `addSearchIndexFile()`
- Delete file → `removeSearchIndexFile()`
- Rename/move/delete dir → Full invalidate

**Persistence:**
- Debounced persist: 5s after last write operation
- Process exit hooks: flush immediately (SIGTERM, SIGINT, beforeExit)

### 3.5 App-Level Search (Fuse.js)

**File:** `lib/fs.ts`

```typescript
export function searchFiles(query: string): AppSearchResult[]
  // Fuzzy search via Fuse.js, limit 20

interface AppSearchResult {
  path: string;
  snippet: string;
  score: number;        // 1 - fuse.score
  matches?: Array<{
    indices: [number, number][];
    value: string;
    key: string;
  }>;
}
```

**Index building:**
- Lazy: built on first search
- TTL: 30s expiration
- Watches mindRoot for changes (immediate invalidation)

**Search queries:**
- Fuse.js fuzzy matching (no BM25)
- CJK support via same tokenization

### 3.6 API Search Route

**File:** `app/api/search/route.ts`

```typescript
GET /api/search?q=query_string

// Response: SearchResult[]
[
  {
    path: "Space/file.md",
    snippet: "...context around match...",
    score: 42.3,
    occurrences: 5
  }
]
```

**Implementation:**
```typescript
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || '';
  if (!q.trim()) return [];
  
  const results = searchFiles(q);
  return NextResponse.json(results);
}
```

### 3.7 Search Result Types

**File:** `lib/core/types.ts`

```typescript
export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}
```

### 3.8 PDF Support

**Current:**
- `searchFiles()` reads PDF text via `extractPdfText()`
- Uses pdfjs-dist for text extraction
- Included in BM25 search automatically

**Limits:**
- MAX_CONTENT_LENGTH = 50,000 chars per file
- Larger documents truncated for index

### 3.9 Extension Point: Adding Embedding-Based RAG

**Integration patterns:**

1. **Dual-search model:**
   - Keep BM25 for full-text (fast, no AI needed)
   - Add semantic search via embeddings (slower, uses LLM)
   - Optionally combine results (hybrid search)

2. **New module structure:**
   ```
   lib/core/
     ├── search.ts            (existing BM25)
     ├── search-index.ts      (existing inverted index)
     ├── embedding-index.ts   (NEW: vector store)
     ├── embedding-client.ts  (NEW: embedding API calls)
     └── rag-search.ts        (NEW: unified search interface)
   ```

3. **Configuration flow:**
   ```
   ~/.mindos/config.json
   └── rag?: {
     enabled: boolean,
     embeddingModel: string,
     embeddingProvider: ProviderId,
     embeddingApiKey: string,
     indexType: 'bm25' | 'hybrid' | 'semantic'
   }
   ```

4. **Index persistence:**
   - Store embeddings at `~/.mindos/embedding-index.json`
   - Include version, model name, file metadata
   - Invalidate on:
     - File changes
     - Model/provider change
     - Config modification

5. **API extension:**
   ```
   POST /api/search (existing, BM25 only)
   POST /api/search/semantic
   GET  /api/search?type=hybrid  (combined BM25 + semantic)
   POST /api/settings/embedding-models (list available)
   ```

---

## 4. PACKAGE ECOSYSTEM

**File:** `package.json`

**Relevant dependencies:**
- `fuse.js@^7.1.0` - Fuzzy search (frontend)
- `pdfjs-dist@^4.10.38` - PDF text extraction
- `@mariozechner/pi-ai@^0.60.0` - LLM provider abstraction
- `zod@^3.23.8` - Schema validation
- `zustand@^5.0.12` - State management

**NO existing embedding/ML dependencies:**
- No `openai` SDK (would be needed for embeddings)
- No `transformers`, `onnx`, or `llm.js`
- No vector database (Pinecone, Qdrant, Weaviate, etc.)

**For embedding RAG, consider adding:**
- `@openai/embeddings` (OpenAI embeddings)
- `vectorstore-lite` or `sqlite-vss` (lightweight local vector store)
- Or: keep in-memory during session, JSON persistence

---

## 5. FEATURE ORGANIZATION PATTERNS

### 5.1 Optional Feature Example: Web Search

**Location:** `lib/agent/web-search.ts`

**Pattern:**
- Standalone module (not integrated by default)
- Called explicitly by agent when needed
- No settings UI (always available if agent uses it)
- No API key management (free, no auth)

**Structure:**
```
lib/agent/
├── web-search.ts      (implementation)
├── providers.ts       (provider metadata)
└── index.ts           (exports)
```

### 5.2 Optional Settings Feature

**Pattern:**
1. Add `NewConfig` interface to `ServerSettings` (optional field)
2. Add parsing function (safe type coercion)
3. Add defaults to `DEFAULTS` object
4. Add UI tab in `components/settings/NewTab.tsx`
5. Wire up API route POST handler
6. Add validation tests

**Example: Knowledge Tab** (existing)
- File: `components/settings/KnowledgeTab.tsx`
- Settings: Git sync config, auto-pull interval, etc.
- API: Handles in `POST /api/settings`

### 5.3 Recommended RAG Feature Structure

```
lib/
├── core/
│   ├── search.ts           (existing BM25)
│   ├── search-index.ts     (existing inverted index)
│   ├── embedding-index.ts  (NEW)
│   └── embedding-client.ts (NEW)
├── rag/
│   ├── config.ts           (RAG config helpers)
│   ├── index-manager.ts    (rebuild, persist, load)
│   └── search.ts           (unified search API)
└── agent/
    └── embedding-provider.ts (NEW provider abstraction)

components/settings/
├── RagTab.tsx              (NEW)
├── RagEmbeddingSelect.tsx  (NEW component)
└── RagIndexStatus.tsx      (NEW component)

app/api/
├── rag/
│   ├── rebuild/route.ts    (POST to rebuild index)
│   ├── status/route.ts     (GET index stats)
│   └── search/route.ts     (POST semantic search)
└── search/
    └── route.ts (existing, add ?type=hybrid param)
```

---

## 6. KEY FILES SUMMARY

| File | Purpose | Key Exports |
|------|---------|-------------|
| `lib/settings.ts` | Core settings I/O | `readSettings()`, `writeSettings()`, `ServerSettings` interface |
| `lib/custom-endpoints.ts` | Provider unified interface | `Provider`, `parseProviders()`, `migrateProviders()` |
| `lib/agent/providers.ts` | Provider metadata & env vars | `PROVIDER_PRESETS`, `getApiKeyEnvVar()`, `ProviderId` type |
| `lib/core/search.ts` | BM25 search | `searchFiles()`, `bm25Score()` |
| `lib/core/search-index.ts` | Inverted index | `SearchIndex` class, persistence |
| `lib/fs.ts` | App-level search & caching | `searchFiles()`, cache invalidation |
| `app/api/settings/route.ts` | Settings REST API | GET/POST handlers |
| `app/api/search/route.ts` | Search REST API | GET handler, BM25 results |
| `components/settings/AiTab.tsx` | Provider UI | Provider selection, key input, test button |

---

## 7. IMPORTANT DESIGN DECISIONS

1. **Unified Provider Model**: All LLM providers use same `Provider` interface, making it easy to add new ones.

2. **Atomic File Writes**: Settings use temp file + rename to prevent corruption on crash.

3. **Lazy Index Building**: Search index built on first search, not at startup.

4. **Incremental Updates**: File mutations update search index O(tokens) instead of full rebuild.

5. **Multi-Engine Web Search**: No API keys needed (free HTML scraping with fallback chain).

6. **CJK Support**: Proper word segmentation with fallback to bigrams.

7. **Auto-Migration**: Old config formats auto-detected and migrated transparently.

8. **Environment Variable Priority**: Settings can be overridden by env vars for CI/deployment.

---

## 8. EXTENSION CHECKLIST FOR EMBEDDING RAG

- [ ] Add `rag?: RagConfig` to `ServerSettings` interface
- [ ] Add RAG parsing function in `lib/settings.ts`
- [ ] Add `RagTab.tsx` UI component in `components/settings/`
- [ ] Add `EmbeddingClient` abstraction in `lib/rag/`
- [ ] Create `EmbeddingIndex` class for vector storage
- [ ] Add API routes for RAG operations
- [ ] Implement hybrid search combining BM25 + semantic
- [ ] Add index persistence at `~/.mindos/embedding-index.json`
- [ ] Add staleness detection (model name, provider, file changes)
- [ ] Add env var support: `RAG_EMBEDDING_PROVIDER`, `RAG_EMBEDDING_API_KEY`
- [ ] Wire up settings validation tests
- [ ] Add migration logic for future config format changes

