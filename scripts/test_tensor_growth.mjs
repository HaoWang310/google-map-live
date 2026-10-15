// London Map v3.22.52 live-growth regression, no browser dependencies.
// Run: node scripts/test_tensor_growth.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
const start=source.indexOf('  function drawLines(fraction=1){');
const end=source.indexOf('  function drawParticles(elapsed,progress){',start);
assert.ok(start>=0&&end>start,'reveal renderer exists');
const lines=Array.from({length:20},(_,i)=>({
  type:'Feature',properties:{family:'base',branch:i%2?'secondary':'primary'},
  geometry:{type:'LineString',coordinates:Array.from({length:15},(_,j)=>[i,j])}
}));
const simulate=new Function('features','density','length','nextDensity','nextLength','fraction','emit',
  "const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));"+
  "let geometrySnapshot={scenario:{year:2100},parameters:{density,length}};"+
  "let settings={density:nextDensity,length:nextLength,direction:'dual',showFilaments:true,showRibbon:false};"+
  "let ribbonFeatures=[],timelineYear=2100,geometryBusy=false,geometryPending=null,"+
  "controlsGeometryTimer=0,requestTimer=0,geometryTimer=0;"+
  "const src=()=>({setData:x=>emit(x)}),ribbonSource=()=>null,onProgress=()=>{};"+
  source.slice(start,end)+'drawLines(fraction);');
let part,full,short;
simulate(lines,55,65,55,65,.10,x=>part=x);
simulate(lines,55,65,55,65,1,x=>full=x);
simulate(lines,55,65,15,25,1,x=>short=x);
assert.ok(part.features.length>0&&part.features.length<full.features.length);
assert.ok(part.features[0].geometry.coordinates.length<full.features[0].geometry.coordinates.length);
assert.equal(full.features.length,20);
assert.equal(full.features[0].geometry.coordinates.length,15);
assert.ok(short.features.length<20,'density has instant valid preview');
assert.ok(short.features[0].geometry.coordinates.length<15,'length has instant valid preview');
assert.ok(source.includes('function setTimelineYear('),'year binding exists');
assert.ok(source.includes('function replayGrowth('),'growth playback exists');
assert.ok(source.includes('yearGrowth=growthTo;growthFrom=growthTo;'),'Worker preserves growth progress');
assert.ok(!source.includes("const f=settings.mode==='analysis'?1:"),'analysis can animate');
assert.ok(ui.includes('hydroVector?.setTimelineYear(futureYear)'),'UI scrubbing connected');
assert.ok(ui.includes("siteHud('siteHudTensorReplay').onclick"),'replay button connected');
assert.ok(ui.includes("number.type='number'"),'parameter values editable');
assert.ok(ui.includes('yearSeekDebounce=setTimeout('),'rapid year inputs coalesced');
console.log('PASS: partial-to-full line reveal, both modes, density/length preview');
console.log('PASS: time slider, replay, numeric inputs and debounce are wired');
