import { describe, expect, it } from 'vitest';
import { resolveUpstreamSubagentEntry } from '@/lib/agent/subagent-extension-entry';

/**
 * pi-subagents 0.87 ships a prebuilt bundle and declares its entry in the
 * `pi.extensions` manifest field, the convention every Pi extension follows;
 * 0.6x shipped TypeScript source only, so we hardcoded `src/extension/index.ts`.
 * Reading the manifest keeps us on whatever the package publishes.
 */

function manifest(extensions?: unknown) {
  return extensions === undefined ? {} : { pi: { extensions } };
}

describe('resolving the pi-subagents extension entry', () => {
  it('uses the entry the package declares', () => {
    expect(resolveUpstreamSubagentEntry('/pkg', manifest(['./bundle/index.js'])))
      .toBe('/pkg/bundle/index.js');
  });

  it('takes the first entry when a package declares several', () => {
    expect(resolveUpstreamSubagentEntry('/pkg', manifest(['./bundle/index.js', './other.js'])))
      .toBe('/pkg/bundle/index.js');
  });

  it('accepts a plain string, which the manifest schema also allows', () => {
    expect(resolveUpstreamSubagentEntry('/pkg', manifest('./bundle/index.js')))
      .toBe('/pkg/bundle/index.js');
  });

  it('falls back to the published source entry for versions without a manifest', () => {
    expect(resolveUpstreamSubagentEntry('/pkg', manifest()))
      .toBe('/pkg/src/extension/index.ts');
  });

  it('ignores a manifest whose entries are empty or the wrong shape', () => {
    for (const entries of [[], [''], ['  '], [42], {}, null]) {
      expect(resolveUpstreamSubagentEntry('/pkg', manifest(entries)))
        .toBe('/pkg/src/extension/index.ts');
    }
  });

  it('refuses an entry that escapes the package directory', () => {
    expect(resolveUpstreamSubagentEntry('/pkg', manifest(['../../evil.js'])))
      .toBe('/pkg/src/extension/index.ts');
    expect(resolveUpstreamSubagentEntry('/pkg', manifest(['/etc/passwd'])))
      .toBe('/pkg/src/extension/index.ts');
  });
});
