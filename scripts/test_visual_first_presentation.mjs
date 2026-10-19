// Visual-first modes are explicit illustrative layers, never flood/tensor evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildTensorGeometryPacket} from './hydro_tensor_geometry.js';
import {buildPresentationRoadNetwork} from './parcel_road_presentation.js';
import {createRoadTopology} from './parcel_road_topology.js';
const w=44,h=34,n=w*h,valid=new Uint8Array(n).fill(1);
const f={validMask:valid,confidence:new Float32Array(n).fill(.8),
 anisotropy:new Float32Array(n).fill(.45),
 primaryX:new Float32Array(n).fill(.85),
 primaryY:new Float32Array(n).fill(.52),
 rainfallInfluence:new Float32Array(n)};
const result={cols:w,rows:h,cellX:30,cellY:30,fields:f,
 siteMask:valid,grid:{left:0,top:0,cellProjectedM:30},
 scenario:{year:2100},demNativeResolutionM:50};
const packet=buildTensorGeometryPacket(result,{mode:'presentation',density:84,
 direction:'dual',curvatureSmoothing:90});
assert.equal(packet.diagnostics.visualizationOnly,true);
assert.ok(packet.meta.lines.filter(x=>x.branch==='primary').length>15,
 'Presentation must cover field with the first woven family');
assert.ok(packet.meta.lines.filter(x=>x.branch==='secondary').length>15,
 'Presentation must cover field with the orthogonal woven family');
assert.equal(packet.meta.ribbons.length,0,'No misleading fake drainage ribbons');
assert.equal(packet.coordinates.length%2,0);
assert.ok(packet.coordinates.length>1000,'Exhibition woven mesh must be dense');
for(const n of packet.coordinates)assert.ok(Number.isFinite(n),'no invalid visual vertices');
const mapDomain={
 w,h,cell:30,scale:.65,left:0,top:1500,inside:valid,
 safe:valid,depth:new Float32Array(n),dryCells:n,wetCells:0,
 groundCell:19.5,
 cellAt:p=>{const x=Math.floor(p[0]/30),y=Math.floor((1500-p[1])/30);
 return x>=0&&x<w&&y>=0&&y<h?y*w+x:-1;},
 toPoint:i=>[((i%w)+.5)*30,1500-(Math.floor(i/w)+.5)*30]
};
const road=buildPresentationRoadNetwork(mapDomain,{visualMode:'presentation',
 roadDensity:88,curvatureSmoothing:90});
assert.ok(road.stats.main>=2,'Main road family must exist');
assert.ok(road.stats.secondary>=3,'Secondary road family must exist');
assert.ok(road.stats.local>=10,'Dense local road family must exist');
const topo=createRoadTopology({roads:road.roads},mapDomain,{});
assert.ok(topo.statistics.roadCount>=25,'No sparse 3-line output');
assert.ok(topo.statistics.cycleRank>=15,'Woven roads should form actual cycles');
assert.ok(topo.statistics.candidateBlocks>=6,'Road cells must enclose provisional blocks');
const ui=fs.readFileSync(new URL('./parcel_road_ui.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('./parcel_road_worker.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
assert.ok(ui.includes('value="presentation" selected'));
assert.ok(ui.includes('value="analysis"'));
assert.ok(worker.includes("if(parameters.visualMode==='presentation')"));
assert.ok(worker.includes('buildPresentationRoadNetwork'));
assert.ok(worker.includes('initialRoadSkeleton'));
assert.ok(renderer.includes('if(d.visualizationOnly)'));
assert.ok(renderer.includes('}else if(modeChanged&&result)'));
console.log(JSON.stringify({pass:true,mode:'presentation-is-conceptual',
 tensorPrimary:packet.meta.lines.filter(x=>x.branch==='primary').length,
 tensorSecondary:packet.meta.lines.filter(x=>x.branch==='secondary').length,
 roads:topo.statistics.roadCount,
 loops:topo.statistics.cycleRank,blocks:topo.statistics.candidateBlocks}));
