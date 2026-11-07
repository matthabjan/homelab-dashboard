// What's Up Docker: the Portainer host's containers. "issues": three have a newer image (a tag, a digest) and one
// registry lookup failed; "calm": all up to date.
import type { Fixtures } from '$lib/types';
import type { WudContainer } from '../integrations/whatsupdocker.ts';

const NAMES = ['postgres', 'redis', 'immich-server', 'paperless', 'jellyfin', 'vaultwarden', 'nextcloud', 'mosquitto', 'zigbee2mqtt', 'grafana', 'traefik', 'wud'];

const wud = (name: string, tag = 'latest', extra: Partial<WudContainer> = {}): WudContainer => ({
  id: `${name.padEnd(12, '0')}abcdef`, name, watcher: 'local', image: { name: `example/${name}`, tag: { value: tag } }, updateAvailable: false, ...extra
});

export default {
  'GET /api/containers': ({ scenario }): WudContainer[] => NAMES.map((n) => {
    if (scenario !== 'issues') return wud(n);
    if (n === 'nextcloud') return wud(n, '29.0.1', { updateAvailable: true, updateKind: { kind: 'tag', localValue: '29.0.1', remoteValue: '29.0.3', semverDiff: 'patch' } });
    if (n === 'immich-server') return wud(n, 'v1.118.2', { updateAvailable: true, updateKind: { kind: 'tag', localValue: 'v1.118.2', remoteValue: 'v1.119.0', semverDiff: 'minor' } });
    if (n === 'vaultwarden') return wud(n, 'latest', { updateAvailable: true, updateKind: { kind: 'digest', localValue: 'sha256:1a2b', remoteValue: 'sha256:3c4d' } });
    if (n === 'zigbee2mqtt') return wud(n, 'latest', { error: { message: 'registry lookup failed' } });
    return wud(n);
  })
} satisfies Fixtures;
