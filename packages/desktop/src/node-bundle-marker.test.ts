import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODE_BUNDLE_MARKER_FILE,
  isBundledNodeCurrent,
  writeNodeBundleMarker,
} from '../scripts/node-bundle-marker.mjs';

const TARGET = { platform: 'darwin', arch: 'arm64', nodeVersion: '22.16.0' };
const tempDirs: string[] = [];

function makeNodeDir(opts: { withBin?: boolean; marker?: object | string | null } = {}): { nodeDest: string; expectedBin: string } {
  const nodeDest = mkdtempSync(path.join(os.tmpdir(), 'mindos-node-marker-'));
  tempDirs.push(nodeDest);
  const expectedBin = path.join(nodeDest, 'bin', 'node');
  if (opts.withBin !== false) {
    mkdirSync(path.dirname(expectedBin), { recursive: true });
    writeFileSync(expectedBin, '#!/bin/sh\n');
  }
  if (typeof opts.marker === 'string') {
    writeFileSync(path.join(nodeDest, NODE_BUNDLE_MARKER_FILE), opts.marker, 'utf-8');
  } else if (opts.marker) {
    writeNodeBundleMarker(nodeDest, opts.marker as never);
  }
  return { nodeDest, expectedBin };
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('bundled-node marker', () => {
  it('accepts a bundled node whose marker matches the requested target', () => {
    const { nodeDest, expectedBin } = makeNodeDir({ marker: TARGET });
    expect(isBundledNodeCurrent(nodeDest, expectedBin, TARGET)).toBe(true);
  });

  it('rejects when the node binary is missing', () => {
    const { nodeDest, expectedBin } = makeNodeDir({ withBin: false, marker: TARGET });
    expect(isBundledNodeCurrent(nodeDest, expectedBin, TARGET)).toBe(false);
  });

  it('rejects a legacy unmarked node dir (could be any platform/arch)', () => {
    const { nodeDest, expectedBin } = makeNodeDir();
    expect(isBundledNodeCurrent(nodeDest, expectedBin, TARGET)).toBe(false);
  });

  it('rejects on platform, arch or node-version mismatch', () => {
    for (const stale of [
      { ...TARGET, platform: 'linux' },   // the cross-compile bug: linux node in a mac zip
      { ...TARGET, arch: 'x64' },         // dist:mac-zip dual-arch reuse
      { ...TARGET, nodeVersion: '20.0.0' },
    ]) {
      const { nodeDest, expectedBin } = makeNodeDir({ marker: stale });
      expect(isBundledNodeCurrent(nodeDest, expectedBin, TARGET)).toBe(false);
    }
  });

  it('treats corrupt marker JSON as not-current', () => {
    const { nodeDest, expectedBin } = makeNodeDir({ marker: '{not json' });
    expect(isBundledNodeCurrent(nodeDest, expectedBin, TARGET)).toBe(false);
  });
});
