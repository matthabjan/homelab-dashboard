// Portainer: 25 containers, two of them carrying homepage labels (they become services).
// "issues": music-assistant crashed and stays exited.
const plain = ['postgres', 'redis', 'immich-server', 'immich-ml', 'paperless', 'gotenberg', 'tika', 'jellyfin', 'sonarr', 'radarr', 'prowlarr', 'qbittorrent', 'vaultwarden',
  'nextcloud', 'mariadb', 'mosquitto', 'zigbee2mqtt', 'node-red', 'uptime-kuma', 'grafana', 'prometheus', 'loki'];

const container = (name, state = 'running', status = 'Up 3 days', labels = {}) => ({ Id: `${name.padEnd(12, '0')}abcdef`, Names: [`/${name}`], State: state, Status: status, Labels: labels });

export default {
  'GET /api/endpoints/:env/docker/containers/json': ({ scenario }) => [
    ...plain.map((n) => container(n)),
    scenario === 'issues' ? container('music-assistant', 'exited', 'Exited (1) 1 hour ago') : container('music-assistant'),
    container('traefik', 'running', 'Up 3 days', {
      'homepage.group': 'Management', 'homepage.name': 'Traefik', 'homepage.icon': 'traefik',
      'homepage.href': 'https://traefik.home.arpa', 'homepage.description': 'Reverse proxy · from container labels', 'homepage.siteMonitor': 'https://traefik.home.arpa'
    }),
    container('wud', 'running', 'Up 3 days (healthy)', {
      'homepage.group': 'Management', 'homepage.name': "What's Up Docker", 'homepage.icon': 'whats-up-docker',
      'homepage.href': 'https://wud.home.arpa', 'homepage.description': 'Image updates · container state only'
    })
  ],
  'GET /api/endpoints/:env/docker/containers/:id/json': () => ({ RestartCount: 5 })
};
