// Ground-flood / building-footprint contract, London Map v3.22.51.
// Run: node scripts/test_flood_building_footprints.mjs (no network or dependencies).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
let frame=null;
const floodScope=vm.createContext({
  postMessage:message=>{if(message?.type==='frame')frame=message;},
  setTimeout,clearTimeout,console
});
vm.runInContext(read('./local_flood_worker.js'),floodScope);
const state=vm.runInContext(`(()=>{
  const n=25,mid=12,buildingFootprint=new Uint8Array(n);
  buildingFootprint[mid]=1;
  sim={cols:5,rows:5,cell:10,terrain:new Float32Array(n),
    inside:new Uint8Array(n).fill(1),obstacle:new Uint8Array(n),
    buildingFootprint,buildingIds:new Uint32Array(n),
    boundary:new Uint8Array(n),overlappingBuildingIds:new Map(),
    accumulation:new Uint16Array(n),water:new Float32Array(n),
    delta:new Float32Array(n),timeSec:0,visualPhase:0,
    svCapacity:new Float32Array(n),svInfilMmH:new Float32Array(n),
    spongeInfilM3:0,spongeCellCount:0,spongeFacilityCount:0,
    grid:{id:1}};
  sim.buildingIds[mid]=1;
  params={...params,rainfall:0,infiltration:0,assumedUrbanDrainageMmH:0,
    drainageGuide:false,openBoundary:false};
  sim.water[mid]=.10;
  const initial=sim.water.reduce((sum,x)=>sum+x,0);
  simulationStep(5);sendFrame();
  return {initial,final:sim.water.reduce((sum,x)=>sum+x,0),
    neighbor:sim.water[mid-1],building:sim.water[mid],
    hardObstacleCells:sim.obstacle.reduce((sum,x)=>sum+x,0)};
})()`,floodScope);
assert.ok(Math.abs(state.initial-state.final)<1e-6,'runoff conserves water');
assert.ok(state.neighbor>0,'water can flow out of building footprint');
assert.ok(state.building>0,'water remains measurable inside building footprint');
assert.equal(state.hardObstacleCells,0,'buildings must not become hard water barriers');
assert.ok(frame,'worker must publish a frame');
assert.equal(new Uint8Array(frame.validMask)[12],1,'wet building base must render');
assert.ok(new Uint16Array(frame.depthMm)[12]>50,'building base depth must be visible');
assert.ok(frame.impactedIds.includes(0),'directly inundated building must count');
assert.equal(frame.stats.floodedBuildingFootprintAreaM2,100);

const tensorScope=vm.createContext({self:{},postMessage:()=>{},console});
vm.runInContext(read('./hydro_tensor_worker.js'),tensorScope);
const solve=vm.runInContext('solve',tensorScope);
const w=41,h=41,n=w*h;
const fixture={
  type:'solve',requestId:1,cols:w,rows:h,cellX:10,cellY:10,
  terrain:new Float32Array(n),accumulation:new Uint16Array(n),
  inside:new Uint8Array(n).fill(1),obstacle:new Uint8Array(n),
  depthMm:new Uint16Array(n),vx:new Int8Array(n),vy:new Int8Array(n),
  intensity:new Uint8Array(n),drainageThresholdKm2:1,
  scenario:{year:2100,kind:'regression'},
  grid:{id:1,cols:w,rows:h,crs:'EPSG:3857',left:0,top:1000,
    cellProjectedM:10,groundScale:1},
  config:{terrainWeight:100,drainageWeight:0,avoidance:0,smoothness:100}
};
for(let y=0;y<h;y++)for(let x=0;x<w;x++)fixture.terrain[y*w+x]=30-x*.1;
const open=solve(fixture);
for(let y=0;y<h;y++)fixture.obstacle[y*w+21]=1;
const footprint=solve(fixture);
assert.equal(footprint.fields.validMask[20*w+21],1);
assert.equal(footprint.fields.obstacleConstraint[20*w+20],0);
assert.ok(footprint.fields.tensorXX.every(
  (value,i)=>value===open.fields.tensorXX[i]),'building footprint must not deflect tensors');
assert.ok(footprint.fields.primaryX[20*w+20]>.99,'supported ground slope is continuous');

const ui=read('./local_flood_ui.js');
assert.ok(ui.includes("const visible=hydroDisplay.flow&&tensorShowBuildings&&!hideSelectedBuildings"),
  'hidden buildings must not leave detached footprint fills');
console.log('PASS flood moves through building base; visible depth and impact are preserved');
console.log('PASS tensor directions cross buildings; hidden building footprints stay hidden');
