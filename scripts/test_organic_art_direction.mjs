// Deterministic art-direction regression for organic exhibition mode.
import assert from 'node:assert/strict';
import {organicWarp,unevenLevels} from './organic_visual_field.js';
import {buildPresentationRoadNetwork} from './parcel_road_presentation.js';
import {createRoadTopology} from './parcel_road_topology.js';
import {buildTensorGeometryPacket} from './hydro_tensor_geometry.js';
const delta=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const levels=unevenLevels(30,.51);
const gaps=levels.slice(1).map((v,i)=>v-levels[i]);
assert.ok(Math.max(...gaps)/Math.min(...gaps)>1.35,'Grid spacing must be nonuniform');
const a=organicWarp(.24,.28,1.45),b=organicWarp(.24,.53,1.45),
 c=organicWarp(.24,.78,1.45),chord=[(a[0]+c[0])/2,(a[1]+c[1])/2];
assert.ok(delta(b,chord)>.012,'Woven fibers must bend rather than remain a regular grid');
const w=54,h=48,n=w*h,valid=new Uint8Array(n).fill(1);
function domainFor(mask){
 return {w,h,cell:18,scale:.64,left:0,top:h*18,inside:mask,safe:mask,
   groundCell:11.52,dryCells:mask.reduce((s,v)=>s+(v>0),0),
   cellAt:p=>{
    const x=Math.floor(p[0]/18),y=Math.floor((h*18-p[1])/18);
    return x>=0&&x<w&&y>=0&&y<h?y*w+x:-1;
   },
   toPoint:i=>[((i%w)+.5)*18,h*18-(Math.floor(i/w)+.5)*18]
 };
}
const domain=domainFor(valid);
const roads=buildPresentationRoadNetwork(domain,{roadDensity:88,curvatureSmoothing:90});
const kinds={main:[],secondary:[],local:[]};
for(const r of roads.roads){
 kinds[r.kind].push(r);
 assert.ok(r.points.length>=3,'All accepted roads need multiple vertices');
 assert.ok(r.provenance.includes('ARTISTIC PREVIEW'),'Road must retain exhibition warning');
 assert.ok(r.points.every(p=>domain.inside[domain.cellAt(p)]===1),'Road cannot leave parcel');
}
assert.ok(kinds.main.length>=3,'Sweeping arteries must exist');
assert.ok(kinds.secondary.length>=8,'Collectors and district rings must exist');
assert.ok(kinds.local.length>=35,'Local organic streets must cover site');
assert.ok(roads.stats.generatedDistricts>=15,'District partition must subdivide the site');
assert.ok(roads.bundles.length>100,'Rounded junction and parallel final bundles must exist');
assert.equal(roads.stats.syntheticPresentation,false);
assert.equal(roads.stats.siteDerived,true);
const topology=createRoadTopology({roads:roads.roads},domain);
assert.ok(topology.statistics.cycleRank>=50,'Organic street fabric should contain loops');
assert.ok(topology.statistics.candidateBlocks>=30,'Actual closed block faces required');
const f={validMask:valid,confidence:new Float32Array(n).fill(.86),
 anisotropy:new Float32Array(n).fill(.72),primaryX:new Float32Array(n).fill(.8),
 primaryY:new Float32Array(n).fill(.6),rainfallInfluence:new Float32Array(n)};
const texture=buildTensorGeometryPacket({cols:w,rows:h,cellX:18,cellY:18,
  fields:f,siteMask:valid,grid:{left:0,top:0,cellProjectedM:18},
  scenario:{year:2100},demNativeResolutionM:50},{
    mode:'presentation',density:88,direction:'dual',curvatureSmoothing:90});
assert.equal(texture.diagnostics.visualizationOnly,true);
assert.ok(texture.meta.lines.some(p=>p.branch==='primary'));
assert.ok(texture.meta.lines.some(p=>p.branch==='secondary'));
for(const maskKind of ['diagonal-half','L-shape']){
 const mask=new Uint8Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)
  mask[y*w+x]=maskKind==='diagonal-half'?
    (y/h < .82-.36*x/w ?1:0):
    ((x<w*.53||y>h*.52)?1:0);
 const d=domainFor(mask),partial=buildPresentationRoadNetwork(d,{roadDensity:82});
 assert.ok(partial.roads.length>18,'Art fabric should span '+maskKind);
 for(const road of partial.roads)for(const p of road.points)
   assert.equal(mask[d.cellAt(p)],1,'No off-parcel roads in '+maskKind);
}
console.log(JSON.stringify({status:'PASS',mode:'illustrative-only',
 roads:topology.statistics.roadCount,arterials:kinds.main.length,
 collectors:kinds.secondary.length,locals:kinds.local.length,
 cycles:topology.statistics.cycleRank,
 provisionalBlocks:topology.statistics.candidateBlocks,
 tensorLines:texture.meta.lines.length}));

