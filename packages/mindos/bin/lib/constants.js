import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(__dirname, '..', '..');
export const MONOREPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
export const ROOT = existsSync(resolve(MONOREPO_ROOT, 'pnpm-workspace.yaml'))
  ? MONOREPO_ROOT
  : PACKAGE_ROOT;
export const PRODUCT_PACKAGE_JSON = resolve(PACKAGE_ROOT, 'package.json');
export const WEB_APP_DIR = resolve(ROOT, 'packages', 'web');
export const CONFIG_PATH = resolve(homedir(), '.mindos', 'config.json');
export const PID_PATH    = resolve(homedir(), '.mindos', 'mindos.pid');
export const BUILD_STAMP = resolve(WEB_APP_DIR, '.next', '.mindos-build-version');
export const MINDOS_DIR  = resolve(homedir(), '.mindos');
export const LOG_PATH    = resolve(MINDOS_DIR, 'mindos.log');
export const CLI_PATH    = resolve(PACKAGE_ROOT, 'bin', 'cli.js');
export const NODE_BIN    = process.execPath;
export const UPDATE_CHECK_PATH = resolve(MINDOS_DIR, 'update-check.json');
export const DEPS_STAMP  = resolve(MINDOS_DIR, 'deps-hash');
export const STANDALONE_SERVER = resolve(PACKAGE_ROOT, '_standalone', 'server.js');
export const STANDALONE_STAMP  = resolve(PACKAGE_ROOT, '_standalone', '.mindos-build-version');
