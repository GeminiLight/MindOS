# Troubleshooting

## Local URL not accessible when running on a remote server

`mindos start` prints two URLs on startup:

```
- Local:    http://localhost:3002
- Network:  http://<server-ip>:3002
```

**Problem:** Clicking the Local URL opens nothing when you're connected via SSH.

**Cause:** `localhost` refers to the server's own loopback interface. When you access it from your local machine, it resolves to *your* machine's localhost — not the server's.

**Solutions:**

1. **Use the Network URL** — requires the port to be open in the server's firewall.

2. **SSH port forwarding** (recommended — no need to expose the port publicly):
   ```bash
   ssh -L 3002:localhost:3002 user@<server-ip>
   ```
   Then open `http://localhost:3002` in your local browser.
