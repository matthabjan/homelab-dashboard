// app.css writes each colour once as light-dark(light, dark), and repeats the light half for browsers without
// light-dark(). The two must not drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
