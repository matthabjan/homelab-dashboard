// Shared test setup. Import it dynamically, after setting DATA_DIR and CONFIG_DIR (config.js reads them on import).
import { DEFAULT_SETTINGS, slug } from './config.js';
/** @import { Config, HostVitals, Service, ServiceState, Settings, Temps } from '$lib/types' */
/** @import { SnapshotInput } from './snapshot.js' */

/** @typedef {Partial<Service> & { name: string, state?: Partial<ServiceState> }} TestService */

/** @returns {ServiceState} a probe that never ran, no widget result, no certificate */
const blank = () => ({ probe: { fails: 0, down: false, since: null, reason: null, ms: null, checked: null }, widget: null, wstate: {}, cert: null });

/**
 * A snapshot input: the services in one group "G", each with its state (a probe that never ran unless given), or a
 * whole loaded `cfg`. `state(id)` hands out the same object each time, as the engine does, so a test can change it
 * between two builds.
 * @param {{ services?: TestService[], cfg?: Config, settings?: Settings, local?: HostVitals | null, temps?: Temps | null }} [opts]
 * @returns {SnapshotInput}
 */
export function snapshotInput({ services = [], cfg, settings = DEFAULT_SETTINGS, local = null, temps = null } = {}) {
  /** @type {Map<string, ServiceState>} */
  const states = new Map();
  /** @type {Service[]} */
  const svcs = services.map(({ state, ...s }) => {
    const group = s.group ?? 'G';
    /** @type {Service} */
    const svc = { id: slug(`${group}-${s.name}`), group, href: null, description: '', icon: null, iconDark: null, probe: null, insecure: false, latencyWarnMs: null, widget: null, heartbeat: null, ...s };
    states.set(svc.id, { ...blank(), ...state });
    return svc;
  });
  return {
    cfg: cfg ?? { settings, groups: [{ name: 'G', services: svcs }], services: svcs, bookmarks: [], problems: [] },
    state: (id) => {
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
