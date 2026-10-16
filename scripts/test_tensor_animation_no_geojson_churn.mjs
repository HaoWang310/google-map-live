// London Map v3.22.66 — regression against animation-frame GeoJSON churn.
// Run: node scripts/test_tensor_animation_no_geojson_churn.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tensorRevealGate} from './hydro_tensor_visual.js';
const source=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const start=source.indexOf('  function uploadGeometryOnce(){');
const end=source.indexOf('  function drawParticles(',start);
assert.ok(start>=0&&end>start,'real renderer paint/reveal section is present');
const paintSection=source.slice(start,end);
assert.ok(!paintSection.includes('coordinates:coords.slice('),
  'streamlines must never be truncated per animation frame');
const calls=[],paints=[];
const map={
  getLayer:id=>({id}),
  setLayoutProperty(){},
  setPaintProperty:(id,prop,value)=>paints.push({id,prop,value})
};
const sourceStub=id=>({setData:fc=>calls.push({
  id,featureCount:fc.features.length,coordinates:fc.features.map(f=>f.geometry.coordinates)
})});
const fieldData=sourceStub('field'),ribbonData=sourceStub('ribbon');
const makeLine=(index,branch)=>({
  type:'Feature',
  properties:{branch,opacity:.67,glowFactor:.5,width:.85,
    revealOrder:index/100,color:branch==='primary'?'#9DDCFF':'#A9D9FA'},
  geometry:{type:'LineString',coordinates:[[index,1],[index+1,2]]}
});
const field=Array.from({length:100},(_,i)=>makeLine(i,i%2?'secondary':'primary'));
const ribbons=Array.from({length:9},(_,i)=>({
  ...makeLine(i,'network'),
  properties:{...makeLine(i,'network').properties,revealOrder:i/9}
}));
const inputCoords=JSON.stringify(field.map(f=>f.geometry.coordinates));
const settings={mode:'analysis',direction:'dual',showRibbon:true,showFilaments:true,
  opacity:.85,glow:.35,density:55,length:65,trunkEmphasis:75};
const bind=new Function('map','settings','features','ribbonFeatures','src',
  'ribbonSource','tensorRevealGate',`
  const enabled=true;
  const lineLayerId='field',glowLayerId='field-glow',
    ribbonLayerId='ribbon',ribbonGlowLayerId='ribbon-glow',particleLayerId='particle';
  const geometrySnapshot={parameters:{density:55,length:65},scenario:{year:2100}};
  let uploadedField=null,uploadedRibbon=null,uploadedDirection=null,yearGrowth=.25;
  let timelineYear=2100,geometryBusy=false,geometryPending=null,
    controlsGeometryTimer=0,requestTimer=0,geometryTimer=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),onProgress=()=>{};
  ${paintSection}
  return {drawLines,applyStyle};
`);
const test=bind(map,settings,field,ribbons,()=>fieldData,()=>ribbonData,tensorRevealGate);
test.applyStyle();
for(let i=0;i<=100;i++)test.drawLines(i/100);
assert.equal(calls.length,2,
  '100 animation frames upload each complete geometry source only once');
assert.deepEqual(calls.map(c=>c.featureCount),[100,9]);
assert.equal(JSON.stringify(field.map(f=>f.geometry.coordinates)),inputCoords,
  'visual reveal must not alter any original point coordinates');
settings.direction='primary';
test.drawLines(1);
assert.equal(calls.length,3,'changing direction only updates field once');
assert.equal(calls.at(-1).featureCount,50);
settings.glow=0;
test.applyStyle();
assert.equal(paints.filter(x=>x.id==='field-glow'&&x.prop==='line-opacity').at(-1)?.value,0);
assert.equal(paints.filter(x=>x.id==='ribbon-glow'&&x.prop==='line-opacity').at(-1)?.value,0);
assert.equal(tensorRevealGate(0),0);
assert.equal(tensorRevealGate(1),1);
console.log('PASS 100 reveal frames: only 2 source uploads, no geometrical churn');
console.log('PASS direction-only upload, strict zero glow and preserved coordinates');
