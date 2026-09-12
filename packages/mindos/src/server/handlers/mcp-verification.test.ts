import { expect, it } from 'vitest';
import { readMcpInitializeResult } from './mcp-verification.js';

it('rejects a generic JSON-RPC result that is not an MCP initialization', async () => {
  expect(await readMcpInitializeResult(new Response('{"jsonrpc":"2.0","id":1,"result":{}}'))).toBe(false);
});
it('rejects an oversized response even when it contains a valid initialization', async () => {
  const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' }, padding: 'x'.repeat(65536) } });
  expect(await readMcpInitializeResult(new Response(text))).toBe(false);
});
it('ignores SSE notifications and cancels a live stream after the initialization response', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"ping"}\n\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{},"serverInfo":{"name":"test","version":"1"}}}\n\n'));
  }, cancel() { cancelled = true; } });
  expect(await readMcpInitializeResult(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))).toBe(true);
  expect(cancelled).toBe(true);
});
