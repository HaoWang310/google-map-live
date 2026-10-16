// v3.22.68 travelling gradients and arc-length particle visual regression.
// Run: node scripts/test_tensor_visual_palette.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HYDRO_TENSOR_PALETTE as P,
  HYDRO_TENSOR_RIBBON_GRADIENT as gradient,
  baseTensorMaterial,ribbonTensorMaterial,particleTensorMaterial,tensorRevealGate
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
  assert.ok(low.opacity>=.40&&high.opacity<=.85);
  assert.ok(high.opacity>low.opacity);
  assert.ok(high.glowFactor>0);
}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const rgbDistance=(a,b)=>Math.hypot(...rgb(a).map((c,i)=>c-rgb(b)[i]));
for(const rank of [0,.5,1]){
  const major=baseTensorMaterial({branch:'primary',rank,wetSupport:rank});
  const minor=baseTensorMaterial({branch:'secondary',rank,wetSupport:rank});
  assert.ok(rgbDistance(major.color,minor.color)>90,
    'primary and secondary should remain distinct at every rank');
  assert.ok(major.opacity>.6&&minor.opacity>.6,
    'black-canvas lines should not be washed out by low alpha');
}
const pinkStop=gradient.indexOf('#EDBDF9');
assert.ok(pinkStop>=4&&gradient[pinkStop-1]<.60,
  'pink-violet must appear by the middle of ribbon lines');
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
assert.ok(gradient.includes('#EDBDF9'));
assert.equal(tensorRevealGate(0),0);
assert.equal(tensorRevealGate(1),1);
assert.deepEqual(tensorRevealGate(.5).slice(0,3),['interpolate',['linear'],['get','revealOrder']]);
assert.ok(ui.includes('[FOCUS_TENSOR_RIBBON_SOURCE]:{type:\'geojson\',lineMetrics:true'),
  'gradient GeoJSON source must have lineMetrics:true');
assert.ok(ui.includes("'line-gradient':HYDRO_TENSOR_RIBBON_GRADIENT"));
assert.ok(field.includes('ensureTraceLayers()'), 'per-axis GPU trace layers installed');
assert.ok(field.includes('traceGradient(ribbonProgress'), 'ribbon gradient is dynamically revealed');
assert.ok(field.includes('uploadGeometryOnce()'));
assert.ok(!field.includes('coordinates:coords.slice('),
  'animation must not reconstruct LineString coordinates per frame');
assert.ok(field.includes('restart({preserveGrowth:true})'),
  'each accepted year preserves running animation instead of snapping');
assert.ok(field.includes('particleTensorMaterial({index:i,main,rank:line.rank})'));
assert.ok(field.includes('const u=(elapsed*settings.speed*(.06+.09*line.rank)+'),
  'particles remain on original trajectory with original speed interpolation');
assert.ok(field.includes("const pos=u*(coords.length-1)"));
assert.ok(!field.includes("queueGeometry(); // colour"),'style edits cannot rebuild geometry');
assert.ok(originalGeometry.includes('export function createTensorGeometry'));
assert.ok(originalTensorWorker.includes('function solve('));
assert.ok(originalFloodWorker.includes('sendFrame('));
console.log('PASS exact five-colour palette, line opacity tiers and sparse highlights');
console.log('PASS GPU gradient traces, real-line heads and no per-frame line chopping');
console.log('NOTE solver/geometry/flood file SHAs are verified separately against pre-change commit');
