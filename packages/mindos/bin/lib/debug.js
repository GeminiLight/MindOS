import { dim } from './colors.js';

const enabled = process.env.MINDOS_DEBUG === '1' || process.argv.includes('--verbose');

export function debug(...args) {
  if (enabled) {
    const ts = new Date().toISOString().slice(11, 23);
    console.error(dim(`[${ts}]`), ...args);
  }
}
