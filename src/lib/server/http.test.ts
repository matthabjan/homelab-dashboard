// The transport against a local server whose host name also resolves to an unreachable IPv6 address, and TCP probes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import type dns from 'node:dns';
import type net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Agent, fetch } from 'undici';
import { cachedLookup, getJson, tcpProbe } from './http.ts';

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

test('getJson: an answer that is not JSON is a short error; the body goes to the log only', async () => {
  const err = await getJson('https://x.test/', {}, async () => new Response('<html><title>Sign in</title>', { status: 200 }))
    .then(() => null, (e: Error & { body?: string }) => e);
  // res.json() would say: Unexpected token '<', "<html><tit"... is not valid JSON
  assert.equal(err?.message, 'Response is not JSON');
  assert.equal(err?.body, '<html><title>Sign in</title>');
});

test('TCP probe: connected is up with the connect time, refused and timeouts are down', async () => {
  const fake = (act: (s: EventEmitter) => void) => () => {
    const s = Object.assign(new EventEmitter(), { destroy() {}, setTimeout(ms: number, fn: () => void) { if (ms === 1) setImmediate(fn); } });
    setImmediate(() => act(s));
    // a stand-in for the socket net.connect returns: only what tcpProbe touches
    return s as unknown as net.Socket;
  };
  const up = await tcpProbe('h', 22, { connect: (fake((s) => s.emit('connect')) as typeof net.connect) });
  assert.equal(up.ok, true);
  assert.ok(typeof up.ms === 'number');
  const refused = await tcpProbe('h', 22, { connect: (fake((s) => s.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))) as typeof net.connect) });
  assert.deepEqual(refused, { ok: false, ms: null, code: 'ECONNREFUSED' });
  const slow = await tcpProbe('h', 22, { connect: (fake(() => {}) as typeof net.connect), timeout: 1 });
  assert.deepEqual(slow, { ok: false, ms: null, code: 'ETIMEDOUT' });
});

