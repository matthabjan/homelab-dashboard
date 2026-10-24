# Integrations

A widget adds live data to a service: tile stats, cards on the page and alerts. Configure it under the service's `widget:` key in `services.yaml`. The fields match [gethomepage](https://gethomepage.dev/widgets/), so existing widget blocks work as they are.

**General rules**

- **Use a dedicated read-only account** wherever the product supports one. Don't reuse an admin login.
- **Use `https://` URLs.** Over `http://`, credentials cross the network in plain text.
- **Pass credentials as secrets** (`${NAME}`). See [Configuration → Secrets](configuration.md#secrets-and-variables).
- Each widget has 25 s per poll. If a call fails, the tile shows *Stats unavailable* with a short reason, keeps its last stats, and the full error goes to the container log.

| Type | Product | Auth | Read-only possible |
|---|---|---|---|
| [`proxmox`](#proxmox-ve) | Proxmox VE | API token | ✅ `PVEAuditor` |
| [`proxmoxbackupserver`](#proxmox-backup-server) | Proxmox Backup Server | API token | ✅ `DatastoreAudit` |
| [`opnsense`](#opnsense) | OPNsense | API key + secret | ✅ scoped privileges |
| [`openmediavault`](#openmediavault) | OpenMediaVault | User + password | ❌ admin required |
| [`adguard`](#adguard-home) | AdGuard Home | User + password | ❌ |
| [`portainer`](#portainer) | Portainer | API key | ✅ Business Edition only |
| [`fritzbox`](#fritzbox) | FRITZ!Box | none (UPnP) | n/a |

---

## Proxmox VE

Provides the **Host** card (CPU, memory, storage, uptime, guests), the PVE rows in **Storage**, the host NIC traffic (LAN in and out) in **Network**, and guest ids that the PBS widget uses to judge backup age.

```yaml
widget:
  type: proxmox
  url: https://pve.home.arpa:8006
  username: dashboard@pve!dashboard     # USER@REALM!TOKENID
  password: ${PVE_TOKEN_SECRET}         # token secret
  # node: pve2                          # cluster: which node to show (default: settings host.node, else first online)
```

**Account.** Create a privilege-separated token with the `PVEAuditor` role on a PVE node. The role is read-only, and its `Sys.Audit` privilege also covers the update count.

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

Provides the PBS rows in **Storage**, **backup age** for each guest, and a *Backups completed* event when new backups arrive.

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

**Which backups are checked.** If a Proxmox VE widget is configured, the guests that currently exist in PVE are checked, along with every `host` backup. Without PVE, any backup group that had a backup in the last 14 days is checked. Deleted guests therefore don't cause permanent alerts.

**Removable datastores** (PBS 3.3 and later, such as an offsite USB disk) are expected to be detached most of the time. They show as *detached · last attached … ago*, are left out of the backup-age checks, and raise an info reminder after `thresholds.offsiteMaxDetachedDays`. The last time the disk was attached is stored in the database, so it survives restarts.

**Alerts**

| Severity | When |
|---|---|
| warning | A guest's latest backup is older than `backupMaxAgeHours`. |
| info | A removable datastore has been detached longer than `offsiteMaxDetachedDays`. |
| info | Backup age is unavailable (missing permission or an API error). |

---

## OPNsense

Provides **WAN traffic** for the Network card, and firewall CPU on the tile.

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

Provides the NAS rows in **Storage** (with each disk's SMART result), plus SMART status and service status on the tile.

```yaml
widget:
  type: openmediavault
  url: https://nas.home.arpa
  username: admin
  password: ${OMV_PASSWORD}
```

**Account.** OMV's RPC API has no read-only role, so this needs an admin login. Treat the password as highly sensitive and use `https://`.

**Alerts**

| Severity | When |
|---|---|
| critical | A monitored disk's SMART status isn't `GOOD`. |
| warning | A service enabled in OMV isn't running. |

Only disks with SMART monitoring enabled in OMV are checked. Virtual disks have no SMART data and are shown without it.

---

## AdGuard Home

Provides the **DNS** part of the Network card: queries, block rate, average response time and a 24-hour query chart.

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

## Portainer

Provides **container counts**, alerts for failed and unhealthy containers, and the container labels used for [label discovery](configuration.md#services-from-container-labels).

```yaml
widget:
  type: portainer
  url: https://portainer.home.arpa
  env: 1                  # environment (endpoint) id, from the URL in Portainer
  key: ${PORTAINER_KEY}
```

**Account.**
- **Business Edition:** create a user with the *Read-only user* role on the environment, then an API key for that user.
- **Community Edition:** an API key always has its user's full rights, so it can start, stop and delete containers. Protect it like an admin password.

**Alerts**

| Severity | When |
|---|---|
| critical | A container is restarting. |
| warning | A container exited with a non-zero code. The alert includes the restart count. |
| warning | A container's health check reports `unhealthy`. |

Containers that exited with code 0 count as finished jobs, not failures. Add the label `dashboard.ignore=true` to hide a container entirely.

---

## FRITZ!Box

Provides internet status and line speed on the tile. It also provides **WAN traffic** when no OPNsense widget is configured, or when `network.service` selects it.

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

## Host temperatures

This isn't a widget. With `host.temperature: true`, the dashboard reads CPU and NVMe temperatures from the kernel's `/sys/class/hwmon`. In an LXC container, or in Docker inside an LXC container, on the Proxmox host, the kernel is the host's, so these are the host's real temperatures. In a VM you see the VM's virtual sensors, if it has any.

CPU drivers that are recognised: `coretemp`, `k10temp`, `zenpower`, `cpu_thermal`, `soc_thermal`, and `acpitz` as a fallback.

---

## Adding an integration

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-integration).
