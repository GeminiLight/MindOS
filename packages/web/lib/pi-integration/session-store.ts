import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from '@mariozechner/pi-coding-agent';

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

export function getOrCreateSessionManager(
  sessionId: string | undefined,
  cwd: string,
): SessionManager {
  if (!sessionId) {
    return SessionManager.inMemory(cwd);
  }

  const sessionDir = getSessionDir(sessionId);

  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    if (sessionDirExists(sessionId)) {
      // Reuse the most recent session in this directory
      return SessionManager.continueRecent(cwd, sessionDir);
    }

    // Brand new — create fresh session file
    return SessionManager.create(cwd, sessionDir);
  } catch (error) {
    console.error(`[session-store] Failed to open/create session ${sessionId}, falling back to inMemory:`, error);
    return SessionManager.inMemory(cwd);
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
