'use client';

import { useEffect } from 'react';
import { useMcpStore } from '@/lib/stores/mcp-store';

/**
 * Thin component that initializes MCP store side-effects (polling, event listeners).
 * Renders nothing — drop it anywhere in the tree that needs MCP data.
 * Replaces the old <McpProvider> wrapper.
 */
export default function McpStoreInit() {
  useEffect(() => {
    const cleanup = useMcpStore.getState()._init();
    return cleanup;
  }, []);

  return null;
}
