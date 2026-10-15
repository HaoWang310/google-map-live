// London Map v3.22.54 — independent rainfall-scenario morphology test.
// Run: node scripts/test_rain_scenario_tensor.mjs
// Synthetic DEM/depth fixture: does not claim validation on the user's real site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createTensorGeometry} from './hydro_tensor_geometry.js';
const tensor=fs.readFileSync(new URL('./hydro_tensor_worker.js',import.meta.url),'utf8');
const sandbox=vm.createContext({self:{}});
vm.runInContext(tensor,sandbox);
const solve=vm.runInContext('solve',sandbox);
const cols=41,rows=33,n=cols*rows;
const grid={id:7,crs:'EPSG:3857',cols,rows,cellProjectedM:10,
  groundScale:1,left:0,top:2000};
const terrain=new Float32Array(n),accumulation=new Uint16Array(n),
  inside=new Uint8Array(n).fill(1),obstacle=new Uint8Array(n);
for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const i=y*cols+x;
  terrain[i]=20-y*.15-x*.045+1.1*Math.sin(x*.12)*Math.cos(y*.11);
  accumulation[i]=1+Math.round(65534*
    (.18+.65*Math.exp(-Math.pow(y-(17+4*Math.sin(x/7)),2)/18)));
}
function input(maxDepthMm,spread,rainfallCase){
  const depthMm=new Uint16Array(n);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const i=y*cols+x;
    const d=(x-20)**2/((spread*1.4)**2)+(y-16)**2/(spread**2);
    depthMm[i]=Math.max(0,Math.round(maxDepthMm*Math.max(0,1-d)));
  }
  return {requestId:1,cols,rows,cellX:10,cellY:10,grid,
    terrain,accumulation,inside,obstacle,depthMm,
    vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),
    drainageThresholdKm2:1,scenario:{year:2100,rainfallCase},
    config:{terrainWeight:35,drainageWeight:45,avoidance:100,smoothness:60}};
}
function evaluate(source){
  const solved=solve(source);
  const engine=createTensorGeometry({...solved,siteMask:inside,
    obstacleMask:obstacle},{metersPerPixel:3,density:55,length:65,
      curvatureSmoothing:65,mode:'analysis',direction:'dual'});
  const lines=engine.buildLines();
  return {solved,engine,lines,
    avgLength:lines.reduce((sum,l)=>sum+l.lengthM,0)/Math.max(1,lines.length),
    wetSensitive:engine.diagnostics.field.primary.wetSensitiveLines+
      engine.diagnostics.field.secondary.wetSensitiveLines};
}
const moderate=evaluate(input(40,7,'moderate'));
const extreme=evaluate(input(120,12,'extreme'));
assert.ok(extreme.solved.diagnostics.rainfallResponse.wetCells20mm>
  moderate.solved.diagnostics.rainfallResponse.wetCells20mm);
assert.ok(extreme.solved.diagnostics.rainfallResponse.maxDepthMm>
  moderate.solved.diagnostics.rainfallResponse.maxDepthMm);
assert.ok(extreme.wetSensitive>moderate.wetSensitive,
  'Depth response must change local geometry support');
assert.ok(extreme.avgLength!==moderate.avgLength,
  'Geometry must react to changed modeled water depth');
const sameWater=evaluate(input(40,7,'extreme'));
assert.deepEqual(Array.from(sameWater.solved.fields.tensorXX),
  Array.from(moderate.solved.fields.tensorXX),
  'Changing only scenario name MUST NOT fabricate tensor directions');
assert.deepEqual(sameWater.lines.map(l=>l.lengthM),
  moderate.lines.map(l=>l.lengthM),
  'Changing only scenario name MUST NOT fabricate new streamline geometry');
assert.ok(moderate.engine.diagnostics.wetPlacementIsDesignVisualization,
  'Depth-related placement must be declared as design visualization');
console.log('PASS true depth differences alter wet-support and integrated geometry');
console.log('PASS identical depths with different labels produce identical geometry');
console.log({moderate:{lines:moderate.lines.length,wetSupport:moderate.wetSensitive},
  extreme:{lines:extreme.lines.length,wetSupport:extreme.wetSensitive}});
