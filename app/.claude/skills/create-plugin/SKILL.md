---
name: create-plugin
description: >
  Guide for creating plugins (renderers and agent tools) in the MindOS app.
  Use this skill when the user wants to add a new renderer, visualization,
  file view, agent tool, or any extension to MindOS — including requests like
  "add a new view for X files", "create a plugin", "add an agent tool",
  "extend the app", or "build a renderer for Y". Also trigger when adding
  new interactive features tied to specific file types or patterns.
---

# MindOS Plugin Development Guide

MindOS has two plugin extension points: **Renderers** (interactive file views) and **Agent Tools** (AI capabilities). Both follow a register-and-resolve pattern — you write an isolated module, register it through the existing registry, and the core app picks it up automatically. No modifications to core files needed beyond a single import line.

## Key Principles

- **Non-invasive**: A plugin is a self-contained module. It registers itself via the existing registry API — never patch core components.
- **Match-based activation**: Renderers activate based on file path / extension matching. Agent tools activate by name when the AI decides to call them. Your plugin opts in; it doesn't force itself on the user.
- **Fail gracefully**: If your plugin throws, only your view breaks — the app falls back to the default editor. Handle errors inside your component or tool executor.
- **Project structure changes frequently**: Don't hardcode deep paths. Use the registry APIs and `@/` alias imports. The patterns described here are stable contracts; specific directories may move.

---

## Extension Point 1: Renderer Plugin

A renderer provides a custom interactive view for files matching a pattern.

### The Contract

```typescript
// from lib/renderers/registry.ts — this is the stable interface

interface RendererContext {
  filePath: string;      // e.g. "Projects/Roadmap.csv"
  content: string;       // raw file content
  extension: string;     // e.g. "csv"
  saveAction: (content: string) => Promise<void>;  // write back to file
}

interface RendererDefinition {
  id: string;            // unique slug, e.g. "my-kanban"
  name: string;          // display name in UI
  description: string;   // shown in renderer picker
  author: string;
  icon: string;          // emoji
  tags: string[];
  builtin: boolean;      // false for plugins
  match: (ctx: { filePath: string; extension: string }) => boolean;
  component: ComponentType<RendererContext>;
}
```

### Steps to Create a Renderer

**1. Write the component**

Create a React component that accepts `RendererContext` as props. Put it wherever components live (currently `components/renderers/` — but don't rely on that path being permanent; just put it next to existing renderers).

```tsx
// Example: MarkmapRenderer.tsx
'use client';
import { RendererContext } from '@/lib/renderers/registry';

export function MarkmapRenderer({ content, filePath, saveAction }: RendererContext) {
  // Parse content, render your custom view
  // Use saveAction() to write changes back to file
  return <div>/* your interactive UI */</div>;
}
```

Guidelines:
- Mark `'use client'` — renderers run in the browser.
- `content` is the raw file text. You parse it yourself.
- Call `saveAction(newContent)` to persist edits. The host handles file I/O.
- Keep dependencies minimal. If you need a heavy lib (e.g. D3, markmap), dynamic-import it to avoid bloating the initial bundle.

**2. Register it**

Add a `registerRenderer()` call in the file where built-in renderers are registered (look for the file that imports `registerRenderer` from the registry and calls it multiple times — that's the registration entry point).

```typescript
import { MarkmapRenderer } from '@/components/renderers/MarkmapRenderer';

registerRenderer({
  id: 'markmap',
  name: 'Mind Map',
  description: 'Renders markdown files as an interactive mind map.',
  author: 'You',
  icon: '🧠',
  tags: ['mindmap', 'visualization', 'markdown'],
  builtin: false,      // <-- false for non-core plugins
  match: ({ filePath }) => /\b(mindmap|MindMap|MINDMAP)\b.*\.md$/i.test(filePath),
  component: MarkmapRenderer,
});
```

That's it. The registry handles resolution, enable/disable toggle, and fallback.

### Match Function Tips

- Be specific. A match on `extension === 'md'` will hijack all markdown files.
- Use filename patterns: `/\bKEYWORD\b.*\.ext$/i`.
- Check both `filePath` and `extension` when needed.
- Registration order matters — first match wins. Place specialized renderers before generic ones.

---

## Extension Point 2: Agent Tool

An agent tool gives the AI new capabilities (e.g. calling external APIs, running computations, accessing new data sources).

### The Contract

Agent tools use the Vercel AI SDK `tool()` helper with a Zod input schema:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: 'What this tool does — the AI reads this to decide when to call it.',
  inputSchema: z.object({
    param: z.string().describe('What this param means'),
  }),
  execute: async ({ param }) => {
    // Do work, return a string result for the AI to interpret
    return 'result string';
  },
});
```

### Steps to Create an Agent Tool

**1. Write the tool**

Create a module that exports one or more `tool()` definitions. Place it next to existing agent modules (currently `lib/agent/` — follow the same pattern).

```typescript
// Example: lib/agent/web-tools.ts
import { tool } from 'ai';
import { z } from 'zod';

export const webTools = {
  fetch_url: tool({
    description: 'Fetch a URL and return its text content. Use when the user asks to read a web page.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
    }),
    execute: async ({ url }) => {
      const res = await fetch(url);
      const text = await res.text();
      return text.slice(0, 10_000); // truncate to avoid token overflow
    },
  }),
};
```

Guidelines:
- Always return a string — the AI reads the result as context.
- Truncate large outputs. The existing pattern uses a `truncate()` helper.
- Throw errors for truly exceptional cases; return error strings for expected failures (so the AI can explain to the user).
- Use `assertWritable()` if your tool writes to the knowledge base (prevents modifying protected files).

**2. Register it**

Merge your tools into the `knowledgeBaseTools` object or spread them alongside it in the route that calls `streamText()`. The current pattern:

```typescript
// In the agent barrel export (lib/agent/index.ts), re-export your new tools
export { webTools } from './web-tools';

// In the route that creates the AI stream, spread them in:
import { knowledgeBaseTools, webTools } from '@/lib/agent';

streamText({
  tools: { ...knowledgeBaseTools, ...webTools },
  // ...
});
```

### Tool Design Tips

- **Description is critical**: The AI decides whether to call your tool based solely on the `description` string. Be specific and include usage scenarios.
- **Idempotent reads, safe writes**: Read tools can be liberal; write tools should validate inputs and use `assertWritable()`.
- **One tool, one job**: Prefer multiple focused tools over a Swiss-army-knife tool with a `mode` parameter.

---

## Checklist

Before shipping a plugin:

- [ ] Plugin is a self-contained module — no changes to core components
- [ ] Registration is a single import + call (renderer) or spread (tool)
- [ ] Has proper error handling (doesn't crash the app on bad input)
- [ ] `match` function is specific enough to not hijack unrelated files
- [ ] Tool descriptions are clear enough for the AI to use correctly
- [ ] Large dependencies are dynamically imported
- [ ] Tested with representative files / prompts
