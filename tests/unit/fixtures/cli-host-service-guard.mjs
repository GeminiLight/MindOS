// Canary: fail before loading any real host-service boundary. Never probe or
// stop the developer's daemon merely to reproduce an isolation failure.
import { registerHooks } from 'node:module';
const external = new Set(['gateway.js', 'port.js'].map(name => new URL(`../../../packages/mindos/bin/lib/${name}`, import.meta.url).href));
registerHooks({
  load(url, context, nextLoad) {
    if (external.has(url)) throw new Error(`CLI fixture loaded a real host-service module: ${url}`);
    return nextLoad(url, context);
  },
});
