// The transport against a local server whose host name also resolves to an unreachable IPv6 address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import { Agent, fetch } from 'undici';
import { cachedLookup } from './http.ts';

test('lookup: cached, and a host with an unreachable IPv6 address still connects every time', async () => {
  const srv = http.createServer((_, res) => res.end('ok')).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  let resolved = 0;
  // a resolver whose every answer lists an unreachable IPv6 address first
  const resolve = ((_host: string, _opts: dns.LookupAllOptions, cb: (err: null, addrs: dns.LookupAddress[]) => void) => {
    resolved++;
    cb(null, [{ address: '2001:db8::1', family: 6 }, { address: '127.0.0.1', family: 4 }]);
  }) as unknown as typeof dns.lookup;
  const dispatcher = new Agent({ connect: { lookup: cachedLookup(resolve) }, pipelining: 0 });
  const url = `http://dual.test:${(srv.address() as AddressInfo).port}/`;
  try {
    for (let i = 0; i < 4; i++) assert.equal(await (await fetch(url, { dispatcher, headers: { connection: 'close' } })).text(), 'ok');
    assert.equal(resolved, 1);
  } finally {
    srv.close();
    await dispatcher.close();
  }
});
