// v3.22.74 · deterministic speed-switch and pause/replay regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHydroTensorRenderer} from './hydro_tensor_field.js';

const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
assert.ok(!ui.includes('siteHudVectorSpeed'),'obsolete animation-speed slider must be removed');
for(const rate of ['0.5','1.25','1.5','2','3','5'])
  assert.ok(ui.includes('<option value="'+rate+'"'),'missing '+rate+'x option');
assert.ok(ui.includes("speedSelector.onchange=()=>"),'speed change handler is wired');
assert.ok(ui.includes('hydroVector?.setPlaybackRate(candidate)'),
  'rate updates the renderer, not the flood simulator');

let now=0,nextId=1;
Object.defineProperty(globalThis,'performance',{
  value:{now:()=>now},configurable:true
});
const callbacks=new Map();
globalThis.requestAnimationFrame=fn=>{const id=nextId++;callbacks.set(id,fn);return id};
globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
function frames(count,ms=32){
  for(let i=0;i<count;i++){
    now+=ms;
    const current=[...callbacks.entries()];
    callbacks.clear();
    for(const [,fn] of current)fn(now);
  }
}
const mapLayers=new Map(),sources=new Map();
for(const id of ['field','field-glow','ribbon','ribbon-glow','particles'])
  mapLayers.set(id,{id,paint:{},layout:{}});
for(const id of ['field-src','ribbon-src','particle-src'])
  sources.set(id,{setData(){}});
const map={
  getLayer:id=>mapLayers.get(id)||null,
  addLayer(layer){mapLayers.set(layer.id,layer);},
  getSource:id=>sources.get(id)||null,
  setPaintProperty(id,name,val){mapLayers.get(id).paint[name]=val;},
  getPaintProperty(id,name){return mapLayers.get(id)?.paint?.[name];},
  setLayoutProperty(id,name,val){mapLayers.get(id).layout[name]=val;}
};
const tensor=createHydroTensorRenderer({
  map,sourceId:'field-src',particleSourceId:'particle-src',
  lineLayerId:'field',glowLayerId:'field-glow',particleLayerId:'particles',
  ribbonSourceId:'ribbon-src',ribbonLayerId:'ribbon',
  ribbonGlowLayerId:'ribbon-glow'
});
tensor.setEnabled(true);
assert.equal(tensor.getPlaybackState().rate,1.25,'default speed must be 1.25x');
assert.equal(tensor.startContinuousPlayback({durationMs:20000}),true);
frames(40);
const at125=tensor.getPlaybackState();
assert.ok(at125.year>2026&&at125.year<2100);
assert.equal(tensor.setPlaybackRate(3),true);
const afterSwitch=tensor.getPlaybackState();
assert.ok(Math.abs(afterSwitch.year-at125.year)<0.1,'speed switching must not jump');
frames(40);
const at3=tensor.getPlaybackState();
const firstDelta=at125.fraction;
const secondDelta=at3.fraction-at125.fraction;
assert.ok(secondDelta>firstDelta*1.9,'3x must advance visibly faster than 1.25x');
assert.equal(tensor.setPlaybackRate(.5),true);
const beforeSlow=tensor.getPlaybackState().fraction;
frames(40);
const slowDelta=tensor.getPlaybackState().fraction-beforeSlow;
assert.ok(slowDelta<secondDelta*.4,'0.5x must slow growth');
assert.equal(tensor.setPlaybackRate(5),true,'5x should be accepted');
const beforeFive=tensor.getPlaybackState().fraction;
frames(20);
const fiveDelta=tensor.getPlaybackState().fraction-beforeFive;
assert.ok(fiveDelta>slowDelta*3.5,'5x should advance substantially faster than 0.5x');
assert.equal(tensor.pauseContinuousPlayback(),true);
const atPause=tensor.getPlaybackState();
frames(50);
assert.equal(tensor.getPlaybackState().year,atPause.year,'pause holds position');
assert.equal(tensor.setPlaybackRate(1.5),true);
assert.equal(tensor.getPlaybackState().year,atPause.year,'changing speed paused holds position');
assert.equal(tensor.resumeContinuousPlayback(),true);
frames(10);
assert.ok(tensor.getPlaybackState().year>atPause.year,'resume continues');
assert.equal(tensor.startContinuousPlayback({durationMs:20000}),true);
assert.equal(tensor.getPlaybackState().year,2026,'run again starts from 2026');
assert.equal(tensor.getPlaybackState().rate,1.5,'replay retains selected speed');
frames(500);
assert.ok(tensor.getPlaybackState().finished,'fast playback reaches 2100');
assert.equal(tensor.getPlaybackState().year,2100);
tensor.setEnabled(false);
console.log('PASS 0.5x, 1.25x, 1.5x, 2x, 3x, 5x: no jumps, pause/resume, replay to 2100');
console.log('PASS timeline speed selector replaces left-side animation-speed slider');
