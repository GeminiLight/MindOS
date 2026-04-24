/**
 * Whitelist Manager
 *
 * Manages user-approved patterns that bypass permission checks.
 * Whitelist entries are session-scoped by default (cleared on restart).
 */

import type { WhitelistEntry } from './types';

export class WhitelistManager {
  private entries: WhitelistEntry[] = [];

  /**
   * Add a pattern to the whitelist
   */
  add(
    pattern: string,
    type: 'command' | 'file' | 'path',
    expiresAt?: Date
  ): void {
    // Check if pattern already exists
    const existing = this.entries.find(
      (e) => e.pattern === pattern && e.type === type
    );

    if (existing) {
      // Update expiry if provided
      if (expiresAt) {
        existing.expiresAt = expiresAt;
      }
      return;
    }

    // Add new entry
    this.entries.push({
      pattern,
      type,
      addedAt: new Date(),
      expiresAt,
    });
  }

  /**
   * Check if a pattern is whitelisted
   */
  isWhitelisted(value: string, type: 'command' | 'file' | 'path'): boolean {
    const now = new Date();

    for (const entry of this.entries) {
      // Skip if type doesn't match
      if (entry.type !== type) {
        continue;
      }

      // Skip if expired
      if (entry.expiresAt && entry.expiresAt < now) {
        continue;
      }

      // Check if pattern matches
      try {
        const regex = new RegExp(entry.pattern);
        if (regex.test(value)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
        continue;
      }
    }

    return false;
  }

  /**
   * Remove a pattern from the whitelist
   */
  remove(pattern: string, type: 'command' | 'file' | 'path'): boolean {
    const index = this.entries.findIndex(
      (e) => e.pattern === pattern && e.type === type
    );

    if (index !== -1) {
      this.entries.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Get all whitelist entries
   */
  getAll(): WhitelistEntry[] {
    return [...this.entries];
  }

  /**
   * Get whitelist entries by type
   */
  getByType(type: 'command' | 'file' | 'path'): WhitelistEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Clear all whitelist entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = new Date();
    this.entries = this.entries.filter(
      (e) => !e.expiresAt || e.expiresAt >= now
    );
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = new Date();
    const active = this.entries.filter(
      (e) => !e.expiresAt || e.expiresAt >= now
    ).length;
    const expired = this.entries.filter(
      (e) => e.expiresAt && e.expiresAt < now
    ).length;
    const byType = {
      command: this.entries.filter((e) => e.type === 'command').length,
      file: this.entries.filter((e) => e.type === 'file').length,
      path: this.entries.filter((e) => e.type === 'path').length,
    };

    return {
      total: this.entries.length,
      active,
      expired,
      byType,
    };
  }
}

// Singleton instance
let whitelistInstance: WhitelistManager | null = null;

/**
 * Get the global WhitelistManager instance
 */
export function getWhitelistManager(): WhitelistManager {
  if (!whitelistInstance) {
    whitelistInstance = new WhitelistManager();
  }
  return whitelistInstance;
}
