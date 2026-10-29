# Configuration reference

All configuration lives in one folder: `CONFIG_DIR`, which is `/config` in the container and `./config` when you run from a checkout. Start from [config.starter/](../config.starter) (what the image ships), or see every widget in [config.example/](../config.example) (the demo).

```
config/
├── settings.yaml     # title, theme, thresholds, intervals …
├── services.yaml     # your services, in groups (gethomepage format)
├── bookmarks.yaml    # links in the footer and the command palette
├── icons/            # your own service icons (optional)
└── images/           # app icon, logo, favicon
```

**Reloading.** Saving any `*.yaml` file in the folder reloads the config within a second. You don't need to restart, and history is kept. Files in `icons/` and `images/` are read when they are requested, but browsers cache them for up to 5 minutes. If a file has a YAML syntax error or the wrong structure (for example a mapping where a list of groups belongs), the dashboard keeps showing its last version that loaded and lists `services.yaml has an error` under *Needs attention*, with the line and reason. The full error, including the lines around it, is in the container log (`[config] services.yaml: …`). A malformed group or entry is skipped and reported the same way, and the rest of the file loads. Once you fix the file, the alert clears on the next save.

**Checking what loaded.** The page **Config & status** (`/config`, linked in the footer, the command palette and every config alert) shows what the dashboard made of your files, read-only:

- **Problems:** files with errors, skipped entries, secrets that aren't set (by name), heartbeats without a token, a `docker` widget on a socket path.
- **Widgets:** each widget's type (linked to its documentation), the scheme, host and port of its `url`, a few harmless options such as `node` or `env`, whether its last poll worked, when it last succeeded, and whether it came from `services.yaml` or from container labels.
- **Checks:** each service's check (HTTP, TCP, container state or heartbeat), its target, interval and current state.
- **Automatic icons:** the icon picked for each service without `icon`, with a *Copy YAML* button to make it permanent.
- **Settings:** every effective setting.

It never shows usernames, passwords, keys, tokens, headers, request bodies, URL paths or queries, heartbeat tokens, or label values beyond group and name. What it shows is chosen field by field, so a new kind of secret can't slip through. Like the rest of the dashboard it is for your LAN or VPN, behind your proxy's login.

---

## `settings.yaml`

Every key is optional. Anything you leave out keeps its default, and nested objects are merged key by key.

### General

| Key | Default | Description |
|---|---|---|
| `title` | `Homelab` | Page title and the default name of the installed app. |
| `theme` | `system` | Default theme for new visitors: `system`, `light` or `dark`. Each viewer can switch in the header, and the choice is remembered per device. |
| `accent` | `#4F8DF7` | Accent colour as a hex value (`#rgb` to `#rrggbbaa`). An invalid value falls back to the default. |
| `linkTarget` | `_blank` | Where service links open: `_blank` (a new tab) or `_self`. |
| `tlsVerify` | `true` | Verify TLS certificates when calling widget APIs. You can override it per service. See [TLS for widget APIs](deployment.md#tls-for-widget-apis). |
| `deepLink` | none | A header button that links to a detailed-metrics tool, as `{ name, href }`. |
| `retentionDays` | `30` | How many days of probes, metrics and events to keep. Older rows are deleted every 6 hours. |

```yaml
deepLink:
  name: Pulse
  href: https://pulse.home.arpa
```

### `pwa`: app icon and logo

Paths are relative to the config folder (served under `/assets/`), or full `https://` URLs.

| Key | Default | Description |
|---|---|---|
| `name` | `title` | Name of the installed app. |
| `shortName` | `title` | Name under the icon on the home screen. |
| `logo` | `images/android-chrome-192x192.png` | Logo in the header. |
| `icon192` | `images/android-chrome-192x192.png` | PNG app icon, 192×192. |
| `icon512` | `images/android-chrome-512x512.png` | PNG app icon, 512×512. It is also used as the maskable icon, so keep the important parts inside the middle 80%. |
| `appleTouchIcon` | `images/apple-touch-icon.png` | iOS home-screen icon (180×180). |
| `favicon` | `images/favicon.ico` | Browser tab icon. |
| `background` | `#0A0D12` | Splash-screen and title-bar colour of the installed app. |

### `host`: the System panel

The System panel shows a Proxmox node when there is a `proxmox` widget, and otherwise the machine the dashboard runs on (the **local host**): CPU, memory, disk and uptime from `/proc`, plus temperatures. The panel works without Proxmox.

| Key | Default | Description |
|---|---|---|
| `source` | `auto` | `auto`: the Proxmox node if a `proxmox` widget exists, else the local host. `proxmox` or `local` forces one. |
| `name` | see description | Shown as *Node*. Default: the Proxmox node's name, else the `HOST_NAME` environment variable, else `this host`. (Inside a container the hostname is the container id, so it isn't used.) |
| `disk` | `/` | Local host: the path whose filesystem the *Disk* gauge shows. In Docker, `/` is usually the host disk that holds Docker's data. To show another disk, mount it read-only (`- /mnt/data:/mnt/data:ro`) and set `disk: /mnt/data`. |
| `service` | first `proxmox` widget | Name of the service (as written in `services.yaml`) whose Proxmox node is shown as the host. |
| `node` | first online node | Proxmox node to show, for clusters. A widget's own `node:` takes precedence. |
| `temperature` | `true` | Read CPU and NVMe temperatures from the kernel (`/sys/class/hwmon`). |
| `storage` | automatic | PVE storage shown on the System panel's *Disk* gauge. By default it is the largest local storage that holds guest disks (`images` / `rootdir` content), otherwise the root filesystem. |
| `storages` | all | List of PVE storage names to show in the Storage panel. |

What the local host shows depends on where the dashboard runs:

| Environment | What it shows |
|---|---|
| Docker container | The host's CPU, memory and uptime. Docker doesn't give a container its own view of `/proc/stat` and `/proc/meminfo`. |
| LXC with lxcfs (the Proxmox default) | The **container's** CPU and memory, not the node's. Proxmox users should keep the `proxmox` source. |
| VM | The VM itself. |

CPU usage is measured between two polls, so the CPU gauge shows `—` for the first minute after a start.

### `network`: the Network panel

| Key | Default | Description |
|---|---|---|
| `service` | OPNsense, else FRITZ!Box | Name of the service whose widget provides the WAN traffic. |
| `dns` | the first DNS widget | Name of the service whose widget (AdGuard Home or Pi-hole) provides the DNS statistics. |

### `mostUsed`

The *Most used* row above the groups fills itself from how often you open each service from the dashboard or the command palette. Each open loses half its weight every `halfLifeDays`, so services you stopped using drop out over time.

| Key | Default | Description |
|---|---|---|
| `count` | `4` | Number of tiles in the row. `0` hides it. |
| `halfLifeDays` | `14` | Days after which an open counts half as much. |

### `intervals` (seconds)

| Key | Default | Description |
|---|---|---|
| `probe` | `30` | Reachability check for every `siteMonitor`. |
| `widgets` | `60` | Polling of widget APIs, the local host and temperatures. |
| `cert` | `21600` | TLS certificate check (every 6 h). |

The page shows a "stale" notice when no update has arrived for 2.5 × the longer of `probe` and `widgets`.

### `thresholds`

| Key | Default | Effect |
|---|---|---|
| `latencyWarnMs` | `250` | A service is *Slow* when its p95 latency over the last hour is above this value. It needs at least 10 samples first. You can override it per service. |
| `certWarnDays` | `14` | Warn when a certificate expires within this many days. Under 3 days is critical. |
| `backupMaxAgeHours` | `26` | A guest's last backup older than this is *overdue*. |
| `offsiteMaxDetachedDays` | `135` | Remind you when a removable PBS datastore hasn't been attached for this long. |
| `storageAmberPct` | `70` | The storage bar turns amber. |
| `storageWarnPct` | `85` | The storage bar turns red and raises an alert. |
| `tempMinC` | `30` | Bottom of the temperature gauge's scale. |
| `tempWarnC` | `75` | Warn at this CPU temperature; at +10 °C it is critical. NVMe drives warn at 70 °C. |
| `driveLifeWarnPct` | `10` | Warn when a drive has this much of its rated endurance left (SMART wear). |
| `driveTempWarnC` | `70` | Warn when a drive in **Drives** reaches this temperature. |

CPU and memory gauges use fixed limits: CPU warns at 75% and is critical at 90%, memory at 80% and 92%.

---

## `services.yaml`

A list of groups. Each group is a list of services. This is the [gethomepage format](https://gethomepage.dev/configs/services/), so existing files work as they are.

```yaml
- Infrastructure:            # group
    - Proxmox VE:            # service name (shown on the tile)
        icon: proxmox
        href: https://pve.home.arpa:8006
        description: Virtualization
        siteMonitor: https://pve.home.arpa:8006
        widget:
          type: proxmox
          url: https://pve.home.arpa:8006
          username: dashboard@pve!dashboard
          password: ${PVE_TOKEN_SECRET}
```

| Key | Description |
|---|---|
| `href` | Where the tile links to. |
| `description` | Second line of the tile when the widget has nothing more specific to show. |
| `icon` | See [Icons](#icons). Without one, an icon is [picked automatically](#automatic-icons). |
| `iconDark` | Icon used in dark mode. |
| `siteMonitor` | URL checked every `intervals.probe` seconds, which gives up/down status, uptime and latency. Any response below 500 counts as up, including the 401 a login page returns. Two failures in a row mark the service down. `https://` URLs also get certificate-expiry checks. `tcp://host:port` only checks that the port accepts a connection, for services without HTTP (SSH, SMB, MQTT, databases); the latency is the time to connect. `probe` is accepted as an alias. |
| `heartbeat` | A push check for jobs, instead of `siteMonitor`. See [Heartbeats](#heartbeats). |
| `latencyWarnMs` | The *Slow* limit for this service, overriding `thresholds.latencyWarnMs`. |
| `tlsVerify` | `false` accepts a self-signed certificate on this service's **widget** API. It overrides the global `tlsVerify`. |
| `widget` | Live data from the service's API. See [Integrations](integrations.md) for each `type`. |

Service names should be unique within a group. A service's id is derived from its group and name, and the id is what uptime history and open counts are stored under, so **renaming a service or its group starts its history from scratch**.

Widgets of a type this dashboard doesn't implement are ignored, and the tile still works.

There is no ICMP ping: it needs extra privileges in the container. Check a port instead, such as `tcp://nas.home.arpa:445` (SMB), `:22` (SSH) or `:80`.

### Heartbeats

For jobs that run on a schedule (backups, cron jobs, scripts), the job reports to the dashboard when it ran, instead of the dashboard checking it. A heartbeat service is up while the last run is on schedule, and down when a run is overdue or the job reported a failure. Its uptime and 24-hour strip mean "on schedule".

```yaml
- Backups:
    - Nightly restic:
        description: Offsite copy
        heartbeat:
          every: 24h          # how often the job runs: 30m, 6h, 1d, 2w …
          grace: 1h           # how late it may be; default 10% of every, at least 5m
          token: ${HB_RESTIC} # a long random string, passed as a secret
          backup: true        # counts in "oldest backup" and "backups overdue"
          # id: restic        # the URL path; default: the service id (backups-nightly-restic)
```

| Key | Description |
|---|---|
| `every` | Expected time between runs: a number with `s`, `m`, `h`, `d` or `w`, or a number of seconds. |
| `grace` | How long after `every` a run may arrive before it counts as missed. Default: 10% of `every`, at least 5 minutes. |
| `token` | Required. The job sends it with each call. Generate one with `openssl rand -hex 24`. |
| `backup` | `true` adds the job to the backup figures next to Proxmox Backup Server's: *oldest backup* and *backups overdue*. That covers restic, borg, Kopia or anything else that can call a URL. |
| `id` | The id in the URL. Default: the service id, made from the group and name. Each id may be used once. |

The job calls `/api/heartbeat/<id>` (GET or POST) when it succeeded, and `/api/heartbeat/<id>/fail` when it failed. The token goes in `Authorization: Bearer <token>` or `?token=<token>`. The answer is `ok` (200). An unknown id and a wrong token both get 404, and more than one call per second for the same id gets 429.

```bash
# at the end of a backup script
if restic backup /data; then
  curl -fsS -m 10 -H "Authorization: Bearer $HB" https://dash.home.arpa/api/heartbeat/backups-nightly-restic
else
  curl -fsS -m 10 -H "Authorization: Bearer $HB" https://dash.home.arpa/api/heartbeat/backups-nightly-restic/fail
fi

# or in one line, with the job's output for the log
restic backup /data > /tmp/restic.log 2>&1 \
  && curl -fsS -m 10 "https://dash.home.arpa/api/heartbeat/backups-nightly-restic?token=$HB" \
  || curl -fsS -m 10 -H 'Content-Type: application/octet-stream' --data-binary @/tmp/restic.log "https://dash.home.arpa/api/heartbeat/backups-nightly-restic/fail?token=$HB"
```

A body sent with `/fail` is written to the container log only; the page shows when the failure was reported, never what the job said. Send it as `Content-Type: application/octet-stream` (as above): a form content type, which `curl -d` uses, is refused with 403 by the cross-site request check. A token in the URL can end up in proxy access logs, so prefer the `Authorization` header where you can.

The last success and failure are stored in the database, so a restart doesn't make jobs overdue. A new heartbeat waits for its first call until `every + grace` after the dashboard first saw it, then counts as missed. A service with a `heartbeat` ignores `siteMonitor`: the heartbeat is its check.

Behind a reverse proxy with basic auth, exempt `/api/heartbeat/` from the login, but keep it behind the IP allowlist: see [Deployment](deployment.md#heartbeats-behind-basic-auth).

---

## `bookmarks.yaml`

Links at the bottom of the page. They can also be found in the command palette. This is the gethomepage format:

```yaml
- Links:
    - GitHub:
        - icon: github
          href: https://github.com/
```

`icon` and `iconDark` work as they do for services, but a bookmark without `icon` shows a monogram (no automatic icons).

---

## Icons

`icon:` (and `iconDark:`) accepts:

| Form | Example | Source |
|---|---|---|
| File name in `config/icons/` | `nas.png`, or `nas` (tries `.png`, `.svg`, `.webp`) | Your own file |
| [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) name | `proxmox`, `adguard-home.svg` | jsDelivr CDN (PNG unless an extension is given) |
| `sh-<name>` | `sh-immich` | [selfh.st icons](https://selfh.st/icons/) via jsDelivr |
| URL | `https://example.com/logo.png` | Loaded directly by the browser |
| Path | `/icons/nas.png`, `/images/logo.png` | A file in the config folder |

A local file in `config/icons/` with a matching name takes precedence over the CDN. gethomepage's `mdi-*` and `si-*` icons are not supported, and those services show a monogram instead. A monogram is also shown when an icon fails to load.

### Automatic icons

A service without `icon` (in `services.yaml` or as the `dashboard.icon` label) gets one from the [selfh.st](https://selfh.st/icons/) or [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) collection:

- The server looks up the service name (`AdGuard Home` → `adguard-home`), then, for a [labelled container](#services-from-container-labels), its image (`ghcr.io/immich-app/immich-server` → `immich-server`, then `immich`). selfh.st is checked before dashboard-icons.
- The coloured icon is used in both themes. If it is nearly black (GitHub, LLDAP), its light variant is used in dark mode. An `iconDark` you set yourself wins.
- Both collections' indexes are downloaded from jsDelivr once a day and kept in the database. If the server can't reach jsDelivr, services without `icon` show a monogram, and it tries again an hour later.
- If the match is wrong, set `icon`: a file in `config/icons/` or any of the forms above.

Local files can be `png`, `svg`, `webp`, `jpg`, `jpeg`, `gif` or `ico`. Local SVGs are served with a restrictive Content-Security-Policy, so scripts inside them don't run.

---

## Secrets and variables

Any string in the three YAML files can contain placeholders:

| Syntax | Resolved from |
|---|---|
| `${NAME}` | See the order below |
| `{{HOMEPAGE_VAR_NAME}}` | The environment variable `HOMEPAGE_VAR_NAME`, otherwise the same order as `${NAME}` |
| `{{HOMEPAGE_FILE_NAME}}` | The contents of the file whose path is in the environment variable `HOMEPAGE_FILE_NAME` |

`${NAME}` is resolved from the first of these that exists:

1. the environment variable `NAME`
2. the file whose path is in the environment variable `NAME_FILE`
3. the file `/run/secrets/name` (the name in **lowercase**), which is where Docker and Compose secrets are mounted

The container runs as UID 1000, which must be able to read the file. Surrounding whitespace in secret files is trimmed. A secret that isn't found becomes an empty string and logs `[config] NAME is not set`. Names may contain `A–Z`, `0–9` and `_`.

Prefer files (option 3) over environment variables: environment variables are visible in `docker inspect`. Secrets are only used on the server and are never sent to the browser.

---

## Services from container labels

The dashboard can create tiles from `dashboard.*` labels on Docker containers (gethomepage's `homepage.*` labels are not read; rename them to `dashboard.*`). It reads the labels through the [Portainer widget](integrations.md#portainer), so at least one `portainer` widget must be configured.

```yaml
labels:
  - dashboard.group=Management
  - dashboard.name=Traefik
  - dashboard.icon=traefik
  - dashboard.href=https://traefik.home.arpa
  - dashboard.siteMonitor=https://traefik.home.arpa
```

- `dashboard.group` and `dashboard.name` are required. Every other `dashboard.<key>` maps to the YAML key of the same name, and nested keys use dots (`dashboard.widget.type=adguard`). The values `true` and `false` become booleans.
- `dashboard.weight` sets the order within the group (lowest first, then by name).
- A labelled service joins the `services.yaml` group with the same name, or creates a new group at the end. If `services.yaml` already defines a service with the same group and name, that one is used and the label is ignored.
- A labelled service **without** `siteMonitor` uses the container's state as its health: running, unhealthy, restarting or exited. Each Portainer poll (`intervals.widgets`) also records that state in the service's history, so it gets an uptime figure and a 24-hour strip like a checked service; running counts as up, anything else (including unhealthy) as down. A container that isn't running raises a critical *is down* alert and logs *went down* / *recovered* in Recent activity, like a failed check; unhealthy raises a warning. It has no latency, and while Portainer is unreachable nothing is recorded.
- Without `dashboard.icon`, an icon is [picked automatically](#automatic-icons) from the name, then the image.
- Label values are **used literally**. `${…}` placeholders are not filled in, so a container image can't extract your secrets. Define services whose widgets need credentials in `services.yaml`.
- Add `dashboard.ignore=true` to a container to hide it from discovery and from the container counts.

---

## Environment variables

| Variable | Default (image) | Description |
|---|---|---|
| `CONFIG_DIR` | `/config` | Config folder. Outside the image the default is `./config`. |
| `DATA_DIR` | `/data` | Where `dashboard.db` (history) is stored. Outside the image the default is `./data`. |
| `SECRETS_DIR` | `/run/secrets` | Folder searched for `${NAME}` secret files. |
| `TZ` | `UTC` | Time zone for the times shown, such as "down since 14:02". |
| `PORT` | `3000` | Listening port. |
| `HOST` | `0.0.0.0` | Listening address. |
| `ORIGIN` | none | Public URL, such as `https://dashboard.example.com`. Use it instead of `PROTOCOL_HEADER` / `HOST_HEADER` when the proxy doesn't send them. |
| `PROTOCOL_HEADER`, `HOST_HEADER` | none | Behind a reverse proxy: the headers carrying the original scheme and host (`x-forwarded-proto`, `x-forwarded-host`). |
| `ADDRESS_HEADER`, `XFF_DEPTH` | none | Behind a reverse proxy: the header and depth for the real client IP (`x-forwarded-for`, `1` for one proxy). They are needed for the per-client stream limit. |
| `NODE_EXTRA_CA_CERTS` | none | PEM file of extra CAs to trust for widget APIs, such as your own CA. |
| `DEMO` | none | `1` uses sample data instead of real APIs. |
| `DEMO_SCENARIO` | `issues` | `issues` (several problems) or `calm` (everything healthy). |
| `DEMO_CONFIG_DIR` | `/app/config.example` | The config `DEMO=1` uses while `CONFIG_DIR` is the image default `/config`, so `docker run -e DEMO=1` shows the full demo instead of the starter. |
| `HWMON_DIR` | `/sys/class/hwmon` | Where temperatures are read from. |
| `PROC_DIR` | `/proc` | Where the local host's CPU, memory and uptime are read from. |
| `HOST_NAME` | none | Name of the local host, shown as *Node* when `host.name` isn't set. |

`PORT`, `HOST`, `ORIGIN` and the `*_HEADER` variables come from SvelteKit's Node adapter. See [its documentation](https://svelte.dev/docs/kit/adapter-node#Environment-variables) for the rest, such as `BODY_SIZE_LIMIT` and `SHUTDOWN_TIMEOUT`.
