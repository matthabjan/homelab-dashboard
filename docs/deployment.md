# Deployment

The dashboard is a single container. It listens on port 3000, reads `/config`, and writes its history to `/data`. **It has no login of its own**, so always run it behind a reverse proxy that handles TLS and authentication.

- [Portainer stack behind Traefik](#portainer-stack-behind-traefik) (recommended)
- [Other reverse proxies](#other-reverse-proxies)
- [Security notes](#security-notes) and [TLS for widget APIs](#tls-for-widget-apis)
- [When a widget fails](#when-a-widget-fails)
- [Updating](#updating)
- [Backup and restore](#backup-and-restore)
- [Building the image yourself](#building-the-image-yourself)

## Requirements

- Docker with a recent Docker Compose. The secrets in the example use an `environment:` source, which needs a recent Compose release; v5.6 is tested.
- `linux/amd64` or `linux/arm64`.
- Network access from the container to the APIs and URLs in your `services.yaml`.

## Portainer stack behind Traefik

This setup assumes an existing Traefik with:

- an external Docker network (here `proxy`)
- an HTTPS entrypoint `websecure`
- a certificate resolver `letsencrypt` that can use the DNS challenge (for the wildcard certificate)
- an `admin-only@file` middleware: an [`ipAllowList`](https://doc.traefik.io/traefik/middlewares/http/ipallowlist/) in Traefik's file-provider config that lets in only your admin clients

In Portainer, open **Stacks → Add stack → Web editor** and paste:

```yaml
services:
  dashboard:
    image: matthabjan/homelab-dashboard:0.0.2   # pin a release; see Updating
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
      # manifest, icons and service worker without login, so phones can install the app (see Security)
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

Then:

1. **Stack variables.** Under **Environment variables**, add every variable from [.env.example](../.env.example). For integrations you don't use, add the name with an empty value: every secret in the stack needs its variable.
2. **Login.** Generate `DASHBOARD_AUTH_USERS` with `htpasswd -nbB admin 'your-password'` (from `apache2-utils`). In Portainer's variable editor, write every `$` in the hash as `$$`.
3. **Config.** On the Docker host, put your config in `/opt/docker/dashboard/config`, starting from [config.example/](../config.example). The container user (UID 1000) needs read access.
4. **DNS.** In your local DNS, point `DASHBOARD_HOST` at Traefik (for example with an AdGuard or Pi-hole DNS rewrite). It doesn't need a public DNS record. Traefik requests a `*.<TLS_DOMAIN>` wildcard certificate, so public Certificate Transparency logs show only the wildcard, not the dashboard's name.
5. **Deploy**, then open `https://<DASHBOARD_HOST>`. If a widget shows *Stats unavailable*, check the container log.

### Adding a secret for a new service

1. Reference it in `services.yaml`, for example `password: ${GRAFANA_TOKEN}`.
2. Add `grafana_token` to the service's `secrets:` list **and** `grafana_token: { environment: GRAFANA_TOKEN }` to the top-level `secrets:` block.
3. Add the stack variable `GRAFANA_TOKEN` and redeploy.

## Other reverse proxies

Whatever proxy you use, it must:

- **Terminate TLS and require authentication**, using basic auth, forward auth (Authelia, Authentik, oauth2-proxy …) or mTLS.
- **Restrict the source network** to trusted admin clients if you can.
- **Not buffer** `/api/stream`. It is a Server-Sent Events stream and the app sends `X-Accel-Buffering: no`, which nginx respects. With other proxies, disable response buffering for that path and allow long-lived connections (the server pings every 20 s).
- **Forward the original scheme, host and client IP**, and set `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER` and `XFF_DEPTH` to match (or set `ORIGIN`).
- Add the security headers from the Traefik example (HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`). The app sets its own Content-Security-Policy, so don't override it.

<details>
<summary>nginx example</summary>

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name dashboard.example.com;
  # ssl_certificate …; ssl_certificate_key …;

  auth_basic "Homelab Dashboard";
  auth_basic_user_file /etc/nginx/dashboard.htpasswd;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location = /api/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

Run the container with `-p 127.0.0.1:3000:3000` and the four `*_HEADER` / `XFF_DEPTH` variables from the Traefik example.

</details>

Don't publish port 3000 on a LAN-facing interface.

## Security notes

- **No login of its own.** Access control and TLS are the reverse proxy's job. Anyone who reaches port 3000 directly, including any container on the proxy's Docker network, bypasses both. Keep that network for trusted containers.
- **Installing the app with basic auth.** Phones fetch the manifest, app icons and service worker without credentials. That's why the example stack serves `/manifest.webmanifest`, `/service-worker.js` and `/assets/images/` without the login, but still only through the IP allowlist. These files contain only the title and the icons.
- **Credentials** are never sent to the browser. Upstream error bodies go to the container log only, and `${…}` placeholders in container labels are not filled in.
- Use a read-only account for each integration wherever the product allows it. See [Integrations](integrations.md).

### TLS for widget APIs

With `tlsVerify: true` (the default), the dashboard rejects invalid certificates when it calls your services' APIs. For a service with a self-signed certificate, in order of preference:

1. Route it through your reverse proxy under a name covered by a real certificate.
2. Trust your own CA: mount it and set `NODE_EXTRA_CA_CERTS=/certs/ca.pem`. The certificate must match the host name in `url:`.
3. Set `tlsVerify: false` on that service. The connection is still encrypted, but a machine on your LAN could intercept the credentials.

Use `https://` for every widget that sends credentials. Uptime and certificate-expiry checks accept self-signed certificates, because they send no credentials.

## When a widget fails

The tile shows *Stats unavailable*. The reason is listed under *Needs attention*, and the details are in `docker logs dashboard`.

| Reason | Fix |
|---|---|
| `Host not found` / `DNS lookup failed` | The container uses the Docker host's DNS server, which may not know your local names. Set `dns:` to your AdGuard / Pi-hole IP. |
| `Connection refused` / `Timed out` | Check the port and firewall from inside the container: `docker exec dashboard wget -qO- --no-check-certificate <url>`. |
| `HTTP 401` | Wrong credentials, or the secret didn't load (look for `[config] NAME is not set` in the log). |
| `HTTP 403` | The account lacks a privilege. See [Integrations](integrations.md). |
| `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | See [TLS for widget APIs](#tls-for-widget-apis). |

If config changes don't take effect, the bind mount may not pass file-change events into the container (Docker Desktop on Windows, network shares). Restart the container.

## Updating

1. Read the [release notes](https://github.com/matthabjan/homelab-dashboard/releases) for the versions you are skipping.
2. Change the image tag, for example `:0.0.2` → `:0.0.3`.
3. In Portainer, redeploy the stack with **Re-pull image** switched on. With plain Compose: `docker compose pull && docker compose up -d`.

The database schema is created and extended automatically. Config files from older versions keep working, because new settings have defaults.

## Backup and restore

| What | Where | Needed? |
|---|---|---|
| Config | your mounted `config/` folder | **Yes.** It is the only thing you can't rebuild. |
| Secrets | your stack variables or secret files | **Yes**, kept in your password manager. |
| History | `dashboard.db` (plus `-wal` and `-shm`) in the `data` volume | Optional: uptime, trends, events and how often each service was opened. |

To take a consistent copy of the database while the container runs:

```bash
docker run --rm -v dashboard_data:/data -v "$PWD:/backup" alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/dashboard.db ".backup /backup/dashboard.db"'
```

The volume name depends on your stack name; find it with `docker volume ls`. To restore, stop the container, copy the file into the volume as `dashboard.db`, delete any `dashboard.db-wal` and `dashboard.db-shm` there, and start the container again.

## Health check

The image has a Docker `HEALTHCHECK` on `GET /api/health`, which returns `200 ok` once the first snapshot has been built and `503 starting` before that. Use the same endpoint for external monitoring.

## Building the image yourself

```bash
docker build -t homelab-dashboard:local .
```

The base image is pinned by digest in the [Dockerfile](../Dockerfile) (`ARG NODE_IMAGE`). The image contains only the example config. Your own config is always mounted at runtime.
