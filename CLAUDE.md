# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Self-hosted homelab status page and launcher (SvelteKit 2 / Svelte 5, Node adapter, Node ≥ 22.13, image ships Node 24). Reads gethomepage-compatible YAML, polls Proxmox VE, PBS, OPNsense, OpenMediaVault, AdGuard Home, Pi-hole, Portainer, Docker (socket proxy), FRITZ!Box and any JSON API (`customapi`), and pushes one JSON snapshot to browsers over SSE.

## Commands

```bash
npm ci
CONFIG_DIR=config.example DEMO=1 npm run dev     # http://localhost:5173 with fixture data (DEMO_SCENARIO=calm for all-healthy)
npm test                                         # node --test over src/**/*.test.js
node --test --test-name-pattern=calm src/lib/server/integrations/integrations.test.js   # one scenario (pattern must match the top-level test name; per-integration subtests can't be selected alone)
npm run check                                    # svelte-kit sync + svelte-check (strict JSDoc type check); there is no linter
npm run build && DEMO=1 CONFIG_DIR=config.example npm start   # production build on :3000
docker build -t homelab-dashboard:local .
```

CI (`.github/workflows/ci.yml`) runs `check` and `test`, then builds the image and smoke-tests it in demo mode (`/api/health`, `/api/state`, `/`), on every push/PR (PRs from `development` to `main` are skipped: the push run already covered that tree); all must pass.

## Architecture

One Node process, no worker or external DB. `src/hooks.server.js` starts a singleton `Engine` (`src/lib/server/engine.js`, kept on `globalThis` so dev HMR doesn't duplicate it).

- **Engine** loads config (`config.js`), watches `CONFIG_DIR` for `*.yaml` changes, and runs three timers from `settings.intervals`: probes (`siteMonitor`, `http.js#probe`), widgets (integrations, then the local host and temperatures), certificates.
- **Local host** (`local.js`): with no `proxmox` widget (`host.source: auto`), the System panel shows the machine the dashboard runs on, read from `PROC_DIR` and `statfs`; it returns the same `HostVitals` as Proxmox (guests null), and records the same `host.cpu`/`host.mem` metrics. Demo: `demo.js#demoLocal`. After each cycle it calls `publish()` → its snapshot builder (`createSnapshot()` → `build(engine, now)`) and emits `update`; `/api/stream` forwards that to SSE clients, `+page.server.js` uses it for SSR.
- **Integrations** (`src/lib/server/integrations/<type>.js`) export `collect(widget, ctx)` returning a `WidgetResult` (`stats`, `line`, `alerts`, optional `events`, `storage`, `host`, `network`, `dns`, `backups`, `containers`, `discovered`). They must reach the outside **only through `ctx`** (`getJson`/`request` transport, `kv` durable, `state` per service, `shared` cross-integration, `metric`, `settings`, `now`, `insecure`) built by `createContext` in `integrations/index.js`. `ORDER = ['proxmox']` runs first because it puts guest ids in `ctx.shared` for PBS backup freshness; the rest run in parallel.
- **Fixtures** (`src/lib/server/demo/<type>.js`) are `"METHOD /path"` → `({ now, scenario, params, headers, body })` tables served by `fixtureTransport`. The same transport seam powers demo mode and the tests, so integrations run unchanged in both. `demo.js` only fakes what has no integration (probes, certs, temps, seeded 24 h history).
- **Checks** (`check.js`: `kindOf`, `record` a reading → check state, history row, events; `status` → the tile's level, line, alert): `siteMonitor` is probed over HTTP (<500 = up) or, for `tcp://host:port`, by connecting (`http.js#tcpProbe`). **Heartbeats** (`heartbeat.js`, `/api/heartbeat/<id>[/fail]`) are push checks: token compared on SHA-256 digests, 404 for unknown id or wrong token, 1 call/s per id; the last success/failure live in `kv`, and `engine.checkHeartbeats` records them on the probe timer.
- **Config view** (`/config`, `config-view.js`): read-only problems, widgets, checks, auto icons, settings. **Allowlist only** (type, URL origin, per-type `SAFE_OPTIONS`, status); `config-view.test.js` fails if any configured secret appears in the page data. Missing secrets are recorded by name during `loadConfig` (not in demo mode).
- **Snapshot** (`snapshot.js`; tested through `build` in `snapshot.test.js`, inputs from `test-helpers.js#snapshotInput`, history seeded with `insertProbe` into a temporary `DATA_DIR`) holds all status rules: probe <500 = up, down after 2 consecutive failures, "slow" = 1 h p95 over `latencyWarnMs` with ≥10 samples, cert/storage/temperature thresholds, verdict, attention ordering, fleet strip. Shapes live in `src/lib/types.d.ts` (`Snapshot`, `Tile`, `WidgetResult`, …).
- **Label discovery**: the Portainer and Docker integrations (shared logic in `integrations/containers.js`) turn `dashboard.*` container labels into `discovered` services; `engine.updateDiscovered` merges them via `config.withDiscovered` (services.yaml wins on same group+name). Label values are never secret-substituted.
- **Icons**: `icons.js` gives services without `icon` one from the selfh.st / dashboard-icons indexes (fetched daily into `kv`), matched by name then container image; `engine.findIcons` stores them in `autoIcons`, which the snapshot uses. A nearly black SVG gets a light variant as `iconDark` (checked by colour: the collections' variant names aren't reliable).
- **Storage**: `db.js` on built-in `node:sqlite` (`DATA_DIR/dashboard.db`): `probes`, `metrics`, `events`, `opens`, `kv`; pruned to `retentionDays`. Service ids are `slug(group-name)`, so renaming a service resets its history.
- **Config**: `loadConfig()` deep-merges `settings.yaml` over `DEFAULT_SETTINGS`; `${NAME}` / `{{HOMEPAGE_VAR_NAME}}` resolve from env, `NAME_FILE`, then `/run/secrets/<name lowercase>`.

Domain terms (service, widget, integration, ctx, transport, fixture, scenario, storage row, removable datastore) are defined in `CONTEXT.md`; use them.

## Adding or changing an integration

Every type must exist in three places or `integrations.test.js` fails: `INTEGRATIONS` (integrations/index.js), `FIXTURES` (demo/index.js), and `WIDGETS` in the test. Fixtures should cover both scenarios (`issues` triggers the alerts, `calm` is healthy). Also update `config.example/services.yaml` (and a commented example in `config.starter/services.yaml` if it's useful without Proxmox) and `docs/integrations.md` (least-privilege account, options, alerts). Match gethomepage widget field names. Alert text is shown to every viewer: never put credentials or upstream bodies in it — throw short messages and attach the body as `err.body` (logged only).

## Conventions

- Plain JS with JSDoc types checked in strict mode (`jsconfig.json`); add shared shapes to `types.d.ts`, use `/** @import … */`. Svelte 5 runes.
- Runtime dependencies are only `yaml` and `undici`; avoid adding more.
- CSP is nonce-based (`svelte.config.js`): no inline scripts or `javascript:` URLs. The service worker must never intercept page loads or `/api/*` (basic auth prompts).
- **Two configs:** `config.example/` is the full demo (`DEMO=1`; in the image at `/app/config.example`, picked via `DEMO_CONFIG_DIR`); `config.starter/` is the image's `/config` and must work with zero edits on any Docker host (CI checks it).
- **This repo is public.** Examples, fixtures, docs and screenshots use generic names only (`*.home.arpa`, `example.com`, demo mode) — never the maintainer's real hosts, IPs or setup. Local `config/`, `.env`, `compose*.yaml`, `secrets/`, `data/` are gitignored.
- Docs: `README.md` (also synced to Docker Hub on release, so keep it standalone), `docs/configuration.md`, `docs/deployment.md`, `docs/integrations.md`, `CONTRIBUTING.md`. Update them when behavior or config changes.

## Branches and releases

Work on `development` (image `:dev`), PR to `main` (`:edge`). Release: bump `version` in `package.json`, merge to `main`, push tag `vX.Y.Z`; the workflow checks the tag against `package.json`, publishes `X.Y.Z`/`X.Y`/`X`/`latest` to Docker Hub (`matthabjan/homelab-dashboard`), and creates the GitHub Release. Dependabot targets `development`; majors are upgraded deliberately.
