// Embedded pi must keep its agentDir inside MindOS's own system directory
// (~/.mindos/pi). Pointing it at ~/.pi would make MindOS auto-load the
// settings/skills/extensions of a user's independently installed pi CLI —
// the two installs must stay isolated (see spec-agent-core-consolidation C 节).
import { describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import { getMindosWebPiRuntimePaths } from '@/lib/agent/mindos-pi-runtime-host';

const MODES = ['chat', 'organize'] as const;

function getPaths(mode: (typeof MODES)[number]) {
  return getMindosWebPiRuntimePaths({
    projectRoot: path.join(os.tmpdir(), 'mindos-runtime-host-test', 'project'),
    mindRoot: path.join(os.tmpdir(), 'mindos-runtime-host-test', 'mind'),
    serverSettings: {},
    mode,
  });
}

describe('getMindosWebPiRuntimePaths agentDir isolation', () => {
  it.each(MODES)('places agentDir under ~/.mindos/pi in %s mode', (mode) => {
    const { agentDir } = getPaths(mode);
    expect(agentDir).toBe(path.join(os.homedir(), '.mindos', 'pi'));
  });

  it('never points agentDir at the standalone pi CLI dir (~/.pi)', () => {
    const { agentDir } = getPaths('chat');
    const piCliDir = path.join(os.homedir(), '.pi');
    expect(agentDir).not.toBe(piCliDir);
    expect(agentDir.startsWith(piCliDir + path.sep)).toBe(false);
  });
});
