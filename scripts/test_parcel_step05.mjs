/* STEP 05 regression uses REAL georeferenced London grid from the repository
   tensor audit (not random geometry). Field values below are DETERMINISTIC
   unit-test fixtures, NOT measured site flood/tensor observations. The live
   generator correctly REQUIRES user-imported computed 2100 arrays. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readSiteTensor,makeRoadDomain,floodReserves} from './parcel_road_constraints.js';
import {initialRoadSkeleton} from './parcel_road_skeleton.js';
import {optimiseWool} from './parcel_wool_solver.js';
import {createRoadTopology} from './parcel_road_topology.js';
const audit=JSON.parse(fs.readFileSync(new URL('../diagnostics/tensor-audit.json',import.meta.url),'utf8'));
const grid=audit.grid,n=grid.cols*grid.rows;
const ring=[[-.305,51.477],[-.284,51.477],[-.284,51.487],[-.305,51.487],[-.305,51.477]];
const fields={
 primaryX:Array.from({length:n},(_,i)=>Math.cos(((i%grid.cols)*.045)+.45)),
 primaryY:Array.from({length:n},(_,i)=>Math.sin(((i%grid.cols)*.045)+.45)),
 confidence:new Array(n).fill(.7),
 validMask:new Array(n).fill(1),
 drainageMask:Array.from({length:n},(_,i)=>(i%grid.cols)>=103&&(i%grid.cols)<=106?1:0)
};
const depths=Array.from({length:n},(_,i)=>{
 const col=i%grid.cols;
 return Math.abs(col-105)<6?800:col>=135&&col<140?250:0;
});
const snapshot={schema:'london-tensor-site-v1',current:{
 cols:grid.cols,rows:grid.rows,grid,scenario:{year:2100},
 fields:Object.fromEntries(Object.entries(fields).map(([k,values])=>[k,{type:'Float32Array',values}])),
 depthMm:{type:'Uint16Array',values:depths}
}};
assert.throws(()=>readSiteTensor({...snapshot,current:{...snapshot.current,scenario:{year:2026}}},ring),
  /2100/);
const source=readSiteTensor(snapshot,ring);
assert.equal(source.year,2100);
assert.equal(source.cols,grid.cols);
assert.throws(()=>readSiteTensor(snapshot,[[-.5,52],[-.4,52],[-.4,52.1],[-.5,52.1],[-.5,52]]),
  /不匹配/);
const config={floodLimitM:.15,woolStrength:55,tensorAlignment:75,
 floodAvoidance:90,roadDensity:45,bundleStrength:55,
 curvatureSmoothing:75,branchingStrength:65};
const domain=makeRoadDomain(source,config);
assert.ok(domain.dryCells>60);
assert.ok(domain.wetCells>10);
const initial=initialRoadSkeleton(domain,config);
assert.ok(initial.roads.length>2,'actual London parcel geometry should support road skeleton');
assert.ok(initial.stats.main>=1);
const wool=optimiseWool(initial,domain,config);
const network=createRoadTopology(wool,domain,config);
assert.ok(network.topology.nodes.length>1);
assert.ok(network.topology.edges.length>0);
assert.ok(network.mainRoads.features.length>0);
assert.ok(network.roadFootprints.features.length>0);
assert.ok(network.statistics.lengthKm>0);
assert.equal(network.topology.properties.closedFacesComputed,false,
 'STEP 06 face subdivision must not be misrepresented as finished');
for(const road of wool.roads)for(const p of road.points)
 assert.ok(domain.safe[domain.cellAt(p)],'no centreline point crosses flood-reserved cell');
for(const e of network.topology.edges)
 assert.ok(e.lengthM>0&&e.widthMetres>=5);
assert.ok(floodReserves(domain).features.length>0);
for(const line of network.roadCenterlines.features)
 assert.equal(line.geometry.type,'LineString');
console.log('PASS STEP 05 on audited georeferenced London parcel extent:',
 network.statistics.roadCount,'roads',network.statistics.edges,'edges',
 network.statistics.lengthKm,'km / test field is deterministic fixture, not observed hydrology');
