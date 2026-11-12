/* Regression test for the bidirectional UI language layer.

   Runs without a DOM: ui_language.js only auto-starts when `document` and
   `window` exist, so the pure translation entry point can be exercised
   directly. This checks that Chinese display actually resolves, that runtime
   messages built from a fixed prefix plus dynamic detail keep their detail,
   and that English mode leaves the English source untouched. */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateUI, setLanguage, getLanguage} from '../scripts/ui_language.js';
import {CHINESE_UI} from '../scripts/ui_chinese_dictionary.js';

const han = /[㐀-鿿]/;

// ---- dictionary integrity -------------------------------------------------

const entries = Object.entries(CHINESE_UI);
assert.ok(entries.length > 250, 'Chinese dictionary must cover the interface');
for (const [english, chinese] of entries) {
  assert.ok(english.trim() === english, `key must be trimmed: ${JSON.stringify(english)}`);
  assert.ok(chinese.trim().length > 0, `empty translation for ${JSON.stringify(english)}`);
  assert.ok(!han.test(english), `key must be English: ${JSON.stringify(english)}`);
}

// ---- zh mode --------------------------------------------------------------

setLanguage('zh');
assert.equal(getLanguage(), 'zh');

// Core panel labels the user sees immediately.
for (const label of ['Map provider', 'Map style', '2D plan', '3D city', 'Analysis layers',
                     'Local flood simulation', 'Hide OSM labels / POIs']) {
  const out = translateUI(label);
  assert.ok(han.test(out), `panel label not translated: ${label} -> ${out}`);
}

// A fixed prefix plus dynamic detail must keep the detail verbatim.
const withDetail = translateUI('Location failed: timeout after 10s');
assert.ok(han.test(withDetail), 'prefixed message must translate');
assert.ok(withDetail.includes('timeout after 10s'), 'dynamic detail must be preserved');

// Numbers and units inside a known phrase survive.
const area = translateUI('Enter minimum contributing area (km²)');
assert.ok(area.includes('km²'), 'units must be preserved');

// An unknown string is returned unchanged rather than mangled.
const unknown = 'ZZ unknown runtime string 12345';
assert.equal(translateUI(unknown), unknown, 'unknown strings must pass through');

// Already-Chinese strings (still present in some modules) are left alone.
const alreadyChinese = '场地边界不可用';
assert.equal(translateUI(alreadyChinese), alreadyChinese, 'Chinese source must not be re-translated');

// ---- en mode reproduces the previous English behaviour --------------------

setLanguage('en');
assert.equal(getLanguage(), 'en');
for (const label of ['Map provider', '2D plan', 'Analysis layers']) {
  assert.equal(translateUI(label), label, `English source must be unchanged in en mode: ${label}`);
}
assert.ok(!han.test(translateUI('场地边界不可用')), 'en mode must translate residual Chinese');

// ---- wiring ---------------------------------------------------------------

const html = readFileSync('index.html', 'utf8');
assert.match(html, /scripts\/ui_language\.js/, 'index.html must load the language layer');
assert.match(html, /id="uiLanguageSwitch"[^>]*data-no-translate/,
  'the language switch must be excluded from translation');
assert.ok(!/ui_english\.js/.test(html),
  'index.html must not also load the one-way English layer');

// ---- round trip must not degrade ------------------------------------------

// A status line is rewritten by the application on every update. Translating
// it must never freeze it on an earlier message, and switching languages twice
// must return exactly the English source.
setLanguage('zh');
const sample = 'Local flood simulation cleared.';
const zhOnce = translateUI(sample);
setLanguage('en');
assert.equal(translateUI(sample), sample, 'en mode must return the English source');
setLanguage('zh');
assert.equal(translateUI(sample), zhOnce, 'repeated switching must be stable');
assert.ok(!translateUI(zhOnce).includes('undefined'), 'translated output must not be re-translated');

setLanguage('zh');
console.log(`PASS UI language layer: ${entries.length} Chinese entries; zh/en switching verified`);
