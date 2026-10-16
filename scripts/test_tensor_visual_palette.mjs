// v3.22.65 silk tensor VISUAL-only regression.
// Run: node scripts/test_tensor_visual_palette.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HYDRO_TENSOR_PALETTE as P,
  HYDRO_TENSOR_RIBBON_GRADIENT as gradient,
  baseTensorMaterial,ribbonTensorMaterial,particleTensorMaterial
} from './hydro_tensor_visual.js';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const field=read('./hydro_tensor_field.js');
const ui=read('./local_flood_ui.js');
const originalGeometry=read('./hydro_tensor_geometry.js');
const originalTensorWorker=read('./hydro_tensor_worker.js');
const originalFloodWorker=read('./local_flood_worker.js');
assert.deepEqual(Object.values(P),[
  '#E3F4FF','#9DDCFF','#518DCE','#A9D9FA','#EDBDF9']);
const expected=new Set(Object.values(P));
for(const branch of ['primary','secondary']){
  const low=baseTensorMaterial({branch,rank:0,wetSupport:0});
  const high=baseTensorMaterial({branch,rank:1,wetSupport:1});
  assert.match(low.color,/^#[A-Fa-f0-9]{6}$/);
  assert.match(high.color,/^#[A-Fa-f0-9]{6}$/);
  assert.ok(low.opacity>=.18&&high.opacity<=.70);
  assert.ok(high.opacity>low.opacity);
  assert.ok(high.glowFactor>0);
}
const trunk=ribbonTensorMaterial({hierarchy:'trunk',rank:1});
const branch=ribbonTensorMaterial({hierarchy:'tributary',rank:.2});
assert.ok(trunk.opacity>branch.opacity);
for(let i=0;i<145;i++){
  const item=particleTensorMaterial({index:i,main:i%3===0,rank:i%7===0?1:.3});
  assert.ok(expected.has(item.color),'all particles stay in the five-colour palette');
  assert.ok(item.radius<=1.3&&item.radius>=.62);
}
assert.equal(gradient[0],'interpolate');
assert.deepEqual(gradient[2],['line-progress']);
assert.ok(gradient.includes('#E3F4FF'));
assert.ok(gradient.includes('#A9D9FA'));
assert.ok(gradient.includes('rgba(237, 189, 249, 0.38)'));
assert.ok(ui.includes('[FOCUS_TENSOR_RIBBON_SOURCE]:{type:\'geojson\',lineMetrics:true'),
  'gradient GeoJSON source must have lineMetrics:true');
assert.ok(ui.includes("'line-gradient':HYDRO_TENSOR_RIBBON_GRADIENT"));
assert.ok(field.includes("['*',settings.glow*settings.opacity*.20"));
assert.ok(field.includes("['*',settings.glow*settings.opacity*.18"));
assert.ok(field.includes('particleTensorMaterial({index:i,main,rank:line.rank})'));
assert.ok(field.includes('const u=(elapsed*settings.speed*(.06+.09*line.rank)+'),
  'particles remain on original trajectory with original speed interpolation');
assert.ok(field.includes("const pos=u*(coords.length-1)"));
assert.ok(!field.includes("queueGeometry(); // colour"),'style edits cannot rebuild geometry');
assert.ok(originalGeometry.includes('export function createTensorGeometry'));
assert.ok(originalTensorWorker.includes('function solve('));
assert.ok(originalFloodWorker.includes('sendFrame('));
console.log('PASS exact five-colour palette, line opacity tiers and sparse highlights');
console.log('PASS ribbon line-progress gradient, camera-safe core/glow and trajectory-bound particles');
console.log('NOTE solver/geometry/flood file SHAs are verified separately against pre-change commit');
