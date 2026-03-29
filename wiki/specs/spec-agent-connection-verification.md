<!-- Created: 2026-03-30 | Status: Implemented -->

# Spec: Agent Connection Runtime Verification

## Problem

Agent connection status was determined purely by static checks:
- `present`: binary/directory exists on disk
- `installed`: `mindos` key found in agent's MCP config file

This meant `present && installed` = "connected" (green dot), even when:
- Agent process crashed but config still exists
- HTTP endpoint is unreachable (network down)
- Agent was uninstalled but stale config remains
- Agent was never actually started

Users saw green "connected" indicators for dead agents.

## Solution

Added runtime HTTP reachability check in `/api/mcp/agents` route:

```
For each agent where installed=true AND transport=http:
  1. Extract URL from config (detectInstalled now returns url field)
  2. Send HEAD request with 1s AbortController timeout
  3. Accept 2xx or 405 (HEAD not supported) as "reachable"
  4. Any other status / timeout / network error → mark installed=false
```

## Implementation

| File | Change |
|------|--------|
| `app/lib/mcp-agents.ts` | `detectInstalled()` now returns `url` field from config entry |
| `app/app/api/mcp/agents/route.ts` | Added concurrent `Promise.all` HTTP verification for all installed agents |

**Performance:** All agent checks run concurrently with 1s timeout, so worst-case adds 1s to the API response. Typical case: <100ms (fast fail for dead endpoints).

**Scope:** Only HTTP transport agents are checked. Stdio transport agents cannot be easily verified without spawning a process.

## Status Flow

```
Config exists + Binary exists + Endpoint reachable  → "connected" (green)
Config exists + Binary exists + Endpoint unreachable → "detected"  (amber)
Binary exists + No config                            → "detected"  (amber)
No binary                                            → "notFound"  (gray)
```

## User Impact

- Accurate agent status indicators
- Dead agents immediately shown as "detected" instead of falsely "connected"
- Users know when to restart an agent
