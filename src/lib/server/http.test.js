// The transport against a local server whose host name also resolves to an unreachable IPv6 address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Agent, fetch } from 'undici';
import { cachedLookup } from './http.js';

test('lookup: cached, and a host with an unreachable IPv6 address still connects every time', async () => {
  const srv = http.createServer((_, res) => res.end('ok')).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  let resolved = 0;
  const resolve = /** @type {any} */ ((_host, _opts, cb) => {
    resolved++;
    cb(null, [{ address: '2001:db8::1', family: 6 }, { address: '127.0.0.1', family: 4 }]);
  });
  const dispatcher = new Agent({ connect: { lookup: cachedLookup(resolve) }, pipelining: 0 });
  const url = `http://dual.test:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/`;
  try {
    for (let i = 0; i < 4; i++) assert.equal(await (await fetch(url, { dispatcher, headers: { connection: 'close' } })).text(), 'ok');
    assert.equal(resolved, 1);
  } finally {
    srv.close();
    await dispatcher.close();
  }
});
