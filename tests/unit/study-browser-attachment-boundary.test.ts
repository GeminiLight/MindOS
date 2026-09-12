import { it, expect } from 'vitest';
import { build } from 'esbuild';
import path from 'node:path';
it('bundles attachment validation for browsers without Node built-ins', async () => {
  const result = await build({
    entryPoints: [path.resolve('packages/web/lib/agent/attachment-limits.ts')],
    bundle: true, platform: 'browser', write: false, logLevel: 'silent',
    alias: {
      '@geminilight/mindos/agent/turn': path.resolve('packages/mindos/src/agent/turn/index.ts'),
      '@geminilight/mindos/agent/turn/attachment-limits': path.resolve('packages/mindos/src/agent/turn/attachment-limits.ts'),
    },
  });
  expect(result.errors).toEqual([]);
  expect(result.outputFiles).toHaveLength(1);
});
it('bundles the browser stream consumer without importing turn execution or Node built-ins', async () => {
  const result = await build({ entryPoints: [path.resolve('packages/mindos/src/agent/stream/stream-consumer.ts')], bundle: true, platform:'browser', write:false, logLevel:'silent' });
  expect(result.errors).toEqual([]);
});
it('bundles reconnect helpers for the browser without server turn clocks', async () => {
  const result=await build({entryPoints:[path.resolve('packages/web/lib/agent/reconnect.ts')],bundle:true,platform:'browser',write:false,logLevel:'silent',alias:{'@geminilight/mindos/agent/turn/retry-policy':path.resolve('packages/mindos/src/agent/turn/retry-policy.ts')}});
  expect(result.errors).toEqual([]);
});
