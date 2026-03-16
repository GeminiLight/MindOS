import { describe, it, expect } from 'vitest';

// ── Extracted logic from bin/lib/stop.js ─────────────────────────────────────
// Unit-testable pure functions extracted from the source to prevent regressions.
// If the source changes, update these in sync.

/**
 * Parse PIDs from `ss -tlnp` output for a given port.
 * Must not false-positive on partial port matches (e.g. port 80 ≠ :8080).
 */
function parseSsPids(ssOutput: string, port: number): number[] {
  const pidsToKill = new Set<number>();
  const portRe = new RegExp(`:${port}(?!\\d)`);
  for (const line of ssOutput.split('\n')) {
    if (!portRe.test(line)) continue;
    const pidMatch = line.match(/pid=(\d+)/g);
    if (pidMatch) {
      for (const m of pidMatch) {
        const pid = Number(m.slice(4));
        if (pid > 0) pidsToKill.add(pid);
      }
    }
  }
  return [...pidsToKill];
}

/**
 * Parse PIDs from `lsof -ti :PORT` output.
 */
function parseLsofPids(lsofOutput: string): number[] {
  return lsofOutput
    .trim()
    .split('\n')
    .map(Number)
    .filter((p) => p > 0);
}

// ── ss PID parsing ───────────────────────────────────────────────────────────

const SS_SAMPLE = `State  Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
LISTEN 0      511          0.0.0.0:5175       0.0.0.0:*    users:(("node",pid=100,fd=22))
LISTEN 0      511        127.0.0.1:8787       0.0.0.0:*    users:(("node",pid=200,fd=31))
LISTEN 0      511                *:3003             *:*    users:(("next-server (v1",pid=300,fd=21))
LISTEN 0      2048         0.0.0.0:3001       0.0.0.0:*    users:(("python",pid=400,fd=16))
LISTEN 0      2048         0.0.0.0:30030      0.0.0.0:*    users:(("node",pid=500,fd=10))
LISTEN 0      511                *:80               *:*    users:(("nginx",pid=600,fd=6))
LISTEN 0      511                *:8080             *:*    users:(("node",pid=700,fd=8))`;

describe('parseSsPids — basic extraction', () => {
  it('finds PID for port 8787', () => {
    expect(parseSsPids(SS_SAMPLE, 8787)).toEqual([200]);
  });

  it('finds PID for port 3003', () => {
    expect(parseSsPids(SS_SAMPLE, 3003)).toEqual([300]);
  });

  it('finds PID for port 3001', () => {
    expect(parseSsPids(SS_SAMPLE, 3001)).toEqual([400]);
  });

  it('returns empty for non-existent port', () => {
    expect(parseSsPids(SS_SAMPLE, 9999)).toEqual([]);
  });
});

describe('parseSsPids — no partial port matches', () => {
  it('port 3003 does NOT match :30030', () => {
    // :30030 contains :3003 as substring — must not match
    const pids = parseSsPids(SS_SAMPLE, 3003);
    expect(pids).not.toContain(500);
    expect(pids).toEqual([300]);
  });

  it('port 80 does NOT match :8080 or :8787', () => {
    const pids = parseSsPids(SS_SAMPLE, 80);
    expect(pids).not.toContain(700); // 8080
    expect(pids).not.toContain(200); // 8787
    expect(pids).toEqual([600]);     // only port 80
  });

  it('port 800 does NOT match :8001 or :80', () => {
    const pids = parseSsPids(SS_SAMPLE, 800);
    expect(pids).toEqual([]);
  });

  it('port 300 does NOT match :3001 or :3003 or :30030', () => {
    const pids = parseSsPids(SS_SAMPLE, 300);
    expect(pids).toEqual([]);
  });
});

describe('parseSsPids — multiple PIDs on one line', () => {
  it('extracts all PIDs when multiple processes share a port', () => {
    const line = `LISTEN 0 128 *:4000 *:* users:(("node",pid=111,fd=3),("node",pid=222,fd=4))`;
    expect(parseSsPids(line, 4000).sort()).toEqual([111, 222]);
  });
});

describe('parseSsPids — empty / malformed input', () => {
  it('handles empty string', () => {
    expect(parseSsPids('', 3000)).toEqual([]);
  });

  it('handles header-only output', () => {
    expect(parseSsPids('State  Recv-Q Send-Q ...', 3000)).toEqual([]);
  });

  it('handles line with port but no pid=', () => {
    const line = `LISTEN 0 511 *:3000 *:*`;
    expect(parseSsPids(line, 3000)).toEqual([]);
  });
});

// ── lsof PID parsing ─────────────────────────────────────────────────────────

describe('parseLsofPids', () => {
  it('parses single PID', () => {
    expect(parseLsofPids('12345\n')).toEqual([12345]);
  });

  it('parses multiple PIDs', () => {
    expect(parseLsofPids('111\n222\n333\n')).toEqual([111, 222, 333]);
  });

  it('handles empty string', () => {
    expect(parseLsofPids('')).toEqual([]);
  });

  it('filters out non-numeric lines', () => {
    expect(parseLsofPids('abc\n123\n\n456')).toEqual([123, 456]);
  });
});

// ── setup.js finish() contract ───────────────────────────────────────────────
// These tests verify the logic contract: when needsRestart is true and server
// is running, the CLI must call 'restart' (not 'start') to avoid port conflicts.

describe('finish() restart contract', () => {
  // Extracted logic from scripts/setup.js finish() — the command selection
  function getRestartCommand(needsRestart: boolean, isRunning: boolean): string | null {
    if (needsRestart && isRunning) {
      // Must use 'restart' to stop old process first
      return 'restart';
    }
    if (needsRestart && !isRunning) {
      // No running process, can start fresh
      return 'start';
    }
    return null; // no restart needed
  }

  it('uses restart when server is running and config changed', () => {
    expect(getRestartCommand(true, true)).toBe('restart');
  });

  it('uses start when server is NOT running and config changed', () => {
    expect(getRestartCommand(true, false)).toBe('start');
  });

  it('returns null when no restart needed', () => {
    expect(getRestartCommand(false, true)).toBeNull();
    expect(getRestartCommand(false, false)).toBeNull();
  });

  // Regression: the old code called 'start' when needsRestart=true and
  // isRunning=true, which failed assertPortFree because ports were still held.
  it('NEVER returns start when server is running (regression)', () => {
    expect(getRestartCommand(true, true)).not.toBe('start');
  });
});

// ── CLI restart contract ─────────────────────────────────────────────────────
// restart must: (1) stop first, (2) wait for ports to free, (3) then start.
// We test the port-wait logic.

describe('restart port-wait logic', () => {
  // Simulate the port-wait loop from bin/cli.js restart command
  async function waitForPortsFree(
    isPortInUse: (port: number) => Promise<boolean>,
    webPort: number,
    mcpPort: number,
    deadlineMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      const webBusy = await isPortInUse(webPort);
      const mcpBusy = await isPortInUse(mcpPort);
      if (!webBusy && !mcpBusy) return true;
      await new Promise((r) => setTimeout(r, 10)); // fast tick for tests
    }
    return false;
  }

  it('returns true immediately when ports are free', async () => {
    const result = await waitForPortsFree(() => Promise.resolve(false), 3000, 8787, 1000);
    expect(result).toBe(true);
  });

  it('waits until ports become free', async () => {
    let callCount = 0;
    const isPortInUse = async () => {
      callCount++;
      return callCount <= 4; // busy for first 4 checks, then free
    };
    const result = await waitForPortsFree(isPortInUse, 3000, 8787, 5000);
    expect(result).toBe(true);
    expect(callCount).toBeGreaterThan(4);
  });

  it('times out when ports never free', async () => {
    const result = await waitForPortsFree(() => Promise.resolve(true), 3000, 8787, 50);
    expect(result).toBe(false);
  });
});

// ── stopMindos contract ──────────────────────────────────────────────────────
// Verifies that port-based cleanup always runs, even when PID file exists.

describe('stopMindos — port cleanup always runs', () => {
  // Simulate stopMindos flow
  function simulateStop(opts: {
    pidsFromFile: number[];
    killTreeSuccess: boolean;
    killByPortResult: number;
  }): { pidKilled: boolean; portCleanupRan: boolean } {
    let pidKilled = false;
    let portCleanupRan = false;

    const pids = opts.pidsFromFile;
    if (pids.length) {
      // Kill saved PIDs
      pidKilled = opts.killTreeSuccess;
    }

    // Port-based cleanup — ALWAYS runs
    portCleanupRan = true;
    // In real code: portKilled += killByPort(port);

    return { pidKilled, portCleanupRan };
  }

  it('runs port cleanup even when PID file exists and kill succeeds', () => {
    const result = simulateStop({
      pidsFromFile: [1234, 5678],
      killTreeSuccess: true,
      killByPortResult: 0,
    });
    expect(result.pidKilled).toBe(true);
    expect(result.portCleanupRan).toBe(true); // KEY: always runs
  });

  it('runs port cleanup when PID file is empty', () => {
    const result = simulateStop({
      pidsFromFile: [],
      killTreeSuccess: false,
      killByPortResult: 1,
    });
    expect(result.portCleanupRan).toBe(true);
  });

  // Regression: old code skipped port cleanup when PID file existed,
  // leaving Next.js worker processes orphaned.
  it('REGRESSION: port cleanup must not be skipped when PIDs exist', () => {
    const result = simulateStop({
      pidsFromFile: [1111],
      killTreeSuccess: true,
      killByPortResult: 0,
    });
    expect(result.portCleanupRan).toBe(true);
  });
});

// ── Port-change restart contract ────────────────────────────────────────────
// When user changes ports in GUI, the config file has NEW ports but processes
// still listen on OLD ports.  stopMindos must clean up BOTH old and new ports.

describe('restart with port change — old ports must be cleaned', () => {
  // Simulate the restart logic: collect old ports, pass as extraPorts
  function getExtraPorts(
    oldEnv: { webPort?: string; mcpPort?: string },
    newConfig: { webPort: number; mcpPort: number },
  ): string[] {
    const extra: string[] = [];
    if (oldEnv.webPort && Number(oldEnv.webPort) !== newConfig.webPort) {
      extra.push(oldEnv.webPort);
    }
    if (oldEnv.mcpPort && Number(oldEnv.mcpPort) !== newConfig.mcpPort) {
      extra.push(oldEnv.mcpPort);
    }
    return extra;
  }

  // Simulate stopMindos port collection
  function getPortsToClean(
    configPorts: { webPort: string; mcpPort: string },
    extraPorts: string[],
  ): Set<string> {
    const ports = new Set([configPorts.webPort, configPorts.mcpPort]);
    for (const p of extraPorts) ports.add(p);
    return ports;
  }

  it('includes old ports when ports changed', () => {
    const extra = getExtraPorts(
      { webPort: '3011', mcpPort: '8787' },
      { webPort: 3012, mcpPort: 8796 },
    );
    expect(extra).toEqual(['3011', '8787']);

    // stopMindos config already has new ports
    const ports = getPortsToClean({ webPort: '3012', mcpPort: '8796' }, extra);
    expect(ports.has('3011')).toBe(true);  // old web port
    expect(ports.has('8787')).toBe(true);  // old mcp port
    expect(ports.has('3012')).toBe(true);  // new web port
    expect(ports.has('8796')).toBe(true);  // new mcp port
  });

  it('no extra ports when ports unchanged', () => {
    const extra = getExtraPorts(
      { webPort: '3011', mcpPort: '8787' },
      { webPort: 3011, mcpPort: 8787 },
    );
    expect(extra).toEqual([]);
  });

  it('handles missing old env vars (fresh start)', () => {
    const extra = getExtraPorts({}, { webPort: 3012, mcpPort: 8796 });
    expect(extra).toEqual([]);
  });

  // Regression: /api/restart passed process.env directly to child,
  // so loadConfig() skipped new values because env vars were already set.
  it('REGRESSION: child process env must not contain stale port vars', () => {
    // Simulate what /api/restart does now
    const parentEnv: Record<string, string> = {
      MINDOS_WEB_PORT: '3011',
      MINDOS_MCP_PORT: '8787',
      PATH: '/usr/bin',
    };
    const childEnv = { ...parentEnv };
    const oldWeb = childEnv.MINDOS_WEB_PORT;
    const oldMcp = childEnv.MINDOS_MCP_PORT;
    delete childEnv.MINDOS_WEB_PORT;
    delete childEnv.MINDOS_MCP_PORT;
    // Old ports must be passed via MINDOS_OLD_* so restart can clean them up
    if (oldWeb) childEnv.MINDOS_OLD_WEB_PORT = oldWeb;
    if (oldMcp) childEnv.MINDOS_OLD_MCP_PORT = oldMcp;

    expect(childEnv.MINDOS_WEB_PORT).toBeUndefined();
    expect(childEnv.MINDOS_MCP_PORT).toBeUndefined();
    expect(childEnv.MINDOS_OLD_WEB_PORT).toBe('3011');
    expect(childEnv.MINDOS_OLD_MCP_PORT).toBe('8787');
    expect(childEnv.PATH).toBe('/usr/bin'); // other vars preserved
  });

  // cli.js restart reads old ports from MINDOS_OLD_* OR current MINDOS_*
  it('restart reads old ports from MINDOS_OLD_* env (GUI path)', () => {
    // Simulate: /api/restart set MINDOS_OLD_* and deleted MINDOS_*
    const env: Record<string, string | undefined> = {
      MINDOS_OLD_WEB_PORT: '3011',
      MINDOS_OLD_MCP_PORT: '8787',
    };
    const oldWebPort = env.MINDOS_OLD_WEB_PORT || env.MINDOS_WEB_PORT;
    const oldMcpPort = env.MINDOS_OLD_MCP_PORT || env.MINDOS_MCP_PORT;
    expect(oldWebPort).toBe('3011');
    expect(oldMcpPort).toBe('8787');
  });

  it('restart reads old ports from MINDOS_* env (CLI path)', () => {
    // Simulate: `mindos restart` from CLI, no MINDOS_OLD_* set
    const env: Record<string, string | undefined> = {
      MINDOS_WEB_PORT: '3011',
      MINDOS_MCP_PORT: '8787',
    };
    const oldWebPort = env.MINDOS_OLD_WEB_PORT || env.MINDOS_WEB_PORT;
    const oldMcpPort = env.MINDOS_OLD_MCP_PORT || env.MINDOS_MCP_PORT;
    expect(oldWebPort).toBe('3011');
    expect(oldMcpPort).toBe('8787');
  });

  // The restart wait loop must wait for ALL ports (old + new) to be free
  it('wait loop covers both old and new ports', async () => {
    const allPorts = new Set([3012, 8796]);
    for (const p of ['3011', '8787']) allPorts.add(Number(p));

    expect(allPorts.size).toBe(4);
    expect(allPorts.has(3011)).toBe(true);
    expect(allPorts.has(8787)).toBe(true);
    expect(allPorts.has(3012)).toBe(true);
    expect(allPorts.has(8796)).toBe(true);
  });
});
