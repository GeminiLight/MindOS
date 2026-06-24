import fs from 'fs';
import path from 'path';
import os from 'os';

function getSessionsRoot(): string {
  return path.join(os.homedir(), '.mindos', 'sessions');
}

export function getSessionDir(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSessionsRoot(), safe);
}

export function sessionDirExists(sessionId: string): boolean {
  const sessionDir = getSessionDir(sessionId);
  if (!fs.existsSync(sessionDir)) return false;
  // Check if there's at least one .jsonl file
  try {
    return fs.readdirSync(sessionDir).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

export function deleteSessionDir(sessionId: string): boolean {
  const sessionDir = getSessionDir(sessionId);
  if (!fs.existsSync(sessionDir)) return false;
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`[session-store] Failed to delete session dir ${sessionDir}:`, error);
    return false;
  }
}
