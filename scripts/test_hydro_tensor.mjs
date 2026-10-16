import {buildTensorGeometryPacket} from './hydro_tensor_geometry.js';
// Run: node scripts/test_hydro_tensor.mjs (no dependencies, no network).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sameHydroGrid,validHydroGrid,tensorDiagnosticGeoJSON} from './hydro_tensor_grid.js';
import {createHydroTensorRenderer} from './hydro_tensor_field.js';
const source=fs.readFileSync(new URL('./hydro_tensor_worker.js',import.meta.url),'utf8');
const scope=vm.createContext({self:{}});vm.runInContext(source,scope);
const solve=vm.runInContext('solve',scope);
const areaCode=a=>1+Math.round(Math.log(a/.0025)/Math.log(20000/.0025)*65534);
function fixture(w=41,h=41,dx=10,dy=10){
 const n=w*h;
 return {type:'solve',requestId:1,cols:w,rows:h,cellX:dx,cellY:dy,
  terrain:new Float32Array(n),accumulation:new Uint16Array(n),
  inside:new Uint8Array(n).fill(1),obstacle:new Uint8Array(n),
  depthMm:new Uint16Array(n),vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),
  drainageThresholdKm2:1,scenario:{year:2026,kind:'regression-fixture'},
  grid:{id:1,cols:w,rows:h,crs:'EPSG:3857',left:0,top:1000,cellProjectedM:dx,groundScale:1},
  config:{terrainWeight:35,drainageWeight:45,avoidance:70,smoothness:0}};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name)}
const plane=fixture();
for(let y=0;y<41;y++)for(let x=0;x<41;x++)plane.terrain[y*41+x]=20-y*.1;
const center=20*41+20;
test('metric DEM slope, aspect and terrain-only tensor',()=>{
 const r=solve(plane).fields;
 assert.ok(Math.abs(r.slopeY[center]+.01)<1e-6);
 assert.ok(Math.abs(r.basePrimaryY[center]-1)<1e-6);
 assert.ok(Math.abs(r.primaryY[center])>.999);
 assert.equal(r.drainageConfidence[center],0);
});
const ridge=structuredClone(plane);
for(let y=0;y<41;y++)for(let x=0;x<41;x++)ridge.accumulation[y*41+x]=areaCode(Math.abs(y-20)<=2?20+x*.5:.0025);
test('independent accumulation tangent is perpendicular to DEM downhill',()=>{
 const f=solve(ridge).fields;
 assert.ok(f.drainageConfidence[center]>.8);
 assert.ok(Math.abs(f.drainageX[center])>.999);
 assert.ok(Math.abs(f.drainageX[center]*f.basePrimaryX[center]+f.drainageY[center]*f.basePrimaryY[center])<1e-5);
 const d=structuredClone(ridge);d.config.terrainWeight=0;d.config.avoidance=0;
 const r=solve(d).fields;assert.ok(Math.abs(r.primaryX[center])>.999);
});
test('flat, uniform-area or NoData cells invent no network / tensor axis',()=>{
 const d=fixture();d.accumulation.fill(areaCode(20));d.terrain[0]=NaN;
 const f=solve(d).fields;
 assert.equal(f.primaryX[center],0);assert.equal(f.secondaryY[center],0);
 assert.equal(f.drainageConfidence[center],0);assert.equal(f.validMask[0],0);
 assert.ok(Number.isNaN(f.aspectRadians[center]));
});
test('ground-metre derivatives support rectangular cells',()=>{
 const d=fixture(15,15,20,50),i=7*15+7;
 for(let y=0;y<15;y++)for(let x=0;x<15;x++)d.terrain[y*15+x]=30+x*.2+y*1;
 const f=solve(d).fields;
 assert.ok(Math.abs(f.slopeX[i]-.01)<1e-6);assert.ok(Math.abs(f.slopeY[i]-.02)<1e-6);
});
test('same-frame water head rotates the wet tensor; stale vx/vy have no influence',()=>{
 const d=fixture();d.config.terrainWeight=0;d.config.drainageWeight=0;
 for(let y=0;y<41;y++)for(let x=0;x<41;x++)d.depthMm[y*41+x]=1000-x*10;
 d.vy.fill(127);d.intensity.fill(255);
 const a=solve(d).fields;
 assert.ok(a.hydraulicX[center]>.99);assert.ok(Math.abs(a.primaryX[center])>.99);
 const changed=structuredClone(d);changed.vx.fill(-127);changed.vy.fill(0);
 assert.deepEqual(solve(changed).fields.primaryX,a.primaryX);
 const dry=fixture();dry.vy.fill(127);dry.intensity.fill(255);
 assert.equal(solve(dry).fields.rainfallInfluence[center],0);
});
test('visual tensor continues across building base while parcel NoData stays invalid',()=>{
  const d=fixture(3,3,50,50);d.depthMm[4]=500;
  d.obstacle[5]=1;d.obstacle[7]=1;d.inside[3]=0;d.inside[1]=0;
  const f=solve(d).fields;
  assert.equal(f.validMask[5],1);assert.equal(f.validMask[7],1);
  assert.equal(f.validMask[3],0);assert.equal(f.validMask[1],0);
  const a=structuredClone(ridge);a.config.smoothness=100;
  for(let y=0;y<41;y++)a.obstacle[y*41+21]=1;
  const b=structuredClone(a);b.obstacle.fill(0);
  const x=solve(a).fields,z=solve(b).fields;
  assert.equal(x.validMask[20*41+21],1);
  assert.equal(z.validMask[20*41+21],1);
  assert.deepEqual(x.tensorXX,z.tensorXX);
  assert.deepEqual(x.primaryX,z.primaryX);
});
test('true ordered eigenvalues, orthogonality and matrix residuals after smoothing',()=>{
 const d=structuredClone(ridge);d.config.smoothness=100;d.depthMm.fill(200);
 const f=solve(d).fields;
 for(let i=0;i<d.cols*d.rows;i++){
  const xx=f.tensorXX[i],xy=f.tensorXY[i],yy=f.tensorYY[i],a=f.eigenvalueMajor[i],b=f.eigenvalueMinor[i];
  assert.ok(a>=b-1e-7&&b>=0&&xx*yy-xy*xy>=-1e-7);
  const ux=f.primaryX[i],uy=f.primaryY[i],vx=f.secondaryX[i],vy=f.secondaryY[i];
  if(Math.hypot(ux,uy)<.5)continue;
  assert.ok(Math.abs(ux*vx+uy*vy)<1e-6);
  assert.ok(Math.hypot(xx*ux+xy*uy-a*ux,xy*ux+yy*uy-a*uy)<1e-6);
  assert.ok(Math.hypot(xx*vx+xy*vy-b*vx,xy*vx+yy*vy-b*vy)<1e-6);
 }
});
const mixed=structuredClone(ridge);
for(let y=0;y<41;y++)for(let x=0;x<41;x++){
 mixed.terrain[y*41+x]=20-x*.02-y*.01;
 mixed.depthMm[y*41+x]=1500-y*25;
}
const axisDistance=(f,g,i)=>Math.acos(Math.min(1,Math.abs(f.primaryX[i]*g.primaryX[i]+f.primaryY[i]*g.primaryY[i])));
const cueDistance=(f,x,y,i)=>Math.acos(Math.min(1,Math.abs(f.primaryX[i]*x+f.primaryY[i]*y)));
test('terrain, drainage and wetness weights each change the actual principal axis',()=>{
 for(const [key,cx,cy] of [['terrainWeight',Math.cos(Math.atan2(.01,.02)),Math.sin(Math.atan2(.01,.02))],
  ['drainageWeight',1,0],['avoidance',null,null]]){
  const low=structuredClone(mixed),high=structuredClone(mixed);
  low.config[key]=5;high.config[key]=100;
  const a=solve(low).fields,b=solve(high).fields;
  assert.ok(axisDistance(a,b,center)>.02,key+' must rotate eigenaxes');
  const x=cx??b.hydraulicX[center],y=cy??b.hydraulicY[center];
  assert.ok(cueDistance(b,x,y,center)<cueDistance(a,x,y,center),key+' must approach the weighted cue');
 }
});
test('calendar labels do not rotate a fixed hydrological state',()=>{
 const a=solve({...mixed,scenario:{year:2026}}),b=solve({...mixed,scenario:{year:2100}});
 assert.deepEqual(a.fields.tensorXY,b.fields.tensorXY);assert.deepEqual(a.fields.primaryY,b.fields.primaryY);
});
test('dry baseline exists and rising same-site depth reorients axes smoothly',()=>{
 const d=structuredClone(mixed);d.config.drainageWeight=0;
 const values=[0,.1,.25,.5,.75,1].map(scale=>{
  const depthMm=Uint16Array.from(d.depthMm,v=>Math.round(v*scale));
  return solve({...d,depthMm}).fields;
 });
 assert.ok(Math.hypot(values[0].primaryX[center],values[0].primaryY[center])>.99);
 assert.equal(values[0].hydraulicCueWeight[center],0);
 assert.ok(axisDistance(values[0],values.at(-1),center)>.1);
 for(let i=1;i<values.length;i++){
  assert.ok(values[i].hydraulicCueWeight[center]>values[i-1].hydraulicCueWeight[center]);
  assert.ok(axisDistance(values[i],values[i-1],center)<Math.PI/4);
 }
});
test('anchored physical-scale regularization reduces undirected neighbour roughness',()=>{
 const d=fixture(61,61);d.config={terrainWeight:100,drainageWeight:0,avoidance:0,smoothness:0};
 for(let y=0;y<61;y++)for(let x=0;x<61;x++)d.terrain[y*61+x]=30-x*.2+.5*Math.sin(x*.8)*Math.cos(y*.35);
 const rough=f=>{
  let sum=0,n=0;
  for(let y=1;y<60;y++)for(let x=1;x<59;x++){
   const i=y*61+x,j=i+1;if(f.confidence[i]<.02||f.confidence[j]<.02)continue;
   const dot=f.primaryX[i]*f.primaryX[j]+f.primaryY[i]*f.primaryY[j];sum+=Math.max(0,1-dot*dot);n++;
  }return sum/n;
 };
 const a=solve(d).fields;d.config.smoothness=100;const b=solve(d).fields;
 assert.ok(rough(b)<rough(a));
 for(let i=0;i<61*61;i++){
  assert.ok(b.anisotropy[i]>=0&&b.anisotropy[i]<=1);
  assert.ok(b.confidence[i]<=b.anisotropy[i]+1e-6);
  assert.ok(b.directionContinuity[i]>=0&&b.directionContinuity[i]<=1.000001);
 }
});
test('physical wall mask does not erase continuous tensor direction evidence',()=>{
  const d=fixture();d.config.smoothness=100;
  for(let y=0;y<41;y++)for(let x=0;x<41;x++){
    d.terrain[y*41+x]=30-x*.1;
    if(x===21)d.obstacle[y*41+x]=1;
  }
  const f=solve(d).fields;
  assert.equal(f.obstacleConstraint[center],0);
  assert.equal(f.validMask[20*41+21],1);
  assert.ok(Math.abs(f.primaryX[center])>.99);
  const flat=structuredClone(d);flat.terrain.fill(20);const empty=solve(flat).fields;
  assert.equal(empty.primaryY[center],0);assert.equal(empty.tensorYY[center],0);
});
test('grid validation distinguishes equal-sized parcels at different origins',()=>{
 const g=ridge.grid;assert.ok(validHydroGrid(g,41,41));
 assert.ok(!sameHydroGrid(g,{...g,left:1}));assert.ok(!sameHydroGrid(g,{...g,id:2}));
 assert.ok(!validHydroGrid({...g,cellProjectedM:NaN},41,41));
});
test('four diagnostic collections preserve actual cell centre coordinates',()=>{
 const r=solve(ridge);const d=tensorDiagnosticGeoJSON(r,1);
 for(const name of ['terrain','drainage','primary','secondary'])assert.ok(d[name].features.length>0);
 const p=d.drainage.features.find(f=>f.properties.cell===center);
 const mid=(p.geometry.coordinates[0][0]+p.geometry.coordinates[1][0])/2;
 assert.ok(Math.abs(mid-(20.5*10)/6378137*180/Math.PI)<1e-10);
});
test('network membership uses the same encoded threshold as the map layer',()=>{
 const d=fixture();d.drainageThresholdKm2=.0025;d.accumulation.fill(1);
 assert.equal(solve(d).fields.drainageMask[center],1);
 d.drainageThresholdKm2=1;d.accumulation.fill(areaCode(1));
 assert.equal(solve(d).fields.drainageMask[center],1);
 d.accumulation.fill(areaCode(1)-1);assert.equal(solve(d).fields.drainageMask[center],0);
});
test('invalid grid array and missing metric rejected',()=>{
 assert.throws(()=>solve({...plane,rows:1.5}));assert.throws(()=>solve({...plane,cellX:0}));
 assert.throws(()=>solve({...plane,accumulation:new Uint16Array(2)}));
});
// Exercise the actual asynchronous renderer adapter, including late results.
const requests=[];let deferGeometry=false;const geometryJobs=[];
globalThis.Worker=class {
 constructor(url){this.geometry=String(url).includes('geometry_worker');if(!this.geometry)globalThis.testWorker=this}
 postMessage(d){if(this.geometry){if(deferGeometry)geometryJobs.push({worker:this,data:d});else this.onmessage({data:{type:'geometry-result',id:d.id,packet:buildTensorGeometryPacket(d.result,d.options)}})}else requests.push(structuredClone(d))}
 terminate(){}
};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const drawn=new Map();
const map={getSource:id=>({setData(data){drawn.set(id,data)}}),getLayer:()=>false};
const renderer=createHydroTensorRenderer({map,sourceId:'axes',particleSourceId:'dots',getBounds:()=>[[99,1],[100,1],[100,0],[99,0]]});
renderer.configure({mode:'analysis'});renderer.setEnabled(true);
const spatial={cols:41,rows:41,grid:ridge.grid,...Object.fromEntries(['terrain','accumulation','inside','obstacle'].map(k=>[k,ridge[k]]))};
const flow={cols:41,rows:41,vx:ridge.vx,vy:ridge.vy,intensity:ridge.intensity};
const delay=()=>new Promise(r=>setTimeout(r,15));
renderer.setField(flow,spatial,{grid:ridge.grid,year:2026,depthMm:ridge.depthMm,force:true});await delay();
const first=requests.at(-1);assert.ok(first);assert.equal(first.cellX,10);
renderer.setField(flow,null,{grid:ridge.grid,year:2100,depthMm:ridge.depthMm,force:true});
const send=d=>globalThis.testWorker.onmessage({data:solve(d)});
send(first);assert.equal(renderer.exportStructuredData(),null);await delay();send(requests.at(-1));
assert.equal(renderer.exportStructuredData().scenarioYear,2100);
// A later pending input must not relabel an already-computed export.
renderer.setField(flow,null,{grid:ridge.grid,year:2075,depthMm:new Uint16Array(1681).fill(250),force:true});
assert.equal(renderer.exportStructuredData().stage.year,2100);
assert.equal(renderer.exportStructuredData().depthMm[center],0);
await delay();send(requests.at(-1));assert.equal(renderer.exportStructuredData().stage.year,2075);
renderer.setEnabled(false);renderer.setField(flow,null,{grid:ridge.grid,year:2040,depthMm:ridge.depthMm});
renderer.setEnabled(true);await delay();assert.equal(requests.at(-1).scenario.year,2040);
// A dry, perfectly flat DEM with a supported network has zero raw DEM axes,
// but its actual computed network tensor must still be visible in 2026.
const flat=structuredClone(ridge);flat.terrain.fill(20);
const flatSpatial={...spatial,terrain:flat.terrain};
renderer.setField(flow,flatSpatial,{grid:ridge.grid,year:2026,depthMm:flat.depthMm,force:true});
await delay();send(requests.at(-1));
assert.ok(drawn.get('axes').features.length>0);
assert.equal(renderer.exportStructuredData().displayCountIndependentOfYear,true);
assert.equal(renderer.exportStructuredData().displayUsesUnifiedComputedEigenfield,true);
passed++;console.log('PASS renderer exact-grid contract, stale responses, snapshot exports and re-enable');
deferGeometry=true;
renderer.configure({density:60});
renderer.configure({density:80});
await new Promise(r=>setTimeout(r,320)); // configuration debounce = 240 ms
assert.equal(geometryJobs.length,1,'rapid density changes must coalesce to one geometry job');
const last=geometryJobs.shift();
assert.equal(last.data.options.density,80,'coalesced build must use latest density');
last.worker.onmessage({data:{type:'geometry-result',id:last.data.id,
  packet:buildTensorGeometryPacket(last.data.result,last.data.options)}});
assert.equal(renderer.exportGeometry().parameters.density,80);
assert.equal(renderer.exportGeometry().pending,false);
passed++;console.log('PASS geometry worker coalesces rapid updates after debounce');
const jobCount=geometryJobs.length;
renderer.configure({direction:'primary'});
assert.ok(drawn.get('axes').features.length>0);
assert.ok(drawn.get('axes').features.every(f=>f.properties.branch==='primary'));
renderer.configure({direction:'secondary'});
assert.ok(drawn.get('axes').features.length>0);
assert.ok(drawn.get('axes').features.every(f=>f.properties.branch==='secondary'));
renderer.configure({direction:'dual'});
assert.equal(geometryJobs.length,jobCount);
assert.equal(drawn.get('axes').features.length,renderer.exportGeometry().field.features.length);
passed++;console.log('PASS direction switches filter one complete snapshot immediately, without a geometry job');
const countBeforeDuplicate=requests.length;
renderer.setField(flow,flatSpatial,{grid:ridge.grid,year:2026,depthMm:flat.depthMm,force:true});await delay();
assert.equal(requests.length,countBeforeDuplicate);
assert.equal(geometryJobs.length,0);
const snapshot=renderer.exportSiteSnapshot();
assert.deepEqual(snapshot.current.input.inside.values,Array.from(flatSpatial.inside));
assert.ok(snapshot.scenarios.some(s=>s.scenario.year===2026));
assert.ok(snapshot.scenarios.some(s=>s.scenario.year===2100));
assert.equal(snapshot.pending.tensor,false);
passed++;console.log('PASS identical native frames do not invalidate geometry; scene export preserves real scenario arrays');
renderer.dispose();
console.log(`${passed} regression groups passed`);
