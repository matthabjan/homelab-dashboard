# Homelab Dashboard

[![CI](https://github.com/matthabjan/homelab-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/matthabjan/homelab-dashboard/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/v/matthabjan/homelab-dashboard?sort=semver&label=docker%20hub)](https://hub.docker.com/r/matthabjan/homelab-dashboard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A self-hosted launcher and status page for a Proxmox-based homelab. It shows at a glance whether everything is OK and gets you to your services quickly. For detailed metrics, link out to a tool such as [Pulse](https://github.com/rcourtman/Pulse).

- **Status first.** One line at the top gives the overall state ("Everything is running." or the most important problem), followed by a list of problems ordered by severity. When nothing is wrong, that list shows recent activity instead.
- **Host vitals.** CPU, RAM, storage and temperature of the Proxmox node, each with a 24-hour trend. Below them: storage across PVE, PBS and the NAS, WAN traffic, and DNS statistics.
- **Launcher.** The services you open most, picked automatically, then every service in its group. Press `/` or `⌘K` / `Ctrl+K` to open a command palette.
- **Checks.** Every service is checked every 30 s, which gives uptime (24 h and 7 d), p95 latency and a 24-hour health strip on each service tile. The dashboard also tracks TLS certificate expiry, backup age per guest, failed or unhealthy containers, SMART status and pending Proxmox updates.
- **Live and installable.** Updates are pushed to the browser as they happen, without reloading, and a service whose status changes is briefly highlighted. If updates stop (server unreachable, device offline), the page says so and greys out instead of showing old data as current. You can install it as an app (PWA) on phones and desktops, where the icon shows the number of open problems, and it has light and dark themes.
- **Works with gethomepage configs.** [gethomepage](https://gethomepage.dev)'s `services.yaml`, `bookmarks.yaml`, icon names and `homepage.*` container labels work as they are.

**Integrations:** Proxmox VE · Proxmox Backup Server · OPNsense · OpenMediaVault · AdGuard Home · Portainer · FRITZ!Box

## Quick start

To try it with built-in sample data (no homelab needed):

```bash
docker run --rm -p 3000:3000 -e DEMO=1 matthabjan/homelab-dashboard:latest
```

Open <http://localhost:3000>. Add `-e DEMO_SCENARIO=calm` to see a homelab where everything is healthy.

To run it with your own services, mount a config folder:

```bash
mkdir -p config && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/config:/seed" matthabjan/homelab-dashboard:latest cp -r /config/. /seed/
# edit config/services.yaml, then:
docker run -d --name dashboard -p 127.0.0.1:3000:3000 \
  -v "$PWD/config:/config:ro" -v dashboard-data:/data \
  matthabjan/homelab-dashboard:latest
```

The app has **no login of its own**. Before you expose it beyond localhost, put it behind a reverse proxy that handles TLS and authentication. See [Deployment](docs/deployment.md).

## Documentation

| | |
|---|---|
| [Deployment](docs/deployment.md) | Production setup with Portainer and Traefik, other proxies, security, fixing failed widgets, updates, backups |
| [Configuration](docs/configuration.md) | Reference for `settings.yaml`, `services.yaml`, `bookmarks.yaml`, icons, secrets and environment variables |
| [Integrations](docs/integrations.md) | Setup, least-privilege accounts and alerts for each widget type |
| [Contributing](CONTRIBUTING.md) | Development setup, adding an integration, releases |

## Image

Multi-arch (`linux/amd64`, `linux/arm64`) images are published to Docker Hub as [`matthabjan/homelab-dashboard`](https://hub.docker.com/r/matthabjan/homelab-dashboard), with build provenance, an SBOM and a GitHub artifact attestation:

```bash
gh attestation verify oci://docker.io/matthabjan/homelab-dashboard:latest --repo matthabjan/homelab-dashboard
```

| Tag | Tracks |
|---|---|
| `X.Y.Z`, `X.Y`, `X`, `latest` | Releases |
| `edge` | `main` |
| `dev` | `development` |

Pin an exact version in production so that it only updates when you choose to.

## Tech

SvelteKit 2 / Svelte 5 on Node 24 (Node adapter). History is stored in the built-in `node:sqlite`. The only other runtime dependencies are `yaml` and `undici`. The fonts are self-hosted [Geist](https://vercel.com/font) (SIL Open Font License, see [static/fonts/OFL.txt](static/fonts/OFL.txt)). Service logos are not bundled: they load from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [selfh.st icons](https://selfh.st/icons/) or your own files.

## License

[MIT](LICENSE)
