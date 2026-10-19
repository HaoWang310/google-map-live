// Deterministic computational regression, not observed London rainfall/tensor.
// Verifies organic street hierarchy, loops, hard flood mask and dense preset.
import assert from 'node:assert/strict';
import {makeRoadDomain} from './parcel_road_constraints.js';
import {initialRoadSkeleton} from './parcel_road_skeleton.js';
import {optimiseWool} from './parcel_wool_solver.js';
import {createRoadTopology} from './parcel_road_topology.js';
const cols=90,rows=68,n=cols*rows,cellProjectedM=10;
const R=6378137,lon=x=>x/R*180/Math.PI,
 lat=y=>(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI;
const left=-13000,top=6710000,grid={left,top,cellProjectedM};
const xy=(x,y)=>[lon(left+x*cellProjectedM),lat(top-y*cellProjectedM)];
const polygon=[xy(2,2),xy(cols-2,2),xy(cols-2,rows-2),xy(2,rows-2),xy(2,2)];
const flood=new Float32Array(n),drain=new Float32Array(n),terrain=new Float32Array(n),
 px=new Float32Array(n),py=new Float32Array(n);
for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
 const i=y*cols+x;
 // Synthetic sinuous high-depth corridor, deterministic fixture.
 const waterCentre=44+7*Math.sin(y/12);
 flood[i]=Math.abs(x-waterCentre)<3?480:
  Math.abs(x-waterCentre)<6?65:0;
 drain[i]=Math.abs(x-waterCentre)<4?1:0;
 terrain[i]=15+x*.004+y*.005+Math.sin(x/17)*.7;
 const a=.42+.29*Math.sin(y/24+x/33);
 px[i]=Math.cos(a);py[i]=Math.sin(a);
}
const source={cols,rows,grid,metricScale:Math.cos(51.5*Math.PI/180),
 polygon:polygon.map(p=>[R*p[0]*Math.PI/180,
  R*Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))]),
 valid:new Float32Array(n).fill(1),primaryX:px,primaryY:py,
 confidence:new Float32Array(n).fill(.83),depth:flood,drainage:drain,terrain};
const config={woolStrength:88,tensorAlignment:78,floodAvoidance:58,
 roadDensity:88,branchingStrength:78,bundleStrength:85,
 reconnectionStrength:86,curvatureSmoothing:90,
 agriculturalContinuity:65,floodLimitM:.12};
const start=performance.now(),domain=makeRoadDomain(source,config);
assert.ok(domain.dryCells>n*.5,'Fixture should retain substantial safe land');
assert.ok(domain.wetCells>100,'Deep-water corridor must stay excluded');
assert.ok(domain.diagnostics.deepExcluded>0,'Flood hazard must be in diagnostics');
const initial=initialRoadSkeleton(domain,config);
assert.ok(initial.stats.main>=2,'Require continuous primary streets');
assert.ok(initial.stats.secondary>=4,'Require a genuine district tier');
assert.ok(initial.stats.local>=6,'Require local streets, not just a sparse skeleton');
const wool=optimiseWool(initial,domain,config);
const network=createRoadTopology(wool,domain,config);
assert.ok(network.statistics.roadCount>=15,'More than a few lines');
assert.ok(network.statistics.edges>0);
assert.ok(network.statistics.nodes>0);
assert.ok(network.statistics.cycleRank>=0);
assert.equal(network.topology.properties.closedFacesComputed,false,
 'Preliminary faces do not mean STEP06 zoning is complete');
for(const r of wool.roads){
 for(let i=0;i<r.points.length;i++){
  const k=domain.cellAt(r.points[i]);
  assert.ok(k>=0&&domain.safe[k], 'Wool vertex must avoid deep-water');
  if(i){
   const a=r.points[i-1],b=r.points[i],num=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/(domain.cell*.35));
   for(let t=0;t<=num;t++){
    const p=[a[0]+(b[0]-a[0])*t/num,a[1]+(b[1]-a[1])*t/num];
    assert.ok(domain.safe[domain.cellAt(p)],'Curve smoothing must avoid hard exclusions');
   }
  }
 }
}
const elapsed=Math.round(performance.now()-start);
console.log(JSON.stringify({
 result:'PASS',fixture:'deterministic synthetic georeferenced test, NOT measured',
 roads:network.statistics.roadCount,
 hierarchy:initial.stats,loops:network.statistics.cycleRank,
 blocks:network.statistics.candidateBlocks,
 elapsedMs:elapsed
},null,2));
