# ⚙️ Configuration Update SOP Example: Zero-Repeat Setup

## Goal
- Ensure agents can run with minimal reconfiguration across sessions.

## Steps
1. Update `CONFIG.json` for structured keys.
2. Update `CONFIG.md` for semantic intent.
3. Verify naming-level rules (emoji + hierarchy) remain consistent.
4. Run `rg` sweep for stale paths and obsolete labels.
5. Validate one real workflow end-to-end.

## Success Criteria
- New session can execute core flows without extra setup prompts.
