# MindOS local views plugin

One plugin connects Codex and Claude Code to the same local MindOS library. People remain Markdown; project tasks remain `TODO.csv`. The Agent creates declarative view definitions, and MindOS renders list/detail, table or board layouts. Composable work pages also support isolated custom HTML/CSS and a bounded worker-script API; ordinary browser scripts and arbitrary React imports are not executed.

## Candidate status

This source candidate requires a MindOS runtime reporting `capabilityVersion: 1` from `mindos views doctor`. The npm version number in this branch is unchanged; **do not assume the published version contains this feature**. macOS and Linux with Node 22.19+ are supported by the setup script. A model API key is not required for this plugin; the host supplies its Agent.

## Install from this checkout

Replace `/absolute/checkout` with the checkout containing this candidate. Both commands use the marketplace directory, not the plugin directory.

Codex:

```sh
codex plugin marketplace add /absolute/checkout/plugins
codex plugin add mindos@mindos-local
```

Claude Code:

```sh
claude plugin marketplace add /absolute/checkout/plugins
claude plugin install mindos@mindos-local
```

Reconnect the host after installation. The shared `mindos-views` skill describes the complete workflow. The portable `plugin.json` and `mcp.json` serve Codex; `.claude-plugin/plugin.json` and `.mcp.json` serve Claude. Both run `scripts/mcp.mjs`, which uses the setup-installed runtime or an existing `mindos` on PATH.

## Connect the runtime

From the installed plugin directory:

```sh
node scripts/setup.mjs
```

Setup preserves an existing root and configuration. If the configured runtime is stopped, add `--start`. If no runtime is installed, supply an **exact tested** release or local product artifact and a user-selected library:

```sh
node scripts/setup.mjs --runtime-package /absolute/mindos-candidate.tgz --root /absolute/library --start
```

The script installs under `~/.mindos/plugin-runtime`; no global PATH modification is needed. Product tarballs use platform runtime packages; a local candidate must have its matching platform runtime available. Developers can point `MINDOS_VIEWS_CLI` at the built checkout's `packages/mindos/bin/cli.js` and `MINDOS_URL` at its isolated preview service. The launcher and setup honor these same overrides. They never silently fall back to direct file writes.

A reachable incompatible server is reported, not replaced. Browser authentication remains the runtime's existing authentication. Setup returns a usable local URL even when opening a browser is unavailable. Uninstalling a host plugin retains local records, the runtime and the other host's installation.

## Try it

- “Create an empty project task collection. Add the tasks from this approved plan, then preview a board grouped by status.”
- “Read my people collection. Preview a table sorted by name, showing background and next follow-up.”
- “Add an optional context text field to these project tasks. Show me the schema change before applying it.”

The workflow is `describe → read → mutate / preview → save`. Reuse the exact operation ID and input after timeouts. Re-read after revision conflicts. UI changes and Agent changes use the same product API. Unknown/private people sections are excluded from structured reads and preserved when known fields change.

## Composable pages

With `describe.pages.specVersion: 1`, the same plugin can create and adjust multi-source work pages through `mindos_pages_read`, `mindos_pages_preview`, and `mindos_pages_save`. Task/person records remain in their original files. Preview does not add navigation; save makes a stable `/studio/pages/<pageId>` page. Layout restore retains the latest source data. External Agents author specifications using their own model; the page UI's optional AI adjustment uses the configured MindOS provider.

Try: “Create a project page with open tasks on the left and related people on the right. Keep the people block locked while making the task block more compact.”

See [page and custom web contract](../../wiki/refs/generative-pages-agent.md) for the schema, scope/version guards, and isolated worker interface.

## Limits

Two adapters; three layouts; 500 records per collection; 256 KiB per source file. Tasks may add up to ten `x_*` optional text fields. No automatic arbitrary CSV/TODO.md conversion, field deletion/type conversion, executable React, cloud service or host-specific data copy. Local processes editing files outside the API remain outside its cooperative locking guarantee.

See [the full contract](../../wiki/refs/generative-views-plugin.md) and [verification record](../../wiki/reviews/review-generative-views-mvp-20261022.md).
