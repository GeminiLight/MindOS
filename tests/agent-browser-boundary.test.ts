import { expect, it } from 'vitest';
import { build } from 'esbuild';
import path from 'node:path';

it('bundles chat attachment, reconnect and event helpers without Node runtime dependencies', async () => {
  const result = await build({
    entryPoints: ['attachment-limits.ts', 'reconnect.ts', '../sse/events.ts', 'stream-consumer.ts'].map(file => path.resolve('packages/web/lib/agent', file)),
    bundle: true, platform: 'browser', write: false, outdir: '/tmp/mindos-browser-boundary', logLevel: 'silent',
  });
  expect(result.outputFiles).toHaveLength(4);
});
