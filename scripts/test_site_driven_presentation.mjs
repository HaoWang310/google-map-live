// Regression for the user's root bug: same parcel shape, different water/DEM
// must not display an identical fixed swirl. Fixtures are synthetic, not a
// claim of visual acceptance on the user's live London selection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {buildTensorGeometryPacket} from './hydro_tensor_geometry.js';
import {buildPresentationRoadNetwork} from './parcel_road_presentation.js';
import {createRoadTopology} from './parcel_road_topology.js';
const sandbox=vm.createContext({self:{}});vm.runInContext(fs.readFileSync(new URL('./hydro_tensor_worker.js',import.meta.url),'utf8'),sandbox);
const solve=vm.runInContext('solve',sandbox);
const w=60,h=48,n=w*h,mask=new Uint8Array(n).fill(1);
function source(axis=0,depthScale=1){
 const terrain=new Float32Array(n),depthMm=new Uint16Array(n),accumulation=new Uint16Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,channel=axis?x-w*.55:y-h*.45-4*Math.sin(x/9);
  terrain[i]=30-(axis?x:y)*.08+.9*Math.cos(x/13)*Math.sin(y/8);
  depthMm[i]=Math.round(depthScale*550*Math.exp(-(channel*channel)/45));accumulation[i]=1+Math.round(40000*Math.exp(-(channel*channel)/30));
 }
 return {requestId:1,cols:w,rows:h,cellX:20,cellY:20,grid:{left:0,top:h*20,cellProjectedM:20,cols:w,rows:h,groundScale:.65},terrain,depthMm,accumulation,inside:mask,obstacle:new Uint8Array(n),vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),scenario:{year:2100},config:{terrainWeight:35,drainageWeight:45,avoidance:100,smoothness:60}};
}
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const params={mode:'presentation',density:88,direction:'dual',curvatureSmoothing:90};
function run(input){
 const before=hash(input),computed=solve(input),fieldsHash=hash(computed.fields);
 const packet=buildTensorGeometryPacket({...computed,siteMask:mask},params);
 assert.equal(hash(input),before,'Native hydrology inputs must stay unchanged');
 assert.equal(hash(computed.fields),fieldsHash,'Display must not overwrite analytical tensor');
 const domain={w,h,cell:20,left:0,top:h*20,scale:.65,groundCell:13,inside:mask,safe:mask,dryCells:n,ax:computed.fields.primaryX,ay:Float32Array.from(computed.fields.primaryY,v=>-v),depth:Float32Array.from(input.depthMm,v=>v/1000),cellAt:p=>{const x=Math.floor(p[0]/20),y=Math.floor((h*20-p[1])/20);return x>=0&&y>=0&&x<w&&y<h?y*w+x:-1;}};
 const roads=buildPresentationRoadNetwork(domain);
 for(const r of roads.roads)for(const p of r.points)assert.equal(mask[domain.cellAt(p)],1);
 assert.ok(roads.bundles.length>100);
 return {packet,roads,computed,domain};
}
const a=run(source(0)),b=run(source(1)),dry=run(source(0,0));
assert.notEqual(hash(a.packet.coordinates),hash(b.packet.coordinates),'Different topography/water must change the woven field');
assert.notEqual(hash(a.packet.coordinates),hash(dry.packet.coordinates),'Changed computed water must influence display geometry');
assert.notEqual(hash(a.roads.roads),hash(b.roads.roads),'Wool district geometry must be parcel-specific');
assert.notEqual(hash(a.roads.roads),hash(dry.roads.roads),'Wool geometry must respond to water');
const camera=buildTensorGeometryPacket({...a.computed,siteMask:mask},{...params,viewRect:[12,10,40,30],metersPerPixel:27});
assert.equal(hash(a.packet.coordinates),hash(camera.coordinates),'Panning/zooming must not generate a new pattern');
const topology=createRoadTopology(a.roads,a.domain);
assert.ok(topology.statistics.roadCount>100);
assert.ok(topology.statistics.cycleRank>20);
assert.ok(topology.statistics.segments<30000);
assert.equal(a.packet.diagnostics.siteDerived,true);
assert.ok(a.packet.meta.lines.some(l=>l.branch==='primary'));
assert.ok(a.packet.meta.lines.some(l=>l.branch==='secondary'));
console.log(JSON.stringify({pass:true,syntheticFixtures:true,lines:[a,b,dry].map(x=>x.packet.meta.lines.length),roads:[a,b,dry].map(x=>x.roads.roads.length),segments:topology.statistics.segments,loops:topology.statistics.cycleRank}));
