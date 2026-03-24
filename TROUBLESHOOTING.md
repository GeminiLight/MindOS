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

## Docker: `Cannot connect to the Docker daemon`

The client is installed but **no daemon is listening** on `/var/run/docker.sock` (service not running, or you lack permission).

1. **Start Docker** (Linux): `sudo systemctl start docker` then `sudo systemctl enable docker`.
2. **Permission**: add your user to the `docker` group, then re-login: `sudo usermod -aG docker "$USER"`.
3. **Not installed**: use your distro’s package (`docker.io` on Debian/Ubuntu, `docker-ce` from [Docker’s docs](https://docs.docker.com/engine/install/)) or your cloud’s “容器服务”文档.

**BuildKit / buildx** (optional): `sudo apt install docker-buildx-plugin` (Debian/Ubuntu) or set `export DOCKER_BUILDKIT=1` when building.

See also **`DOCKER.md`** in the repo root.

## Docker: `unknown flag: --rm` when running `docker compose run --rm …`

Usually **`docker compose` is not available** (Compose V2 plugin not installed), so the CLI does not enter the compose subcommand and `--rm` is parsed as a top-level `docker` flag (invalid).

1. Install the plugin: `sudo apt install docker-compose-plugin` (Debian/Ubuntu) or `sudo dnf install docker-compose-plugin` / `sudo yum install docker-compose-plugin` (Fedora/RHEL-style — **no `apt` on these**). If the package is missing, follow [Docker Engine install](https://docs.docker.com/engine/install/) for your distro.
2. Verify: `docker compose version`.
3. Run onboard **without** `--rm`: `docker compose run mindos mindos onboard`, or use standalone **`docker-compose run --rm …`** if you only have the v1 binary.
