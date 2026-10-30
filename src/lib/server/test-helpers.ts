// Shared test setup. A test that sets DATA_DIR or CONFIG_DIR imports this dynamically, after setting them (config.ts
// reads them on import).
import { DEFAULT_SETTINGS, slug } from './config.ts';
import { blankCheck } from './check.ts';
import type { Config, HostVitals, Kv, Service, ServiceState, Settings, Temps } from '$lib/types';
import type { SnapshotInput } from './snapshot.ts';

/** A `Kv` in memory, for one test. */
export const memoryKv = (): Kv => {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => (m.get(k) ?? null) as T | null, set: (k: string, v: unknown) => { m.set(k, v); } };
};

export type TestService = Partial<Service> & { name: string; state?: Partial<ServiceState> };

/** A check that never ran, no widget result, no certificate. */
const blank = (): ServiceState => ({ check: blankCheck(), widget: null, wstate: {}, cert: null });

/**
 * A snapshot input: the services in one group "G", each with its state (a check that never ran unless given), or a
 * whole loaded `cfg`. `state(id)` hands out the same object each time, as the engine does, so a test can change it
 * between two builds.
 */
export function snapshotInput({ services = [], cfg, settings = DEFAULT_SETTINGS, local = null, temps = null }: { services?: TestService[]; cfg?: Config; settings?: Settings; local?: HostVitals | null; temps?: Temps | null } = {}): SnapshotInput {
  const states = new Map<string, ServiceState>();
  const svcs: Service[] = services.map(({ state, ...s }) => {
    const group = s.group ?? 'G';
    const svc: Service = { id: slug(`${group}-${s.name}`), group, href: null, description: '', icon: null, iconDark: null, probe: null, insecure: false, latencyWarnMs: null, widget: null, heartbeat: null, ...s };
    states.set(svc.id, { ...blank(), ...state });
    return svc;
  });
  return {
    cfg: cfg ?? { settings, groups: [{ name: 'G', services: svcs }], services: svcs, bookmarks: [], problems: [] },
    state: (id: string) => {
      let st = states.get(id);
      if (!st) states.set(id, (st = blank()));
      return st;
    },
    autoIcons: new Map(),
    shared: {},
    temps,
    local
  };
}
