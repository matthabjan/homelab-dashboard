// Shared shapes, checked by `npm run check`. Types only: nothing here exists at runtime.
// Imported with `import type { Context, WidgetResult } from '$lib/types'`. Terms as in CONTEXT.md.
// The shapes of the APIs an integration reads live in that integration's own file.

/** Any value JSON can hold: parsed config values, API bodies before an integration narrows them. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// ---------- config (settings.yaml, services.yaml, bookmarks.yaml) ----------

export interface Settings {
  title: string;
  theme: 'system' | 'light' | 'dark';
  accent: string;
  linkTarget: string;
  tlsVerify: boolean;
  deepLink: { name: string; href: string } | null;
  pwa: {
    name: string | null;
    shortName: string | null;
    icon192: string;
    icon512: string;
    appleTouchIcon: string;
    favicon: string;
    logo: string;
    background: string;
  };
  host: {
    source: 'auto' | 'proxmox' | 'local';
    name: string | null;
    disk: string;
    service: string | null;
    node: string | null;
    temperature: boolean;
    storages: string[] | null;
    storage: string | null;
  };
  network: { service: string | null; dns: string | null };
  mostUsed: { count: number; halfLifeDays: number };
  intervals: { probe: number; widgets: number; cert: number };
  thresholds: {
    backupMaxAgeHours: number;
    offsiteMaxDetachedDays: number;
    certWarnDays: number;
    latencyWarnMs: number;
    storageAmberPct: number;
    storageWarnPct: number;
    tempMinC: number;
    tempWarnC: number;
    driveLifeWarnPct: number;
    driveTempWarnC: number;
    minOutageMinutes: number;
  };
  retentionDays: number;
}

/** The `widget:` block of a service. Fields beyond `type` depend on the integration. */
export interface Widget {
  type: string;
  url: string;
  username?: string;
  password?: string;
  /** options of the integration; each one narrows its own (e.g. `datastore`, `fields`) */
  [option: string]: unknown;
}

/** Container state of a label-discovered service (from Portainer). */
export interface ContainerState {
  state: string;
  health: string | null;
  exitCode: number;
  /** exited cleanly and not meant to be running (restart policy no or on-failure): a one-shot job that finished */
  done: boolean;
}

/**
 * A service as written in services.yaml or in `dashboard.*` container labels, before config.ts resolves it.
 * Not validated: config.ts reads it as it is (a value of another type is used as written).
 */
export interface ServiceDef {
  href?: string;
  description?: string;
  icon?: string;
  iconDark?: string;
  siteMonitor?: string;
  /** older name of siteMonitor */
  probe?: string;
  tlsVerify?: boolean;
  latencyWarnMs?: number | string;
  widget?: Widget;
  heartbeat?: HeartbeatDef;
}

/** A service's `heartbeat:` block as written: durations as "24h" or seconds. */
export interface HeartbeatDef {
  every?: string | number;
  grace?: string | number;
  id?: string | number;
  token?: string | number;
  backup?: boolean;
}

export interface Service {
  id: string;
  name: string;
  group: string;
  href: string | null;
  description: string;
  icon: string | null;
  iconDark: string | null;
  probe: string | null;
  insecure: boolean;
  latencyWarnMs: number | null;
  widget: Widget | null;
  container?: ContainerState | null;
  /** Image of a label-discovered container, for automatic icons. */
  image?: string | null;
  /** a push check: jobs call /api/heartbeat/<id>; null when absent or misconfigured */
  heartbeat: Heartbeat | null;
}

/** A service's `heartbeat:` block, durations in ms. */
export interface Heartbeat {
  /** URL path and kv key; defaults to the service id */
  id: string;
  every: number;
  grace: number;
  token: string;
  /** counts in "oldest backup" / "backups overdue" */
  backup: boolean;
}

/** How a check finds out whether a service is up. */
export type CheckKind = 'http' | 'tcp' | 'container' | 'heartbeat';

/** What the heartbeat endpoint stored for one id (kv `heartbeat:<id>`). */
export interface HeartbeatRecord {
  /** when the dashboard first saw this heartbeat: a job that never reports is overdue `every + grace` after it */
  since: number;
  lastOk: number | null;
  lastFail: number | null;
}

/** A heartbeat's state as the engine last computed it. */
export interface HeartbeatState extends HeartbeatRecord {
  state: 'up' | 'down' | 'pending';
  /** the job reported a failure after its last success */
  failed: boolean;
  /** when it became overdue (down and not failed) */
  overdueSince: number | null;
}

export interface Bookmark {
  group: string;
  name: string;
  href: string;
  icon: string | null;
  iconDark: string | null;
}

export interface Config {
  settings: Settings;
  groups: { name: string; services: Service[] }[];
  services: Service[];
  bookmarks: Bookmark[];
  problems: ConfigProblem[];
  /** loaded for the demo (Sources.demo): no secrets are expected, and the page says it's a demo */
  demo: boolean;
}

/** Something in a config file that couldn't be used as written; shown in the attention list. */
export interface ConfigProblem {
  file: string;
  /** the reason and where (line, group): never the file's content, which could hold a secret */
  message: string;
  /** what is shown instead: the file's last version that loaded, nothing from it, or (null) the rest of the file */
  fallback: 'last' | 'none' | null;
}

// ---------- integrations ----------

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  insecure?: boolean;
  timeout?: number;
  redirect?: RequestRedirect;
}

/** The seam between integrations and the network: undici in production, a fixture transport in demo and tests. */
export type Transport = (url: string, opts?: RequestOptions) => Promise<Response | import('undici').Response>;

/**
 * Where the engine's readings come from: `liveSources` (sources.ts) in production, `demoSources` (demo.ts) in the
 * demo; tests script their own. The engine reaches the outside only through these (and the db).
 */
export interface Sources {
  /** one HTTP or TCP probe of `s.probe` */
  probe(s: Service, now: number): ProbeResult | Promise<ProbeResult>;
  /** the certificate behind an https `s.probe`; null when there is none to read */
  cert(s: Service): CertInfo | null | Promise<CertInfo | null>;
  /** the machine the dashboard runs on; `state` carries the previous CPU totals between calls */
  local(host: Settings['host'], state: { prev?: { total: number; idle: number } | null }): HostVitals | null | Promise<HostVitals | null>;
  temps(): Temps | null | Promise<Temps | null>;
  /** the transport a widget type's integration gets in `ctx` */
  transport(type: string): Transport;
  /** for the icon indexes and SVGs */
  iconTransport: Transport;
  /** fill history before the first rounds (the demo's first day); runs on every config load */
  seed(services: Service[]): void;
  /** the demo's readings: the config needs no secrets, and the page says it's a demo */
  demo: boolean;
}

/** What a fixture route receives (demo/index.ts); it returns an object (sent as JSON) or a string (sent as XML). */
export interface FixtureRequest {
  now: number;
  scenario: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  /** parsed when JSON, else the raw string (SOAP) */
  body: unknown;
  url: URL;
}

/** "METHOD /path" → route handler, one table per widget type. */
export type Fixtures = Record<string, (req: FixtureRequest) => object | string | Promise<object | string>>;

/** Durable key/value store that survives restarts. */
export interface Kv {
  /** what was stored under `key`, as the caller stored it (JSON round trip); null when nothing was */
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
}

/** Hand-offs between integrations within one widget round. */
export interface Shared {
  /** per Proxmox widget (API URL and node): guest id → name, so several PVE hosts each add theirs */
  guests?: Record<string, Record<string, string>>;
}

/** Everything an integration may use. Built by createContext in integrations/index.ts. */
export interface Context {
  settings: Settings;
  now: number;
  insecure: boolean;
  shared: Shared;
  /** in memory, per service, between polls; each integration keeps its own fields */
  state: Record<string, unknown>;
  /** history for sparklines; null and NaN are skipped */
  metric(key: string, value: number | null): void;
  kv: Kv;
  request: Transport;
  /** the parsed body, as the shape the integration expects from that endpoint (not checked at runtime) */
  getJson<T = unknown>(url: string, opts?: RequestOptions): Promise<T>;
}

export type Severity = 'crit' | 'warn' | 'info';

export interface Alert {
  sev: Severity;
  title: string;
  detail?: string;
  /** identifies the alert across polls, unique within one result: titles may carry readings (a count, a percentage) */
  key: string;
  /** what the alert is about, one line each (pending packages with their versions); the sheets list them under it */
  items?: string[];
}

/** Written to the events table and shown in the feed. */
export interface WidgetEvent {
  sev: Severity | 'ok';
  title: string;
  detail?: string;
  /** when it happened, if not at this poll (ms) */
  ts?: number;
}

export interface Stat {
  k: string;
  v: string;
  level?: string | null;
}

/** One line in the Storage panel: usage, or `offline` (an unavailable or detached storage). */
export type StorageRow = UsageRow | OfflineRow;

export interface UsageRow {
  name: string;
  sub: string;
  source: 'pve' | 'pbs' | 'omv';
  used: number;
  total: number;
  /** null when the total is 0 (size unknown) */
  pct: number | null;
  offline?: false;
  /** the metric its fill is recorded under, for the 24 h trend */
  metric?: string;
}

export interface OfflineRow {
  name: string;
  sub: string;
  source: 'pve' | 'pbs' | 'omv';
  offline: true;
  /** how full it was when last seen, drawn as a grey bar */
  pct?: number | null;
  metric?: string;
}

/** The machine shown as "host": the Proxmox node, or the one the dashboard runs on (local.ts, no guests). */
export interface HostVitals {
  node: string;
  /** null on the local host's first poll (CPU % needs two samples) */
  cpu: number | null;
  cpus: number;
  mem: number;
  maxmem: number;
  memPct: number;
  /** `metric`: where its fill is recorded; unset for the local host, whose disk the engine records as host.disk */
  disk: { name: string; pct: number | null; sub: string; metric?: string };
  uptime: string | null;
  guestsRunning: number | null;
  guestsTotal: number | null;
  updates: number | null;
}

/** Traffic in Mbit/s: WAN from a router (`fallback`: from the FRITZ!Box, used only when no router reports it), or LAN from the Proxmox host NIC (down = into the host). */
export interface NetworkReading {
  down: number | null;
  up: number | null;
  source: string;
  fallback?: boolean;
}

/** What SMART says about one drive, whichever format it came in (NVMe log text, ATA attributes, PBS names). */
export interface SmartReading {
  tempC: number | null;
  hours: number | null;
  /** bytes written over the drive's life */
  written: number | null;
  /** % of rated endurance left (100 − NVMe "Percentage Used", or the ATA wear attribute) */
  lifeLeft: number | null;
  /** media errors, reallocated, pending and uncorrectable sectors added up */
  errors: number | null;
  /** NVMe critical warning set, or an ATA attribute below its threshold */
  failing: boolean;
}

/** One physical drive: PVE host disks, and disks passed into the OMV and PBS VMs (virtual disks are skipped). */
export interface Drive extends Omit<SmartReading, 'failing'> {
  model: string;
  serial: string | null;
  kind: 'NVMe' | 'SSD' | 'HDD' | 'USB';
  size: number;
  /** which system sees it: the PVE node; unset means the widget's own service (the snapshot fills in its name) */
  where?: string;
  /** warning: a past or minor SMART problem (OMV's BAD_ATTRIBUTE_IN_THE_PAST, BAD_SECTOR) */
  health: 'ok' | 'warning' | 'failing' | 'unknown';
}

/** Current rates plus their 24 h series, as the Network panel draws them. */
export interface Traffic {
  source: string | null;
  href: string | null;
  down: number | null;
  up: number | null;
  seriesDown: (number | null)[] | null;
  seriesUp: (number | null)[] | null;
  spanH: number | null;
  /** where the series start (ms); they end at the snapshot's time */
  from: number | null;
}

export interface DnsStats {
  queries: number;
  blockedPct: number;
  /** null when the server doesn't report it (Pi-hole) */
  avgMs: number | null;
  series: number[] | null;
  /** what the counts cover, e.g. "24 h" (AdGuard's statistics interval) */
  period: string | null;
  /** % blocked per point of `series`, and how long a point is (ms); null when the server doesn't report them */
  blockedSeries?: number[] | null;
  stepMs?: number | null;
}

/** One PBS server's backups, each group judged against backupMaxAgeHours by the integration. */
export interface PbsBackups {
  /** false when no group was judged (no guests in PVE, nothing backed up lately) */
  known: boolean;
  /** guests (VMs, containers) judged, how many are overdue, their newest backup (ms) */
  guests: number;
  guestOverdue: number;
  last: number | null;
  /** host backups (proxmox-backup-client): hostnames, how many are overdue, the newest (ms) */
  hosts: string[];
  hostOverdue: number;
  hostLast: number | null;
  /** the oldest judged backup and what it is */
  oldestAge: number | null;
  oldestName: string | null;
  /** the datastores read */
  stores: string[];
  /** how an overdue backup is raised, so the Backups row is as bad as its alerts */
  overdueSev: 'crit' | 'warn';
}

/** A line in the Backups sheet: one PBS server's guest backups, its host backups, or a job. */
export interface BackupRow {
  /** the service it opens */
  id: string;
  title: string;
  detail: string;
  /** the newest run (ms), shown as "last run 5 m ago" */
  last: number | null;
  /** jobs: when the next run is expected (ms) */
  due: number | null;
  /** "on schedule", "2 overdue", "failed" */
  state: string;
  level: Level | 'none';
  /** PBS rows: the server's name */
  source: string | null;
}

/** The Backups sheet: overdue backups (PBS and jobs marked `backup: true`), the oldest backup and the rows. */
export interface Backups {
  overdue: number;
  /** as bad as the overdue backups' alerts */
  level: Level | 'none';
  oldestAge: number | null;
  /** what the oldest backup is: a guest or host on PBS, or a backup job */
  oldestName: string | null;
  /** PBS rows first (they run daily, so they change most), then the jobs by when they are due */
  rows: BackupRow[];
}

/** What a sheet shows: one level of the sheet stack (the page keeps it in history state). */
export type SheetRef = { kind: 'service'; id: string } | { kind: 'infra'; tab: 'system' | 'storage' | 'drives' | 'network' } | { kind: 'backups' } | { kind: 'activity' };

export interface ContainerCounts {
  running: number;
  total: number;
  failed: number;
  unhealthy: number;
}

/** A service found in container labels; joins the services.yaml group of the same name. */
export interface Discovered {
  group: string;
  name: string;
  /** the service as the labels define it, like a services.yaml entry */
  def: ServiceDef;
  container: ContainerState;
  image: string | null;
}

/** What collect returns. Everything after `alerts` is type-specific and read by the snapshot. */
export interface WidgetResult {
  stats: Stat[];
  line: string | null;
  alerts: Alert[];
  events?: WidgetEvent[];
  storage?: StorageRow[];
  host?: HostVitals;
  network?: NetworkReading | null;
  lan?: NetworkReading | null;
  drives?: Drive[];
  dns?: DnsStats;
  backups?: PbsBackups;
  containers?: ContainerCounts;
  discovered?: Discovered[];
}

/** A customapi threshold, compared on the raw value after `scale`; any matching condition counts. */
export interface Threshold {
  above?: number;
  below?: number;
  equals?: string | number | boolean;
  not?: string | number | boolean;
}

/** One value of a customapi widget (gethomepage's mapping fields, plus `warn` / `crit`). */
export interface CustomApiMapping {
  /** dot path `a.b.0.c`, or the nested form `{ a: { b: c } }` */
  field: string | { [key: string]: Json };
  label?: string;
  format?: 'text' | 'number' | 'float' | 'percent' | 'bytes' | 'bitrate' | 'duration' | 'date' | 'relativeDate' | 'size';
  prefix?: string;
  suffix?: string;
  scale?: number | string;
  remap?: { value?: Json; any?: boolean; to: Json }[];
  warn?: Threshold;
  crit?: Threshold;
}

export interface Integration {
  collect(widget: Widget, ctx: Context): Promise<WidgetResult>;
}

// ---------- engine state ----------

/** A service's up/down from its check (probe, container state or heartbeat), kept by `check.ts#record`. */
export interface CheckState {
  /** failed readings in a row */
  fails: number;
  down: boolean;
  /** the first failure of the current run of failures */
  since: number | null;
  reason: string | null;
  /** the last probe's latency */
  ms: number | null;
  checked: number | null;
}

/** One HTTP or TCP probe. `code` is the HTTP status or the error code (see `http.ts#reasonText`). */
export interface ProbeResult {
  ok: boolean;
  ms: number | null;
  code: string | number | null;
}

/** A tile's status from its check; `alert` is completed with the service name ("<name> is down"). */
export interface CheckStatus {
  lvl: Level | 'unknown';
  status: string;
  line: string | null;
  /** undefined: the line takes the tile's level */
  lineLevel?: Tile['lineLevel'];
  alert?: { sev: 'crit' | 'warn'; title: string; detail: string; ts?: number };
  /** heartbeats: the short word for the job's state, for the Backups sheet and the service sheet */
  word?: string;
}

export interface CertInfo {
  validTo: number;
  trusted: boolean;
  selfSigned: boolean;
  /** the CN; Node gives a list when the certificate has several */
  subject?: string | string[];
}

/** The last collect of a service: its result, or `ok: false` with the error and the previous stats. */
export type WidgetState = WidgetResult & { ok: boolean; ts: number; error?: string; /** the last successful poll */ lastOk: number | null };

export interface ServiceState {
  check: CheckState;
  heartbeat?: HeartbeatState | null;
  widget: WidgetState | null;
  wstate: Record<string, unknown>;
  cert: CertInfo | null;
}

export interface Temps {
  cpu: number | null;
  nvme: number[];
  drives: number[];
}

// ---------- /config: the read-only config page ----------

/** One labelled value: a widget option, a setting. */
export interface KeyValue {
  k: string;
  v: string;
}

/**
 * Everything the /config page shows, built from an allowlist (config-view.ts): no credentials, headers, request
 * bodies, URL paths or queries, heartbeat tokens, or label values beyond group and name.
 */
export interface ConfigView {
  title: string;
  demo: boolean;
  generatedAt: number;
  problems: { file: string; message: string; level: Level }[];
  widgets: {
    id: string;
    name: string;
    group: string;
    type: string;
    /** the integration's section in docs/integrations.md; null for a type this dashboard doesn't implement */
    docs: string | null;
    /** scheme, host and port of `url` only */
    origin: string | null;
    options: KeyValue[];
    status: 'ok' | 'error' | 'never' | 'unsupported';
    error: string | null;
    lastOk: number | null;
    source: string;
  }[];
  checks: {
    id: string;
    name: string;
    group: string;
    kind: CheckKind;
    target: string;
    interval: string;
  }[];
  icons: { id: string; name: string; group: string; yaml: string; icon: string; iconDark: string | null }[];
  /** every service once, in dashboard order: the page joins widgets, checks and icons on it */
  services: {
    id: string;
    name: string;
    group: string;
    /** services.yaml, or the container labels a widget discovered */
    source: string;
    /** the icon the dashboard shows (automatic or configured) */
    icon: string | null;
    iconDark: string | null;
  }[];
  /** every setting with its effective value; `changed` when it differs from the default */
  settings: (KeyValue & { changed: boolean })[];
}

// ---------- snapshot: the JSON the browser renders ----------

export type Level = 'ok' | 'warn' | 'crit';

/** One of the key numbers under the verdict. */
export interface Fact {
  k: string;
  v: string;
  level: Level | null;
}

export interface AttentionItem {
  sev: Severity;
  /** named after its service ("Pi-hole: Blocking is disabled") */
  title: string;
  detail?: string;
  /** the raised key, scoped by its service or source (`<sid>|<key>`, `config|<key>`) */
  key: string;
  sid?: string;
  service?: string;
  href?: string | null;
  /** when it first appeared */
  ts: number;
  items?: string[];
  /** the sheet that tells more, for its row in Activity; null when there is none */
  open?: SheetRef | null;
}

/** A row of the feed: a note, or a recent event. */
export type FeedItem = AttentionItem | (FeedEvent & { service?: undefined; items?: undefined });

export interface FeedEvent {
  ts: number;
  sev: Severity | 'ok';
  /** null for events that aren't about one service (backups completed, updates) */
  sid: string | null;
  title: string;
  detail: string | null;
  href: string | null;
  /** the sheet that tells more, for its row in Activity; null when there is none */
  open?: SheetRef | null;
}

export interface Tile {
  id: string;
  name: string;
  group: string;
  description: string;
  href: string | null;
  host: string;
  icon: string;
  iconDark: string | null;
  level: Level | 'unknown';
  status: string;
  line: string;
  lineLevel: Level | 'muted' | null;
  stats: Stat[];
  uptime24: number | null;
  uptime7: number | null;
  p95: number | null;
  /** how up/down is decided; only http and tcp measure a response time (p95) */
  check: CheckKind | null;
  cert: { days: number; selfSigned: boolean } | null;
  /** probe health in 48 half-hour buckets, oldest first; null when the service has no probes */
  beats: (Level | 'none')[] | null;
}

/** A heartbeat service as the dashboard sees it: when it last ran and when the next run is due. */
export interface Job {
  id: string;
  name: string;
  group: string;
  href: string | null;
  description: string;
  every: number;
  grace: number;
  lastOk: number | null;
  lastFail: number | null;
  /** when the next run is expected; overdue after `due + grace` */
  due: number;
  state: 'up' | 'down' | 'pending';
  failed: boolean;
  backup: boolean;
  /** the short word for its state ("on schedule", "overdue", "failed", "waiting for its first run") and its level, from check.ts */
  status: string;
  level: Level | 'none';
}

/** A metric's recent history: equal buckets from `from` to the snapshot's time, null where nothing was recorded. */
export interface Trend {
  values: (number | null)[];
  from: number;
}

export interface Gauge {
  key: string;
  label: string;
  val: number | string;
  unit: string;
  pct: number | null;
  level: Level | 'none';
  sub: string | null;
  /** 24 h history in equal buckets from `from` to the snapshot's time; null without two samples yet */
  series: (number | null)[] | null;
  from?: number;
  max?: number | null;
  /** where it turns amber, drawn as a line on the chart */
  warn?: number | null;
}

/** One area of the infrastructure card, said once for its row and its tab. */
export interface InfraPanel {
  id: 'system' | 'storage' | 'drives' | 'network' | 'backups';
  label: string;
  /** beside the label: the host's name */
  where?: string;
  value: string;
  unit?: string;
  /** the line of context under the figure */
  sub: string;
  /** figures shown instead of `value` where one can't say it, each with its label */
  stats?: { k: string; v: string; level: Level | 'none' }[];
  /** as bad as what is raised for the area: a marker always has an alert behind it */
  level: Level | 'none';
  /** the line under the panel's tab in the Infrastructure sheet */
  meta?: string;
}

export interface Snapshot {
  generatedAt: number;
  demo: boolean;
  /** the dashboard's own version (package.json), for the footer */
  version: string | null;
  /** how many config problems /config lists: the badge on its header button */
  configProblems: number;
  title: string;
  linkTarget: string;
  deepLink: Settings['deepLink'];
  logo: string | null;
  staleAfter: number;
  /** the hero: the state in one sentence; while something needs attention, its top item and how to get to it */
  verdict: { level: Level; tag: string; title: string; sub: string; action: { label: string; href: string } | null };
  /** when the newest event happened, for "last change 2 h ago" */
  lastChange: number | null;
  /** heartbeat services: jobs that report when they ran, with their schedule */
  jobs: Job[];
  /** the Backups sheet, from backups.ts */
  backups: Backups;
  attention: AttentionItem[];
  needCount: number;
  /** what Activity lists: the notes (info alerts), then recent events (went down, recovered, backups completed …), newest first */
  feed: FeedItem[];
  /** 48 half-hour buckets, oldest first */
  fleet: (Level | 'none')[];
  fleetAvail: number | null;
  /** `name` is the Proxmox node; `facts` are labelled pairs shown beside it (uptime, guests) */
  host: { name: string; href: string | null; facts: { label: string; value: string }[]; gauges: Gauge[] } | null;
  /** `off` rows (unavailable, detached, size unknown) draw `pct` as a grey bar: the last known fill, or empty */
  /** `group`: the service that reports it (rows are grouped by it); `warn`: the fill where its bar turns amber */
  storage: { name: string; group: string; pct: number | null; level: Level | 'off'; sub: string; warn: number; trend: Trend | null }[];
  /** the infrastructure sheet's Drives panel; empty when no widget reports drives */
  drives: {
    name: string;
    /** where it sits (the host or NAS that reports it): rows are grouped by it */
    group: string;
    meta: string;
    /** every SMART detail as one line, for the tooltip */
    detail: string;
    status: string;
    level: Level;
    /** % of rated endurance left, drawn as a bar; null when the drive doesn't report it */
    life: number | null;
    lifeLevel: Level;
    /** °C, for the card's hottest drive */
    tempC: number | null;
    facts: Fact[];
  }[];
  network: (Traffic & {
    /** the Proxmox host NIC, shown under WAN on its own scale */
    lan: Traffic | null;
    dns: (DnsStats & { href: string | null; name: string }) | null;
  }) | null;
  /** the infrastructure card's rows, which are also the Infrastructure sheet's tabs (all but Backups) */
  infrastructure: InfraPanel[];
  /** most-opened services, by open count with a half-life of `settings.mostUsed.halfLifeDays` */
  mostUsed: Tile[];
  groups: { name: string; summary: string; services: Tile[] }[];
  bookmarks: Bookmark[];
}
