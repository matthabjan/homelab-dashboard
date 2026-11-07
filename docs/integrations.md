# Integrations

A widget adds live data to a service: its status line and stats, rows of the infrastructure card, and alerts. Configure it under the service's `widget:` key in `services.yaml`. The fields match [gethomepage](https://gethomepage.dev/widgets/), so existing widget blocks work as they are.

**General rules**

- **Use a dedicated read-only account** wherever the product supports one. Don't reuse an admin login.
- **Use `https://` URLs.** Over `http://`, credentials cross the network in plain text.
- **Pass credentials as secrets** (`${NAME}`). See [Configuration → Secrets](configuration.md#secrets-and-variables).
- A widget's facts appear twice: the first two as the service's **status line** (the Status view, attention items, the service sheet's header) and all of them as **stats** in its sheet. A problem the widget sees, such as overdue backups or a stopped container, comes first.
- In the attention list, an alert starts with its service's name ("Pi-hole: Blocking is disabled") unless it already names it; on the service itself it doesn't.
- A service is as bad as the worst alert raised for it: from its widget, a certificate, a full storage or a drive it reports. With a Proxmox host, CPU and NVMe temperatures count against the Proxmox service.
- Each widget has 25 s per poll. If it fails, the status line shows *Stats unavailable*, the sheet keeps the last stats, the reason is a note in Activity, and the full error goes to the container log.

| Type | Product | Auth | Read-only possible |
|---|---|---|---|
| [`proxmox`](#proxmox-ve) | Proxmox VE | API token | ✅ `PVEAuditor` |
| [`proxmoxbackupserver`](#proxmox-backup-server) | Proxmox Backup Server | API token | ✅ `DatastoreAudit` |
| [`opnsense`](#opnsense) | OPNsense | API key + secret | ✅ scoped privileges |
| [`openmediavault`](#openmediavault) | OpenMediaVault | User + password | ❌ admin required |
| [`adguard`](#adguard-home) | AdGuard Home | User + password | ❌ |
| [`pihole`](#pi-hole) | Pi-hole | App password (v6), API token (v5) | ❌ |
| [`portainer`](#portainer) | Portainer | API key | ✅ Business Edition only |
| [`docker`](#docker) | Docker Engine | none (socket proxy) | ✅ the proxy's allowlist |
| [`whatsupdocker`](#whats-up-docker) | What's Up Docker | Basic auth or none | ❌ |
| [`fritzbox`](#fritzbox) | FRITZ!Box | none (UPnP) | n/a |
| [`customapi`](#custom-api) | any JSON API | headers, Basic auth or none | depends on the API |

---

## Proxmox VE

Provides the **System** panel (CPU, memory, disk, uptime, guests), the PVE rows in **Storage**, the host NIC traffic (LAN in and out) in **Network**, the host's physical disks in [**Drives**](#drives), and guest ids that the PBS widget uses to judge backup age.

```yaml
widget:
  type: proxmox
  url: https://pve.home.arpa:8006
  username: dashboard@pve!dashboard     # USER@REALM!TOKENID
  password: ${PVE_TOKEN_SECRET}         # token secret
  # node: pve2                          # cluster: which node to show (default: settings host.node, else first online)
```

**Account.** Create a privilege-separated token with the `PVEAuditor` role on a PVE node. The role is read-only, and its `Sys.Audit` privilege also covers the disk list with SMART data. The update count is the exception: Proxmox requires `Sys.Modify` on `/nodes/<node>` to list pending updates, which `PVEAuditor` doesn't include. Without it the dashboard skips the count, and no updates alert appears. To grant it, put `PVEAuditor` on the node path too, because an ACL on a more specific path replaces the roles inherited from `/`: `pveum role add DashboardUpdates --privs Sys.Modify`, then `pveum acl modify /nodes/<node> --tokens '<user>!<token>' --roles PVEAuditor,DashboardUpdates` (and the same with `--users <user>` for a privilege-separated token).

```bash
pveum user add dashboard@pve --comment "homelab dashboard (read-only)"
pveum acl modify / --users dashboard@pve --roles PVEAuditor
pveum user token add dashboard@pve dashboard --privsep 1     # prints the secret once
pveum acl modify / --tokens 'dashboard@pve!dashboard' --roles PVEAuditor
```

**Shows:** CPU, RAM and running/total guests. In a cluster, set `node` to count only that node's guests.

**Alerts**

| Severity | When |
|---|---|
| critical | The node isn't `online`. |
| warning | A PVE storage is unavailable, such as a missing mount. |
| warning | `host.storage` names a storage that doesn't exist. |
| info | apt updates are pending. |

PBS storages attached to PVE are left out here; the PBS widget reports them.

---

## Proxmox Backup Server

Provides the PBS rows in **Storage**, **backup age** for each guest (a *Guest backups* row among the jobs in the **Backups** sheet: guests, last run, overdue), a *Backups completed* event per job run (once no new backup has landed for 15 minutes, naming the guests by their Proxmox name), and disks passed into the PBS VM (such as a removable offsite disk while it's plugged in) in [**Drives**](#drives). The status line shows how long ago the **last backup** finished and how full the first **datastore** is; while backups are overdue, how many comes first.

```yaml
widget:
  type: proxmoxbackupserver
  url: https://pbs.home.arpa:8007
  username: dashboard@pbs!dashboard
  password: ${PBS_TOKEN_SECRET}
  datastore: [main, offsite]   # one name, a list, or leave out for all
```

**Account.** A token's rights are limited by its user's rights, so both need the ACL:

```bash
proxmox-backup-manager user create dashboard@pbs --comment "homelab dashboard (read-only)"
proxmox-backup-manager user generate-token dashboard@pbs dashboard     # prints the secret once
proxmox-backup-manager acl update /datastore/<store> DatastoreAudit --auth-id dashboard@pbs
proxmox-backup-manager acl update /datastore/<store> DatastoreAudit --auth-id 'dashboard@pbs!dashboard'
```

Without `DatastoreAudit` you still see usage, but not backup age. An info alert tells you which privilege is missing.

For **Drives**, the token also needs `Sys.Audit` on `/system/disks` (the `Audit` role on `/` includes it):

```bash
proxmox-backup-manager acl update /system/disks Audit --auth-id dashboard@pbs
proxmox-backup-manager acl update /system/disks Audit --auth-id 'dashboard@pbs!dashboard'
```

**Which backups are checked.** If a Proxmox VE widget is configured, the guests that currently exist in PVE are checked, along with every `host` backup. Without PVE, any backup group that had a backup in the last 14 days is checked. Deleted guests therefore don't cause permanent alerts.

**Guest and host backups.** Guests (VMs and containers, backed up by vzdump) and hosts (`host` groups, backed up with `proxmox-backup-client`) usually run on different schedules, so they are reported apart. The *last backup* stat and the Backups sheet's *Guest backups* row cover guests only, *host backup* and a *Host backups* row cover hosts. Activity gets a *Backups completed* event once a run's backups stop landing for 15 minutes, and a separate *Host backups completed* for host backups. Each backup group is compared with the last backup seen for it, so a backup that started before another but finished after it is still reported. A datastore that is read for the first time (just added to the widget) is a baseline: its existing backups aren't reported as new.

**Removable datastores** (PBS 3.3 and later, such as an offsite USB disk) are expected to be detached most of the time. They show greyed out as *detached …* (time since last attached), with the bar at how full the disk was then, are left out of the backup-age checks, and raise an info reminder after `thresholds.offsiteMaxDetachedDays`. The last time the disk was attached is stored in the database, so it survives restarts.

**Alerts**

| Severity | When |
|---|---|
| warning | A guest's or host's latest backup is older than `backupMaxAgeHours`. |
| info | A removable datastore has been detached longer than `offsiteMaxDetachedDays`. |
| info | Backup age is unavailable (missing permission or an API error). |

---

## OPNsense

Provides **WAN traffic** for the Network panel and firewall CPU in its status line. With the matching privileges it also reports **gateways**, **services** and **firmware updates**.

```yaml
widget:
  type: opnsense
  url: https://opnsense.home.arpa
  username: ${OPNSENSE_KEY}       # API key
  password: ${OPNSENSE_SECRET}    # API secret
  # wan: wan                      # interface name, if your WAN isn't "wan"
```

`key` and `secret` are accepted in place of `username` and `password`.

**Account.** Create a dedicated user who is **not** in the admin group, then an API key for that user. Grant only what you want the widget to read, and check *Effective Privileges* for the API paths:

| Reads | API path | Privilege |
|---|---|---|
| CPU (required) | `/api/diagnostics/activity/*` | Diagnostics: Activity |
| WAN traffic (required) | `/api/diagnostics/traffic/*` | Diagnostics: Traffic |
| Gateways (optional) | `/api/routes/gateway/*` | the one listing that path, e.g. System: Gateways |
| Services (optional) | `/api/core/service/*` | Status: Services |
| Firmware (optional) | `/api/core/firmware/*` | System: Firmware |

Leave out an optional privilege and the widget skips that part without an error. OPNsense has no read-only variant of these privileges: **Status: Services** also allows starting and stopping services, and **System: Firmware** allows installing updates and rebooting. Grant them only if you are comfortable with that for the key.

Traffic rates come from the difference between two polls, so the first value appears one widget interval after startup (*Collecting traffic…*).

The firmware status is the result of OPNsense's last update check, read every 10 minutes; the widget never starts a check itself. Run one with **Check for updates** under System → Firmware → Status; OPNsense's own dashboard also checks when its firmware widget is shown.

**Alerts**

| Severity | When |
|---|---|
| critical | A gateway is down. It leads the status line. A gateway you marked down by hand is shown but not raised. |
| warning | A gateway has packet loss or high latency, by the thresholds set on the gateway in OPNsense. |
| warning | An enabled service isn't running. |
| info | A firmware update is pending ("OPNsense 25.7.5 available", with the package count and whether it needs a reboot), or a new major release can be installed. |

---

## OpenMediaVault

Provides the NAS rows in **Storage** (with each disk's SMART result) and the disks with SMART monitoring in [**Drives**](#drives). The status line shows how **full** the fullest data file system is (the system disk is left out; amber and red at the `storageAmberPct` / `storageWarnPct` thresholds) and the pending package **updates** (only an admin login sees them). While an enabled service is stopped, **services** (running / enabled) comes first.

```yaml
widget:
  type: openmediavault
  url: https://nas.home.arpa
  username: admin
  password: ${OMV_PASSWORD}
```

**Account.** OMV's RPC API has no read-only role, so this needs an admin login. Rather than your own, create a dedicated user under **Users → Users**: shell `/usr/sbin/nologin`, member of `openmediavault-admin` only (not `_ssh` or `sudo`), no shared folder permissions. An OMV admin can effectively get root on the NAS, so treat the password as highly sensitive and use `https://`.

**Alerts**

| Severity | When |
|---|---|
| warning | A service enabled in OMV isn't running. |
| info | Package updates are available. |

Disk health alerts come from [Drives](#drives). Only disks with SMART monitoring enabled in OMV are checked. Virtual disks have no SMART data and are shown without it.

---

## AdGuard Home

Provides the **DNS** part of the Network panel: queries, block rate, average response time and a 24-hour query chart.

```yaml
widget:
  type: adguard
  url: https://adguard.home.arpa
  username: admin
  password: ${ADGUARD_PASSWORD}
```

**Account.** AdGuard Home has no read-only role, so this uses the AdGuard login. Use `https://`.

**Alerts**

| Severity | When |
|---|---|
| critical | The DNS server reports that it isn't running. |
| warning | Protection (filtering) is paused. |

---

## Pi-hole

Provides the **DNS** part of the Network panel (queries and block rate over 24 hours) when it is the first DNS widget, or when `network.dns` names it. With AdGuard Home and Pi-hole both configured, each service shows its own numbers.

```yaml
widget:
  type: pihole
  url: https://pihole.home.arpa
  key: ${PIHOLE_APP_PASSWORD}   # v6: app password; v5: API token
  # version: 5                  # Pi-hole v5 (default: 6)
```

**Account.** Pi-hole has no read-only role.
- **v6:** create an **app password** under *Settings → Web interface / API → Advanced settings → Configure app password*, so the dashboard doesn't use your login password. The dashboard logs in once and reuses that session until it expires, because Pi-hole limits the number of concurrent sessions. Without a password set on Pi-hole, leave `key` out.
- **v5:** the API token from *Settings → API / Web interface → Show API token*.

**Alerts**

| Severity | When |
|---|---|
| warning | Blocking is disabled. |

---

## Portainer

Provides **container counts**, alerts for failed and unhealthy containers, and the container labels used for [label discovery](configuration.md#services-from-container-labels). The status line shows running / total containers, then how many failed (red) or are unhealthy (amber), if any.

```yaml
widget:
  type: portainer
  url: https://portainer.home.arpa
  env: 1                  # environment (endpoint) id, from the URL in Portainer; required
  key: ${PORTAINER_KEY}
```

**Account.**
- **Business Edition:** create a user with the *Read-only user* role on the environment, then an API key for that user.
- **Community Edition:** an API key always has its user's full rights, so it can start, stop and delete containers. Protect it like an admin password.

**Alerts**

| Severity | When |
|---|---|
| critical | A container is restarting. |
| warning | A container stopped: it is dead, it exited with a non-zero code, or it exited with code 0 although its restart policy is `always` or `unless-stopped` (a `docker stop`). The alert includes the restart count. |
| warning | A container's health check reports `unhealthy`. |

Containers that exited with code 0 under restart policy `no` or `on-failure` count as finished jobs, not failures. A container that is its own service through [label discovery](configuration.md#services-from-container-labels) without `siteMonitor` gets no alert here: its own status reports it. Add the label `dashboard.ignore=true` to hide a container entirely.

---

## Docker

The same as [Portainer](#portainer) (container counts, alerts, [label discovery](configuration.md#services-from-container-labels)), straight from a Docker host's Engine API without Portainer. Use one `docker` widget per host.

```yaml
widget:
  type: docker
  url: http://socket-proxy:2375   # a docker-socket-proxy, see Deployment
```

**Why a socket proxy.** Mounting `/var/run/docker.sock` into a container gives it root on the host, even read-only: the API can start a privileged container. So the widget only takes an `http(s)://` URL. A `unix://` URL or a socket path is reported as a config problem. Put [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) in front of the socket, allow only `CONTAINERS`, and keep it on an internal network. See [Deployment → Docker socket proxy](deployment.md#docker-socket-proxy).

**Counting.** A label-discovered service appears once, however many widgets see its container.

**Alerts:** as for [Portainer](#portainer).

---

## What's Up Docker

Provides **pending image updates** for the containers [What's Up Docker](https://getwud.github.io/wud/) (WUD) watches: one note in Activity per container with a newer image, like the apt updates of Proxmox and OpenMediaVault. The status line shows how many updates are pending and how many containers WUD watches.

```yaml
widget:
  type: whatsupdocker
  url: https://wud.home.arpa
  username: dashboard            # WUD_AUTH_BASIC_<NAME>_USER; leave both out if WUD has no auth
  password: ${WUD_PASSWORD}      # the plain password, not WUD's hash
```

**Account.** WUD's basic auth has no roles, and its API can trigger updates where a trigger is configured. Add a separate user for the dashboard (`WUD_AUTH_BASIC_DASHBOARD_USER` / `_HASH`) so it can be removed on its own.

The widget reads what WUD found on its last check (`WUD_WATCHER_<NAME>_CRON`, hourly by default); it doesn't make WUD check the registries. With several watchers (Docker hosts), each container's note names it by container name.

**Notes**

| Severity | When |
|---|---|
| info | A container has a newer image: a newer tag ("29.0.1 → 29.0.3 (patch)") or a new image for the same tag ("new image for :latest"). It goes away once the container runs the new image. |

Containers whose registry lookup failed are counted as *lookup errors* in the stats; WUD's own UI shows why.

---

## FRITZ!Box

The status line shows the line's sync rates (↓ / ↑ Mbit/s) and how long the connection has been up; while the internet is offline, that comes first. It also provides **WAN traffic** when no OPNsense widget is configured, or when `network.service` selects it.

```yaml
widget:
  type: fritzbox
  url: http://192.168.178.1
```

**Setup.** No credentials are needed. Enable *Heimnetz → Netzwerk → Netzwerkeinstellungen → Statusinformationen über UPnP übertragen* (in the English UI, *Home Network → Network → Network Settings → Transmit status information over UPnP*).

The widget talks TR-064 to port **49000**, or **49443** if `url` is `https://`, whatever port is in `url`. Allow these ports if a firewall sits between the dashboard and the router.

**Alerts**

| Severity | When |
|---|---|
| critical | The internet connection isn't `Connected`. |

---

## Custom API

Shows values from any HTTP endpoint that answers JSON, as stats, with optional thresholds that raise alerts. The fields are [gethomepage's `customapi`](https://gethomepage.dev/widgets/services/customapi/), so existing blocks work as they are.

```yaml
widget:
  type: customapi
  url: https://media.home.arpa/api/status
  # method: GET                      # or POST
  # headers: { X-Api-Key: "${MEDIA_KEY}" }
  # requestBody: { query: status }   # an object is sent as JSON
  # username: dashboard              # Basic auth
  # password: ${MEDIA_PASSWORD}
  # refreshInterval: 300000          # ms; at least intervals.widgets
  mappings:
    - field: sessions.active         # dot path; list items by index: streams.0.user
      label: sessions
      format: number
    - field: { library: items }      # gethomepage's nested form works too
      label: items
      format: number
    - field: healthy
      label: health
      remap: [{ value: true, to: OK }, { value: false, to: Degraded }]
      crit: { below: 1 }             # ours: alert when the value crosses a threshold
```

**Mapping keys**

| Key | Meaning |
|---|---|
| `field` | Where the value is: a dot path (`a.b.0.c`) or the nested form `{ a: { b: c } }`. |
| `label` | The stat's label. Default: the last key of `field`. A threshold alert is "{label} is {value}", after the service name. |
| `format` | `text` (default), `number`, `float`, `percent`, `bytes`, `bitrate` (bits/s), `duration` (seconds), `date`, `relativeDate`, `size` (length of a list or object). |
| `prefix`, `suffix` | Text before and after the value. |
| `scale` | Multiply numbers, for example `100` or `"1/1024"`. |
| `remap` | Replace values: `[{ value: 1, to: up }, { any: true, to: down }]`. The first match wins. |
| `warn`, `crit` | Thresholds: `{ above: n }`, `{ below: n }`, `{ equals: v }` or `{ not: v }`. They are compared with the value after `scale` and before `remap`. A boolean counts as 0 or 1. |

The status line shows the first two mappings, the sheet all of them, in mapping order. `display` is accepted and ignored. A widget with thresholds only raises alerts: the service's status (Up, Down) stays its reachability check.

**Account.** Whatever the API needs. Prefer a read-only token in `headers`, passed as a secret.

**Alerts**

| Severity | When |
|---|---|
| critical / warning | A mapping crosses its `crit` / `warn` threshold: "Media server: Health is Degraded", with the threshold in the detail. |
| warning | A mapping's `field` isn't in the response. The stat shows `—`. |

If the response isn't JSON (a login page, for example), the status line shows *Stats unavailable · Response is not JSON*, and the start of the response goes to the container log.

---

## Drives

The **Drives** row of the infrastructure card, and the **Drives** tab of its sheet, sit next to **Storage**: Storage shows how full each storage is, Drives how healthy the physical disks are. Both appear as soon as a widget reports drives, grouped by the host or service that reports them; a drive to check turns it amber.

| Source | Drives |
|---|---|
| Proxmox VE | The node's physical disks (`/nodes/<node>/disks`), including disks or partitions passed to VMs. |
| OpenMediaVault | Disks with SMART monitoring enabled in OMV, such as a USB disk passed into the VM. |
| Proxmox Backup Server | Disks passed into the PBS VM, such as a removable datastore's disk while it's plugged in. |

Virtual disks (QEMU, virtio) are skipped, since the host reports the real drive. A disk seen by two sources (passed through whole) is shown once. Each row shows model, type (NVMe, SSD, HDD, USB), size and where it sits, then life left, temperature, power-on time and data written as far as the drive reports them. SATA SSDs that PVE lists as `hdd` with `rpm 0` are shown as SSD. SMART details are read every 10 minutes, since they change slowly and reading them wakes the disks.

**Alerts** count against the service that reported the drive, so it turns amber or red too. They read as the drive's model and the problem ("NAS: WD Red has 8% life left").

| Severity | When |
|---|---|
| critical | SMART reports the drive as failing (or an NVMe critical warning is set). |
| warning | OMV reports `BAD_ATTRIBUTE_IN_THE_PAST` (a threshold was crossed once) or `BAD_SECTOR` (a few bad sectors). |
| warning | Life left is at or below `thresholds.driveLifeWarnPct`. |
| warning | The drive reports media errors, or reallocated, pending or uncorrectable sectors. |
| warning | The drive is at or above `thresholds.driveTempWarnC`. |

---

## Host temperatures

This isn't a widget. With `host.temperature: true`, the dashboard reads CPU and NVMe temperatures from the kernel's `/sys/class/hwmon`. In an LXC container, or in Docker inside an LXC container, on the Proxmox host, the kernel is the host's, so these are the host's real temperatures. In a VM you see the VM's virtual sensors, if it has any.

CPU drivers that are recognised: `coretemp`, `k10temp`, `zenpower`, `cpu_thermal`, `soc_thermal`, and `acpitz` as a fallback.

---

## Adding an integration

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-integration).
