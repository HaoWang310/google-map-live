// v3.22.75 · Continuous 2026–2100 timeline scrubbing, no physical re-solve.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHydroTensorRenderer} from './hydro_tensor_field.js';

const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scrub=ui.slice(ui.indexOf('  function seekTensorDisplayYear('),
  ui.indexOf('  const seekYear=value=>'));
assert.ok(scrub.includes('seekContinuousPlayback(target,{resume:false})'));
assert.ok(!scrub.includes('requestYear('),'slider must not send expensive hydrology jobs');
assert.ok(!scrub.includes('queueGeometry('),'slider must not integrate geometry');
assert.ok(ui.includes('if(seekTensorDisplayYear(value))return;'),
  'tensor handling must return before original rain seek/worker pipeline');
assert.ok(ui.includes("slider.onchange=e=>finishTensorDisplaySeek(e.target.value)"),
  'both range controls commit their selected year on release');
assert.ok(ui.includes('tensorScrubResumeAfterRelease'),
  'only an already playing timeline resumes after mouseup');
assert.ok(html.includes('siteHudFooterYear'),'footer time slider retained');
assert.ok(html.includes('cursor:ew-resize'),'drag handle must be reachable');

let now=0,id=1;const raf=new Map();
Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
globalThis.requestAnimationFrame=fn=>{const key=id++;raf.set(key,fn);return key};
globalThis.cancelAnimationFrame=key=>raf.delete(key);
const layers=new Map(),sources=new Map(),writes={field:0,ribbon:0};
for(const name of ['field','field-glow','ribbon','ribbon-glow','particles'])
  layers.set(name,{id:name,paint:{},layout:{}});
sources.set('field-src',{setData(){writes.field++}});
sources.set('ribbon-src',{setData(){writes.ribbon++}});
sources.set('particle-src',{setData(){}});
const map={
  getLayer:key=>layers.get(key)||null,
  addLayer:layer=>layers.set(layer.id,layer),
  getSource:key=>sources.get(key)||null,
  setPaintProperty:(key,p,value)=>{layers.get(key).paint[p]=value},
  getPaintProperty:(key,p)=>layers.get(key)?.paint?.[p],
  setLayoutProperty:(key,p,value)=>{layers.get(key).layout[p]=value}
};
const player=createHydroTensorRenderer({
  map,sourceId:'field-src',particleSourceId:'particle-src',
  lineLayerId:'field',glowLayerId:'field-glow',particleLayerId:'particles',
  ribbonSourceId:'ribbon-src',ribbonLayerId:'ribbon',
  ribbonGlowLayerId:'ribbon-glow'
});
function step(n){
  for(let i=0;i<n;i++){
    now+=32;
    const cb=[...raf.values()];raf.clear();
    for(const fn of cb)fn(now);
  }
}
player.setEnabled(true);
player.setPlaybackRate(5);
assert.equal(player.startContinuousPlayback({durationMs:64000}),true);
step(10);
assert.ok(player.getPlaybackState().running);
assert.equal(player.seekContinuousPlayback(2050),true);
assert.equal(player.getPlaybackState().year,2050);
assert.equal(player.getPlaybackState().paused,true);
step(100);
assert.equal(player.getPlaybackState().year,2050,'selected year stays fixed while dragging');
assert.equal(player.seekContinuousPlayback(2030),true);
assert.equal(player.getPlaybackState().year,2030,'scrub backwards immediately');
assert.equal(player.seekContinuousPlayback(2085),true);
assert.equal(player.getPlaybackState().year,2085,'scrub forwards immediately');
assert.equal(player.resumeContinuousPlayback(),true);
step(10);
assert.ok(player.getPlaybackState().year>2085,'play continues from selected year');
assert.ok(player.getPlaybackState().year<2100,'no jump to final keyframe');
player.seekContinuousPlayback(2100);
assert.ok(player.getPlaybackState().finished,'2100 is a valid completed frame');
player.seekContinuousPlayback(2039);
assert.equal(player.getPlaybackState().year,2039,'2100 can scrub back to any earlier year');
assert.equal(player.getPlaybackState().paused,true,'completed playback stays paused for inspection');
step(30);
assert.equal(player.getPlaybackState().year,2039);
player.seekContinuousPlayback(2026);
assert.equal(player.getPlaybackState().fraction,0,'2026 must show the beginning of growth');
player.seekContinuousPlayback(2100);
assert.equal(player.getPlaybackState().fraction,1,'2100 must show full growth');
assert.equal(writes.field,1,'scrubbing must never re-upload huge line GeoJSON');
assert.equal(writes.ribbon,1,'scrubbing must never re-upload ribbon GeoJSON');
player.setEnabled(false);
console.log('PASS instant 2026–2100 seek, reverse seek, pause and continue at 5x');
console.log('PASS no rainfall recalculation or geometry upload during dragging');
