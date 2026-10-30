# Integrations

A widget adds live data to a service: tile stats, panels in the vitals card and alerts. Configure it under the service's `widget:` key in `services.yaml`. The fields match [gethomepage](https://gethomepage.dev/widgets/), so existing widget blocks work as they are.

**General rules**

- **Use a dedicated read-only account** wherever the product supports one. Don't reuse an admin login.
- **Use `https://` URLs.** Over `http://`, credentials cross the network in plain text.
- **Pass credentials as secrets** (`${NAME}`). See [Configuration → Secrets](configuration.md#secrets-and-variables).
- Every alert about a service starts with the service's name in the attention list ("Pi-hole: Blocking is disabled", "Nextcloud: Certificate expires in 5 d"), unless it already names it. On the service's own tile it doesn't.
- A tile is as bad as the worst alert raised for its service, wherever that alert comes from: a widget, a certificate, a full storage or a drive it reports. With a Proxmox host, the CPU and NVMe temperatures count against the Proxmox tile.
- A widget's service card and its Most used card show the same two facts (on the service card as one line), and a problem the widget sees, such as overdue backups or a stopped container, comes first in both.
- Each widget has 25 s per poll. If a call fails, the tile shows *Stats unavailable* with a short reason, keeps its last stats, and the full error goes to the container log.

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

**Shows:** CPU, RAM and running/total guests on the tile. In a cluster, set `node` to count only that node's guests.

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

Provides the PBS rows in **Storage**, **backup age** for each guest, a *Backups completed* event when new backups arrive, and disks passed into the PBS VM (such as a removable offsite disk while it's plugged in) in [**Drives**](#drives). The tile shows how long ago the **last backup** finished and how full the first **datastore** is; while backups are overdue, how many comes first.

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

**Removable datastores** (PBS 3.3 and later, such as an offsite USB disk) are expected to be detached most of the time. They show greyed out as *detached …* (time since last attached), with the bar at how full the disk was then, are left out of the backup-age checks, and raise an info reminder after `thresholds.offsiteMaxDetachedDays`. The last time the disk was attached is stored in the database, so it survives restarts.

**Alerts**

| Severity | When |
|---|---|
| warning | A guest's latest backup is older than `backupMaxAgeHours`. |
| info | A removable datastore has been detached longer than `offsiteMaxDetachedDays`. |
| info | Backup age is unavailable (missing permission or an API error). |

---

## OPNsense

Provides **WAN traffic** for the Network panel, and firewall CPU on the tile.

```yaml
widget:
  type: opnsense
  url: https://opnsense.home.arpa
  username: ${OPNSENSE_KEY}       # API key
  password: ${OPNSENSE_SECRET}    # API secret
  # wan: wan                      # interface name, if your WAN isn't "wan"
```

`key` and `secret` are accepted in place of `username` and `password`.

**Account.** Create a dedicated user who is **not** in the admin group. Grant only the privileges for **Diagnostics: Activity** and the **traffic** API (check *Effective Privileges*), then create an API key for that user.

Traffic rates come from the difference between two polls, so the first value appears one widget interval after startup (*Collecting traffic…*).

---

## OpenMediaVault

Provides the NAS rows in **Storage** (with each disk's SMART result) and the disks with SMART monitoring in [**Drives**](#drives). The tile shows how **full** the fullest data file system is (the system disk is left out; amber and red at the `storageAmberPct` / `storageWarnPct` thresholds) and the pending package **updates** (only an admin login sees them), the same in the service card and the Most used card. While an enabled service is stopped, **services** (running / enabled) comes first.

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

Provides the **DNS** part of the Network panel (queries and block rate over 24 hours) when it is the first DNS widget, or when `network.dns` names it. With AdGuard Home and Pi-hole both configured, each tile shows its own numbers.

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

Provides **container counts**, alerts for failed and unhealthy containers, and the container labels used for [label discovery](configuration.md#services-from-container-labels). The tile shows running / total containers, then how many failed (red) or are unhealthy (amber), if any.

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

Containers that exited with code 0 under restart policy `no` or `on-failure` count as finished jobs, not failures. A container that is its own tile through [label discovery](configuration.md#services-from-container-labels) without `siteMonitor` gets no alert here: its tile reports it. Add the label `dashboard.ignore=true` to hide a container entirely.

---

## Docker

The same as [Portainer](#portainer) (container counts, alerts, [label discovery](configuration.md#services-from-container-labels)), straight from a Docker host's Engine API without Portainer. Use one `docker` widget per host.

```yaml
widget:
  type: docker
  url: http://socket-proxy:2375   # a docker-socket-proxy, see Deployment
```

**Why a socket proxy.** Mounting `/var/run/docker.sock` into a container gives it root on the host, even read-only: the API can start a privileged container. So the widget only takes an `http(s)://` URL. A `unix://` URL or a socket path is reported as a config problem. Put [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) in front of the socket, allow only `CONTAINERS` and `INFO`, and keep it on an internal network. See [Deployment → Docker socket proxy](deployment.md#docker-socket-proxy).

**Counting.** The *containers up* figure adds up all Docker hosts. A host that both Portainer and a `docker` widget see (same engine ID from `/info`) is counted once, and a label-discovered service appears once.

**Alerts:** as for [Portainer](#portainer).

---

## FRITZ!Box

The tile shows the line's sync rates (↓ / ↑ Mbit/s) and how long the connection has been up; while the internet is offline, that comes first. It also provides **WAN traffic** when no OPNsense widget is configured, or when `network.service` selects it.

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

Shows values from any HTTP endpoint that answers JSON, as tile stats, with optional thresholds that raise alerts. The fields are [gethomepage's `customapi`](https://gethomepage.dev/widgets/services/customapi/), so existing blocks work as they are.

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

The tile shows the first two mappings, in mapping order (any more are read for their thresholds). `display` is accepted and ignored. A widget with thresholds only raises alerts: the service's status (Up, Down) stays its reachability check.

**Account.** Whatever the API needs. Prefer a read-only token in `headers`, passed as a secret.

**Alerts**

| Severity | When |
|---|---|
| critical / warning | A mapping crosses its `crit` / `warn` threshold: "Media server: Health is Degraded", with the threshold in the detail. |
| warning | A mapping's `field` isn't in the response. The stat shows `—`. |

If the response isn't JSON (a login page, for example), the tile shows *Stats unavailable · Response is not JSON*, and the start of the response goes to the container log.

---

## Drives

The vitals card has a **Drives** panel next to **Storage**: Storage shows how full each storage is, Drives how healthy the physical disks are. The tab appears as soon as a widget reports drives, and each browser remembers the open tab.

| Source | Drives |
|---|---|
| Proxmox VE | The node's physical disks (`/nodes/<node>/disks`), including disks or partitions passed to VMs. |
| OpenMediaVault | Disks with SMART monitoring enabled in OMV, such as a USB disk passed into the VM. |
| Proxmox Backup Server | Disks passed into the PBS VM, such as a removable datastore's disk while it's plugged in. |

Virtual disks (QEMU, virtio) are skipped, since the host reports the real drive. A disk seen by two sources (passed through whole) is shown once. Each row shows model, type (NVMe, SSD, HDD, USB), size and where it sits, then life left, temperature, power-on time and data written as far as the drive reports them. SATA SSDs that PVE lists as `hdd` with `rpm 0` are shown as SSD. SMART details are read every 10 minutes, since they change slowly and reading them wakes the disks.

**Alerts** count against the service that reported the drive, so its tile turns amber or red too. They read as the drive's model and the problem ("NAS: WD Red has 8% life left").

| Severity | When |
|---|---|
| critical | SMART reports the drive as failing (or an NVMe critical warning is set). |
| warning | OMV reports `BAD_ATTRIBUTE_IN_THE_PAST` (a threshold was crossed once) or `BAD_SECTOR` (a few bad sectors). |
| warning | Life left is at or below `thresholds.driveLifeWarnPct`. |
| warning | The drive reports media errors, or reallocated, pending or uncorrectable sectors. |
| warning | The drive is at or above `thresholds.driveTempWarnC`. |

A drive's alert also turns the tile of the service that reports it amber or red, like the service's own alerts.

---

## Host temperatures

This isn't a widget. With `host.temperature: true`, the dashboard reads CPU and NVMe temperatures from the kernel's `/sys/class/hwmon`. In an LXC container, or in Docker inside an LXC container, on the Proxmox host, the kernel is the host's, so these are the host's real temperatures. In a VM you see the VM's virtual sensors, if it has any.

CPU drivers that are recognised: `coretemp`, `k10temp`, `zenpower`, `cpu_thermal`, `soc_thermal`, and `acpitz` as a fallback.

---

## Adding an integration

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-integration).
