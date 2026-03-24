# Bundled MindOS runtime (optional)

This folder is copied into the app’s **Resources/mindos-runtime** when you run `electron-builder` (see `extraResources` in `electron-builder.yml`).

To ship a **runnable** built-in MindOS (so users can run without `npm i -g`):

1. From the **monorepo root** (parent of `desktop/`), produce `app/.next` and install deps, e.g. `npm run build` and ensure `app/node_modules` / `mcp/node_modules` exist as needed.
2. Run:

   ```bash
   cd desktop && npm run prepare-mindos-runtime
   ```

   Or `MINDOS_BUNDLE_SOURCE=/path/to/repo npm run prepare-mindos-runtime`.

3. Then `npm run dist` (or your platform script).

If you skip step 2, only this README may be packaged; **prefer-newer** will fall back to the global install as before.

See `wiki/specs/spec-desktop-bundled-mindos.md`.
