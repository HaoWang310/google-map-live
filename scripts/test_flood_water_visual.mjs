// Regression: render-only water depth filtering must never spread wet pixels,
// change the solver's buffers or turn an invalid building/site pixel into water.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {smoothWetDepths} from './flood_water_visual.js';

const width=5,height=5;
const raw=new Uint16Array(width*height);
const valid=new Uint8Array(width*height).fill(1);
const id=(x,y)=>y*width+x;
raw[id(1,1)]=600;
raw[id(2,1)]=80;
raw[id(1,2)]=20;
raw[id(3,3)]=300;
raw[id(4,4)]=900;
valid[id(4,4)]=0;
const snapshot=raw.slice(),maskSnapshot=valid.slice();
const output=smoothWetDepths(raw,width,height,valid,1);
assert.deepEqual([...raw],[...snapshot],'source mm buffers must not change');
assert.deepEqual([...valid],[...maskSnapshot],'native valid mask must not change');
for(let i=0;i<raw.length;i++){
  if(raw[i]===0||!valid[i])assert.equal(output[i],0,'dry or invalid cell cannot gain water');
  else assert.ok(Number.isFinite(output[i])&&output[i]>0,'wet source stays visibly wet');
}
assert.ok(output[id(1,1)]<raw[id(1,1)]/1000,'neighbouring wet cells should soften isolated peaks');
assert.ok(output[id(2,1)]>raw[id(2,1)]/1000,'a shallow wet neighbour gains smoothly blended depth');
assert.equal(output[id(4,4)],0,'invalid water cell is ignored by visual filter');
const same=new Uint16Array(16).fill(200);
const uniform=smoothWetDepths(same,4,4);
for(const d of uniform)assert.ok(Math.abs(d-0.2)<1e-6,'uniform wet field remains uniform');

const ui=fs.readFileSync(new URL('local_flood_ui.js',import.meta.url),'utf8');
assert.ok(ui.includes('smoothWetDepths(depths,width,height,valid,wetThreshold*1000)'));
assert.ok(ui.includes('smoothWetDepths(depths,widths,rows,validCells,1)'));
assert.ok(ui.includes('alpha*=smooth(0,1.5,edgePx)'),'2D shoreline needs 1.5px inward feather');
assert.ok(ui.includes('const depth=wetMean;'),'2D color must not mix a hard nearest-neighbour step');
assert.ok(ui.includes('Math.sqrt(115000/displayCells)'),'3D subdivisions must respect node budget');
assert.ok(ui.includes('float depthMix(float a,float b,float x)'),'3D depth palette is continuous');
console.log('PASS: 2D/3D display-only smoothing, 1.5px inward feather, dry mask and node budget');
