// Home Assistant: a small house. "issues": core and an add-on have updates, two batteries run low and a plug is
// unavailable; "calm": all up to date and charged.
import type { Fixtures } from '$lib/types';
import type { HassConfig, HassState } from '../integrations/homeassistant.ts';

const update = (id: string, title: string, installed: string, latest: string): HassState => ({
  entity_id: `update.${id}`, state: installed === latest ? 'off' : 'on', attributes: { title, installed_version: installed, latest_version: latest, friendly_name: `${title} Update` }
});
const battery = (id: string, name: string, level: number): HassState => ({
  entity_id: `sensor.${id}_battery`, state: String(level), attributes: { device_class: 'battery', unit_of_measurement: '%', friendly_name: `${name} Battery` }
});

export default {
  'GET /api/config': (): HassConfig => ({ version: '2026.11.0', location_name: 'Home' }),
  'GET /api/states': ({ scenario }): HassState[] => {
    const issues = scenario === 'issues';
    return [
      update('home_assistant_core_update', 'Home Assistant Core', '2026.11.0', issues ? '2026.11.1' : '2026.11.0'),
      update('home_assistant_operating_system_update', 'Home Assistant Operating System', '16.3', '16.3'),
      update('mosquitto_broker_update', 'Mosquitto broker', '6.5.1', issues ? '6.5.2' : '6.5.1'),
      battery('front_door', 'Front door', issues ? 9 : 81),
      battery('living_room_motion', 'Living room motion', 64),
      { entity_id: 'binary_sensor.garden_sensor_battery_low', state: issues ? 'on' : 'off', attributes: { device_class: 'battery', friendly_name: 'Garden sensor' } },
      { entity_id: 'sensor.house_power', state: '412', attributes: { unit_of_measurement: 'W', friendly_name: 'House power' } },
      { entity_id: 'switch.desk_plug', state: issues ? 'unavailable' : 'on', attributes: { friendly_name: 'Desk plug' } },
      { entity_id: 'zone.home', state: '2', attributes: { friendly_name: 'Home' } }
    ];
  },
  'POST /api/template': () => '2'
} satisfies Fixtures;
