// Retained urban fabric must alter tensor planning without touching hydrology.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {rasterizeSitePlanning} from './site_planning_tensor.js';

const R=6378137,DEG=Math.PI/180;
const merc=([lng,lat])=>[R*lng*DEG,R*Math.log(Math.tan(Math.PI/4+lat*DEG/2))];
const point=[-0.25,51.47],p=merc(point),step=10;
const grid={left:p[0]-55,top:p[1]+55,cellProjectedM:step};
const square=(x,y,r=4)=>({type:'Polygon',coordinates:[[
  [x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]
].map(([dx,dy])=>[point[0]+dx/R*180/Math.PI,point[1]+dy*Math.cos(point[1]*DEG)/R*180/Math.PI])]});
const keep=[
  {type:'Feature',properties:{elementType:'building',elementId:'building:one',planDecision:'keep'},geometry:square(0,0)},
  {type:'Feature',properties:{elementType:'road',elementId:'road:one',part:'surface',planDecision:'keep',
    roadAxisX:0,roadAxisY:1},geometry:square(20,0)},
  {type:'Feature',properties:{elementType:'park',elementId:'park:removed',planDecision:'remove'},geometry:square(-20,0)}
];
const raster=rasterizeSitePlanning(keep,grid,11,11);
assert.equal(raster.mask[5*11+5],1,'kept building becomes a design-only exclusion');
assert.equal(raster.mask[5*11+3],0,'removed park cannot exclude land');
assert.ok(raster.roadWeight[5*11+7]>0,'kept road must supply direction evidence');
assert.ok(raster.roadX[5*11+7]<0,'north-south road has cos(2theta)=-1');
const empty=rasterizeSitePlanning([],grid,11,11);
assert.ok(!empty.mask.some(Boolean));
assert.ok(!empty.roadWeight.some(Boolean));

const worker=fs.readFileSync(new URL('hydro_tensor_worker.js',import.meta.url),'utf8');
const ctx=vm.createContext({self:{}});
vm.runInContext(worker,ctx);
const solve=vm.runInContext('solve',ctx);
const n=121,original={
  cols:11,rows:11,cellX:10,cellY:10,
  terrain:Float32Array.from({length:n},(_,i)=>100+.05*(i%11)),
  accumulation:new Uint16Array(n).fill(1),
  inside:new Uint8Array(n).fill(1),obstacle:new Uint8Array(n),
  depthMm:new Uint16Array(n),vx:new Int8Array(n),vy:new Int8Array(n),
  intensity:new Uint8Array(n),drainageThresholdKm2:1,
  config:{terrainWeight:65,drainageWeight:0,avoidance:0,smoothness:0}
};
const baseline=solve(original);
const planned=solve({...original,retainedMask:raster.mask,
  retainedRoadX:raster.roadX,retainedRoadY:raster.roadY,retainedRoadWeight:raster.roadWeight});
assert.equal(baseline.fields.validMask[5*11+5],1);
assert.equal(planned.fields.validMask[5*11+5],0);
assert.equal(planned.fields.validMask[5*11+3],1);
assert.ok(Math.abs(planned.fields.primaryY[5*11+7])>Math.abs(baseline.fields.primaryY[5*11+7]),
  'road should bend the tensor axis towards retained road direction');
assert.equal(planned.diagnostics.retainedPlanning.hydrologyInputsUnchanged,true);
assert.ok(planned.diagnostics.retainedPlanning.roadGuidedCells>0);
assert.ok(planned.diagnostics.retainedPlanning.excludedCells>0);
assert.deepEqual([...original.depthMm],new Array(n).fill(0));
assert.deepEqual([...original.obstacle],new Array(n).fill(0));
console.log('PASS retained building exclusion, road-axis guidance, ignored removal and unchanged runoff');
