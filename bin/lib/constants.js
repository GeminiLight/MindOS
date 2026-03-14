import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT        = resolve(__dirname, '..', '..');
export const CONFIG_PATH = resolve(homedir(), '.mindos', 'config.json');
export const PID_PATH    = resolve(homedir(), '.mindos', 'mindos.pid');
export const BUILD_STAMP = resolve(ROOT, 'app', '.next', '.mindos-build-version');
export const MINDOS_DIR  = resolve(homedir(), '.mindos');
export const LOG_PATH    = resolve(MINDOS_DIR, 'mindos.log');
export const CLI_PATH    = resolve(__dirname, '..', 'cli.js');
export const NODE_BIN    = process.execPath;
export const UPDATE_CHECK_PATH = resolve(MINDOS_DIR, 'update-check.json');
export const DEPS_STAMP  = resolve(MINDOS_DIR, 'deps-hash');
