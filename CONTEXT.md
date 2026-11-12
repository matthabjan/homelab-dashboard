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

**Infrastructure** — the strip under the top card: a cell each for System, Storage, Drives, Network and Backups, with one figure, a small picture of it (the CPU's and the traffic's last 24 h, the fullest storage, a mark per drive, the last seven days of backups) and a line of context (side by side when the page is wide; on phones a compact list, a row per area with the picture on the right and the line of context only where something needs attention). A cell opens the Infrastructure sheet at its tab: System (the host's gauges and 24 h charts), Storage and Drives (grouped by the host or service that reports them), Network and Backups. A cell and its tab say the same (`snap.infrastructure`, built by `infrastructure.ts`): the figure, the context and a level that is as bad as what is raised for the area, so a marker always has an alert behind it (a storage bar's amber stays in the sheet; overdue PBS backups alone warn, a late job is critical). A problem colours the figure and adds its shape; the cell is not tinted. Only panels with data get a tab.

**Sheet** — a panel over the page with the details of one thing (a service with its own activity, infrastructure with backups, activity; on Setup, how a service is set up): a side panel on desktop with a close button, a bottom sheet on phones that opens part of the way up and follows the finger in one fluid drag (up to the full height, down to any height or closed, a quick flick closes), and has a handle that closes it on a tap instead of a close button. Sheets stack: one opened from inside another (Backups → a job) is a level deeper, with a round back button beside its title (no text: where it leads is its label and tooltip); each level is a history entry, so back (browser, Android, Esc) goes up one level, and closing closes all. The page itself stays short.

**Job** — a heartbeat service: something that reports when it ran (a backup, a sync, a verify) rather than being opened. Jobs are counted apart from services and listed in the Backups tab and among the service tiles, where a tap opens their details since there is nothing to launch.

**Backup row** — a line in the Backups tab of the Infrastructure sheet: one PBS server's guest backups, its host backups, or a job; each with its state in short ("on schedule", "2 overdue", "failed") and a level as bad as its alerts. Built by `backups.ts`, which also gives the Backups figures: *overdue* counts PBS backups and jobs marked `backup: true`; a late job that makes no backup is named and red, but not counted.

**Local host** — the machine the dashboard runs on, shown in the System panel when there is no Proxmox widget (`host.source`). Its vitals come from `/proc` and `statfs` (`local.ts`); in Docker that is the host, under lxcfs the container.

**Heartbeat** — a push check: a scheduled job (backup, cron) calls `/api/heartbeat/<id>` when it ran, or `…/fail`. A service with a `heartbeat:` block is up while the last run is within `every + grace` and no failure came after it; the endpoint stores the last success and failure in `kv`. `backup: true` adds it to the backup figures.

**Check** — how a service's up/down is found: an HTTP or TCP probe (`siteMonitor`), a container's state (label discovery), or a heartbeat. A service has at most one. `check.ts` turns each reading into the service's check state (a probe is down after two failures in a row, the others at once), a probe history row and the *went down* / *recovered* events, and gives the tile's status from it.

**Config view** — the read-only page `/config` (Setup): whether the configuration is right (problems, each service's check, widget connection and icon, settings), not how services are doing; built by `config-view.ts` from an allowlist so no secret can appear in it.

**Storage row** — one line in the Storage panel: usage (`used`, `total`, `pct`, `sub`) or `offline` (an unavailable PVE storage, a detached removable datastore). `storage.ts` judges every fill once, the rows and the System panel's Disk gauge alike: amber from `storageAmberPct` (the bar only), red and a warning from `storageWarnPct`. A disk is one alert: the gauge's disk warns through its storage row when one has its metric, else by itself.

**Drive** — a physical disk in the infrastructure Drives panel, with what SMART says about it (health, life left, temperature, power-on time, data written). Reported by PVE (host disks), OMV and PBS (disks passed into their VMs); virtual disks are skipped. Not the same as a storage row: a storage is a filesystem or pool, a drive is hardware.

**Removable datastore** — a PBS datastore on a disk that is plugged in now and then (offsite copy). Detached is normal; it only alerts after `offsiteMaxDetachedDays`.

**Tile** — a service or job in the Services list: its icon, its name and its status line. A tap opens the service (`href`); the button at its end, or a long press, opens its sheet. One without `href` opens its sheet on a tap.

**View** — on phones, what the tab bar switches between: Home (the sentence, most used, infrastructure, activity, links), Services (the tiles) and Alerts (everything that needs attention). Search, the fourth tab, opens the palette. On wide screens all of it is one page.
