import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { PID_PATH } from './constants.js';

export function savePids(...pids) {
  writeFileSync(PID_PATH, pids.filter(Boolean).join('\n'), 'utf-8');
}

export function loadPids() {
  if (!existsSync(PID_PATH)) return [];
  return readFileSync(PID_PATH, 'utf-8').split('\n').map(Number).filter(Boolean);
}

export function clearPids() {
  if (existsSync(PID_PATH)) rmSync(PID_PATH);
}
