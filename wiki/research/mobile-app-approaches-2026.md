# Cross-Platform Mobile App Approaches for MindOS (2025-2026)

> Research report comparing mobile development approaches for a local-first knowledge base with Next.js 16 + React 19 + Tailwind 4 + shadcn/ui stack.

## Executive Summary

| Approach | Code Reuse | Native Capability | Performance | Time to MVP | Recommendation |
|----------|------------|-------------------|-------------|-------------|----------------|
| **Capacitor** | 85-95% | Medium | Medium | Fastest | **Best for MVP** |
| **React Native + Expo** | 30-50% | High | High | Medium | Best for long-term native feel |
| **Tauri Mobile** | 70-85% | High | High | Medium | Best if already using Tauri Desktop |
| **PWA Enhancement** | 100% | Low | Medium | Instant | Not viable (iOS limitations) |
| **Expo + RN Web Unified** | 60-70% | High | High | Longest | Best for new projects |

**Recommended Path for MindOS**: Start with **Capacitor** for rapid MVP, evaluate user feedback, then consider **React Native + Expo** rewrite for native-feeling features if demand justifies investment.

---

## Approach 1: Capacitor (Ionic)

### Overview
Capacitor wraps web applications in native WebView containers, providing access to native device APIs through JavaScript bridges.

### How Well Does It Wrap Next.js Apps?

**Critical Limitation**: Capacitor requires **static exports only** - no SSR support.

```javascript
// next.config.js - REQUIRED for Capacitor
const nextConfig = {
  output: 'export',  // Must be static
  images: {
    unoptimized: true,  // No server-side image optimization
  },
}
```

**What Works:**
- SSG (Static Site Generation) pages
- Client-side data fetching (SWR, React Query)
- React components, hooks, context
- Tailwind CSS, shadcn/ui components
- TipTap editor (runs in WebView)
- React Flow graphs (runs in WebView)

**What Doesn't Work:**
- Server-Side Rendering (SSR)
- API Routes (`/api/*`)
- Server Actions
- Middleware
- Dynamic routes like `/items/[itemId]` (need workarounds)

**Real-World Case Study: Podwise**
- Successfully deployed Next.js + Capacitor app
- Key learnings: "Not an ideal stack... you may encounter many unknown problems"
- Required maintaining dual codebase (web with SSR, mobile with CSR)
- Implemented custom Link component wrapper for URL consistency

### File System Access

**@capacitor/filesystem** plugin provides full access:
- Read/write files to app sandbox
- Access to Documents, Cache, Library directories
- External storage access on Android
- Content URI support for user-selected files

```typescript
import { Filesystem, Directory } from '@capacitor/filesystem';

// Read a markdown file
const contents = await Filesystem.readFile({
  path: 'notes/my-note.md',
  directory: Directory.Documents,
  encoding: Encoding.UTF8
});

// Write a file
await Filesystem.writeFile({
  path: 'notes/new-note.md',
  data: '# My Note\n\nContent here...',
  directory: Directory.Documents,
  encoding: Encoding.UTF8
});
```

**Limitations:**
- iOS sandbox restrictions (no access to arbitrary paths)
- Android requires storage permissions declaration
- No Git integration (would need custom native plugin or JS library)

### Native API Support

| Feature | Support | Plugin |
|---------|---------|--------|
| File System | ✅ Full | @capacitor/filesystem |
| Push Notifications | ✅ Full | @capacitor/push-notifications |
| Camera | ✅ Full | @capacitor/camera |
| Geolocation | ✅ Full | @capacitor/geolocation |
| Haptics | ✅ Full | @capacitor/haptics |
| Share | ✅ Full | @capacitor/share |
| Biometrics | ✅ Full | @capacitor/biometrics |
| SQLite | ✅ Full | @capacitor-community/sqlite |
| Background Tasks | ⚠️ Limited | @capacitor/background-runner |
| Bluetooth | ⚠️ Community | @capacitor-community/bluetooth-le |

### Performance for Rich Content

**TipTap Editor**: ✅ Works well - runs in WebView as designed
**React Flow Graphs**: ✅ Works - may need optimization for large graphs (>500 nodes)
**File Tree Navigation**: ✅ Works - virtualized lists recommended for 1000+ files

**Known Issues:**
- Android WebView historically slower than iOS WKWebView
- Complex animations may drop frames on older Android devices
- Memory pressure on large documents (>100KB markdown)

### Community & Maintenance Status (2025-2026)

- **Maintainer**: Ionic team (backed by commercial company)
- **Latest Version**: Capacitor 6.x (as of 2025)
- **npm Downloads**: ~300K/week
- **GitHub Activity**: Active, regular releases
- **Documentation**: Comprehensive, well-maintained
- **Plugin Ecosystem**: 50+ official plugins, 100+ community plugins

### Verdict for MindOS

| Criteria | Score | Notes |
|----------|-------|-------|
| Code Reuse % | 85-95% | Highest of all approaches |
| Native Capability | 6/10 | Good but WebView-limited |
| Performance | 6/10 | Acceptable, not native-level |
| Dev Experience | 8/10 | Familiar web tooling |
| Maintenance Burden | Low | Single codebase, mostly |
| Time to MVP | **Fastest** | 2-4 weeks |
| App Store Distribution | ✅ Yes | Standard native app submission |
| Bundle Size | 15-30 MB | WebView overhead |
| Offline Support | ✅ Yes | Service worker + native storage |

---

## Approach 2: React Native + Expo

### Overview
Build truly native UI with React paradigms. Requires rewriting components but can share business logic.

### Code Sharing Strategy with Existing React Web Components

**Reality Check**: React Native uses different primitives (`View`, `Text`, `Pressable`) than web (`div`, `span`, `button`). **Direct component reuse is not possible.**

**What CAN Be Shared (30-50%):**
- Business logic (utilities, hooks, state management)
- API clients and data fetching logic
- TypeScript types and interfaces
- Validation schemas (Zod, Yup)
- Constants and configuration

**What CANNOT Be Shared:**
- React components (different primitives)
- CSS/Tailwind (need NativeWind or StyleSheet)
- DOM-dependent libraries (TipTap, CodeMirror, React Flow)

### Solito / Tamagui Approach

**Solito 5** (October 2025) enables unified navigation:
- Web-first design - no longer requires react-native-web
- Unified `<Link>` component works on both platforms
- `.native.tsx` files for platform-specific code
- Supports Next.js 16 and Expo SDK 54

```typescript
// Shared navigation works on both platforms
import { Link } from 'solito/link'

<Link href="/product/123">View Product</Link>
```

**Tamagui** enables cross-platform styling:
- Compile-time optimized styles
- Works with React Native and Web
- Tailwind-like utility classes
- ~60-70% component code sharing possible

### Expo Router vs Next.js Routing

| Feature | Expo Router v4 | Next.js 16 App Router |
|---------|----------------|----------------------|
| File-based routing | ✅ | ✅ |
| Dynamic routes | ✅ `[id].tsx` | ✅ `[id]/page.tsx` |
| Nested layouts | ✅ `_layout.tsx` | ✅ `layout.tsx` |
| Route groups | ✅ `(group)` | ✅ `(group)` |
| Type-safe navigation | ✅ | ✅ |
| Deep linking | ✅ Auto-configured | Manual setup |
| Server components | ❌ | ✅ |

**Key Difference**: Very similar patterns! Teams familiar with Next.js App Router will adapt quickly to Expo Router.

### File System Access

**expo-file-system** provides comprehensive access:

```typescript
import * as FileSystem from 'expo-file-system';

// Read a file
const content = await FileSystem.readAsStringAsync(
  FileSystem.documentDirectory + 'notes/my-note.md'
);

// Write a file
await FileSystem.writeAsStringAsync(
  FileSystem.documentDirectory + 'notes/new-note.md',
  '# New Note\n\nContent...'
);

// List directory
const files = await FileSystem.readDirectoryAsync(
  FileSystem.documentDirectory + 'notes/'
);

// Download a file
await FileSystem.downloadAsync(
  'https://example.com/file.md',
  FileSystem.documentDirectory + 'downloads/file.md'
);
```

**Capabilities:**
- Full app sandbox read/write
- External storage access (Android)
- iCloud/Google Drive integration possible
- SAF (Storage Access Framework) for user-selected folders

### Can TipTap/CodeMirror Work in React Native?

**TipTap**: Not directly. Use **TenTap (10tap-editor)** instead.

TenTap is a React Native wrapper around TipTap/ProseMirror:
- Uses WebView internally for the editor
- Bridges to React Native via `useEditorBridge` hook
- Supports mentions, collaboration, comments
- Customizable toolbars
- Dark mode support

```typescript
import { RichText, useEditorBridge } from '@10play/tentap-editor';

const editor = useEditorBridge({
  autofocus: true,
  avoidIosKeyboard: true,
  initialContent: '# Welcome\n\nStart writing...',
});

return <RichText editor={editor} />;
```

**CodeMirror**: Not directly. Options:
1. **WebView wrapper** (like TenTap approach)
2. **react-native-code-editor** (Monaco-based, WebView)
3. Custom syntax highlighting with TextInput

**React Flow**: Not directly. Options:
1. **WebView wrapper** with message passing
2. **react-native-graph** (different API, simpler)
3. Custom canvas-based implementation with `react-native-skia`

### Performance Characteristics

**Expo SDK 52+ with New Architecture:**
- JSI (JavaScript Interface) - synchronous native calls
- Fabric renderer - concurrent rendering
- TurboModules - lazy-loaded native modules
- Hermes engine - bytecode precompilation

| Benchmark | React Native (New Arch) | Capacitor WebView |
|-----------|-------------------------|-------------------|
| Startup Time | ~300-500ms | ~500-800ms |
| List Scrolling (1000 items) | 60 fps | 40-50 fps |
| Touch Response | <16ms | 16-32ms |
| Memory (idle) | ~80-120 MB | ~150-200 MB |

### Community & Ecosystem Maturity

- **Expo SDK 52/53**: Production-ready, used by major apps
- **npm Downloads**: 3M+/week (react-native)
- **GitHub Stars**: 120K+ (react-native)
- **Commercial Apps**: Discord, Shopify, Coinbase, Instagram
- **EAS Build**: Cloud builds for iOS/Android without local setup
- **Over-the-air Updates**: Push JS changes without App Store review

### Verdict for MindOS

| Criteria | Score | Notes |
|----------|-------|-------|
| Code Reuse % | 30-50% | Business logic only |
| Native Capability | 9/10 | Full native access |
| Performance | 9/10 | Near-native with New Architecture |
| Dev Experience | 7/10 | Learning curve for RN |
| Maintenance Burden | High | Two UI codebases |
| Time to MVP | 3-4 months | Significant rewrite |
| App Store Distribution | ✅ Yes | Standard submission |
| Bundle Size | 15-25 MB | No WebView overhead |
| Offline Support | ✅ Yes | SQLite + file system |

---

## Approach 3: Tauri Mobile (v2)

### Overview
Tauri 2.0 (October 2024) brought mobile support, using system WebViews and Rust backend.

### Mobile Support Status (iOS/Android)

**Officially Supported** since Tauri 2.0 stable release:
- iOS: Uses WKWebView (WebKit)
- Android: Uses Android System WebView (Chromium-based)
- Backend: Rust compiles to native ARM/x86 code

**Maturity Assessment:**
- ✅ Functional for production apps
- ⚠️ Less mature than desktop (fewer production apps)
- ⚠️ Not all plugins support mobile yet
- ⚠️ GitHub Actions mobile builds "in progress"
- ⚠️ Developer experience "actively improving"

### Can It Wrap a Next.js Frontend?

**Yes**, with the same limitations as Capacitor:
- Must use static export (`output: 'export'`)
- No SSR support
- No API routes

```toml
# tauri.conf.json equivalent - point to Next.js output
[build]
distDir = "../out"
```

### File System Access

**@tauri-apps/plugin-fs** provides system-level access:

```typescript
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs';

// Read file
const content = await readTextFile('documents/notes/my-note.md');

// Write file
await writeTextFile('documents/notes/new-note.md', '# New Note');

// List directory
const entries = await readDir('documents/notes');
```

**Security Model:**
- Capability-based permissions in `tauri.conf.json`
- Must explicitly declare file system access scope
- Symlink resolution and path validation

### Bundle Size vs Electron

| App Type | Tauri 2.x | Electron 34.x | Difference |
|----------|-----------|---------------|------------|
| Hello World | 3.2 MB | 85 MB | 96% smaller |
| Complex App | 8.6 MB | 244 MB | 96% smaller |
| Typical Range | 5-15 MB | 120-250 MB | ~25x smaller |

**Why So Much Smaller?**
- No bundled Chromium (uses system WebView)
- Rust compiles to small native binary
- No Node.js runtime

### Rust Requirement - Learning Curve

**Reality:**
- Frontend: 100% JavaScript/TypeScript (React, Vue, etc.)
- Backend: Mostly optional - JavaScript API handles common cases
- Many production apps ship with minimal custom Rust

**When Rust IS Needed:**
- Custom native plugins
- Performance-critical processing
- System-level operations not covered by plugins
- Custom security requirements

**Learning Curve:**
- Basic proficiency: 2-4 weeks
- Production-ready: 2-3 months
- Expert: 6+ months

### Verdict for MindOS

| Criteria | Score | Notes |
|----------|-------|-------|
| Code Reuse % | 70-85% | Same as Capacitor |
| Native Capability | 8/10 | Excellent plugin system |
| Performance | 8/10 | System WebView + Rust |
| Dev Experience | 6/10 | Rust learning curve |
| Maintenance Burden | Medium | Rust backend if needed |
| Time to MVP | 2-3 months | Depends on Rust familiarity |
| App Store Distribution | ✅ Yes | Standard submission |
| Bundle Size | **5-15 MB** | Smallest option |
| Offline Support | ✅ Yes | Full file system access |

**Key Advantage**: If MindOS already uses Tauri for Desktop, mobile becomes nearly free.

---

## Approach 4: PWA Enhancement

### What's Still Missing in PWA on iOS in 2026?

**Critical Blockers for MindOS:**

| Feature | iOS Status | Impact on MindOS |
|---------|------------|------------------|
| File System Access API | ❌ Not supported | **BLOCKING** - Can't read/write local Markdown files |
| Background Sync | ❌ Not supported | Can't sync files when app closed |
| Push Notifications | ⚠️ Partial (iOS 16.4+) | Requires manual "Add to Home Screen" |
| Storage Quota | ⚠️ 50MB limit | **BLOCKING** - Knowledge base may exceed this |
| 7-Day Cache Expiry | ⚠️ Active | Data deleted if app not opened for 7 days |
| EU Support | ❌ Broken (iOS 17.4+) | No standalone mode in EU |

### File System Access API Support

**NOT SUPPORTED on iOS** - This is a **complete blocker** for MindOS.

```javascript
// This API does NOT work on iOS Safari
const dirHandle = await window.showDirectoryPicker(); // ❌ Fails
```

**What Works:**
- Basic file input picker (read-only, user-selected)
- Web Share API (send files to other apps)

### Push Notifications Status

**Partially Working** (iOS 16.4+, non-EU):
- User must manually add PWA to home screen first
- No automatic install prompts
- Completely broken in EU countries (iOS 17.4+)

### Background Processing

**NOT SUPPORTED:**
- ❌ Background Sync API
- ❌ Periodic Background Sync
- ❌ Background Fetch

**Impact**: Cannot sync files or run AI agent loops when app is backgrounded.

### App Store Distribution

**PWABuilder** can package PWAs for stores, but:
- Still runs in WebView
- Still subject to iOS PWA limitations
- Apple may reject apps that are "just websites"

### Verdict for MindOS

| Criteria | Score | Notes |
|----------|-------|-------|
| Code Reuse % | 100% | No changes needed |
| Native Capability | 2/10 | **BLOCKING limitations** |
| Performance | 6/10 | WebView-level |
| Dev Experience | 10/10 | Zero additional work |
| Maintenance Burden | None | Same codebase |
| Time to MVP | Instant | Already have PWA |
| App Store Distribution | ⚠️ Limited | May be rejected |
| Bundle Size | 0 | Browser-based |
| Offline Support | ⚠️ Limited | 50MB limit, 7-day expiry |

**Conclusion**: **NOT VIABLE** for MindOS due to File System Access API unavailability.

---

## Approach 5: Expo + React Native Web (Unified Codebase)

### Overview
Use React Native as the primary UI framework, with web as a compilation target.

### Architecture

```
monorepo/
├── apps/
│   ├── mobile/          # Expo (iOS/Android)
│   └── web/             # Next.js with react-native-web
├── packages/
│   └── ui/              # Shared RN components
└── turbo.json
```

### Requires Rewriting Components

**Full rewrite of 189 TSX components** would be needed:
- Replace `div` → `View`
- Replace `span` → `Text`
- Replace `button` → `Pressable`
- Replace Tailwind classes → NativeWind classes
- Replace TipTap → TenTap
- Replace React Flow → Custom graph solution

### NativeWind (Tailwind for RN)

NativeWind v4 brings Tailwind to React Native:

```typescript
// Same className syntax works!
<View className="flex-1 justify-center items-center bg-white">
  <Text className="text-xl font-bold text-gray-900">Hello</Text>
  <Pressable className="px-4 py-2 bg-amber-500 rounded-lg">
    <Text className="text-white font-semibold">Click Me</Text>
  </Pressable>
</View>
```

**Compatibility:**
- Most Tailwind classes work
- Some web-specific classes don't apply (e.g., `cursor-pointer`)
- Requires babel/metro configuration

### Expo Router for All Platforms

Expo Router v4 supports web target:

```typescript
// app/_layout.tsx - works on iOS, Android, AND web
import { Stack } from 'expo-router';

export default function Layout() {
  return <Stack />;
}
```

### Verdict for MindOS

| Criteria | Score | Notes |
|----------|-------|-------|
| Code Reuse % | 60-70% | After rewrite |
| Native Capability | 9/10 | Full Expo access |
| Performance | 9/10 | Native on mobile, web on web |
| Dev Experience | 7/10 | RN learning curve |
| Maintenance Burden | Medium | One codebase, RN-first |
| Time to MVP | **4-6 months** | Full rewrite |
| App Store Distribution | ✅ Yes | Standard submission |
| Bundle Size | 15-25 MB | Native apps |
| Offline Support | ✅ Yes | Full capabilities |

**Best For**: New projects starting from scratch, not existing Next.js apps.

---

## Detailed Comparison Matrix

### Code Reuse %

| Approach | Reuse % | What's Reusable |
|----------|---------|-----------------|
| Capacitor | 85-95% | Almost everything except SSR |
| React Native + Expo | 30-50% | Business logic, types, API clients |
| Tauri Mobile | 70-85% | Frontend code (same as Capacitor) |
| PWA Enhancement | 100% | Everything |
| Expo + RN Web Unified | 60-70% | After rewrite to RN components |

### Native Capability

| Feature | Capacitor | RN + Expo | Tauri | PWA | Expo Unified |
|---------|-----------|-----------|-------|-----|--------------|
| File System | ✅ | ✅ | ✅ | ❌ | ✅ |
| Background Tasks | ⚠️ | ✅ | ✅ | ❌ | ✅ |
| Push Notifications | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Local AI Agent | ✅ | ✅ | ✅ | ❌ | ✅ |
| MCP Server | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Git Integration | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ |

### Performance

| Aspect | Capacitor | RN + Expo | Tauri | PWA | Expo Unified |
|--------|-----------|-----------|-------|-----|--------------|
| Startup Time | ~500-800ms | ~300-500ms | ~400-600ms | ~200ms | ~300-500ms |
| UI Responsiveness | WebView | Native | WebView | WebView | Native |
| Large File Lists | ⚠️ | ✅ | ⚠️ | ⚠️ | ✅ |
| Rich Text Editing | ✅ | ⚠️ WebView | ✅ | ✅ | ⚠️ WebView |
| Graph Rendering | ✅ | ⚠️ Custom | ✅ | ✅ | ⚠️ Custom |

### Time to MVP

| Approach | Time | Key Factors |
|----------|------|-------------|
| PWA | 0 | Already done (but not viable) |
| Capacitor | 2-4 weeks | Static export + native config |
| Tauri Mobile | 2-3 months | Rust learning curve |
| RN + Expo | 3-4 months | Partial rewrite |
| Expo Unified | 4-6 months | Full rewrite |

### Bundle Size

| Approach | iOS | Android | Notes |
|----------|-----|---------|-------|
| Capacitor | 15-30 MB | 15-40 MB | WebView overhead |
| RN + Expo | 15-25 MB | 20-35 MB | Native + JS bundle |
| Tauri Mobile | 5-15 MB | 8-20 MB | Smallest |
| PWA | 0 | 0 | Browser-based |
| Expo Unified | 15-25 MB | 20-35 MB | Same as RN |

---

## Specific Considerations for MindOS Features

### TipTap Rich Text Editor

| Approach | Solution | Effort |
|----------|----------|--------|
| Capacitor | Use as-is | Zero |
| React Native | TenTap (WebView-based) | Low - component swap |
| Tauri | Use as-is | Zero |
| Expo Unified | TenTap | Low |

### React Flow Graph Visualization

| Approach | Solution | Effort |
|----------|----------|--------|
| Capacitor | Use as-is | Zero |
| React Native | WebView wrapper or react-native-graph | Medium |
| Tauri | Use as-is | Zero |
| Expo Unified | WebView wrapper or custom | Medium |

### File Tree Navigation

| Approach | Solution | Effort |
|----------|----------|--------|
| Capacitor | Use as-is + Filesystem plugin | Low |
| React Native | Rewrite with FlatList/FlashList | Medium |
| Tauri | Use as-is + fs plugin | Low |
| Expo Unified | Rewrite with FlatList/FlashList | Medium |

### pi-agent-core AI Agent Loops

All approaches can run pi-agent-core since it's JavaScript-based:
- Runs in WebView (Capacitor, Tauri)
- Runs in Hermes/JSC (React Native)

**Key Concern**: Background execution when app is suspended
- Capacitor: Limited via background-runner plugin
- React Native: expo-task-manager provides background tasks
- Tauri: Rust backend can continue processing

### MCP Server Connections

HTTP-based MCP connections work in all approaches. For stdio-based MCP:
- Capacitor: Need custom plugin or proxy server
- React Native: Need native module or proxy server
- Tauri: Rust backend can handle stdio directly

---

## Recommended Path for MindOS

### Phase 1: Capacitor MVP (2-4 weeks)

**Why Start Here:**
1. Fastest path to App Store presence
2. 85-95% code reuse
3. TipTap and React Flow work without changes
4. Validates mobile demand before larger investment

**Steps:**
1. Create static export configuration
2. Set up Capacitor project
3. Implement file system access with @capacitor/filesystem
4. Configure push notifications
5. Test on iOS and Android devices
6. Submit to App Stores

**Limitations to Accept:**
- No SSR (acceptable for mobile)
- WebView performance (acceptable for MVP)
- Some features may feel "web-like"

### Phase 2: Evaluate & Decide (1-2 months post-launch)

**Metrics to Track:**
- User adoption and retention
- Performance complaints
- Feature requests requiring native capabilities
- App Store reviews mentioning performance

**Decision Points:**
- If users are happy → Continue with Capacitor
- If performance issues → Consider Tauri (smaller bundle) or RN rewrite
- If native features needed → Consider RN + Expo rewrite

### Phase 3: Native Rewrite (If Justified)

**When to Consider React Native + Expo:**
- >10,000 active mobile users
- Significant performance complaints
- Need for native-feeling features (gestures, animations)
- Mobile-first features not possible in WebView

**Approach:**
1. Keep Capacitor app live during development
2. Rewrite incrementally starting with highest-traffic screens
3. Use TenTap for rich text editing
4. Build custom graph component or WebView wrapper
5. Migrate users gradually

---

## Success Stories & Precedents

### Similar Apps That Used Capacitor
- **Podwise**: Next.js + Capacitor for podcast knowledge management
- Various internal tools and B2B applications

### Similar Apps That Used React Native
- **Notion Mobile**: Native rewrite from web (complex, well-funded)
- **Obsidian Mobile**: Custom native implementation

### Local-First Knowledge Base Examples
- **Lokus**: React + Rust (Tauri-like) - "local-first that outpaces Notion"
- **React Native Notion Clone**: Expo + Prisma local-first demo

---

## Conclusion

For MindOS with its existing Next.js stack and 189 TSX components:

1. **Start with Capacitor** - Lowest risk, fastest delivery, validates market
2. **Skip PWA** - iOS limitations make it non-viable
3. **Consider Tauri** if you want smallest bundle and already use it for Desktop
4. **Plan for React Native** as a potential future investment if mobile becomes critical
5. **Avoid Expo Unified rewrite** unless starting a new project

The mobile market will give you the data needed to make the right long-term investment decision.
