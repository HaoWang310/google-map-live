// STEP 05 final-Wool-only exhibition regression. Quantifies hierarchy and
// verifies no tensor/OSM or intermediate skeleton layers appear in STEP05.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPresentationRoadNetwork} from './parcel_road_presentation.js';
import {createRoadTopology} from './parcel_road_topology.js';
const w=61,h=51,inside=new Uint8Array(w*h).fill(1);
function domain(mask){
 return {w,h,cell:16,scale:.68,left:0,top:h*16,
  inside:mask,safe:mask,dryCells:mask.reduce((a,b)=>a+(b>0),0),groundCell:10.88,
  cellAt:p=>{const x=Math.floor(p[0]/16),y=Math.floor((h*16-p[1])/16);
   return x>=0&&x<w&&y>=0&&y<h?y*w+x:-1},
  toPoint:i=>[((i%w)+.5)*16,(h-Math.floor(i/w)-.5)*16]
 };
}
const params={visualMode:'presentation',woolStrength:88,
 roadDensity:88,branchingStrength:78,bundleStrength:85,curvatureSmoothing:90};
const d=domain(inside);
const result=buildPresentationRoadNetwork(d,params);
assert.equal(result.stats.woolCombinedOnly,true);
assert.ok(result.stats.generatedDistricts>=15,'Use site-derived partition, not eight fixed circles');
const kinds={main:0,secondary:0,local:0};
const provenance=new Set();
for(const r of result.roads){
 kinds[r.kind]++;
 assert.ok(r.points.length>=3);
 assert.ok(r.provenance.includes('wool-attraction-and-bundling'));
 assert.ok(r.provenance.includes('ARTISTIC PREVIEW'));
 assert.ok(r.points.every(p=>d.cellAt(p)>=0&&inside[d.cellAt(p)]),
  'Road samples must be inside selected parcel');
 provenance.add(r.provenance.split(' / ').at(-1).split('-')[0]);
}
assert.ok(kinds.main>=3,'Need multiple long crossing arteries');
assert.ok(kinds.secondary>=10,'Need a connected intermediate collector system');
assert.ok(kinds.local>=70,'Need dense local enclosed streets, not stray lines');
assert.ok(result.stats.localFiberCandidates>=70,
  'Local fiber sampling must be sufficiently dense for reference morphology');
assert.ok(provenance.has('district')&&provenance.has('collector'));
assert.ok(result.bundles.length>100);
// Design goal: arterial routes span a meaningful part of the land area.
const mainRoads=result.roads.filter(x=>x.kind==='main');
assert.ok(mainRoads.reduce((sum,r)=>sum+r.lengthM,0)>d.groundCell*Math.hypot(w,h)*1.5,
 'Connected main route edges must span a meaningful total distance');
const topo=createRoadTopology({roads:result.roads},d);
assert.ok(topo.statistics.cycleRank>=50,'Fine streets must produce enclosed loops');
assert.ok(topo.statistics.candidateBlocks>=25,'Street blocks must be recognized');
const ui=fs.readFileSync(new URL('./parcel_road_ui.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('./parcel_road_worker.js',import.meta.url),'utf8');
const hydro=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
const vector=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
assert.ok(ui.includes('STEP 05 · Wool 融合路网 · 仅最终结果'));
assert.ok(ui.includes('重新生成 Wool 最终路网'));
assert.ok(ui.includes("['main','secondary','local'].includes(k)?'checked':''"),
 'Reference flood corridor and road footprint overlays must default OFF');
assert.ok(ui.includes('active&&result&&check?.checked'));
assert.ok(worker.includes('buildPresentationRoadNetwork(domain,parameters)'));
assert.ok(worker.includes('createRoadTopology(repaired,domain,parameters'));
assert.ok(hydro.includes('hydroVector?.setRenderSuppressed?.(step05Only)'));
assert.ok(vector.includes('function setRenderSuppressed(value)'));
assert.ok(!worker.includes("postMessage({type:'skeleton'"), 'Intermediate skeleton must never render');
const triangular=new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)
 triangular[y*w+x]=(x/w>y/h*.38+.08&&x/w<.92-y/h*.20)?1:0;
const clipped=buildPresentationRoadNetwork(domain(triangular),params);
for(const r of clipped.roads)for(const p of r.points)
 assert.equal(triangular[domain(triangular).cellAt(p)],1,
  'Only within-polygon roads may be generated');
console.log(JSON.stringify({status:'PASS',woolFinalOnly:true,hierarchy:kinds,
 loops:topo.statistics.cycleRank,blocks:topo.statistics.candidateBlocks,
 crossings:topo.statistics.crossings,irregularSiteRoads:clipped.roads.length}));

