<!-- Last verified: 2026-03-30 -->

# API Reference: Monitoring, Changes & Gateway

## GET /api/monitoring

Performance monitoring data. Polled every 5s by the Settings > Monitoring tab.

**Response:**

```json
{
  "system": {
    "uptimeMs": 123456,
    "memory": { "heapUsed": 52428800, "heapTotal": 67108864, "rss": 104857600 },
    "nodeVersion": "v22.x.x"
  },
  "application": {
    "agentRequests": 42,
    "toolExecutions": 156,
    "totalTokens": 12500,
    "avgResponseTimeMs": 850,
    "errors": 2
  },
  "knowledgeBase": {
    "root": "/path/to/my-mind",
    "fileCount": 127,
    "totalSizeBytes": 524288
  },
  "mcp": {
    "running": true,
    "port": 8781
  }
}
```

**Notes:**
- KB stats are cached (30s TTL) to avoid expensive disk scans
- Metrics come from `MetricsCollector` singleton (AIP-002)

---

## GET /api/changes

Content change tracking for the Activity panel.

**Operations:**

| op | Method | Params | Response |
|----|--------|--------|----------|
| `summary` | GET | — | `{ unseenCount, lastEventAt }` |
| `list` | GET | `?path=`, `?source=user\|agent\|system`, `?event_op=`, `?q=`, `?limit=50` | `{ events: [...] }` |
| `mark_seen` | POST | `{ "op": "mark_seen" }` | `{ ok: true }` |

**Event object:**

```json
{
  "id": "uuid",
  "path": "Space/note.md",
  "op": "file_created",
  "source": "user",
  "timestamp": "2026-03-30T00:00:00.000Z"
}
```

**Source types:** `user` (UI action), `agent` (AI tool call), `system` (auto-sync, scaffold)

---

## Gateway (systemd / launchd)

CLI command: `mindos gateway install|uninstall|status|logs`

**Platform detection:**
- macOS: launchd (`~/Library/LaunchAgents/com.mindos.plist`)
- Linux: systemd user service (`~/.config/systemd/user/mindos.service`)

**What `gateway install` does:**
1. Generates platform-specific service config
2. Points to current `mindos start --daemon` entrypoint
3. Enables auto-start on login
4. Starts the service immediately

**What `gateway uninstall` does:**
1. Stops the service
2. Disables auto-start
3. Removes service config file

**Log access:**
- `mindos gateway logs` — tails `~/.mindos/mindos.log`
- `mindos gateway status` — checks if service is running

**Log rotation:**
- Auto-rotates when `mindos.log` > 2MB
- Keeps 1 backup (`.old`), max ~4MB total

---

## See Also

- [AIP-002 Performance Monitoring](./architecture-improvement-proposals.md)
- [20-system-architecture.md](./20-system-architecture.md) — API routes table
