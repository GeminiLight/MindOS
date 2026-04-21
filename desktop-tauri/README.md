# MindOS Desktop (Tauri Spike)

A minimal Tauri-based desktop application spike for MindOS, designed to evaluate the feasibility of migrating from Electron to Tauri.

## Features

### Phase 1: Basic Window (✅ Completed)
- Main window with webview
- System tray integration
- Minimize to tray (close button hides window)
- Tray menu (Show/Hide, Quit)
- Connects to localhost:3456 runtime

### Phase 2: Runtime Management (✅ Completed)
- Configuration management (~/.mindos/config.json)
- Runtime health checking
- Auto-start runtime on app launch
- Runtime status in tray menu
- Graceful shutdown

### Phase 3: Advanced Features (🔄 Partial)
- Deep link support (mindos://) ✅
- Auto-update (future)
- Multi-window management (future)
- Global shortcuts (future)

## Quick Start

### Prerequisites

1. **Rust** (required for Tauri)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Node.js** 18+ (for frontend build)

3. **System dependencies** (see [SETUP.md](./SETUP.md) for details)

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Build

```bash
# Build for production
npm run tauri build
```

## Architecture

```
┌─────────────────────────────────────┐
│  Tauri Window (System WebView)     │
│  ┌───────────────────────────────┐ │
│  │  Frontend (localhost:3456)    │ │
│  │  - React UI                   │ │
│  │  - Tauri API calls            │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
           │ Tauri Commands
           ▼
┌─────────────────────────────────────┐
│  Rust Backend                       │
│  - Window management                │
│  - System tray                      │
│  - Runtime lifecycle                │
│  - Config management                │
└─────────────────────────────────────┘
           │ Sidecar / HTTP
           ▼
┌─────────────────────────────────────┐
│  MindOS Runtime (Node.js)           │
│  - HTTP server (port 3456)          │
│  - File system operations           │
│  - MCP integration                  │
└─────────────────────────────────────┘
```

## Configuration

Config file: `~/.mindos/config.json`

```json
{
  "port": 3456,
  "auto_start": true,
  "window": {
    "width": 1200,
    "height": 800,
    "x": null,
    "y": null
  },
  "tray": {
    "enabled": true,
    "minimize_to_tray": true
  }
}
```

## Tauri Commands

Frontend can call these commands via `invoke()`:

```typescript
import { invoke } from '@tauri-apps/api/core';

// Get runtime health
const health = await invoke('get_runtime_health');

// Start runtime
await invoke('start_runtime_command');

// Stop runtime
await invoke('stop_runtime_command');

// Get config
const config = await invoke('get_config');

// Save config
await invoke('set_config', { config: newConfig });
```

## Comparison: Tauri vs Electron

| Feature | Tauri | Electron (current) |
|---------|-------|-------------------|
| Package size | ~50MB | ~170MB |
| Memory usage | ~100MB | ~300MB |
| Startup time | ~1s | ~3s |
| Technology | Rust + WebView | Chromium + Node |
| Security | Sandboxed | Less restricted |
| Platform support | macOS, Windows, Linux | macOS, Windows, Linux |

## Known Limitations

1. **Rust required**: Developers need Rust toolchain installed
2. **WebView differences**: System WebView may have platform-specific quirks
3. **No Node.js in renderer**: Unlike Electron, renderer process cannot directly access Node.js APIs
4. **Sidecar complexity**: Runtime management is more complex than Electron's integrated Node.js

## Next Steps

After completing this spike, evaluate:

1. **Feasibility**: Does Tauri meet MindOS's core requirements?
2. **Performance**: Are package size and startup time improvements significant?
3. **Migration cost**: Is the effort justified by the benefits?

Based on the evaluation, decide:
- **Continue**: Implement Phase 3 and gradually migrate
- **Pause**: Keep spike as reference, continue with Electron
- **Abandon**: Focus on optimizing Electron version

## Documentation

- [SETUP.md](./SETUP.md) - Environment setup guide
- [Spec](../wiki/specs/spec-desktop-tauri-spike.md) - Full specification
- [Tauri Docs](https://tauri.app/v2/) - Official Tauri documentation

## License

Same as MindOS main project.

## Deep Link Usage

MindOS Desktop registers the `mindos://` protocol. You can use it to open files directly:

```bash
# Open a specific file
open "mindos://open/notes/test.md"

# Open with query parameters
open "mindos://open/notes/test.md?line=10"

# Just open the app
open "mindos://"
```

From HTML:
```html
<a href="mindos://open/notes/test.md">Open in MindOS</a>
```

The app will:
1. Launch or focus if already running
2. Parse the URL and extract the path
3. Navigate to the specified file in the runtime
