# Context

Terms used in the code and in design discussions.

**Service** — one entry in `services.yaml`: a tile with a link, an optional probe (`siteMonitor`) and an optional widget.

**Widget** — the `widget:` block of a service: a `type` plus the connection details (`url`, credentials, options like `datastore`).

**Integration** — the code for one widget type (`src/lib/server/integrations/<type>.js`). Exports `collect(widget, ctx)` and returns a widget result. Talks to the outside only through `ctx`.

**Widget result** — what `collect` returns: `stats`, `line`, `alerts`, optional `events`, and type-specific parts the page reads (`storage`, `host`, `network`, `dns`, `backups`, `containers`, `discovered`).

**Context (`ctx`)** — everything an integration may use: `request` / `getJson` (the transport), `kv` (durable), `state` (per service, in memory), `shared` (hand-offs between integrations, e.g. Proxmox guest ids for PBS freshness), `settings`, `now`, `metric`. Built by `createContext` in `integrations/index.js`.

**Transport** — a function `(url, opts) → Response`; the seam between integrations and the network. Production: undici (`http.js`). Demo and tests: a fixture transport.

**Fixture** — the recorded-style API responses for one widget type (`src/lib/server/demo/<type>.js`): a table of `"METHOD /path"` routes to functions of `{ now, scenario, params, headers, body }`.

**Scenario** — which story the fixtures tell: `issues` (default; things to look at) or `calm` (all fine). Set with `DEMO_SCENARIO`.

**Vitals card** — the card under the status overview with four panels behind tabs: System (the host's gauges), Storage, Drives and Network. A tab is marked with the worst level in its panel; only panels with data get a tab.

**Local host** — the machine the dashboard runs on, shown in the System panel when there is no Proxmox widget (`host.source`). Its vitals come from `/proc` and `statfs` (`local.js`); in Docker that is the host, under lxcfs the container.

**Storage row** — one line in the Storage panel: usage (`used`, `total`, `pct`, `sub`) or `offline` (an unavailable PVE storage, a detached removable datastore).

**Drive** — a physical disk in the vitals card's Drives panel, with what SMART says about it (health, life left, temperature, power-on time, data written). Reported by PVE (host disks), OMV and PBS (disks passed into their VMs); virtual disks are skipped. Not the same as a storage row: a storage is a filesystem or pool, a drive is hardware.

**Removable datastore** — a PBS datastore on a disk that is plugged in now and then (offsite copy). Detached is normal; it only alerts after `offsiteMaxDetachedDays`.
