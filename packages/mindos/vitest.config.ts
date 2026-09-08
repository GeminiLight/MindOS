import { defineConfig } from 'vitest/config';

// Vitest 3+ changed two defaults that the core suite relied on:
// - fake timers now fake `performance` too, so `performance.timeOrigin` becomes
//   the epoch at which the fake clock was installed. run-ledger caches
//   `Math.round(performance.timeOrigin)` as the process identity, so a test that
//   installs fake timers first would poison the identity for the rest of the file.
//   Keep the Vitest 2 list: timers and Date only.
// - `turbo run test` executes every workspace suite at once; the SQLite-backed
//   ledger/store tests insert hundreds of rows and blow the 5s default under that
//   contention while passing alone. Web (20s) and mobile (30s) already run with a
//   larger budget, so give core the same headroom.
export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'Date'],
    },
  },
});
