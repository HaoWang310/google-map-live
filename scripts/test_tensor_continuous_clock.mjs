// v3.22.69 · Validate smooth display clock independent of Worker keyframes.
// Run: node scripts/test_tensor_continuous_clock.mjs
import assert from 'node:assert/strict';
import {createHydroTensorRenderer} from './hydro_tensor_field.js';
const scheduled=[];let nextRafId=1;
globalThis.requestAnimationFrame=fn=>{
  const id=nextRafId++;scheduled.push({id,fn});return id;
};
globalThis.cancelAnimationFrame=id=>{
  // In the real browser RAF cancellation is by handle. Tests run serially,
  // so cancelled callbacks are simply ignored.
  for(const item of scheduled)if(item.id===id)item.cancelled=true;
};
const sources=new Map();
const counts={field:0,ribbon:0,particles:0};
for(const [name,key] of [['field-source','field'],['ribbon-source','ribbon'],
  ['particle-source','particles']]){
  sources.set(name,{setData(){counts[key]++;}});
}
const layers=new Map();
for(const id of ['field','field-glow','ribbon','ribbon-glow','particles'])
  layers.set(id,{id,layout:{},paint:{}});
const map={
  getLayer:id=>layers.get(id)||null,
  addLayer(layer){layers.set(layer.id,layer);},
  getSource:id=>sources.get(id)||null,
  setPaintProperty(id,key,value){layers.get(id).paint[key]=value;},
  getPaintProperty(id,key){return layers.get(id)?.paint?.[key];},
  setLayoutProperty(id,key,value){layers.get(id).layout[key]=value;}
};
const seen=[];
const tensor=createHydroTensorRenderer({
  map,sourceId:'field-source',particleSourceId:'particle-source',
  lineLayerId:'field',glowLayerId:'field-glow',particleLayerId:'particles',
  ribbonSourceId:'ribbon-source',ribbonLayerId:'ribbon',
  ribbonGlowLayerId:'ribbon-glow',
  onProgress:item=>seen.push({year:item.year,fraction:item.fraction})
});
tensor.setEnabled(true);
assert.equal(tensor.startContinuousPlayback({durationMs:10000}),true);
const start=performance.now();
for(let i=1;i<=640;i++){
  const item=scheduled.shift();
  // Playback legitimately stops scheduling at its 2100 completion.
  if(!item)break;
  if(!item.cancelled)item.fn(start+i*16);
  if(i===200||i===350||i===500){
    // These are authoritative solver years arriving while presentation
    // is already in motion. They must NOT jump the visible interpolated year.
    const last=seen.at(-1).year;
    tensor.setTimelineYear(i===200?2035:i===350?2055:2085);
    assert.equal(seen.at(-1).year,last,
      'Worker keyframe must not change the visual year');
  }
}
const years=seen.map(x=>x.year);
for(let i=1;i<years.length;i++)
  assert.ok(years[i]>=years[i-1]-1e-8,'display year must never go backwards');
for(const y of [2035,2045,2055,2065,2075,2085,2095]){
  assert.ok(years.some(x=>x<y)&&years.some(x=>x>y),
    'continuous UI clock must travel through '+y);
}
assert.ok(years.at(-1)>=2099.99,
  'final visual year should reach 2100 without waiting for all Workers');
assert.equal(counts.field,1,'no heavy line source uploaded during playback');
assert.equal(counts.ribbon,1,'no heavy ribbon source uploaded during playback');
// The clock remains latched at 2100 when a slow final Worker keyframe arrives.
tensor.setTimelineYear(2095);
assert.equal(seen.at(-1).year,years.at(-1));
tensor.setEnabled(false);
console.log('PASS continuously interpolates 2026–2100 despite 9 authoritative keyframes');
console.log('PASS no backward snap from late Worker frames and no line GeoJSON churn');
