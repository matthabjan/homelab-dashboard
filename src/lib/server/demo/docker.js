// Docker through a socket proxy: a second, smaller Docker host than the one behind Portainer (another engine id,
// so its containers add to the count). "issues": syncthing's health check fails.
import { container } from './portainer.js';

const names = ['socket-proxy', 'unbound', 'restic-rest', 'mealie', 'ntfy'];

export default {
  'GET /info': () => ({ ID: 'DEMO:DOCKER02:ENGINE', Name: 'docker-02' }),
  'GET /containers/json': ({ scenario }) => [
    ...names.map((n) => container(n, 'running', 'Up 9 days')),
    container('syncthing', 'running', scenario === 'issues' ? 'Up 9 days (unhealthy)' : 'Up 9 days (healthy)')
  ],
  'GET /containers/:id/json': () => ({ RestartCount: 0, HostConfig: { RestartPolicy: { Name: 'unless-stopped' } } })
};
