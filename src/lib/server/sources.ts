// The engine's readings in production: probes and certificates over the network, the local host from /proc,
// temperatures from hwmon, undici for widgets and icons. demo.ts#demoSources is the other adapter.
import { certInfo, probe, request } from './http.ts';
import { readTemps } from './integrations/host.ts';
import { readLocal } from './local.ts';
import type { Sources } from '$lib/types';

export const liveSources: Sources = {
  probe: (s) => probe((s.probe as string)),
  cert: (s) => certInfo((s.probe as string)),
  local: (host, state) => readLocal(host, state),
  temps: () => readTemps(),
  transport: () => request,
  iconTransport: request,
  seed: () => {}
};
