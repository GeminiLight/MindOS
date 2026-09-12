# Website: Human–Agent Co-evolution

## Source and publishing
- Source: `scripts/website/content.mjs` and `render.mjs`.
- Tracked publishing directory: `landing/`. `landing/content.md` is generated from the same content source as the HTML; do not edit the snapshot independently.
- Build: `node scripts/website/render.mjs`.
- Preview: `node scripts/website/serve.mjs`, then open `http://127.0.0.1:4578/zh/`.
- Social card: with the preview server running, `node scripts/website/capture-social.mjs`.
- Test: `pnpm exec vitest run tests/landing-website.test.ts`.
- Browser verification: `pnpm exec playwright test -c tests/e2e/landing.config.ts`.
- Existing `sync-to-mindos.yml` publishes `landing/` to gh-pages on main integration. CNAME stays `mindos.you`. This task must not push a public branch directly.

## Product narrative
The homepage leads with Human–Agent Co-evolution. It explains a concrete loop: human intent → agent action → human review → reusable knowledge for the next task. It does not imply automatic model training, universal agent compatibility, or blanket guarantees that cloud calls never transmit context.

English and Chinese have separate static URLs, including getting-started and data/control pages. Language switching keeps the page type. Original anchors vision/demo-flow/compare/workflow/features/quickstart remain valid.

## Visual and interaction system
A cinematic opening uses 35 golden mesh strands to express the shared mind. Header, hero, labels, and artwork follow the selected theme: warm paper and amber in light mode, charcoal and luminous gold in dark mode. The artwork follows the pointer by at most 6°/4° and resets on exit; touch does not trigger pointer tilt, while reduced motion keeps the entire scene still. The user-requested ambient scene and brand strip each have a pause control (see below). There is no WebGL runtime; fonts are served locally. Product screenshots are actual UI; IBM Plex Sans and italic Lora are self-hosted, with local system fonts for CJK.

`landing/globals.css` owns the static site's tokens, with @theme inline aliases. They follow the product design system; product app styles are not changed. The action button scopes --amber to --amber-action to preserve the white-text convention. Opening-scene token values (light / dark): --hero-background #f8f6f1 / #101110, --hero-foreground #1c1a17 / #f4f0e8, --hero-muted #685f52 / #b9b5a9, --hero-border #d8d2c7 / #3d3930, --hero-surface #f2efe9 / #1d1d19, --hero-amber #82531f / #efb86d, --hero-core #82531f / #ffe4b3, --hero-action #95551b / #a46328. Decorative --hero-filament #ad742e / #efb86d is separate from readable text. Glow/line/glass use related translucent surfaces. All are registered in @theme inline. Website text amber uses #82531f in light and #e0a85e in dark for readable small labels; website muted text uses #685f52 / #b0a797. Border #d8d2c7 / #494339; inset note surface #fdfbf7 / #211f1a; all component styles reference these tokens.

Measured contrast, using the browser's resolved tokens:
| Pair | Light | Dark |
|---|---:|---:|
| Primary text / page | 16.08 | 14.77 |
| Secondary text / page | 5.81 | 7.86 |
| White / amber action | 5.84 | 4.78 |
| Amber text / subtle surface | 5.34 | 6.73 |

Focus uses :focus-visible + ring; UI layers use z-index 10/30/50; radii use 4/8/12/16px; transitions are at most 280ms and disabled for reduced motion.

Preview and co-evolution controls use manual tabs with ArrowLeft/Right/Home/End, selected state, labelled panels, and keyboard focus. Screenshot preview uses a native dialog with Escape and focus restoration; the image link remains usable without JS. FAQ uses native details/summary. Mobile menu closes on navigation, outside click, or Escape.

## Recovery and privacy
- Downloads have persistent mirror and GitHub links for each platform; no user-language/UA architecture inference and no inaccessible OSS routing.
- The public GitHub release API only updates a version label. Failure, timeout, non-desktop tags, draft/pre-release or malformed metadata keep the original native links.
- Copy waits for completion, reports rejection, restores the button and offers manual selection. A six-second timeout prevents a stuck control.
- Theme initialization handles denied storage. Content is visible by default, and installation/FAQ/navigation remain usable with JS disabled.
- Static robots preserves existing training-bot preferences while allowing search by default. Cloudflare may still add its managed section; verify the deployed response.
- No analytics or knowledge-upload behavior was added.

## Verification and remaining release boundary
Validated at 390/768/1440 in English/Chinese, light/dark, plus 320px overflow checks. Screenshots live at `/tmp/mindos-website-{en|zh}-{width}-{light|dark}.png`. 26 browser tests cover keyboard, pointer reset/reduced motion, copy rejection/retry, API failure, no-JS and denied-storage paths. Ten unit/static contracts pass. Local page/asset and anchor references are checked. Additional WebKit and Firefox smoke checks passed for the hero, tabs, and keyboard navigation, with no browser errors; their screenshots are `/tmp/mindos-website-{webkit|firefox}-hero.png`.

Font files are latin subsets from Google Fonts, with SIL OFL licenses in `landing/fonts/`. Existing product WebP assets total about 398 KiB, with explicit dimensions and lazy loading for inactive previews.

This is a website-only change: no runtime/package version bump, product release, agent settings change, or knowledge data migration. Production can only be claimed updated after main integration and the existing sync workflow succeed; then verify the live Chinese page, metadata, robots, and download endpoints. No Search Console, real-user CWV, real screen reader, or physical device measurements were made.

## Integration and production verification — 2026-09-12

PR https://github.com/GeminiLight/mindos-dev/pull/340 was merged into main at `b80ad36a5e4b87049ccd4f4cc035939beaedbb2c`. The root main worktree fast-forwarded without modifying unrelated local work. [Sync run 34683123541](https://github.com/GeminiLight/mindos-dev/actions/runs/34683123541) succeeded; the public product source commit is `02e0da3deb13094b6b6bcbf42fd8db13bd909f56`. GitHub Pages reports `built` for landing commit `d3e85eafb2a99aabc523aace688e0e7c5ff150e2`.

Post-merge validation from the main worktree: `pnpm exec vitest run tests/landing-website.test.ts tests/workflow-migration-contract.test.ts` passed 27 tests; `pnpm exec playwright test -c tests/e2e/landing.config.ts` passed 26 tests. The existing preview serves the identical merged landing source. The previously timing-out CLI sync case also passed individually in the main build environment (`pnpm exec vitest run tests/unit/cli-sync.test.ts -t 'records remote deletion conflicts'`). This resolves the outstanding individual case; it does not claim a new full workspace release run.

Production browser verification at https://mindos.you confirmed all six pages return 200 with the new copy and canonical URLs. Chinese homepage light/dark switching, the co-evolution selection, and zero page errors were verified. All four R2 installer mirror HEAD requests returned 200. Screenshots: `/tmp/mindos-website-production-light.png` and `/tmp/mindos-website-production-dark.png`. Generic Python HTTP requests received 403 while Chromium received 200; no crawler-access or search-indexing improvement is inferred from the successful browser checks. Real-user CWV, search traffic, and AI citation changes remain unmeasured.

## Historical candidate delivery — 2026-09-12

At the initial handoff, the candidate was pushed to `origin/codex/website-coevolution` with draft PR https://github.com/GeminiLight/mindos-dev/pull/340. Earlier GitHub fetch/push attempts timed out; connectivity recovered, fetch succeeded, and the branch contains current main `371e59cfeef4868192bc66571d31168c7de0c7b5`. At that stage, no main integration, production deployment, or public sync had been performed; the completed integration is recorded above.

The 9 website contracts and 20 browser tests pass. Supplemental WebKit/Firefox checks and 320px overflow checks pass. Generated-page consistency and JavaScript syntax checks pass. The broader `pnpm run test:quick` is **not fully green**: after connecting existing package dependencies, all 40 contract files / 240 tests passed; the unit run had missing local build output and timeouts. Building the unchanged uninstall-safety artifact and rerunning the three failed files serially passed 113/114 tests. One unchanged CLI sync test (`records remote deletion conflicts…`) still timed out at its original 5-second limit when run alone. No test threshold or product code was changed. Full workspace release validation was not run for this static website change.

Evidence: `/tmp/mindos-website-quick-check.log`, `/tmp/mindos-website-quick-retry.log`, `/tmp/mindos-website-sync-retry.log`. The later integration rerun and publishing results are recorded above.

## Theme correction — 2026-09-12

Removed the forced dark color scheme and moved dark scene colors into the root dark-theme selector. First-load light mode, toggling, reload persistence, and switching languages now keep the header and hero consistent with the rest of the page. Denied storage and no-JavaScript fallback are covered. Two bilingual regression tests reproduced the original failure before the CSS change; all 22 browser tests now pass. The static social-card capture explicitly selects its intended dark palette independently of the interactive page.

Desktop/mobile screenshots: `/tmp/mindos-website-theme-zh-1440-light.png`, `/tmp/mindos-website-theme-zh-390-light.png`, and `/tmp/mindos-website-theme-zh-1440-dark.png`. Browser-resolved contrast (light / dark): hero secondary text 5.81 / 9.23, accent heading 6.06 / 10.59, CTA white text 5.84 / 4.78. The existing unrelated CLI sync timeout was not rerun for this CSS correction.

## Interaction polish — 2026-09-12

`landing/motion.mjs` owns optional Web Animations effects and scroll/resize observations. Content is visible in the base HTML/CSS. Entering the viewport triggers a single 280ms appearance; there is no initial hidden state; these content entrances do not loop. Gallery and co-evolution selection update synchronously, with a 220ms moving indicator and 240ms content transition. Interrupted transitions start from the current indicator geometry, and resize recalculates its position. FAQ/image-preview opening completes the feedback system. The later ambient scene replaced the pointer-enter spark animation so the two never compete for its transform.

The sticky header marks the current section and displays reading progress; scroll work is scheduled once per animation frame. Download links now offer 44px targets. Reduced motion cancels active Web Animations immediately, leaving the chosen panel visible; hidden pages cancel active effects. Missing animation or observer APIs preserve usable static content and controls.

Validation: 26 Playwright tests and 10 website contracts pass, including rapid repeated tab selection, resize alignment, scroll navigation, live reduced-motion cancellation, and missing-API fallbacks. The 12 bilingual/theme/viewport screenshots were regenerated after animations settle. Source syntax checks passed. The known unrelated CLI sync timeout in the earlier delivery record was not rerun for this website-only interaction change.

Additional WebKit/Firefox checks passed for the moving indicator, keyboard selection, scroll navigation and reduced motion. Actual browser recording: `/tmp/mindos-website-motion-preview.webm`; reviewed screenshots: `/tmp/mindos-website-motion-gallery.png` and `/tmp/mindos-website-motion-evolution.png`.

Anchor landing also compensates for each responsive section’s padding using `--section-space`, instead of stacking a second header-sized scroll margin. This keeps destination headings 16–80px below the sticky header, including legacy aliases. A browser assertion reproduced the old excessive gap before the correction.

## Product sync boundary

The existing deployment workflow removes `landing/` from public product source, so `.syncinclude` now also excludes the root `scripts/website/` directory and the three website-only test/config files under `tests/`. These tools depend on the private development repository’s landing source; copying them without that directory would leave broken imports in product checks. A dry-run rsync regression uses the real sync parser, verifies all website-only files are omitted, and retains unrelated product tests and a nested website-named fixture. The existing workflow contract suite also passes. Website deployment itself still uses the existing gh-pages workflow unchanged.


## Brand strip and vector UI — 2026-09-12

The four approximate logos were removed. `scripts/website/brands.mjs` now renders seven documented clients (Cursor, Codex, Claude Code, Gemini CLI, OpenCode, Windsurf, Cline) from locally hosted official artwork. Exact official sources and the one proportional raster resize are recorded in `landing/img/brands/SOURCES.md`. Original brand colors are preserved; the Cursor and Windsurf marks use their official theme editions. Other client names remain available through the complete supported-agents link.

The user explicitly requested a continuously looping row. `landing/brands.css` therefore defines a 48-second linear loop as a scoped exception to the normal short-transition rule. Two identical groups join seamlessly; the second is inert and hidden from accessibility APIs. `landing/brands.mjs` manages pause/resume, offscreen/background pause, and preference changes. Hover originally paused (removed in the follow-up below); focusing, touching, or horizontally wheeling the viewport switches to an ordinary single-list scroll surface. Arrow keys/Home/End support keyboard browsing. No JavaScript or reduced motion means a static scrollable list with no duplicates; failed image requests retain the brand names. No carousel dependency or third-party asset request was introduced.

`icons.mjs` supplies consistent SVG arrows, checks, FAQ, and download-platform symbols across all six generated pages. Successful release metadata updates retain the existing SVG instead of restoring a text arrow. Actual product screenshot pixels are unchanged.

Validation: 11 website contracts + 17 existing workflow contracts; 30 browser tests, including pause/manual exploration, live reduced motion, artwork failures/no JS, all logo assets loading, and release-link icon preservation. Screenshot capture waits only for finite transitions and freezes loops during capture; continuous movement is tested separately. Screenshots: `/tmp/mindos-website-{en|zh}-{390|768|1440}-{light|dark}.png`; focused preview: `/tmp/mindos-brands-desktop-dark.png`, `/tmp/mindos-brands-mobile-dark.png`. Supplemental WebKit/Firefox mobile motion, keyboard and reduced-motion checks pass; 320px has no page overflow. Recorded preview: `/tmp/mindos-brands-preview.webm`. Task branch: `codex/website-brand-strip`; integration and deployment are separate from the previously merged PR #340.


Candidate delivery: [PR #347](https://github.com/GeminiLight/mindos-dev/pull/347), based on main `735faa63`; main's concurrent backlog additions were preserved during synchronization. The pre-push fallback ran product-wide checks in the isolated website worktree and encountered absent per-package dependencies. Equivalent `pnpm run test:quick` validation was completed in the main worktree (262 root contracts + 576 units passed, 9 skipped), alongside the branch's 28 contracts and 30 browser tests. Candidate push therefore used `SKIP_TESTS=1`; hooks and test limits were not changed. Log: `/tmp/mindos-brands-main-quick.log`. This candidate is not yet merged or deployed; no release gate or installer build was needed for the static-site-only change.


## Default co-evolution scene motion — 2026-09-12

The user asked for a more striking default animation on the infinity-shaped shared-mind artwork. Three SVG paths now carry counter-flowing signal trails and bright heads; the 35-strand ribbon breathes subtly while two rings expand from the central spark. The spark rotates gently. Labels remain outside the moving ribbon, preserving legibility and the existing pointer-tilt interaction.

`constellation.mjs` generates reusable orbit geometry and visible static artwork; `scene.css` animates dash offsets, transforms and opacity in 4–12 second loops. `scene.mjs` gates motion on visibility and user/system preference, with a localized pause/resume button. It has no per-frame JavaScript, WebGL or extra dependency. Offscreen/background motion pauses; reduced motion hides signals/pulses and disables movement; no JavaScript or missing IntersectionObserver leaves a complete static figure. The requested continuous scene is an explicit, scoped exception to the default short-transition rule. Existing semantic hero colors adapt it to both themes.

Validation: 28 website/workflow contracts and all 32 browser tests pass. The two new tests failed before implementation, then passed for autonomous movement, stable labels, pause/resume, offscreen suspension and reduced motion. Supplemental WebKit/Firefox mobile checks pass. All 12 viewport/theme screenshots were regenerated; closeups are `/tmp/mindos-scene-ambient-light.png` and `/tmp/mindos-scene-ambient-dark.png`. Recording: `/tmp/mindos-scene-ambient-preview.webm`. The same main baseline's product quick checks were already green for this candidate; they were not repeated for this isolated SVG/CSS enhancement. No full release gate was run. Delivery continues in PR #347, not yet merged/deployed.


## Expanded default-loop showcase — 2026-09-12

The row now contains ten brands: nine documented clients plus Doubao Work, visibly labelled “Connection unverified” / “接入待验证”. Kimi Code and WorkBuddy use official artwork and match existing registry entries; WorkBuddy remains MCP-only in MindOS. Doubao Work uses its own official work-product logo and Chinese name, not the general Doubao face. No runtime capability was added. The subtitle now says MCP **or** Skills because supported methods vary by client.

The pause/resume button is retained and motion starts automatically. Hover no longer pauses the loop; explicit pause, manual keyboard/touch browsing, offscreen/background suspension and reduced-motion support remain. Official asset provenance is recorded in `landing/img/brands/SOURCES.md`. The browser regression was extended before implementation for all ten loaded logos, the Chinese pending label and continuous motion while hovering.

Validation: all 28 website/workflow contracts and 32 browser tests pass. Twelve responsive screenshots were refreshed, plus reviewed closeups `/tmp/mindos-expanded-brands-light.png` and `/tmp/mindos-expanded-brands-dark.png`. No product runtime changes or release build.


Integration: PR #347 merged into main at `1e80ebe7` on 2026-09-12. The main worktree fast-forwarded without changing existing paper or untracked audit work; 28 website/workflow contracts passed again. Sync/publication run [34687572479](https://github.com/GeminiLight/mindos-dev/actions/runs/34687572479) did not start because GitHub reports failed recent payments or an insufficient spending limit. Public sync and website deployment remain pending; rerun the latest main sync after the account issue is resolved.
