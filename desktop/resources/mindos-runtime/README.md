# Bundled MindOS runtime (optional)

This folder is copied into the app's **Resources/mindos-runtime** when you run `electron-builder` (see `extraResources` in `electron-builder.yml`).

To ship a **runnable** built-in MindOS (so users can run without `npm i -g`):

1. From the **monorepo root** (parent of `desktop/`), run a production Next build so `app/.next/standalone/server.js` exists, e.g. `npm run build` (or `cd app && ./node_modules/.bin/next build` if `mindos` is not on `PATH`). The app uses **`output: 'standalone'`**; `prepare-mindos-runtime` syncs `.next/static` and `public` into the standalone tree per Next's deployment docs.
2. Run:

   ```bash
   cd desktop && npm run prepare-mindos-runtime
   ```

   Or `MINDOS_BUNDLE_SOURCE=/path/to/repo npm run prepare-mindos-runtime`.

3. Then `npm run dist` (or your platform script).

The prepared **`app/`** does **not** include root **`app/node_modules`** (standalone carries traced deps). MCP is pre-bundled into a single `mcp/dist/index.cjs` via esbuild — no `mcp/node_modules` is needed at runtime. The prepare script copies the bundle if it already exists, or builds it from source otherwise.

If you skip step 1–2, only this README may be packaged; **prefer-newer** will fall back to the global install as before.

See `wiki/specs/spec-desktop-bundled-mindos.md` and `wiki/specs/spec-desktop-standalone-runtime.md`.
