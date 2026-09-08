// Update/uninstall tests exercise the real CLI, filesystem and npm argv, not
// machine-global daemon discovery or restart. Model the intended stopped state.
// Exact module URLs keep this fixture from replacing unrelated application code.
import { registerHooks } from 'node:module';
if (process.env.NODE_ENV !== 'test') throw new Error('This fixture is test-only.');
const stubs = new Map([
  ['gateway.js', 'export const getPlatform = () => null;'],
  ['port.js', 'export const isPortInUse = async () => false; export const assertPortFree = () => { throw new Error("Unexpected port assertion in CLI fixture"); };'],
].map(([name, source]) => [new URL(`../../../packages/mindos/bin/lib/${name}`, import.meta.url).href, source]));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const source = stubs.get(resolved.url);
    return source === undefined ? resolved : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  },
});
