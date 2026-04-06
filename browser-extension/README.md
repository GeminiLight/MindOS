# MindOS Web Clipper

Save any web page to your MindOS knowledge base — one click, beautifully formatted Markdown.

## Features

- **One-click clip**: Save the current page as clean Markdown
- **Smart extraction**: Uses Mozilla Readability to extract article content (removes ads, navigation, etc.)
- **Frontmatter metadata**: Auto-generates YAML frontmatter with title, source URL, author, site, date
- **Space selector**: Choose which MindOS space (folder) to save into
- **Editable title**: Edit the page title before saving
- **Context menu**: Right-click "Save to MindOS" on any page
- **Keyboard shortcut**: `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac)
- **Dark mode**: Follows system preference
- **Local-first**: Data goes directly to your local MindOS instance — no cloud

## Setup

1. **Install the extension** — Load from `dist/` folder in Chrome
2. **Click the extension icon** — First time opens the setup view
3. **Enter your MindOS URL** — Default is `http://localhost:3456`
4. **Paste your auth token** — Find it in MindOS → Settings → MCP
5. **Click Connect** — Extension verifies the connection
6. **Done!** — Start clipping pages

## Development

```bash
# Install dependencies
npm install

# Build (production)
npm run build

# Watch mode (dev)
npm run watch

# Package as .zip for distribution
npm run package
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Architecture

```
src/
├── manifest.json          # Chrome Extension Manifest V3
├── background/
│   └── service-worker.ts  # Context menu + keyboard shortcut
├── content/
│   └── extractor.ts       # Readability page extraction (runs on page)
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Styles (MindOS brand: warm amber)
│   └── popup.ts           # Popup controller (setup → clip → save)
├── lib/
│   ├── types.ts           # Shared TypeScript types
│   ├── api.ts             # MindOS REST API client
│   ├── storage.ts         # Chrome storage wrapper
│   └── markdown.ts        # HTML → Markdown pipeline
└── icons/                 # Extension icons (16/32/48/128)
```

### Data Flow

```
Webpage → Content Script (Readability) → Popup (Turndown → Markdown)
    → POST /api/file → MindOS Knowledge Base
```

### Tech Stack

- **TypeScript** — Type-safe throughout
- **esbuild** — Fast bundling
- **Readability.js** — Article content extraction (by Mozilla)
- **Turndown** — HTML to Markdown conversion
- **Chrome Manifest V3** — Modern extension platform
