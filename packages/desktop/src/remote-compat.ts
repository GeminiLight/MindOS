/**
 * Remote-server version compatibility.
 *
 * The local runtime has had a compat gate for a long time (minUserVersion /
 * maxTestedUserVersion in mindos-runtime-pick.ts), but remote mode read the
 * server's `version` from /api/health and only printed it. Connecting a current
 * Desktop to an old server silently produced a broken shell — most visibly on
 * macOS, where `titleBarStyle: 'hidden'` relies on the page rendering its own
 * titlebar row. This applies the same `minMindOsVersion` knob to remote.
 */
import semver from 'semver';

export type RemoteCompatVerdict =
  | { ok: true }
  | { ok: false; reason: 'below-min'; serverVersion: string; minVersion: string };

export interface RemoteCompatInput {
  /** `version` from the server's /api/health, if it reported one. */
  serverVersion: string | null | undefined;
  /** `minMindOsVersion` from ~/.mindos/config.json. Unset → no floor. */
  minVersion: string | null | undefined;
}

/**
 * Pure. Unknown or unparsable versions pass: a server that does not report a
 * version is not evidence of incompatibility, and blocking it would make the
 * client unusable against older-but-working deployments.
 */
export function checkRemoteCompat(input: RemoteCompatInput): RemoteCompatVerdict {
  const min = typeof input.minVersion === 'string' ? input.minVersion.trim() : '';
  if (!min || !semver.valid(min)) return { ok: true };

  const server = typeof input.serverVersion === 'string' ? input.serverVersion.trim().replace(/^v/, '') : '';
  if (!server || !semver.valid(server)) return { ok: true };

  if (semver.lt(server, min)) {
    return { ok: false, reason: 'below-min', serverVersion: server, minVersion: min };
  }
  return { ok: true };
}
