// Shared shapes, checked by `npm run check`. Types only: nothing here exists at runtime.
// The JS files use them through JSDoc, e.g. /** @import { Context, WidgetResult } from '$lib/types' */.
// Terms as in CONTEXT.md.

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
    service: string | null;
    node: string | null;
    temperature: boolean;
    storages: string[] | null;
    storage: string | null;
  };
  network: { service: string | null };
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
  };
  retentionDays: number;
}

/** The `widget:` block of a service. Fields beyond `type` depend on the integration. */
export interface Widget {
  type: string;
  url: string;
  username?: string;
  password?: string;
  [option: string]: any;
}

/** Container state of a label-discovered service (from Portainer). */
export interface ContainerState {
  state: string;
  health: string | null;
  exitCode: number;
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

/** What a fixture route receives (demo/index.js); it returns an object (sent as JSON) or a string (sent as XML). */
export interface FixtureRequest {
  now: number;
  scenario: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  /** parsed when JSON, else the raw string (SOAP) */
  body: any;
  url: URL;
}

/** "METHOD /path" → route handler, one table per widget type. */
export type Fixtures = Record<string, (req: FixtureRequest) => object | string | Promise<object | string>>;

/** Durable key/value store that survives restarts. */
export interface Kv {
  get(key: string): any;
  set(key: string, value: unknown): void;
}

/** Hand-offs between integrations within one widget round. */
export interface Shared {
  guestIds?: Set<string>;
  guestNames?: Record<string, string>;
  containers?: ContainerCounts;
}

/** Everything an integration may use. Built by createContext in integrations/index.js. */
export interface Context {
  settings: Settings;
  now: number;
  insecure: boolean;
  shared: Shared;
  /** in memory, per service, between polls */
  state: Record<string, any>;
  /** history for sparklines; null and NaN are skipped */
  metric(key: string, value: number | null): void;
  kv: Kv;
  request: Transport;
  getJson(url: string, opts?: RequestOptions): Promise<any>;
}

export type Severity = 'crit' | 'warn' | 'info';

export interface Alert {
  sev: Severity;
  title: string;
  detail?: string;
  /** identifies the alert across polls when the title changes (e.g. includes a count) */
  key?: string;
}

/** Written to the events table and shown in the feed. */
export interface WidgetEvent {
  sev: Severity | 'ok';
  title: string;
  detail?: string;
}

export interface Stat {
  k: string;
  v: string;
  level?: string | null;
}

/** One line in the storage card: usage, or `offline` (an unavailable or detached storage). */
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
}

export interface OfflineRow {
  name: string;
  sub: string;
  source: 'pve' | 'pbs' | 'omv';
  offline: true;
  /** how full it was when last seen, drawn as a grey bar */
  pct?: number | null;
}

/** The Proxmox node shown as "host". */
export interface HostVitals {
  node: string;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  memPct: number;
  disk: { name: string; pct: number | null; sub: string };
  uptime: string | null;
  guestsRunning: number;
  guestsTotal: number;
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
  health: 'ok' | 'failing' | 'unknown';
}

/** Current rates plus their 24 h series, as the network card draws them. */
export interface Traffic {
  source: string | null;
  href: string | null;
  down: number | null;
  up: number | null;
  seriesDown: (number | null)[] | null;
  seriesUp: (number | null)[] | null;
  spanH: number | null;
}

export interface DnsStats {
  queries: number;
  blockedPct: number;
  avgMs: number;
  series: number[] | null;
  /** what the counts cover, e.g. "24 h" (AdGuard's statistics interval) */
  period: string | null;
}

export interface BackupStatus {
  overdue: number;
  oldestAge: number | null;
  known: boolean;
}

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
  def: Record<string, any>;
  container: ContainerState;
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
  backups?: BackupStatus;
  containers?: ContainerCounts;
  discovered?: Discovered[];
}

export interface Integration {
  collect(widget: Widget, ctx: Context): Promise<WidgetResult>;
}

// ---------- engine state ----------

export interface ProbeState {
  fails: number;
  down: boolean;
  since: number | null;
  reason: string | null;
  ms: number | null;
  checked: number | null;
}

export interface CertInfo {
  validTo: number;
  trusted: boolean;
  selfSigned: boolean;
  subject?: string;
}

/** The last collect of a service: its result, or `ok: false` with the error and the previous stats. */
export type WidgetState = WidgetResult & { ok: boolean; ts: number; error?: string };

export interface ServiceState {
  probe: ProbeState;
  widget: WidgetState | null;
  wstate: Record<string, any>;
  cert: CertInfo | null;
}

export interface Temps {
  cpu: number | null;
  nvme: number[];
  drives: number[];
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
  title: string;
  detail?: string;
  key?: string;
  sid?: string;
  service?: string;
  href?: string | null;
  ts: number;
}

export interface FeedEvent {
  ts: number;
  sev: Severity | 'ok';
  sid: string;
  title: string;
  detail: string | null;
  href: string | null;
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
  cert: { days: number; selfSigned: boolean } | null;
  /** probe health in 48 half-hour buckets, oldest first; null when the service has no probes */
  beats: (Level | 'none')[] | null;
}

export interface Gauge {
  key: string;
  label: string;
  val: number | string;
  unit: string;
  pct: number | null;
  level: Level | 'none';
  sub: string | null;
  series: (number | null)[] | null;
  max?: number | null;
}

export interface Snapshot {
  generatedAt: number;
  demo: boolean;
  title: string;
  linkTarget: string;
  deepLink: Settings['deepLink'];
  logo: string | null;
  staleAfter: number;
  verdict: { level: Level; tag: string; title: string; sub: string };
  facts: Fact[];
  attention: AttentionItem[];
  needCount: number;
  events: FeedEvent[];
  /** 48 half-hour buckets, oldest first */
  fleet: (Level | 'none')[];
  fleetAvail: number | null;
  host: { name: string; href: string | null; detail: string; gauges: Gauge[] } | null;
  /** `off` rows (unavailable, detached, size unknown) draw `pct` as a grey bar: the last known fill, or empty */
  storage: { name: string; pct: number | null; level: Level | 'off'; sub: string; href: string | null }[];
  /** the storage card's second view; empty when no widget reports drives */
  drives: {
    name: string;
    meta: string;
    /** every SMART detail as one line, for the tooltip */
    detail: string;
    status: string;
    level: Level;
    /** % of rated endurance left, drawn as a bar; null when the drive doesn't report it */
    life: number | null;
    lifeLevel: Level;
    facts: Fact[];
    href: string | null;
  }[];
  network: (Traffic & {
    /** the Proxmox host NIC, shown under WAN on its own scale */
    lan: Traffic | null;
    dns: (DnsStats & { href: string | null; name: string }) | null;
  }) | null;
  /** most-opened services, by open count with a half-life of `settings.mostUsed.halfLifeDays` */
  mostUsed: Tile[];
  groups: { name: string; summary: string; services: Tile[] }[];
  bookmarks: Bookmark[];
}
