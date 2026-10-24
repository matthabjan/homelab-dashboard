# Homelab Dashboard

A launcher and status overview for a Proxmox-based homelab. It answers "is everything OK?" at a glance and gets you to your services fast. For deep metrics, link out to something like [Pulse](https://github.com/rcourtman/Pulse).

- **Status first.** The top line gives one verdict ("Everything is running." or the most important problem). Below it, a "Needs attention" list is ordered by severity. When nothing needs attention, the list shows recent activity instead.
- **Host vitals.** CPU, RAM, storage and temperature for the Proxmox node, each with a 24 h trend. Storage also covers PVE, PBS and the NAS. Network shows WAN traffic (OPNsense or FRITZ!Box) and AdGuard stats.
- **Launcher.** Pinned services are ordered by how often you open them, followed by all services in their groups. Press `/` or `⌘K`/`Ctrl K` to open the command palette.
- **Checks:**
  - every service is checked every 30 s, giving uptime (24 h / 7 d) and p95 latency
  - TLS certificate expiry
  - backup freshness per guest (PBS)
  - stopped or unhealthy containers (Portainer)
  - SMART status (OpenMediaVault)
  - pending Proxmox updates
- **Live and installable.** Updates are pushed to the browser (Server-Sent Events) without reloads. You can install it as an app (PWA) on phone and desktop. The theme follows the system, or you can choose System / Light / Dark in the header.
- **Reuses homepage's config.** [gethomepage](https://gethomepage.dev)'s `services.yaml`, `bookmarks.yaml` and icon names work the same way.

Integrations: Proxmox VE, Proxmox Backup Server, OPNsense, OpenMediaVault, AdGuard Home, Portainer, FRITZ!Box.

## Try it (demo data, no APIs needed)

```bash
npm ci && npm run build
DEMO=1 CONFIG_DIR=config.example npm start                        # http://localhost:3000, sample data with issues
DEMO=1 DEMO_SCENARIO=calm CONFIG_DIR=config.example npm start     # everything healthy
```

## Deploy (Docker Compose behind Traefik)

The included [compose.yaml](compose.yaml) assumes an existing Traefik that has:
- an external Docker network (default `proxy`)
- an HTTPS entrypoint
- a certificate resolver that can use the DNS challenge (for the wildcard certificate)

The image is published at `ghcr.io/matthabjan/homelab-dashboard` for `linux/amd64` and `linux/arm64`. It contains only the example config. Your own `config/` folder is mounted over it at runtime, so you don't need to build anything to use your own services, icons and settings.

```bash
mkdir -p /opt/docker/dashboard && cd /opt/docker/dashboard
curl -fsSLO https://raw.githubusercontent.com/matthabjan/homelab-dashboard/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/matthabjan/homelab-dashboard/main/.env.example -o .env && chmod 600 .env
# your services, settings and icons: start from config.example/ in this repo
git clone --depth 1 https://github.com/matthabjan/homelab-dashboard.git /tmp/hd && cp -r /tmp/hd/config.example config
nano .env                       # host name, LAN ranges, login, secrets
nano config/services.yaml
docker compose up -d
docker compose logs -f          # each integration logs an error line if credentials are wrong
```

**Image tags:** `latest` follows the `main` branch and `development` the development branch. `1.2.3` / `1.2` are releases. Set `IMAGE=ghcr.io/matthabjan/homelab-dashboard:1.2` in `.env` to update only when you choose to. To update, run `docker compose pull && docker compose up -d`.

**Build it yourself** from a checkout instead: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

Then point the host name at Traefik in your local DNS (e.g. an AdGuard / Pi-hole DNS rewrite). It doesn't need a public DNS record. Traefik gets a `*.<TLS_DOMAIN>` wildcard certificate, so public Certificate Transparency logs show only the wildcard, not the dashboard's name.

### Deploy as a Portainer stack

1. **Stacks → Add stack → Repository** with `https://github.com/matthabjan/homelab-dashboard` and compose path `compose.yaml`, or paste [compose.yaml](compose.yaml) into the **Web editor**. Either way the pre-built image is pulled; nothing is built on your host.
2. Add every variable from [.env.example](.env.example) under **Environment variables**. For integrations you don't use, add the name with an empty value.
3. Set `CONFIG_PATH` to an absolute path on the Docker host, e.g. `/opt/docker/dashboard/config`, and put your config there. Portainer's clone of the repo has no `config/` folder.
4. In `DASHBOARD_AUTH_USERS`, write every `$` of the hash as `$$`.

The secrets are passed as Compose secrets with an `environment:` source. That requires a recent Docker Compose; it is tested with Docker Compose v5.6. If your Portainer version rejects the `secrets:` block, check that it uses Compose v2 or newer.

### Without Traefik

The app listens on port 3000 and has no login of its own. Put it behind any reverse proxy that handles TLS and authentication. Don't publish port 3000 directly.

## Security model

The dashboard holds API credentials for your infrastructure, and it shows your network layout to everyone who can open it. The defaults are:

| Layer | What it does |
|---|---|
| **Traefik IP allowlist** | Only clients from `LAN_CIDRS` get through. Keep guest and IoT networks out of this list. |
| **Traefik basic auth** | Login required (`DASHBOARD_AUTH_USERS`). Create it with `htpasswd -nbB admin 'password'` (from `apache2-utils`). |
| **Security headers** | HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` (Traefik), and a nonce-based Content-Security-Policy (the app). |
| **Secrets as files** | Credentials go into the container as `/run/secrets/*`, not as environment variables, so `docker inspect` doesn't show them. They are never sent to the browser. |
| **TLS verification** | On by default for widget APIs. Turn it off per service only where you have to (see below). |
| **Container hardening** | Runs as the non-root `node` user, with all capabilities dropped, `no-new-privileges`, PID and memory limits, config mounted read-only, and a digest-pinned base image. |
| **Error messages** | Upstream response bodies go to the container log only. Viewers see just the HTTP status. |
| **Rate limits** | At most 10 live streams per client and 100 in total. The "open" counter accepts only same-origin JSON. |

Any container on the same Docker network as Traefik can reach the dashboard's port 3000 directly, without the allowlist or the login. Keep that network for trusted containers.

**Basic auth and installed apps.** The web manifest is requested with credentials, so installing works. iOS home-screen apps may ask for the login again after a while.

### TLS for widget APIs

`tlsVerify: true` (the default in `settings.yaml`) rejects invalid certificates when the dashboard talks to your services' APIs. A service with a self-signed certificate has three options:

1. **Best:** route it through your reverse proxy under a name covered by a real certificate (e.g. `https://pve.example.com`).
2. **Good:** trust your own CA. Mount it into the container and set `NODE_EXTRA_CA_CERTS=/certs/ca.pem` (both lines are commented out in `compose.yaml`). The certificate must match the host name in `url:`.
3. **Fallback:** add `tlsVerify: false` to that service in `services.yaml`. The connection is still encrypted, but a machine on your LAN could intercept the credentials.

Prefer `https://` URLs for every widget. Over `http://`, passwords and API keys cross the network in plain text.

Uptime checks and certificate-expiry checks always accept self-signed certificates, because they read the certificate and send no credentials.

## Configuration (`config/`, reloads automatically)

| File | What |
|---|---|
| `services.yaml` | Services, in groups. Same format as homepage, plus `pinned: true`, `iconDark:` and `tlsVerify:` |
| `settings.yaml` | Title, default theme, accent colour, header link, app icon, TLS verification, thresholds, intervals |
| `bookmarks.yaml` | Links at the bottom |
| `icons/` | Your own service icons, referenced by file name |
| `images/` | App icon, logo and favicon for the installed app (`settings.yaml → pwa`) |

**Icons.** `icon:` takes one of:
- a file name from `config/icons/`
- a [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) name, loaded from the jsDelivr CDN
- `sh-<name>` for [selfh.st icons](https://selfh.st/icons/)
- a URL

Set `iconDark:` for a variant shown in dark mode. If no icon is set, or one fails to load, a monogram is generated.

**Secrets.** Write `${NAME}` (or homepage's `{{HOMEPAGE_VAR_NAME}}`) in the YAML files. The value is taken from the first of these that exists:
1. the environment variable `NAME`
2. the file named in `NAME_FILE`
3. the Docker secret `/run/secrets/name` (lowercase)

To add a secret for a new service, add it to both the `secrets:` lists in `compose.yaml`.

## API permissions (least privilege)

Give the dashboard its own read-only account wherever the product allows it. Don't reuse an admin login.

| Service | What to create |
|---|---|
| **Proxmox VE** | A privilege-separated token with `PVEAuditor` (see below). It's read-only, and `Sys.Audit` in that role also covers the update count. |
| **Proxmox Backup Server** | A token with `DatastoreAudit` on the datastore (see below). Without it you get usage but no backup freshness. |
| **OPNsense** | A dedicated user without the admin group. Grant only the privileges for **Diagnostics: Activity** and the **traffic** API (check *Effective Privileges*), then create the API key for that user. |
| **OpenMediaVault** | Needs an admin login; OMV's RPC has no read-only role. Treat this password as highly sensitive and use `https://`. |
| **AdGuard Home** | Needs the AdGuard login; AdGuard has no read-only role. Use `https://`. |
| **Portainer** | Business Edition: a user with the *Read-only user* role on the environment, and an API key for that user. Community Edition: a key always carries its user's full rights, so it can start, stop and delete containers. Protect it accordingly. Set `env:` to the environment id. Add the label `dashboard.ignore=true` to a container to hide it. |
| **FRITZ!Box** | No credentials. Enable *Heimnetz → Netzwerk → Netzwerkeinstellungen → "Statusinformationen über UPnP übertragen"* (English UI: "Transmit status information over UPnP"). |

**Proxmox VE** (on a PVE node):

```bash
pveum user add dashboard@pve --comment "homelab dashboard (read-only)"
pveum acl modify / --users dashboard@pve --roles PVEAuditor
pveum user token add dashboard@pve dashboard --privsep 1     # prints the secret once
pveum acl modify / --tokens 'dashboard@pve!dashboard' --roles PVEAuditor
```
`services.yaml`: `username: dashboard@pve!dashboard`, `password: ${PVE_TOKEN_SECRET}`.

**Proxmox Backup Server** (on the PBS host; a token's rights are limited by its user's, so both need the ACL):

```bash
proxmox-backup-manager user create dashboard@pbs --comment "homelab dashboard (read-only)"
proxmox-backup-manager user generate-token dashboard@pbs dashboard     # prints the secret once
proxmox-backup-manager acl update /datastore/<store> DatastoreAudit --auth-id dashboard@pbs
proxmox-backup-manager acl update /datastore/<store> DatastoreAudit --auth-id 'dashboard@pbs!dashboard'
```
`services.yaml`: `username: dashboard@pbs!dashboard`, `password: ${PBS_TOKEN_SECRET}`, `datastore: <store>`.

**Temperatures** come from the kernel's sensor files (`/sys/class/hwmon`). In an LXC container the kernel is the Proxmox host's, so these are the host's real CPU and NVMe temperatures.

## Releases

Work happens on `development` (published as `:development`) and reaches `main` through pull requests. Pushing to `main` publishes `:latest`. To publish a version, run `git tag v1.0.0 && git push --tags`. The [Image workflow](.github/workflows/image.yml) builds both architectures and attaches build provenance and an SBOM. Pull requests are built but not published.

## Development

```bash
npm ci
CONFIG_DIR=config.example DEMO=1 npm run dev    # http://localhost:5173 (this machine only)
```

## Tech

SvelteKit 2 / Svelte 5 (Node adapter), Node 24, and the built-in `node:sqlite` for 30 days of history. The only other runtime dependencies are `yaml` and `undici`. Fonts are self-hosted ([Geist](https://vercel.com/font), SIL Open Font License, see `static/fonts/OFL.txt`). Service logos are not included; they load from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) or your own `config/icons/`.

## License

[MIT](LICENSE)
