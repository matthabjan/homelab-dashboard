// Portainer: 26 containers, two of them carrying homepage labels (they become services).
// "issues": music-assistant crashed and stays exited; wud was `docker stop`ped (exit 0, but it should be running).
// In both, certbot-renew is a one-shot job that finished (exit 0, no restart policy): not a failure.
const plain = ['postgres', 'redis', 'immich-server', 'immich-ml', 'paperless', 'gotenberg', 'tika', 'jellyfin', 'sonarr', 'radarr', 'prowlarr', 'qbittorrent', 'vaultwarden',
  'nextcloud', 'mariadb', 'mosquitto', 'zigbee2mqtt', 'node-red', 'uptime-kuma', 'grafana', 'prometheus', 'loki'];

const container = (name, state = 'running', status = 'Up 3 days', labels = {}) => ({ Id: `${name.padEnd(12, '0')}abcdef`, Names: [`/${name}`], State: state, Status: status, Labels: labels });

export default {
  'GET /api/endpoints/:env/docker/containers/json': ({ scenario }) => [
    ...plain.map((n) => container(n)),
    scenario === 'issues' ? container('music-assistant', 'exited', 'Exited (1) 1 hour ago') : container('music-assistant'),
    container('traefik', 'running', 'Up 3 days', {
      'dashboard.group': 'Management', 'dashboard.name': 'Traefik', 'dashboard.icon': 'traefik',
      'dashboard.href': 'https://traefik.home.arpa', 'dashboard.description': 'Reverse proxy · from container labels', 'dashboard.siteMonitor': 'https://traefik.home.arpa'
    }),
    container('certbot-renew', 'exited', 'Exited (0) 6 hours ago'),
    container('wud', scenario === 'issues' ? 'exited' : 'running', scenario === 'issues' ? 'Exited (0) 20 minutes ago' : 'Up 3 days (healthy)', {
      'dashboard.group': 'Management', 'dashboard.name': "What's Up Docker", 'dashboard.icon': 'whats-up-docker',
      'dashboard.href': 'https://wud.home.arpa', 'dashboard.description': 'Image updates · container state only'
    })
  ],
  'GET /api/endpoints/:env/docker/containers/:id/json': ({ params }) => params.id.startsWith('certbot')
    ? { RestartCount: 0, HostConfig: { RestartPolicy: { Name: 'no' } } }
    : { RestartCount: 5, HostConfig: { RestartPolicy: { Name: 'unless-stopped' } } }
};
