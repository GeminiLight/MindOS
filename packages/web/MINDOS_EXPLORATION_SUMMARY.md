# MindOS Exploration Summary

## Overview
This document provides a high-level summary of the MindOS codebase exploration conducted on 2026-04-10. The full detailed analysis is in `MINDOS_INFRASTRUCTURE_ANALYSIS.md`.

## Key Findings

### 1. Settings System
- **Location**: `~/.mindos/config.json` (single JSON file per user)
- **I/O**: `lib/settings.ts` (readSettings/writeSettings)
- **Pattern**: Atomic writes via temp file + rename (crash-safe)
- **Extension**: Add new field to `ServerSettings` interface, parse safely, add UI tab
- **Current size**: Real config observed ~2KB with ~5 providers

### 2. LLM API Key Management
- **Architecture**: Unified `Provider` interface - all LLM providers use same model
- **Structure**: Each provider has ID (p_*), name, protocol, apiKey, model, baseUrl
- **Provider Types**: 20+ supported (Anthropic, OpenAI, Google, Groq, DeepSeek, Ollama, etc.)
- **Resolution Chain**: Config file → Environment variables → Preset defaults
- **File**: `lib/agent/providers.ts` (PROVIDER_PRESETS registry)
- **Migration**: Auto-detects old format, transparently migrates to new unified model

### 3. Search Infrastructure
- **Dual System**:
  1. **Core Search (BM25)**: `lib/core/search.ts` - Backend, MCP-friendly, full-text
  2. **App Search (Fuse.js)**: `lib/fs.ts` - Frontend, fuzzy matching, UI overlay
- **Index**: Inverted index in `lib/core/search-index.ts`, persists to `~/.mindos/search-index.json`
- **Updates**: Incremental on file changes (O(tokens) not O(all-files))
- **Features**: CJK support, PDF text extraction, multi-term BM25 scoring
- **API Route**: `GET /api/search?q=query`

### 4. Package Ecosystem
- **Relevant deps**: fuse.js, pdfjs-dist, @mariozechner/pi-ai, zod, zustand
- **NO existing**: OpenAI SDK, transformers, vector databases
- **For RAG**: Would need to add embedding client + lightweight vector store

### 5. Feature Organization
- **Pattern**: Optional features are modular (e.g., web-search in lib/agent/)
- **Settings Features**: Get UI tab + API route wiring
- **Example**: KnowledgeTab (git sync settings)

---

## File Locations Reference

### Core Settings
- `lib/settings.ts` - Main settings I/O
- `lib/custom-endpoints.ts` - Provider unified interface
- `app/api/settings/route.ts` - Settings API endpoint

### Provider Management
- `lib/agent/providers.ts` - Provider presets & metadata
- `lib/settings-ai-client.ts` - Client-side settings mirror

### Search
- `lib/core/search.ts` - BM25 algorithm + core search
- `lib/core/search-index.ts` - Inverted index class
- `lib/core/types.ts` - SearchResult interface
- `lib/fs.ts` - App-level search wrapper, cache management
- `app/api/search/route.ts` - Search API endpoint

### UI
- `components/settings/AiTab.tsx` - LLM provider UI
- `components/settings/` - Other setting tabs

### Configuration Files
- `~/.mindos/config.json` - User settings
- `~/.mindos/search-index.json` - Persisted search index
- `~/.mindos/sync-state.json` - Git sync state

---

## Design Patterns Worth Following

1. **Atomic Persistence**: Temp file + rename (prevents corruption)
2. **Lazy Building**: Index built on first use, not at startup
3. **Incremental Updates**: Mutations update index O(tokens) not O(all-files)
4. **Safe Type Coercion**: All parsing includes fallbacks to sensible defaults
5. **Environment Variable Override**: Settings can be overridden by env vars
6. **Auto-Migration**: Old formats detected and transparently upgraded
7. **Config Merging**: New writes merge with existing to preserve unknown fields

---

## For Adding Embedding-Based RAG

### Recommended Structure
```
lib/
├── rag/              (NEW)
│   ├── config.ts     - RAG configuration helpers
│   ├── search.ts     - Unified BM25 + semantic search interface
│   └── index.ts      - Exports
├── core/
│   ├── embedding-index.ts   (NEW) - Vector storage
│   ├── embedding-client.ts  (NEW) - Embedding API calls
│   └── ...existing...

app/api/
├── rag/              (NEW)
│   ├── rebuild/route.ts
│   ├── search/route.ts
│   └── status/route.ts

components/settings/
├── RagTab.tsx        (NEW) - UI for RAG configuration
```

### Configuration Pattern
```typescript
interface RagConfig {
  enabled: boolean;
  embeddingModel: string;       // e.g., "text-embedding-3-small"
  embeddingProvider: ProviderId; // Reuse existing provider system
  embeddingApiKey?: string;      // Optional if using env var
  indexType: 'bm25' | 'hybrid' | 'semantic';
  chunkSize: number;
  chunkOverlap: number;
}

// Add to ServerSettings in lib/settings.ts:
rag?: RagConfig;
```

### API Paths
- `POST /api/rag/rebuild` - Rebuild embedding index
- `GET /api/rag/status` - Index statistics
- `GET /api/search?q=...&type=hybrid` - Hybrid search (BM25 + semantic)
- `POST /api/settings/embedding-models` - List available models

---

## Quick Reference: How MindOS Extends

### Adding a New LLM Provider
1. Add to `ProviderId` type in `lib/agent/providers.ts`
2. Add to `PROVIDER_PRESETS` with metadata
3. Add env var mapping in `getApiKeyEnvVar()`
4. UI automatically updates (uses PROVIDER_PRESETS registry)

### Adding a New Settings Field
1. Add to `ServerSettings` interface in `lib/settings.ts`
2. Add parsing function with safe defaults
3. Add to `DEFAULTS` constant
4. Create UI tab in `components/settings/NewTab.tsx`
5. API route handles automatically (it's generic)

### Adding a New Search Feature
1. Create module in `lib/` or `lib/core/`
2. Implement similar index/query patterns
3. Add API route in `app/api/`
4. Wire into main search orchestrator

---

## Testing Notes

- Settings tests: `__tests__/api/settings.test.ts`
- Search tests: `__tests__/api/search.test.ts`
- Core search tests: `__tests__/lib/` directory
- Mock pattern: Use vitest with module mocking

---

## Environment Variables Supported

- `MIND_ROOT` - Override knowledge base location
- `MINDOS_WEB_PORT` - Web server port
- `AI_PROVIDER` - Default provider ID
- `ANTHROPIC_API_KEY` - Anthropic API key
- `OPENAI_API_KEY` - OpenAI API key
- (And similar for all supported providers)

---

## Caching & Invalidation Strategy

**Search Index Lifecycle:**
1. Lazy build on first search
2. Persisted to `~/.mindos/search-index.json`
3. TTL: 5 minutes (file watcher invalidates immediately)
4. On file change: Incremental update (not full rebuild)
5. On process exit: Flush pending updates (SIGTERM, SIGINT hooks)

**File Tree Cache:**
1. TTL: 30 seconds
2. File watcher invalidates immediately
3. Rebuilds on invalidation

---

## Critical Files for Planning RAG

1. **MUST READ**:
   - `lib/settings.ts` - Settings system
   - `lib/agent/providers.ts` - Provider model
   - `lib/core/search.ts` - BM25 implementation
   - `lib/core/search-index.ts` - Index pattern

2. **GOOD REFERENCE**:
   - `components/settings/AiTab.tsx` - How to build settings UI
   - `app/api/settings/route.ts` - API pattern
   - `__tests__/api/settings.test.ts` - Testing pattern

3. **OPTIONAL**:
   - `lib/agent/web-search.ts` - Example optional feature
   - `lib/sync-config.ts` - Persistence utilities

---

## Next Steps for Implementation

1. ✅ Understand settings system architecture
2. ✅ Understand provider model and API key resolution
3. ✅ Understand search infrastructure (BM25 + index)
4. ⏭️ Plan embedding provider integration
5. ⏭️ Design RAG configuration schema
6. ⏭️ Implement EmbeddingClient abstraction
7. ⏭️ Implement EmbeddingIndex class
8. ⏭️ Wire up settings UI (RagTab.tsx)
9. ⏭️ Add API routes for RAG operations
10. ⏭️ Implement hybrid search combining BM25 + semantic

---

**Generated**: 2026-04-10  
**Repository**: MindOS (sop_note/app)  
**Analysis Scope**: Settings system, LLM API management, search infrastructure  
**Goal**: Planning for embedding-based RAG search integration
