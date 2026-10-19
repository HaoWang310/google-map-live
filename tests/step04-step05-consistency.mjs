/* STEP04/05 deterministic algorithm regression. Synthetic fixtures, NOT real-site certification. */
import assert from 'node:assert/strict';
import {smoothSiteField,traceSiteWeave} from '../scripts/site_visual_field.js';
import {growOrganicLocalRoads} from '../scripts/parcel_road_organic.js';
import {buildPresentationRoadNetwork} from '../scripts/parcel_road_presentation.js';
import {optimiseWool} from '../scripts/parcel_wool_solver.js';
import {createRoadTopology} from '../scripts/parcel_road_topology.js';

function fixture(angleShift=0,wet=false){
 const w=38,h=32,n=w*h,cell=20,left=0,top=2000,scale=.62;
 const inside=new Uint8Array(n).fill(1),safe=new Uint8Array(n).fill(1);
 const ax=new Float32Array(n),ay=new Float32Array(n),
  certainty=new Float32Array(n).fill(.82),anisotropy=new Float32Array(n).fill(.76),
  depth=new Float32Array(n),hydro=new Uint8Array(n),cost=new Float32Array(n).fill(1),
  slope=new Float32Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,theta=angleShift+.16*Math.sin(x*.11)+.10*Math.sin(y*.13);
  ax[i]=Math.cos(theta);ay[i]=-Math.sin(theta); // north-positive metric space
  if(wet&&x>=15&&x<=17&&y>6&&y<26){
   safe[i]=0;depth[i]=.20;hydro[i]=1;cost[i]=9;
  }
 }
 const cellAt=p=>{const x=Math.floor((p[0]-left)/cell),y=Math.floor((top-p[1])/cell);
  return x>=0&&y>=0&&x<w&&y<h?y*w+x:-1;
 };
 const domain={w,h,cell,left,top,inside,safe,ax,ay,certainty,anisotropy,depth,hydro,cost,
  slope,scale,groundCell:cell*scale,
  dryCells:safe.reduce((a,v)=>a+v,0),wetCells:n-safe.reduce((a,v)=>a+v,0),
  sourceRevision:'fixture:'+angleShift+':'+wet,sourceYear:2100,
  cellAt,toPoint:i=>[left+((i%w)+.5)*cell,top-(Math.floor(i/w)+.5)*cell]};
 return domain;
}
function checkField(domain){
 const {w,h,inside,ax,ay,depth,certainty,anisotropy}=domain;
 const originalX=ax.slice(),originalY=ay.slice();
 const field=smoothSiteField({w,h,mask:inside,ax,ay:Float32Array.from(ay,v=>-v),
  wet:depth,confidence:certainty,anisotropy},.87);
 assert.deepEqual(ax,originalX,'original tensor X must be immutable');
 assert.deepEqual(ay,originalY,'original tensor Y must be immutable');
 assert.equal(field.validMask.length,w*h);
 assert.ok(field.diagnostics.meanAngleErrorDeg>=0);
 const woven=traceSiteWeave(field,{density:.68,dx:20,dy:20});
 assert.ok(woven.lines.length>0,'presentation must trace source-derived curves');
 for(const line of woven.lines)for(const p of line.path)
  assert.ok(field.at(p.x,p.y)>=0,'no display path outside source mask');
 return field;
}
function run(domain){
 const field=checkField(domain);
 const siteField=smoothSiteField({w:domain.w,h:domain.h,mask:domain.safe,ax:domain.ax,
  ay:Float32Array.from(domain.ay,v=>-v),confidence:domain.certainty,
  anisotropy:domain.anisotropy,wet:domain.depth},.88);
 domain.presentationTensor={field:siteField,diagnostics:siteField.diagnostics};
 domain.smoothAxisX=siteField.smoothPrimaryX;
 domain.smoothAxisY=Float32Array.from(siteField.smoothPrimaryY,v=>-v);
 const trunk=[[3,16],[11,15],[22,19],[34,18]];
 const grown=growOrganicLocalRoads(domain,siteField,[trunk],{roadDensity:85});
 for(const r of grown.roads)for(const p of r.points)
  assert.ok(domain.safe[domain.cellAt([domain.left+p[0]*domain.cell,domain.top-p[1]*domain.cell])],
   'local roads cannot occupy a hard flood cell');
 const plan=buildPresentationRoadNetwork(domain,{
  roadDensity:62,woolStrength:80,bundleStrength:65,
  floodAvoidance:82,curvatureSmoothing:85,branchingStrength:63});
 assert.ok(plan.roads.length>0,'organic presentation should yield streets');
 assert.ok(plan.stats.organicDiagnostics,'organic-growth diagnostics are required');
 // The display-only bundle strands must not appear in analytical streets.
 assert.ok(plan.bundles.every(b=>!plan.roads.includes(b)));
 const wool=optimiseWool(plan,domain,{roadDensity:38,woolStrength:35,
  branchingStrength:35,curvatureSmoothing:65,bundleStrength:45,
  tensorAlignment:80,reconnectionStrength:50});
 assert.ok(wool.roads.length>=plan.roads.length);
 const topo=createRoadTopology(wool,domain,{});
 assert.equal(topo.roadCenterlines.features.length,wool.roads.length);
 assert.ok(Number.isFinite(topo.statistics.components));
 return {curves:field.diagnostics,roads:topo.statistics.roadCount,
  organic:plan.stats.organicDiagnostics,components:topo.statistics.components,
  firstAngle:[field.smoothPrimaryX[100],field.smoothPrimaryY[100]]};
}
const a=run(fixture(0,false));
const b=run(fixture(.85,true));
assert.ok(Math.abs(a.firstAngle[0]-b.firstAngle[0])>.1,
 'different source fields must produce different smoothed tensor orientations');
console.log(JSON.stringify({result:'PASS',note:'synthetic fixtures; real parcel visual acceptance pending',
 sourceCases:2,baselineRoads:a.roads,wetRoads:b.roads,
 baselineComponents:a.components,wetComponents:b.components},null,2));
