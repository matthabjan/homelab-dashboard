# Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can agree on the approach.

## Setup

Requires Node 22.13 or later (Node 24 is what the image ships with).

```bash
npm ci
CONFIG_DIR=config.example DEMO=1 npm run dev    # http://localhost:5173, sample data
npm test                                        # every integration against the demo fixtures, both scenarios
npm run check                                   # type-check JS (JSDoc) and Svelte; shapes in src/lib/types.d.ts
```

To try the production build: `npm run build && DEMO=1 CONFIG_DIR=config.example npm start` (port 3000).

To test against your real homelab, copy `config.example/` to `config/` and drop `DEMO=1`. `config/`, `.env`, `data/`, `secrets/` and `compose.yaml` are gitignored. **Never commit your own config, host names or secrets.**

## Project layout

```
src/
├── hooks.server.js              starts the engine
├── lib/
│   ├── components/              Svelte UI pieces
│   ├── types.d.ts               shared types (config, widget results, snapshot)
│   └── server/
│       ├── config.js            YAML loading, secrets, icons
│       ├── engine.js            timers, state, SSE events
│       ├── snapshot.js          state + history → page JSON (status rules live here)
│       ├── db.js                SQLite (node:sqlite)
│       ├── http.js              transport (undici), probes, certificate checks
│       ├── integrations/        one file per widget type
│       └── demo/                API fixtures per widget type
└── routes/                      page and HTTP endpoints
```

[CONTEXT.md](CONTEXT.md) defines the terms (service, widget, integration, context, transport, fixture …). Please use them in code and discussion.

**Runtime in short:** the engine starts with the server and runs three timers: probes every 30 s, widgets every 60 s and certificates every 6 h. Integrations reach the network only through `ctx`, which is undici in production and the fixture transport in the demo and tests. After each poll, `buildSnapshot` turns the state and history into one JSON document. It is rendered on the server for the first page load and then pushed to browsers over Server-Sent Events (`/api/stream`). History lives in `DATA_DIR/dashboard.db`.

## Code style

- Plain JavaScript with JSDoc types, checked by `svelte-check` in strict mode. Put shared shapes in `src/lib/types.d.ts`.
- Svelte 5 runes.
- Keep runtime dependencies minimal: currently `yaml` and `undici` only.
- Comments explain *why*, not *what*.
- Commit messages are in the imperative mood and describe the effect ("Keep null out of the snapshot facts").

## Adding an integration

1. **Fixture first.** Create `src/lib/server/demo/<type>.js`, which maps `"METHOD /path"` routes to functions of `{ now, scenario, params, headers, body }`. Return realistic API responses, using generic names only. Cover both scenarios: `issues` should trigger the alerts, and `calm` should be healthy. Register it in `demo/index.js`.
2. **Integration.** Create `src/lib/server/integrations/<type>.js` and export `async collect(widget, ctx)` returning `{ stats, line, alerts }`, plus any of `storage`, `network`, `dns`, `backups`, `containers`, `events`. Use only `ctx.getJson` / `ctx.request` for HTTP, passing `insecure: ctx.insecure`, and `ctx.metric`, `ctx.state`, `ctx.kv` for memory. Register it in `integrations/index.js`.
3. **Test.** Add a widget block to `WIDGETS` in `integrations.test.js`. The test fails until fixtures, integrations and widgets all list the same types.
4. **Example and docs.** Add the service to `config.example/services.yaml`, and a section to [docs/integrations.md](docs/integrations.md) covering the least-privilege account, the options and the alerts.

Guidelines: match gethomepage's widget fields where an equivalent exists. Never put credentials or upstream response bodies into alert text, because alerts are shown to every viewer. Throw errors with short messages and attach the body as `err.body` for the log.

## Pull requests

- Target the `development` branch.
- `npm run check` and `npm test` must pass. CI runs them, then builds the image and smoke-tests it in demo mode.
- Update the docs when behaviour or configuration changes.
- Screenshots help for UI changes. Take them in demo mode, never from a real setup.
- The README screenshots are in `docs/screenshots/`. When the UI changes visibly, retake them in demo mode: desktop at 1440×1080, phones at 390×844 with 2× pixel density (`issues` scenario in dark mode, `calm` in light mode).

## Releases (maintainers)

`development` is published as `:dev`, and `main` as `:edge`.

1. Bump `version` in `package.json` and the pinned tag in the README's compose example on `development`, and merge to `main` through a pull request.
2. Tag `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`. Publishing a release in the GitHub UI with a new `vX.Y.Z` tag on `main` works too; the workflow then keeps that release instead of creating one.
3. The [CI workflow](.github/workflows/ci.yml) checks that the tag matches `package.json`, builds `linux/amd64` and `linux/arm64` with provenance, an SBOM and a GitHub artifact attestation, pushes `X.Y.Z`, `X.Y`, `X` and `latest` to Docker Hub, creates the GitHub Release with generated notes, and syncs this README to Docker Hub.

Dependabot targets `development` weekly and waits 7 days after a release before proposing it. Major versions are upgraded by hand.
