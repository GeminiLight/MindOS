/**
 * Tests for shared/connection-store.ts — CRUD operations and limits
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectionStore, createMemoryStorage } from 'shared/connection-store';
import type { SavedConnection } from 'shared/connection';

function makeConn(address: string, daysAgo: number = 0): SavedConnection {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    address,
    lastConnected: d.toISOString(),
    authMethod: 'password',
  };
}

describe('createConnectionStore', () => {
  let store: ReturnType<typeof createConnectionStore>;

  beforeEach(() => {
    store = createConnectionStore(createMemoryStorage());
  });

  // ── Normal paths ──
  it('starts with empty connections', () => {
    expect(store.getConnections()).toEqual([]);
  });

  it('saves and retrieves a connection', () => {
    const conn = makeConn('http://localhost:3456');
    store.saveConnection(conn);
    const list = store.getConnections();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe('http://localhost:3456');
  });

  it('returns connections sorted by lastConnected descending', () => {
    store.saveConnection(makeConn('http://old.com', 5));
    store.saveConnection(makeConn('http://recent.com', 0));
    store.saveConnection(makeConn('http://middle.com', 2));

    const list = store.getConnections();
    expect(list[0].address).toBe('http://recent.com');
    expect(list[1].address).toBe('http://middle.com');
    expect(list[2].address).toBe('http://old.com');
  });

  it('updates existing connection by address', () => {
    store.saveConnection(makeConn('http://server.com', 3));
    store.saveConnection({ ...makeConn('http://server.com', 0), label: 'My Server' });

    const list = store.getConnections();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('My Server');
  });

  it('removes a connection by address', () => {
    store.saveConnection(makeConn('http://a.com'));
    store.saveConnection(makeConn('http://b.com'));
    store.removeConnection('http://a.com');

    const list = store.getConnections();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe('http://b.com');
  });

  // ── MAX_CONNECTIONS limit ──
  it('enforces max 5 connections, dropping oldest', () => {
    for (let i = 0; i < 7; i++) {
      store.saveConnection(makeConn(`http://server${i}.com`, 7 - i));
    }

    const list = store.getConnections();
    expect(list).toHaveLength(5);
    // Most recent should be server6 (0 days ago)
    expect(list[0].address).toBe('http://server6.com');
    // Oldest should be server2 (5 days ago), not server0/server1 which got trimmed
    expect(list[4].address).toBe('http://server2.com');
  });

  // ── Active connection ──
  it('stores and retrieves active connection', () => {
    expect(store.getActiveConnection()).toBeNull();
    store.setActiveConnection('http://myserver.com');
    expect(store.getActiveConnection()).toBe('http://myserver.com');
  });

  it('clears active connection', () => {
    store.setActiveConnection('http://myserver.com');
    store.clearActiveConnection();
    expect(store.getActiveConnection()).toBeNull();
  });

  // ── Edge cases ──
  it('handles removing non-existent address', () => {
    store.saveConnection(makeConn('http://a.com'));
    store.removeConnection('http://nonexistent.com');
    expect(store.getConnections()).toHaveLength(1);
  });

  it('handles empty storage gracefully', () => {
    expect(store.getConnections()).toEqual([]);
    expect(store.getActiveConnection()).toBeNull();
    store.removeConnection('http://ghost.com'); // no throw
  });

  it('handles corrupted storage data', () => {
    const storage = createMemoryStorage();
    storage.set('mindos:connections', 'not-json');
    const s = createConnectionStore(storage);
    expect(s.getConnections()).toEqual([]); // graceful fallback
  });

  it('handles non-array JSON in storage', () => {
    const storage = createMemoryStorage();
    storage.set('mindos:connections', '"just a string"');
    const s = createConnectionStore(storage);
    expect(s.getConnections()).toEqual([]);
  });
});
