// The engine's readings in production: probes and certificates over the network, the local host from /proc,
// temperatures from hwmon, undici for widgets and icons. demo.js#demoSources is the other adapter.
import { certInfo, probe, request } from './http.js';
import { readTemps } from './integrations/host.js';
import { readLocal } from './local.js';
/** @import { Service, Sources } from '$lib/types' */

/** @type {Sources} */
export const liveSources = {
  probe: (s) => probe(/** @type {string} */ (s.probe)),
  cert: (s) => certInfo(/** @type {string} */ (s.probe)),
  local: (host, state) => readLocal(host, state),
  temps: () => readTemps(),
  transport: () => request,
  iconTransport: request,
  seed: () => {}
};
