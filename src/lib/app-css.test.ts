// app.css writes each colour once as light-dark(light, dark), and repeats the light half for browsers without
// light-dark(): the two must not drift apart. And every font size and corner radius in the app is a step of its scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');
/** the declarations of a block, by custom property */
const decls = (block: string) => new Map([...block.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)].map((m) => [m[1], m[2]]));
/** `light-dark(a, b)` → a, with nested parentheses (rgba(), var()) kept whole */
function lightHalf(value: string): string {
  let out = '';
  for (let i = 0; i < value.length;) {
    if (!value.startsWith('light-dark(', i)) { out += value[i++]; continue; }
    let depth = 0, j = i + 'light-dark('.length, comma = -1;
    for (; j < value.length; j++) {
      const c = value[j];
      if (c === '(') depth++;
      else if (c === ')') { if (!depth) break; depth--; }
      else if (c === ',' && !depth && comma < 0) comma = j;
    }
    out += value.slice(i + 'light-dark('.length, comma).trim();
    i = j + 1;
  }
  return out;
}
/** a shadow list without the layers that are transparent in this theme */
const withoutTransparent = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim()).filter((x) => !/\btransparent$/.test(x)).join(', ');

test('the light theme for old browsers repeats the light half of every colour', () => {
  const palette = decls(css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='light']")));
  const start = css.indexOf('@supports not (color: light-dark(');
  const fallback = decls(css.slice(start, css.indexOf('\n}\n', start)));
  assert.ok(palette.size > 20, 'the palette was found');
  assert.deepEqual([...fallback.keys()], [...palette.keys()], 'the same properties, in the same order');
  for (const [name, value] of palette) {
    assert.ok(value.includes('light-dark('), `${name} is written as light-dark()`);
    assert.equal(fallback.get(name), withoutTransparent(lightHalf(value)), name);
  }
});

test('font sizes and corner radii are steps of the scale, never values of their own', () => {
  const src = new URL('..', import.meta.url).pathname;
  const files = fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(svelte|css)$/.test(f));
  assert.ok(files.length > 20, 'the components were found');
  const off: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    // the scale's own definition, the fluid headline, and the diamond's 1.5px are the only literals
    for (const m of text.matchAll(/(font-size|border-radius):\s*([^;}]+)/g)) {
      const value = m[2].trim();
      if (m[1] === 'font-size' && (/^var\(--fs-\d+\)$/.test(value) || /^clamp\(/.test(value) || /^[\d.]+em$/.test(value) || value === 'inherit')) continue;
      if (m[1] === 'border-radius' && value.split(/\s+/).every((x) => /^var\(--r-(\d+|pill)\)$/.test(x) || x === '0' || x === '50%' || x === '1.5px' || x === 'inherit')) continue;
      off.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(off, []);
});
