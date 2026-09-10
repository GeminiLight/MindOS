#!/usr/bin/env node

// Fake `codex app-server`: a JSON-RPC-over-stdio stand-in used by the turn
// lane pool tests. Knobs (environment variables):
//   FAKE_CODEX_SPAWN_LOG      append one `pid` line per process start
//   FAKE_CODEX_METHOD_LOG     append one `method` line per request received
//   FAKE_CODEX_HANG_FIRST_TURN=1
//                              the first turn/start never completes until
//                              turn/interrupt arrives; its terminal
//                              turn/completed is then emitted 100 ms later so a
//                              following turn can observe the late notification
//   FAKE_CODEX_TURN_DELAY_MS  delay before turn/completed (default 0)

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const spawnLog = process.env.FAKE_CODEX_SPAWN_LOG;
const methodLog = process.env.FAKE_CODEX_METHOD_LOG;
const hangFirstTurn = process.env.FAKE_CODEX_HANG_FIRST_TURN === '1';
const turnDelayMs = Number(process.env.FAKE_CODEX_TURN_DELAY_MS ?? '0') || 0;

if (spawnLog) appendFileSync(spawnLog, `${process.pid}\n`);

let threadCounter = 0;
let turnCounter = 0;
/** threadId → pending interrupt resolver for a hanging turn. */
const hangingTurns = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function completeTurn(threadId, turnId, status) {
  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status } } });
}

function handleTurnStart(id, params) {
  turnCounter += 1;
  const turnId = `turn-${process.pid}-${turnCounter}`;
  const threadId = params.threadId;
  send({ id, result: { turn: { id: turnId } } });
  send({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
  const streamed = params.input?.find?.((part) => part.type === 'text')?.text ?? '';
  send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: `${turnId}-item`, delta: `fake codex ok: ${streamed}` } });
  if (hangFirstTurn && turnCounter === 1) {
    hangingTurns.set(threadId, () => {
      setTimeout(() => completeTurn(threadId, turnId, 'interrupted'), 100);
    });
    return;
  }
  setTimeout(() => completeTurn(threadId, turnId, 'completed'), turnDelayMs);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params = {} } = message;
  if (typeof method !== 'string') return;
  if (methodLog) appendFileSync(methodLog, `${method}\n`);
  switch (method) {
    case 'initialize':
      send({ id, result: { userAgent: `fake-codex-app-server/${process.pid}` } });
      return;
    case 'initialized':
      return;
    case 'thread/start':
      threadCounter += 1;
      send({ id, result: { thread: { id: `thr-${process.pid}-${threadCounter}`, cwd: params.cwd ?? null } } });
      return;
    case 'thread/resume':
      send({ id, result: { thread: { id: params.threadId } } });
      return;
    case 'turn/start':
      handleTurnStart(id, params);
      return;
    case 'turn/interrupt': {
      send({ id, result: {} });
      const resume = hangingTurns.get(params.threadId);
      if (resume) {
        hangingTurns.delete(params.threadId);
        resume();
      }
      return;
    }
    default:
      if (typeof id === 'number') {
        send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
      }
  }
});

lines.on('close', () => process.exit(0));
