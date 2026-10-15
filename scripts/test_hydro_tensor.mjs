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
test('buildings, parcel masks and diagonal corner blocking',()=>{
 const d=fixture(3,3,50,50);d.depthMm[4]=500;
 d.obstacle[5]=1;d.obstacle[7]=1;d.inside[3]=0;d.inside[1]=0;
 const f=solve(d).fields;
 assert.equal(f.hydraulicConfidence[4],0);assert.equal(f.primaryX[5],0);
 assert.equal(f.validMask[3],0);
 const a=structuredClone(ridge);for(let y=0;y<41;y++)a.obstacle[y*41+21]=1;
 const b=structuredClone(a);for(let y=0;y<41;y++)for(let x=22;x<41;x++)b.accumulation[y*41+x]=areaCode(10000);
 const x=solve(a).fields,z=solve(b).fields;
 for(let y=0;y<41;y++)for(let c=0;c<21;c++)assert.equal(x.drainageConfidence[y*41+c],z.drainageConfidence[y*41+c]);
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
const requests=[];
globalThis.Worker=class {constructor(){globalThis.testWorker=this}postMessage(d){requests.push(structuredClone(d))}terminate(){}};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const map={getSource:()=>({setData(){}}),getLayer:()=>false};
const renderer=createHydroTensorRenderer({map,getBounds:()=>[[99,1],[100,1],[100,0],[99,0]]});
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
renderer.dispose();passed++;console.log('PASS renderer exact-grid contract, stale responses, snapshot exports and re-enable');
console.log(`${passed} regression groups passed`);
