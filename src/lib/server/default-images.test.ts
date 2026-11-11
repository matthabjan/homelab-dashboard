// Which file answers for an image path: the config's own, or the app's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { builtinFor } from './default-images.ts';

test('the app\'s icon answers when the config has none or an old stock copy; a file put there replaces it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'images-'));
  fs.mkdirSync(path.join(dir, 'images'));
  const put = (name: string, body: string) => fs.writeFileSync(path.join(dir, 'images', name), body);
  const stock = new Set([createHash('sha256').update('old icon').digest('hex')]);

  assert.equal(builtinFor(dir, 'images/favicon.ico', stock), 'favicon.ico', 'nothing in the config');
  put('favicon.ico', 'old icon');
  assert.equal(builtinFor(dir, 'images/favicon.ico', stock), 'favicon.ico', 'a copy of the old stock icon is not a choice');
  put('favicon.ico', 'my own icon');
  assert.equal(builtinFor(dir, 'images/favicon.ico', stock), null, 'the config\'s own file wins');
  put('logo-dark.png', 'my own dark logo');
  assert.equal(builtinFor(dir, '/images/logo-dark.png', stock), null);

  assert.equal(builtinFor(dir, 'images/photo.png', stock), null, 'not one of the app\'s files');
  assert.equal(builtinFor(dir, 'icons/favicon.ico', stock), null, 'only images/');
  assert.equal(builtinFor(dir, 'https://example.com/favicon.ico', stock), null);
  assert.equal(builtinFor(dir, null, stock), null);
  fs.rmSync(dir, { recursive: true });
});
