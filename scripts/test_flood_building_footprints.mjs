// Generalised surface flood + solid building tests. Run: node scripts/test_flood_building_footprints.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
let frame=null;
const scope=vm.createContext({postMessage:message=>{
  if(message?.type==='frame')frame=message;
},setTimeout,clearTimeout,console});
vm.runInContext(read('./local_flood_worker.js'),scope);
const result=vm.runInContext(`(()=>{
  const cols=5,rows=5,n=cols*rows,mid=12;
  const inside=new Uint8Array(n).fill(1);
  const buildingFootprint=new Uint8Array(n),obstacle=new Uint8Array(n);
  buildingFootprint[mid]=1;obstacle[mid]=1;
  sim={cols,rows,cell:10,groundCellM:6.25,groundAreaM2:39.0625,
    grid:{id:10,groundScale:.625},
    terrain:new Float32Array(n),inside,obstacle,buildingFootprint,
    buildingIds:new Uint32Array(n),boundary:new Uint8Array(n),
    overlappingBuildingIds:new Map(),accumulation:new Uint16Array(n),
    water:new Float32Array(n),delta:new Float32Array(n),timeSec:0,
    visualPhase:0,svCapacity:new Float32Array(n),
    svInfilMmH:new Float32Array(n),spongeInfilM3:0,
    spongeCellCount:0,spongeFacilityCount:0,buildings:[{}]};
  sim.buildingIds[mid]=1;
  buildRoofDrainage(sim);resetWaterBalance();
  params={...params,rainfall:36,infiltration:0,
    assumedUrbanDrainageMmH:0,drainageGuide:false,
    openBoundary:false,floodMode:'rain',duration:120};
  simulationStep(5);
  const stored=Array.from(sim.water).reduce((a,b)=>a+b,0);
  const roofTargetCount=Array.from(sim.roofDrainCounts).reduce((a,b)=>a+b,0);
  const rainDepth=sim.balance.rainM3/(25*sim.groundAreaM2);
  const total=sim.balance.rainM3;
  const balance=stored*sim.groundAreaM2;
  const roofWet=sim.water[mid];
  params={...params,rainfall:0};
  sim.water[11]+=.20;sim.balance.externalInM3+=.20*sim.groundAreaM2;sim.timeSec=5;
  simulationStep(5);sendFrame();
  return {total,balance,roofWet,roofTargetCount,roofCellCount:sim.roofCellCount,
    building:sim.water[mid],validCells:sim.inside.reduce((a,v)=>a+v,0),
    waterBalanceError:sim.balance.rainM3-sim.balance.infiltrationM3-
      sim.balance.boundaryOutM3-
      sim.water.reduce((a,v)=>a+v*sim.groundAreaM2,0)};
})()`,scope);
assert.equal(result.roofCellCount,1);
assert.equal(result.roofTargetCount,1,'the roof must have an outdoor discharge target');
assert.equal(result.roofWet,0,'ground water must not enter solid buildings');
assert.ok(Math.abs(result.total-result.balance)<1e-5,'rain on roofs is conserved');
assert.equal(result.building,0,'runoff cannot penetrate a solid building footprint');
assert.ok(frame,'must produce a render frame');
assert.equal(new Uint16Array(frame.depthMm)[12],0);
assert.ok(frame.impactedIds.includes(0),'water near building must flag damage');
assert.ok(frame.stats.wetAreaM2>0,'wet area must be in real m²');
assert.ok(frame.stats.waterBalance!==null);
assert.ok(frame.stats.waterBalance.relativeError<1e-5,'closed-domain water budget conserved');

const tScope=vm.createContext({self:{},postMessage:()=>{},console});
vm.runInContext(read('./hydro_tensor_worker.js'),tScope);
const solve=vm.runInContext('solve',tScope);
const cols=41,rows=41,n=cols*rows,terrain=new Float32Array(n),
  inside=new Uint8Array(n).fill(1),obstacle=new Uint8Array(n);
for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  terrain[y*cols+x]=50-x*.10;
  if(x===21)obstacle[y*cols+x]=1;
}
const data={type:'solve',requestId:1,cols,rows,cellX:6.25,cellY:6.25,
  grid:{id:1,cols,rows,crs:'EPSG:3857',cellProjectedM:10,groundScale:.625,
    left:0,top:1000},terrain,inside,obstacle,
  accumulation:new Uint16Array(n),depthMm:new Uint16Array(n),
  vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),
  drainageThresholdKm2:1,scenario:{year:2100},
  config:{terrainWeight:100,drainageWeight:0,avoidance:0,smoothness:60}};
const tensor=solve(data);
assert.equal(tensor.fields.validMask[20*cols+21],0,
  'building cannot be a valid tensor integration cell');
assert.equal(tensor.diagnostics.buildingFootprintsPassable,false);
assert.equal(tensor.diagnostics.obstacleCells,41);
const ui=read('./local_flood_ui.js');
assert.ok(ui.includes('geodesicRingAreaM2(ring)'),
  'selected area must use actual earth geometry');
assert.ok(ui.includes('按 0 栋建筑的开放地块继续运行'),
  'zero-building rural plots must remain valid');
console.log('PASS conservative roof runoff, ground-metre statistics and building impact');
console.log('PASS tensor barrier masks, empty rural plots and real area selection');
