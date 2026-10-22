---
name: setup
description: Connect the MindOS plugin to an existing local library, or set up a new local runtime and shared work views.
---

# Connect MindOS

Run `node scripts/setup.mjs` relative to this plugin root (resolve the actual installed plugin path). It checks the existing runtime and capability without changing config. Reuse an existing MindOS or Desktop runtime. Never create another root just because a service is stopped.

If the service is stopped, run the same script with `--start`; it starts only after capability discovery fails and preserves config. If no MindOS executable exists, install the exact tested runtime artifact using `--runtime-package /absolute/path/mindos.tgz --root /absolute/user-selected/library --start`. A published version may be passed only as `@geminilight/mindos@X.Y.Z` after that release is verified to support capability 1. Do not guess a minimum published version; this candidate has not yet been released. The script accepts no floating version.

Ask for a library folder only if none exists in current configuration. A root choice does not authorize replacing a different configured library. Unsupported existing runtimes must be upgraded explicitly; preserve their data and settings. Setup's 60-second readiness timeout reports a log path and never claims success without a capability response.

Then describe, list and create the requested empty people or task collection through the shared tools. Open its view URL. No separate model API key is needed. Browser login may still be required. Uninstalling this host plugin retains data, runtime and the other host's connection.
