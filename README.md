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

## Deploy (Portainer stack behind Traefik)

The image is published on Docker Hub as [`matthabjan/homelab-dashboard`](https://hub.docker.com/r/matthabjan/homelab-dashboard) for `linux/amd64` and `linux/arm64`. It contains only the example config. Your own `config/` folder is mounted over it at runtime, so you don't need to build anything to use your own services, icons and settings.

**Image tags:** `0.0.1` / `0.0` / `0` and `latest` are releases, `edge` follows `main`, `dev` follows `development`. Pin a version (e.g. `:0.0.1`) to update only when you choose to.

Deploy it as a custom stack in Portainer (**Stacks → Add stack → Web editor**). The example below assumes an existing Traefik that has an external Docker network (default `proxy`), an HTTPS entrypoint, a certificate resolver that can use the DNS challenge (for the wildcard certificate), and an `admin-only@file` IP allowlist middleware.

```yaml
services:
  dashboard:
    image: matthabjan/homelab-dashboard:0.0.1
    container_name: dashboard
    restart: unless-stopped
    environment:
      TZ: ${TZ:-UTC}
      CONFIG_DIR: /config
      DATA_DIR: /data
      # Traefik terminates TLS; tell the app its public origin and the real client address
      PROTOCOL_HEADER: x-forwarded-proto
      HOST_HEADER: x-forwarded-host
      ADDRESS_HEADER: x-forwarded-for
      XFF_DEPTH: 1
      # NODE_EXTRA_CA_CERTS: /certs/ca.pem   # trust your own CA for widget APIs
    # Credentials arrive as files in /run/secrets, so they don't show up in `docker inspect`
    secrets: [pve_token_secret, pbs_token_secret, opnsense_key, opnsense_secret, omv_password, adguard_password, portainer_key]
    volumes:
      - /opt/docker/dashboard/config:/config:ro   # services/settings/bookmarks + icons; reloads automatically
      - data:/data                                # uptime history (SQLite)
      # - /opt/docker/dashboard/ca.pem:/certs/ca.pem:ro
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 200
    mem_limit: 512m
    # dns: 192.168.1.53   # optional: your AdGuard / Pi-hole when the host resolves elsewhere
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.dashboard.rule=Host(`${DASHBOARD_HOST}`)
      - traefik.http.routers.dashboard.entrypoints=websecure
      - traefik.http.routers.dashboard.tls=true
      - traefik.http.routers.dashboard.tls.certresolver=letsencrypt
      - traefik.http.routers.dashboard.tls.domains[0].main=${TLS_DOMAIN}
      - traefik.http.routers.dashboard.tls.domains[0].sans=*.${TLS_DOMAIN}
      - traefik.http.routers.dashboard.middlewares=admin-only@file,dashboard-auth@docker,dashboard-headers@docker
      - traefik.http.middlewares.dashboard-auth.basicauth.users=${DASHBOARD_AUTH_USERS}
      - traefik.http.middlewares.dashboard-auth.basicauth.realm=Homelab Dashboard
      - traefik.http.middlewares.dashboard-auth.basicauth.removeheader=true
      # security headers (the Content-Security-Policy comes from the app itself, it needs per-request nonces)
      - traefik.http.middlewares.dashboard-headers.headers.stsSeconds=31536000
      - traefik.http.middlewares.dashboard-headers.headers.frameDeny=true
      - traefik.http.middlewares.dashboard-headers.headers.contentTypeNosniff=true
      - traefik.http.middlewares.dashboard-headers.headers.referrerPolicy=no-referrer
      - traefik.http.middlewares.dashboard-headers.headers.permissionsPolicy=camera=(), microphone=(), geolocation=(), payment=(), usb=()
      - traefik.http.middlewares.dashboard-headers.headers.customResponseHeaders.X-Robots-Tag=noindex, nofollow
      # manifest, icons and service worker without login, so phones can install the app (see Security model)
      - traefik.http.routers.dashboard-icons.rule=Host(`${DASHBOARD_HOST}`) && (Path(`/manifest.webmanifest`) || Path(`/service-worker.js`) || PathPrefix(`/assets/images/`))
      - traefik.http.routers.dashboard-icons.priority=1000
      - traefik.http.routers.dashboard-icons.entrypoints=websecure
      - traefik.http.routers.dashboard-icons.tls=true
      - traefik.http.routers.dashboard-icons.middlewares=admin-only@file,dashboard-headers@docker
      - traefik.http.routers.dashboard-icons.service=dashboard
      - traefik.http.routers.dashboard.service=dashboard
      - traefik.http.services.dashboard.loadbalancer.server.port=3000

# Each secret is read from the stack variable of the same name; leave it empty for integrations you don't use.
secrets:
  pve_token_secret: { environment: PVE_TOKEN_SECRET }
  pbs_token_secret: { environment: PBS_TOKEN_SECRET }
  opnsense_key: { environment: OPNSENSE_KEY }
  opnsense_secret: { environment: OPNSENSE_SECRET }
  omv_password: { environment: OMV_PASSWORD }
  adguard_password: { environment: ADGUARD_PASSWORD }
  portainer_key: { environment: PORTAINER_KEY }

volumes:
  data:

networks:
  proxy:
    external: true
```

1. Add the variables from [.env.example](.env.example) under **Environment variables**. For integrations you don't use, add the name with an empty value.
2. Put your config in the mounted folder on the Docker host; start from [config.example/](config.example).
3. In `DASHBOARD_AUTH_USERS` (output of `htpasswd -nbB <user> <password>`), write every `$` of the hash as `$$`.
4. To update, change the image tag and redeploy the stack with **Re-pull image**.

The secrets use Compose secrets with an `environment:` source, which needs a recent Docker Compose (tested with v5.6). Each integration logs an error line if its credentials are wrong.

Then point the host name at Traefik in your local DNS (e.g. an AdGuard / Pi-hole DNS rewrite). It doesn't need a public DNS record. Traefik gets a `*.<TLS_DOMAIN>` wildcard certificate, so public Certificate Transparency logs show only the wildcard, not the dashboard's name.

**Widgets report "Host not found".** The container uses the Docker host's DNS server. If your local names (e.g. `pve.home.arpa`) only exist in AdGuard or Pi-hole and the host asks a different server, set `dns:` to the AdGuard / Pi-hole IP.

**Build it yourself** from a checkout: `docker build -t homelab-dashboard:local .`

### Without Traefik

The app listens on port 3000 and has no login of its own. Put it behind any reverse proxy that handles TLS and authentication. Don't publish port 3000 directly.

## Security model

The dashboard holds API credentials for your infrastructure, and it shows your network layout to everyone who can open it. The defaults are:

| Layer | What it does |
|---|---|
| **Traefik IP allowlist** | The `admin-only@file` middleware (an `ipAllowList` in Traefik's file-provider config) lets only admin clients through. Keep guest and IoT networks out of it. |
| **Traefik basic auth** | Login required (`DASHBOARD_AUTH_USERS`). Create it with `htpasswd -nbB admin 'password'` (from `apache2-utils`). |
| **Security headers** | HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` (Traefik), and a nonce-based Content-Security-Policy (the app). |
| **Secrets as files** | Credentials go into the container as `/run/secrets/*`, not as environment variables, so `docker inspect` doesn't show them. They are never sent to the browser. |
| **TLS verification** | On by default for widget APIs. Turn it off per service only where you have to (see below). |
| **Container hardening** | Runs as the non-root `node` user, with all capabilities dropped, `no-new-privileges`, PID and memory limits, config mounted read-only, and a digest-pinned base image. |
| **Error messages** | Upstream response bodies go to the container log only. Viewers see just the HTTP status. |
| **Rate limits** | At most 10 live streams per client and 100 in total. The "open" counter accepts only same-origin JSON. |

Any container on the same Docker network as Traefik can reach the dashboard's port 3000 directly, without the allowlist or the login. Keep that network for trusted containers.

**Basic auth and installed apps.** Phones fetch the web manifest and app icons without the login when installing, so `/manifest.webmanifest` and `/assets/images/` are served without basic auth, though still only through `admin-only`. They contain the title and the app icons, nothing else. iOS home-screen apps may ask for the login again after a while.

### TLS for widget APIs

`tlsVerify: true` (the default in `settings.yaml`) rejects invalid certificates when the dashboard talks to your services' APIs. A service with a self-signed certificate has three options:

1. **Best:** route it through your reverse proxy under a name covered by a real certificate (e.g. `https://pve.example.com`).
2. **Good:** trust your own CA. Mount it into the container and set `NODE_EXTRA_CA_CERTS=/certs/ca.pem` (both lines are commented out in the example stack). The certificate must match the host name in `url:`.
3. **Fallback:** add `tlsVerify: false` to that service in `services.yaml`. The connection is still encrypted, but a machine on your LAN could intercept the credentials.

Prefer `https://` URLs for every widget. Over `http://`, passwords and API keys cross the network in plain text.

Uptime checks and certificate-expiry checks always accept self-signed certificates, because they read the certificate and send no credentials.

## Configuration (`config/`, reloads automatically)

| File | What |
|---|---|
| `services.yaml` | Services, in groups. Same format as homepage, plus `pinned: true`, `iconDark:`, `tlsVerify:` and `latencyWarnMs:` |
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

To add a secret for a new service, add it to both `secrets:` lists in your stack.

**Containers from labels.** Like homepage, the dashboard lists containers that carry `homepage.*` labels. It reads them through the Portainer widget, so at least one `portainer` widget must be configured. `homepage.group` and `homepage.name` are required. The other labels map to the YAML keys: `homepage.href`, `homepage.icon`, `homepage.description`, `homepage.siteMonitor`, `homepage.pinned`, `homepage.weight` (sort order), `homepage.widget.type`, and so on. A container joins the `services.yaml` group with the same name, or gets a new group. An entry in `services.yaml` with the same group and name takes precedence. Label values are used literally: `${NAME}` secrets are **not** filled in, so a container image can't read your secrets. Define services whose widgets need credentials in `services.yaml`.

```yaml
labels:
  - homepage.group=Management
  - homepage.name=Traefik
  - homepage.icon=traefik
  - homepage.href=https://traefik.home.arpa
  - homepage.siteMonitor=https://traefik.home.arpa
```

## API permissions (least privilege)

Give the dashboard its own read-only account wherever the product allows it. Don't reuse an admin login.

| Service | What to create |
|---|---|
| **Proxmox VE** | A privilege-separated token with `PVEAuditor` (see below). It's read-only, and `Sys.Audit` in that role also covers the update count. |
| **Proxmox Backup Server** | A token with `DatastoreAudit` on the datastore (see below). Without it you get usage but no backup freshness. |
| **OPNsense** | A dedicated user without the admin group. Grant only the privileges for **Diagnostics: Activity** and the **traffic** API (check *Effective Privileges*), then create the API key for that user. |
| **OpenMediaVault** | Needs an admin login; OMV's RPC has no read-only role. Treat this password as highly sensitive and use `https://`. |
| **AdGuard Home** | Needs the AdGuard login; AdGuard has no read-only role. Use `https://`. |
| **Portainer** | Business Edition: a user with the *Read-only user* role on the environment, and an API key for that user. Community Edition: a key always carries its user's full rights, so it can start, stop and delete containers. Protect it accordingly. Set `env:` to the environment id. Add the label `dashboard.ignore=true` to a container to hide it (from the counts and from label discovery). |
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

Work happens on `development` (published as `:dev`) and reaches `main` through pull requests (`:edge`). To publish a version, bump `version` in `package.json`, merge to `main`, then `git tag v0.0.2 && git push --tags`. The [Image workflow](.github/workflows/image.yml) checks the tag against `package.json`, builds both architectures with build provenance and an SBOM, pushes to Docker Hub, and creates the GitHub Release. Pull requests are built but not published.

## Development

```bash
npm ci
CONFIG_DIR=config.example DEMO=1 npm run dev    # http://localhost:5173 (this machine only)
```

## Tech

SvelteKit 2 / Svelte 5 (Node adapter), Node 24, and the built-in `node:sqlite` for 30 days of history. The only other runtime dependencies are `yaml` and `undici`. Fonts are self-hosted ([Geist](https://vercel.com/font), SIL Open Font License, see `static/fonts/OFL.txt`). Service logos are not included; they load from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) or your own `config/icons/`.

## License

[MIT](LICENSE)
