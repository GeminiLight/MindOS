# Mobile Framework Research: Knowledge Base / Note-Taking Apps

Research conducted: April 2026  
Sources: Engineering blogs, GitHub repositories, official documentation, tech interviews

---

## Summary Table

| App | Mobile Framework | Confidence | Why They Chose It | Performance Notes | Migration History |
|-----|------------------|------------|-------------------|-------------------|-------------------|
| **Notion** | Native (Swift + Kotlin) | ✅ High | Performance, 10M+ users with 11 engineers | Editor still web-based (hybrid) | Cordova → Native (2019+) |
| **Obsidian** | Capacitor | ✅ High | Code sharing with Electron desktop | Very positive; near-desktop parity | N/A |
| **Logseq** | Capacitor + ClojureScript | ✅ High | Code sharing with web/desktop | Decent | N/A |
| **Craft** | Native (Swift/SwiftUI) | ✅ High | Sub-50ms latency, Apple Design Award | Excellent; praised for native feel | N/A |
| **Bear** | Native (Swift) | ✅ High | Apple-only, premium experience | Excellent; Apple Design Award | N/A |
| **Anytype** | Native (Swift + Kotlin) | ✅ High | Performance, E2E encryption | Good | N/A |
| **AFFiNE** | Capacitor | ✅ High | 90%+ code sharing with web | Under development | N/A |
| **AppFlowy** | Flutter | ✅ High | Open-source, single codebase | Good | N/A |
| **Joplin** | React Native | ✅ High | Cross-platform FOSS | 2.5-3s cold start (Android) | N/A |
| **Capacities** | Unknown (likely web/Capacitor) | ⚠️ Medium | Not publicly disclosed | Under development | N/A |
| **Heptabase** | Unknown (likely Capacitor/web) | ⚠️ Low | Not publicly disclosed | Mobile in beta | N/A |
| **Raycast** | Native (Swift) | ✅ High | iOS-only, deep system integration | Excellent; iOS widgets, shortcuts | N/A |
| **Linear** | Native (Swift + Kotlin) | ✅ High | "Fast and fluid UX" | Excellent | N/A |
| **Figma** | WebAssembly + C++ (web app) | ✅ High | Complex rendering, code sharing | Good; C++ for hot paths | Skew → TypeScript (2024) |
| **Slack** | Native (Swift + Kotlin) | ✅ High | Best-of-breed per platform | Good; 100% Swift migration | Objective-C → Swift |
| **Discord** | React Native | ✅ High | Faster updates, code sharing | Good after migration | Native Android → RN (2022) |

---

## Detailed Analysis by App

### 1. Notion

**Framework**: Native (Swift for iOS, Kotlin for Android)  
**Source**: [Pragmatic Engineer Newsletter - "Notion going native"](https://newsletter.pragmaticengineer.com/p/notion-going-native-on-ios-and-android) (Dec 2024)

**Key Facts**:
- **Original**: Webviews + Cordova
- **Current**: Fully native (Swift + Kotlin) since 2019
- **Team**: Only 11 mobile engineers serving 10M+ users
- **Hybrid exception**: The editor remains web-based (most complex component)
- **Supporting tech**: SQLite, Combine (iOS), Compose (Android)
- **Build tools**: Bazel, Buck

**Why Native**: The team explicitly evaluated React Native and rejected it. They wanted native language features and APIs for best performance.

**Performance**: Good overall, but mobile app historically had complaints about speed (hence the native rewrite)

---

### 2. Obsidian

**Framework**: Capacitor  
**Source**: [Obsidian Forum - "What technology obsidian mobile is developed with?"](https://forum.obsidian.md/t/what-technology-obsidian-mobile-is-developed-with/40125)

**Key Facts**:
- Desktop uses Electron; mobile uses **Capacitor**
- Same core codebase for web/desktop/mobile
- Almost identical functionality to desktop

**Why Capacitor**: Maximum code reuse with Electron desktop. Most features work identically across platforms.

**Performance**: Highly praised by users. "Taken aback by how close it was to the desktop app's functionality."

**App Store**: ~200k downloads/month, positive reviews

---

### 3. Logseq

**Framework**: Capacitor + ClojureScript  
**Source**: [GitHub logseq/logseq](https://github.com/logseq/logseq)

**Key Facts**:
- **Language breakdown**: Clojure 70.5%, JavaScript 12.3%, CSS 7%, TypeScript 4.3%, Swift 2.8%, Kotlin 1.5%
- Uses `capacitor.config.ts` for mobile builds
- Native Swift/Kotlin for platform-specific features

**Why Capacitor**: Code sharing with the ClojureScript web app while allowing native optimizations where needed.

---

### 4. Craft

**Framework**: Native (Swift/SwiftUI)  
**Source**: [Blake Crosley - "Craft: Native-First Document Excellence"](https://blakecrosley.com/guides/design/craft)

**Key Facts**:
- **iOS/macOS**: Native Swift + SwiftUI
- Won **Apple Design Award 2021**
- Mac uses Mac Catalyst with heavy customization
- iCloud for syncing

**Why Native**: Sub-50ms response times, platform-appropriate UX. Contrast with Electron: ~16ms input latency vs ~200ms.

**Quote**: "Craft deliberately chose native Swift/SwiftUI development over cross-platform solutions specifically to achieve sub-50ms response times."

---

### 5. Bear

**Framework**: Native (Swift)  
**Source**: [bear.app](https://bear.app), [Shiny Frog company info](https://shinyfrog.net/)

**Key Facts**:
- Made by Shiny Frog (small Italian team)
- Apple-only (iOS, iPadOS, macOS)
- Won **Apple Design Award**
- iCloud sync

**Why Native**: Small team focused exclusively on Apple ecosystem. Premium, polished experience.

**Performance**: Excellent. Praised for elegant, fast UI.

---

### 6. Anytype

**Framework**: Native (Swift for iOS, Kotlin for Android)  
**Sources**: 
- [GitHub anyproto/anytype-swift](https://github.com/anyproto/anytype-swift) - 97.1% Swift
- [GitHub anyproto/anytype-kotlin](https://github.com/anyproto/anytype-kotlin) - 99.5% Kotlin

**Key Facts**:
- Truly native on both platforms
- Modular architecture with feature modules
- E2E encryption, offline-first
- Uses `anytype-heart` middleware (shared core logic)

**Why Native**: Performance, security (E2E encryption), offline-first design

---

### 7. AFFiNE

**Framework**: Capacitor  
**Source**: [DeepWiki - toeverything/AFFiNE](https://deepwiki.com/toeverything/AFFiNE)

**Key Facts**:
- Capacitor 7.0.0
- 90%+ code shared with web version through `@affine/core`
- Same React app runs on mobile in native containers

**Why Capacitor**: Maximum code reuse with web app while accessing native APIs via plugins.

---

### 8. AppFlowy

**Framework**: Flutter + Rust  
**Source**: [AppFlowy Docs](https://docs.appflowy.io/docs/documentation/appflowy/from-source/environment-setup)

**Key Facts**:
- Flutter 3.27.4 for UI
- Rust for backend/core logic
- Single codebase for iOS, Android, desktop, web

**Why Flutter**: Open-source alternative to Notion. Single codebase, good performance, customizability.

---

### 9. Joplin

**Framework**: React Native  
**Source**: [Joplin Build Documentation](https://joplinapp.org/help/dev/BUILD/)

**Key Facts**:
- React Native for iOS and Android
- Open source, cross-platform
- Uses Expo modules

**Known Performance Issues**:
- Cold start: 2.5-3 seconds on Android
- ReactInstance initialization: ~266ms
- ViewManager initialization: ~254ms (46 ViewManagers)
- Cannot lazy-load most components

**Source**: [Joplin Mobile Startup Performance Spec](https://joplinapp.org/help/dev/spec/mobile_startup_performance/)

---

### 10. Capacities

**Framework**: Unknown (likely web-based or Capacitor)  
**Source**: [Capacities Mobile Documentation](https://docs.capacities.io/reference/mobile)

**Key Facts**:
- Mobile app positions as "companion to desktop"
- Technical stack not publicly disclosed
- Focus on search, upload, quick notes

---

### 11. Heptabase

**Framework**: Unknown (likely Capacitor or web-based)  
**Source**: [Heptabase Roadmap](https://wiki.heptabase.com/roadmap)

**Key Facts**:
- Mobile app currently in development
- Desktop uses Electron (evident from download page)
- Mobile likely shares code with web/desktop

---

### 12. Raycast

**Framework**: Native (Swift)  
**Source**: [Raycast iOS page](https://www.raycast.com/ios)

**Key Facts**:
- iOS-only (no Android)
- Deep iOS integration: widgets, shortcuts, action button, lock screen
- Companion to Mac app

**Why Native**: Requires deep iOS system integration impossible with cross-platform frameworks.

---

### 13. Linear

**Framework**: Native (Swift + Kotlin)  
**Source**: [Linear Mobile page](https://linear.app/mobile) - "Linear Mobile is built with native Swift and Kotlin code"

**Key Facts**:
- Explicitly states native development
- Redesigned UI for mobile

**Why Native**: "To guarantee a fast and fluid user experience"

---

### 14. Figma

**Framework**: WebAssembly + C++ (web-based mobile app)  
**Source**: [Figma Engineering - "Mobile engine evolution"](https://segmentfault.com/a/1190000044892542)

**Key Facts**:
- Not a native app - runs in mobile browser/WebView
- C++ rendering engine compiled to WebAssembly
- TypeScript for application logic (migrated from custom "Skew" language in 2024)
- WebGPU for rendering

**Why This Approach**: Complex vector graphics rendering engine that must be identical across platforms. C++ for performance-critical paths.

---

### 15. Slack

**Framework**: Native (Swift + Kotlin)  
**Source**: [Slack Engineering - "Stabilize, Modularize, Modernize"](https://slack.engineering/stabilize-modularize-modernize-scaling-slacks-mobile-codebases/) (Jan 2022)

**Key Facts**:
- **iOS**: 100% Swift (migrated from Objective-C)
- **Android**: Kotlin (phasing out Java)
- Uses Combine (iOS), SQLDelight (Android)
- MVVM+C (iOS), MVP (Android) architecture

**Why Native**: Developers "wanted to work with native language features and APIs, and build best-of-breed apps for each platform." Explicitly rejected cross-platform code sharing.

**Migration**: Objective-C → Swift (complete), Java → Kotlin (ongoing)

---

### 16. Discord

**Framework**: React Native  
**Source**: [React Native Radio - "Discord's Journey to React Native"](https://infinite.red/react-native-radio/rnr-343-discords-journey-to-react-native-with-chas-jhin)

**Key Facts**:
- Switched Android to React Native (iOS already used it)
- Single codebase for both platforms now
- Has own npm package: `@discordapp/react-native`

**Why React Native**: Faster update cycles, code sharing, unified design across iOS/Android/desktop.

**Migration**: Native Android → React Native (around 2022)

---

## Framework Comparison Summary

### Native (Swift + Kotlin) - 6 apps
**Apps**: Notion, Craft, Bear, Anytype, Linear, Slack, Raycast

**Pros**:
- Best performance (sub-50ms latency)
- Deep platform integration
- Best UX for each platform

**Cons**:
- 2x development effort
- Different codebases per platform

**Best for**: Premium products, performance-critical apps, small teams focused on one ecosystem (Bear)

---

### Capacitor - 4 apps
**Apps**: Obsidian, Logseq, AFFiNE, (likely) Heptabase

**Pros**:
- Maximum code sharing with web/Electron desktop
- Access to native APIs via plugins
- Easier migration from web apps

**Cons**:
- Not truly native performance
- Some features behave differently per platform

**Best for**: Apps with existing web/Electron codebases wanting mobile presence

---

### React Native - 2 apps
**Apps**: Joplin, Discord

**Pros**:
- Single codebase
- Large ecosystem
- Faster iteration than native

**Cons**:
- 2-3 second cold starts common
- Cannot lazy-load core components
- Performance ceiling

**Best for**: Apps prioritizing development speed over raw performance

---

### Flutter - 1 app
**Apps**: AppFlowy

**Pros**:
- True cross-platform (desktop + mobile)
- Good performance
- Single codebase

**Cons**:
- Larger app size
- Dart learning curve

**Best for**: Open-source projects, startups wanting fast cross-platform development

---

### WebAssembly/Web - 1 app
**Apps**: Figma

**Pros**:
- Identical rendering across all platforms
- Complex graphics engine sharing

**Cons**:
- Not a real native app
- Limited platform integration

**Best for**: Apps with complex rendering engines that must be consistent

---

## Key Insights

1. **Premium note apps go native**: Notion, Craft, Bear all chose native development for performance and UX despite the higher cost.

2. **Electron apps use Capacitor for mobile**: Obsidian, Logseq, AFFiNE all follow the pattern of Electron desktop + Capacitor mobile.

3. **React Native has performance issues**: Joplin's documented 2.5-3 second cold starts and Discord's migration to RN (not from it) shows it's viable but has tradeoffs.

4. **Native is trending up**: Notion rewrote from Cordova to native. Slack explicitly rejected cross-platform. Linear chose native from the start.

5. **Small teams can go native**: Bear's small team (Shiny Frog) succeeded with native Swift by focusing only on Apple ecosystem.

6. **Editor components often stay web-based**: Even native apps like Notion keep the complex editor as web-based, showing hybrid is acceptable for specific components.

---

## Recommendations for MindOS

Based on this research:

| Priority | Recommendation |
|----------|----------------|
| **Code sharing** | Capacitor (follows Obsidian/Logseq pattern - Electron desktop + Capacitor mobile) |
| **Performance** | Native Swift + Kotlin (follows Notion/Linear pattern) |
| **Speed to market** | Capacitor or Flutter |
| **Best UX** | Native |

**Suggested approach**: Start with Capacitor for MVP (maximum code reuse with existing Next.js web app), then evaluate if native rewrite is needed based on user feedback and performance requirements.
