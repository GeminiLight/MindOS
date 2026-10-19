# Agent brand artwork

These marks identify clients or visibly labelled prospective connections, not sponsorship or endorsement. Marks belong to their respective owners. Previously checked 2026-09-12; Codex, Kimi and OpenCode refreshed against first-party assets on 2026-10-10. Preserve their proportions and supplied colors; brand artwork is exempt from MindOS UI color-token substitution.

| Files | Official source | Preparation |
|---|---|---|
| cursor-light.svg, cursor-dark.svg | https://cursor.com/brand — https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip | Unmodified `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg` and `CUBE_2D_DARK.svg`; theme-specific editions. |
| codex-light.svg, codex-dark.svg | OpenAI official VS Code extension `openai.chatgpt` 26.1002.51308, `resources/blossom-black.svg` and `blossom-white.svg`; https://marketplace.visualstudio.com/items?itemName=openai.chatgpt | Unmodified official Codex extension artwork, replacing the older desktop icon. These are the extension’s OpenAI Blossom marks, labelled Codex; not a newly invented standalone Codex symbol. |
| claude.svg | Anthropic official VS Code extension `anthropic.claude-code` 2.1.263, `resources/claude-logo.svg` | Unmodified Claude symbol. https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code |
| gemini.svg | https://gemini.google.com/ — https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg | Unmodified Google Gemini symbol; displayed as Gemini CLI to identify the supported client. |
| opencode-light.svg, opencode-dark.svg | https://opencode.ai/brand ; official source https://github.com/anomalyco/opencode/tree/dev/packages/console/app/src/asset/brand (`opencode-logo-light.svg`, `opencode-logo-dark.svg`) | Unmodified official vertical logo marks. Git blobs `7ed0af003bb6d3947106e5dd5b45fd08cdb58ca5` and `c28babff1be159160016884695e097d9159d468b`. Replaces the generic favicon. |
| windsurf-light.svg, windsurf-dark.svg | https://windsurf.com/brand — https://exafunction.github.io/public/brand/windsurf-black-symbol.svg and https://exafunction.github.io/public/brand/windsurf-white-symbol.svg | Unmodified theme-specific symbols. |
| cline.png | https://cline.bot/ — https://cline.bot/assets/branding/favicons/apple-touch-icon.png | Unmodified official app icon. |
| kimi-light.svg, kimi-dark.svg | https://moonshotai.github.io/Branding-Guide/ ; `scenarios/04-k-only/k-only-light.svg`, `k-only-dark.svg`; product https://www.kimi.com/code/ | Unmodified official K-only artwork, paired with the Kimi Code client name. Replaces the general Kimi PWA icon; this is Kimi’s published family mark, not a claimed separate Code-only logo. |
| workbuddy.svg | https://www.workbuddy.cn/ — https://download.codebuddy.cn/web/workbuddy/93a7cd0d70556625552d16b09c6a9cf8c2e089b9/assets/logo.svg | Unmodified official WorkBuddy symbol. |
| doubao-work.png | https://www.doubao.com/work — https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/doubaowork-logo-f.png | Unmodified Doubao Work logo, distinct from the general Doubao app. |

The nine verified client names are checked against `docs/en/supported-agents.md` in the development repository. The full compatibility link remains available next to the strip. Files are served locally: visitors do not contact brand websites to load artwork.

Kimi Code supports MCP and Skills in the MindOS registry; WorkBuddy currently supports MCP only. Doubao Work (豆包工作, the official name of the office product) is displayed with “Connection unverified” / “接入待验证”: no MindOS registry entry or supported connection has been verified. This showcase does not add a runtime integration.

MindOS identity is reused unchanged from `packages/web/public/logo-square.svg`. Header, footer and supporting marks reference `/img/logo-square.svg`; the website no longer redraws a second version with different stroke widths. Official colored logos keep their supplied colors and proportions. Removed superseded files: `codex.png`, `kimi-code.png`, `opencode.png`.
