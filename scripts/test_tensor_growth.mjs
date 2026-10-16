// v3.22.68 · Physical-path display growth regression.
// Run: node scripts/test_tensor_growth.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TENSOR_TRACE_WAVES,traceGrowthProgress,traceGrowthWave,traceGradient
} from './hydro_tensor_visual.js';
const field=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
assert.equal(TENSOR_TRACE_WAVES,2);
for(const family of ['ribbon','primary','secondary']){
  assert.equal(traceGrowthProgress(0,family),0);
  assert.equal(traceGrowthProgress(1,family),1);
  for(const step of [0,.07,.24,.44,.67,.88,1]){
    const first=traceGrowthProgress(step,family,0);
    assert.ok(first>=0&&first<=1);
    if(family!=='ribbon')
      assert.ok(first>=traceGrowthProgress(step,family,1),
        'later growth waves must not overtake earlier waves');
  }
}
assert.ok(traceGrowthProgress(.26,'ribbon')>traceGrowthProgress(.26,'primary'));
assert.ok(traceGrowthProgress(.55,'primary')>traceGrowthProgress(.55,'secondary'));
assert.notEqual(traceGrowthWave(0),traceGrowthWave(1));
for(const family of ['ribbon','primary','secondary']){
  const complete=traceGradient(1,family);
  assert.deepEqual(complete.slice(0,3),['interpolate',['linear'],['line-progress']]);
  assert.ok(complete.includes('#EDBDF9'),'completed lines keep purple accents');
  const partial=traceGradient(.38,family);
  assert.equal(partial[partial.length-1],'rgba(0,0,0,0)');
  const stops=partial.filter((value,i)=>i>=3&&(i-3)%2===0);
  assert.ok(stops.every((n,i)=>i===0||n>stops[i-1]),
    'gradient stops remain strictly increasing at partial progress');
}
assert.ok(field.includes('function drawGrowthHeads('),'heads are geometry-anchored');
assert.ok(field.includes('function headCoordinate('),'heads use cumulative arc-length');
assert.ok(field.includes('drawGrowthHeads(yearGrowth,true)'),'animated heads are driven on each frame');
assert.ok(field.includes('5900/playbackRate'),'short replay respects the selected playback multiplier');
assert.ok(!field.includes('tensorRevealGate('),'whole-line opacity reveal is no longer primary');
assert.ok(ui.includes('lineMetrics:true'),'real field source permits line-gradient');
assert.ok(ui.includes("siteHud('siteHudTensorReplay').onclick"),'replay button connected');
assert.ok(ui.includes('hydroVector?.setTimelineYear(futureYear)'),'year slider connected');
console.log('PASS wave order and monotonic path gradients, with transparent untraced segments');
console.log('PASS arc-length particle heads, six-second replay and UI wiring');
