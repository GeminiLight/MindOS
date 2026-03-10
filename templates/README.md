# template/

MindOS preset templates for initializing your personal knowledge base.

## Presets

- `template/en/`: English preset
- `template/zh/`: Chinese preset

## Quick Start

```bash
# 1) Choose one preset and copy it to my-mind/
cp -r template/en my-mind/
# or
# cp -r template/zh my-mind/

# 2) Configure MIND_ROOT (point MCP and App to your knowledge base)
echo "MIND_ROOT=$(pwd)/my-mind" >> app/.env.local

# 3) Start filling content from 👤 Profile (en) or 👤 画像 (zh)
```

## Notes

- `my-mind/` is your private workspace and is git-ignored.
- Keep preset structure stable so agents can locate files predictably.
- If you add or rename folders in presets, update docs accordingly.
