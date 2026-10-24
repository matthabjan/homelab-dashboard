// FRITZ!Box UPnP (TR-064): SOAP answers chosen by the SoapAction header.
const envelope = (fields) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</s:Body></s:Envelope>`;

const action = (headers) => String(headers.SoapAction ?? '').split('#')[1];

export default {
  'POST /igdupnp/control/WANIPConn1': () => envelope({ NewConnectionStatus: 'Connected', NewUptime: 12 * 86_400 }),
  'POST /igdupnp/control/WANCommonIFC1': ({ headers }) =>
    action(headers) === 'GetAddonInfos'
      ? envelope({ NewByteReceiveRate: Math.round((30 + Math.random() * 80) * 125_000), NewByteSendRate: Math.round((4 + Math.random() * 12) * 125_000) })
      : envelope({ NewLayer1DownstreamMaxBitRate: 250_000_000, NewLayer1UpstreamMaxBitRate: 40_000_000 })
};
