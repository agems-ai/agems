# Tailscale Integration for AGEMS

Tailscale provides a zero-config VPN that lets you securely access your AGEMS instance from anywhere without exposing ports to the public internet.

## Why Tailscale?

- **No port forwarding** -- AGEMS stays off the public internet
- **End-to-end encryption** -- WireGuard-based, no traffic inspection
- **Access from anywhere** -- Reach your instance via a stable Tailscale hostname
- **MagicDNS** -- Access AGEMS at `http://agems:3000` on your tailnet
- **ACLs** -- Fine-grained access control for team members

## Prerequisites

1. A [Tailscale account](https://tailscale.com/)
2. An auth key from [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)
   - Use a **reusable** key for Docker restarts
   - Use an **ephemeral** key if you want the node to auto-deregister on shutdown
3. Docker and Docker Compose installed

## Quick Setup

### 1. Generate an Auth Key

Go to **Tailscale Admin Console > Settings > Keys** and generate a new auth key. Copy it.

### 2. Set Environment Variables

Add to your `.env` file:

```env
TS_AUTHKEY=tskey-auth-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TS_HOSTNAME=agems
```

### 3. Start with Tailscale

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

### 4. Access AGEMS

Once running, AGEMS will be available on your tailnet:

- **Web UI:** `http://agems:3000`
- **API:** `http://agems:3001`

If MagicDNS is enabled on your tailnet (default), you can use the hostname directly. Otherwise, use the Tailscale IP shown in your admin console.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TS_AUTHKEY` | Yes | -- | Tailscale auth key for automatic login |
| `TS_HOSTNAME` | No | `agems` | Hostname on your tailnet |
| `TS_STATE_DIR` | No | `/var/lib/tailscale` | Persistent state directory |
| `TS_EXTRA_ARGS` | No | -- | Additional `tailscale up` arguments |
| `TS_USERSPACE` | No | `true` | Run in userspace mode (recommended for containers) |

## Architecture

The Tailscale container runs as a sidecar, sharing the network namespace with the `web` service:

```
Internet (no public access)
         |
    [Tailnet]
         |
  ┌──────────────┐
  │  tailscale    │  ← Tailscale sidecar (network gateway)
  │  container    │
  └──────┬───────┘
         │ network_mode: "service:web"
  ┌──────┴───────┐
  │  web (Next)  │  :3000
  └──────────────┘
  ┌──────────────┐
  │  api (Nest)  │  :3001
  └──────────────┘
  ┌──────────────┐
  │  postgres    │  :5432 (internal only)
  └──────────────┘
  ┌──────────────┐
  │  redis       │  :6379 (internal only)
  └──────────────┘
```

## Advanced Configuration

### Expose only specific ports via Tailscale

By default, all ports on the shared network are accessible. To restrict access, use Tailscale ACLs in your admin console:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["group:admins"],
      "dst": ["tag:agems:3000", "tag:agems:3001"]
    }
  ]
}
```

### Funnel (Public HTTPS)

If you do want to expose AGEMS publicly with automatic HTTPS via Tailscale Funnel:

```bash
# Inside the tailscale container
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml exec tailscale \
  tailscale funnel 3000
```

This gives you a public `https://agems.tailnet-name.ts.net` URL with automatic TLS.

### Subnet Router

To make your entire Docker network accessible from your tailnet:

Set `TS_EXTRA_ARGS=--advertise-routes=172.18.0.0/16` (adjust subnet to match your Docker network).

## Troubleshooting

**Container keeps restarting:**
- Check that `TS_AUTHKEY` is valid and not expired
- Verify `/dev/net/tun` exists on the host (`ls -la /dev/net/tun`)

**Cannot reach AGEMS via Tailscale hostname:**
- Ensure MagicDNS is enabled in Tailscale admin console
- Try using the Tailscale IP directly (visible in admin console)
- Check `docker compose logs tailscale` for errors

**Auth key issues:**
- Reusable keys are recommended for Docker deployments
- Ephemeral keys cause the node to disappear on container stop
- Keys expire after the duration set at creation time

**Permission denied on /dev/net/tun:**
- The container needs `NET_ADMIN` and `SYS_MODULE` capabilities (already set in the compose file)
- On some systems, you may need to run `modprobe tun` on the host first
