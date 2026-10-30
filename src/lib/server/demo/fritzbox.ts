// FRITZ!Box UPnP (TR-064): SOAP answers chosen by the SoapAction header.
import type { Fixtures } from '$lib/types';
import type { FritzAddonInfos, FritzLinkProperties, FritzStatusInfo } from '../integrations/fritzbox.ts';

/** An answer's <New…> fields, as numbers or text (XML makes them text). */
const envelope = <T>(fields: { [K in keyof T]: string | number }) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</s:Body></s:Envelope>`;

const action = (headers: Record<string, string>) => String(headers.SoapAction ?? '').split('#')[1];

export default {
  'POST /igdupnp/control/WANIPConn1': () => envelope<FritzStatusInfo>({ NewConnectionStatus: 'Connected', NewUptime: 12 * 86_400 }),
  'POST /igdupnp/control/WANCommonIFC1': ({ headers }) =>
    action(headers) === 'GetAddonInfos'
      ? envelope<FritzAddonInfos>({ NewByteReceiveRate: Math.round((30 + Math.random() * 80) * 125_000), NewByteSendRate: Math.round((4 + Math.random() * 12) * 125_000) })
      : envelope<FritzLinkProperties>({ NewLayer1DownstreamMaxBitRate: 250_000_000, NewLayer1UpstreamMaxBitRate: 40_000_000 })
} satisfies Fixtures;
