// v3.22.68 · Multi-layer gradient animation without per-frame line uploads.
// Run: node scripts/test_tensor_animation_no_geojson_churn.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHydroTensorRenderer} from './hydro_tensor_field.js';
const source=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('./hydro_tensor_visual.js',import.meta.url),'utf8');
const reveal=source.slice(source.indexOf('  function revealOpacity('),
  source.indexOf('  function applyStyle(){'));
assert.ok(!reveal.includes('.setData('),
  'gradient animation must never upload heavy GeoJSON geometry');
assert.ok(reveal.includes("'line-gradient'"),'gradient paint is frame-driven');
assert.ok(visual.includes('rgba(0,0,0,0)'),'unswept parts stay invisible');

// Presentation is the default: mock the browser's RAF scheduler without
// executing queued frames, since this test checks GeoJSON upload churn only.
let nextFrameId=0;
globalThis.requestAnimationFrame=()=>++nextFrameId;
globalThis.cancelAnimationFrame=()=>{};
const layers=new Map(),sources=new Map(),uploadCounts=new Map();
const initial=['field','field-glow','ribbon','ribbon-glow','particles'];
for(const id of initial)layers.set(id,{id,paint:{}});
for(const id of ['field-src','ribbon-src','particle-src']){
  uploadCounts.set(id,0);
  sources.set(id,{setData(){uploadCounts.set(id,uploadCounts.get(id)+1);}});
}
const map={
  getLayer:id=>layers.get(id)||null,
  addLayer(layer){assert.ok(!layers.has(layer.id));layers.set(layer.id,layer);},
  getSource:id=>sources.get(id)||null,
  setLayoutProperty(id,key,value){
    const layer=layers.get(id);assert.ok(layer);(layer.layout||= {})[key]=value;
  },
  setPaintProperty(id,key,value){
    const layer=layers.get(id);assert.ok(layer);(layer.paint||= {})[key]=value;
  },
  getPaintProperty(id,key){return layers.get(id)?.paint?.[key];}
};
const renderer=createHydroTensorRenderer({
  map,sourceId:'field-src',particleSourceId:'particle-src',
  glowLayerId:'field-glow',lineLayerId:'field',
  particleLayerId:'particles',ribbonSourceId:'ribbon-src',
  ribbonLayerId:'ribbon',ribbonGlowLayerId:'ribbon-glow',
  getBounds:()=>null
});
renderer.setEnabled(true);
for(const branch of ['primary','secondary']){
  for(let w=0;w<2;w++){
    const core=layers.get('field-trace-'+branch+'-'+w);
    const wake=layers.get('field-wake-'+branch+'-'+w);
    assert.ok(core&&wake,'both core and glow layers are installed');
    assert.deepEqual(core.filter[1],['==',['get','branch'],branch]);
  }
}
renderer.setTimelineYear(2100,{instant:true});
const afterFirst={field:uploadCounts.get('field-src'),ribbon:uploadCounts.get('ribbon-src')};
assert.equal(afterFirst.field,1);
assert.equal(afterFirst.ribbon,1);
for(let year=2026;year<=2100;year++){
  renderer.setTimelineYear(year,{instant:true});
}
assert.equal(uploadCounts.get('field-src'),1,
  '75 visual year updates must not re-upload field source');
assert.equal(uploadCounts.get('ribbon-src'),1,
  '75 visual year updates must not re-upload ribbon source');
assert.ok(map.getPaintProperty('field-trace-primary-0','line-gradient'));
assert.ok(map.getPaintProperty('ribbon','line-gradient'));
renderer.setEnabled(false);
assert.equal(layers.get('field-trace-primary-0').layout.visibility,'none');
assert.equal(layers.get('particles').layout.visibility,'none');
console.log('PASS independent blue/purple core+bloom layers created and hidden on disable');
console.log('PASS 75 gradient year updates without a single repeated GeoJSON line upload');
