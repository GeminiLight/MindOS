# templates/

MindOS preset templates for initializing your personal knowledge base.

## Presets

- `templates/en/`: English preset
- `templates/zh/`: Chinese preset

## Quick Start

Templates are initialized automatically by `mindos onboard` — no manual copy needed.

If you need to manually initialize:

```bash
# 1) Run the setup wizard (recommended)
mindos onboard

# 2) Or copy a preset manually to your knowledge base directory
cp -r templates/en ~/.mindos/my-mind
# then set mindRoot in ~/.mindos/config.json

# 3) Start filling content from 👤 Profile (en) or 👤 画像 (zh)
```

## Notes

- `my-mind/` is your private workspace and is git-ignored.
- Keep preset structure stable so agents can locate files predictably.
- If you add or rename folders in presets, update docs accordingly.
