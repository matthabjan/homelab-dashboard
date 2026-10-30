// Docker through a socket proxy: a second, smaller Docker host than the one behind Portainer (another engine id,
// so its containers add to the count). "issues": syncthing's health check fails.
import { container } from './portainer.ts';
import type { Fixtures } from '$lib/types';
import type { DockerContainer, DockerContainerInspect, DockerInfo } from '../integrations/containers.ts';

const names = ['socket-proxy', 'unbound', 'restic-rest', 'mealie', 'ntfy'];

export default {
  'GET /info': (): DockerInfo => ({ ID: 'DEMO:DOCKER02:ENGINE', Name: 'docker-02' }),
  'GET /containers/json': ({ scenario }): DockerContainer[] => [
    ...names.map((n) => container(n, 'running', 'Up 9 days')),
    container('syncthing', 'running', scenario === 'issues' ? 'Up 9 days (unhealthy)' : 'Up 9 days (healthy)')
  ],
  'GET /containers/:id/json': (): DockerContainerInspect => ({ RestartCount: 0, HostConfig: { RestartPolicy: { Name: 'unless-stopped' } } })
} satisfies Fixtures;
