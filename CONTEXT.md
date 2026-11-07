# Context

Terms used in the code and in design discussions.

**Service** — one entry in `services.yaml`: a tile with a link, an optional probe (`siteMonitor`) and an optional widget.

**Widget** — the `widget:` block of a service: a `type` plus the connection details (`url`, credentials, options like `datastore`).

**Integration** — the code for one widget type (`src/lib/server/integrations/<type>.ts`). Exports `collect(widget, ctx)` and returns a widget result. Talks to the outside only through `ctx`.

**Widget result** — what `collect` returns: `stats`, `line`, `alerts`, optional `events`, and type-specific parts the page reads (`storage`, `drives`, `host`, `network`, `dns`, `backups`, `containers`, `discovered`).

**Context (`ctx`)** — everything an integration may use: `request` / `getJson` (the transport), `kv` (durable), `state` (per service, in memory), `shared` (hand-offs between integrations, e.g. Proxmox guest ids for PBS freshness), `settings`, `now`, `metric`, `insecure`. Built by `createContext` in `integrations/index.ts`.

**Transport** — a function `(url, opts) → Response`; the seam between integrations and the network. Production: undici (`http.ts`). Demo and tests: a fixture transport.

**Sources** — where the engine's readings come from: probes, certificates, the local host, temperatures, the transport each widget type gets, the first day of history, and whether it is the demo. `liveSources` (`sources.ts`) in production, `demoSources()` (`demo.ts`) in the demo; tests script their own. The engine reaches the outside only through them and the db.

**Fixture** — the recorded-style API responses for one widget type (`src/lib/server/demo/<type>.ts`): a table of `"METHOD /path"` routes to functions of `{ now, scenario, params, headers, body }`.

**Scenario** — which story the fixtures tell: `issues` (default; things to look at) or `calm` (all fine). Set with `DEMO_SCENARIO`.

**Snapshot** — the one JSON document the page renders: tiles, attention, verdict, infrastructure panels, jobs, recent events, fleet strip, Most used. Built from engine state and history by the snapshot module (`createSnapshot` in `snapshot.ts`) and pushed over SSE on every change.

**Attention** — the list of alerts that need looking at, most severe first. Checks, widgets, the infrastructure panels and the config raise them, each with a key that is unique within its service (or source, such as `host` or `config`); the attention module (`attention.ts`) names each after its service, keeps the time it first appeared by that key, and gives each tile its worst alert: a tile is as bad as what is raised for it.

**Feed** — what the **Activity** card lists: the notes (info alerts), then the last day's events, newest first, without an event that repeats an alert (`withoutRepeats`). A repeat of an event stays: a service that went down twice did so twice. Built on the server. Warnings and critical alerts are the hero's, so they are not in it.

**Verdict** — the hero's sentence: "All 15 services up" (with jobs, backups and expiring certificates as context), or the top attention item with an Open action for its service.

**Infrastructure** — the card under the hero: a row each for System, Storage, Drives, Network and Backups, with an icon, one figure and a line of context under an Infrastructure header that says how many need attention (side by side when the page is wide; on phones collapsed to the area icons and one sentence: the key figures, or only what needs attention). A row (on phones, an icon) opens the Infrastructure sheet at its tab: System (the host's gauges and 24 h charts), Storage and Drives (grouped by the host or service that reports them) and Network; Backups opens its own sheet. A tab is marked with the worst level in its panel; only panels with data get a tab.

**Sheet** — a panel over the page with the details of one thing (a service with its own activity, infrastructure, backups, activity): a side panel on desktop, a bottom sheet on phones that a pull down from its top closes (the close button stays as the tap alternative). Sheets stack: one opened from inside another (Backups → a job) is a level deeper, with a back button; each level is a history entry, so back (browser, Android, Esc) goes up one level, and closing closes all. The page itself stays short.

**Job** — a heartbeat service: something that reports when it ran (a backup, a sync, a verify) rather than being opened. Jobs are counted apart from services, listed in the Backups sheet and the Status view, never in the launcher.

**Local host** — the machine the dashboard runs on, shown in the System panel when there is no Proxmox widget (`host.source`). Its vitals come from `/proc` and `statfs` (`local.ts`); in Docker that is the host, under lxcfs the container.

**Heartbeat** — a push check: a scheduled job (backup, cron) calls `/api/heartbeat/<id>` when it ran, or `…/fail`. A service with a `heartbeat:` block is up while the last run is within `every + grace` and no failure came after it; the endpoint stores the last success and failure in `kv`. `backup: true` adds it to the backup figures.

**Check** — how a service's up/down is found: an HTTP or TCP probe (`siteMonitor`), a container's state (label discovery), or a heartbeat. A service has at most one. `check.ts` turns each reading into the service's check state (a probe is down after two failures in a row, the others at once), a probe history row and the *went down* / *recovered* events, and gives the tile's status from it.

**Config view** — the read-only page `/config` (Setup): whether the configuration is right (problems, each service's check, widget connection and icon, settings), not how services are doing; built by `config-view.ts` from an allowlist so no secret can appear in it.

**Storage row** — one line in the Storage panel: usage (`used`, `total`, `pct`, `sub`) or `offline` (an unavailable PVE storage, a detached removable datastore).

**Drive** — a physical disk in the infrastructure Drives panel, with what SMART says about it (health, life left, temperature, power-on time, data written). Reported by PVE (host disks), OMV and PBS (disks passed into their VMs); virtual disks are skipped. Not the same as a storage row: a storage is a filesystem or pool, a drive is hardware.

**Removable datastore** — a PBS datastore on a disk that is plugged in now and then (offsite copy). Detached is normal; it only alerts after `offsiteMaxDetachedDays`.
