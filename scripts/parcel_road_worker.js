/* STEP 05 complete worker: source validation -> spatial constraints ->
   initial A* skeleton -> constrained wool -> planar topology -> export package. */
import {readSiteTensor,makeRoadDomain,floodReserves,lonlat} from './parcel_road_constraints.js';
import {initialRoadSkeleton} from './parcel_road_skeleton.js';
import {optimiseWool} from './parcel_wool_solver.js';
import {createRoadTopology} from './parcel_road_topology.js';
let source=null,ring=null,latest=null,parameters=null;
const send=(id,progress,message)=>postMessage({type:'progress',id,progress,message});
const collection=features=>({type:'FeatureCollection',features});
function rle(mask){
 const result=[];if(!mask?.length)return result;
 let last=mask[0],length=1;
 for(let i=1;i<mask.length;i++){
  if(mask[i]===last)length++;
  else{result.push([Number(last),length]);last=mask[i];length=1}
 }
 result.push([Number(last),length]);return result;
}
function packageNetwork(domain,plan,network,wool,mode){
 const candidateNodes=collection(plan.candidates.map((c,i)=>({
  type:'Feature',properties:{candidateId:i+1,role:c.role,
    evidence:c.evidence},
  geometry:{type:'Point',coordinates:lonlat(c.point)}
 })));
 const accessNodes=collection(plan.access.map((point,i)=>({
  type:'Feature',properties:{accessId:i+1,source:'site boundary, safe DEM cell candidate; access not surveyed'},
  geometry:{type:'Point',coordinates:lonlat(point)}
 })));
 const boundary=collection([{type:'Feature',properties:{kind:'site_boundary',crs:'EPSG:4326'},
  geometry:{type:'Polygon',coordinates:[ring]}}]);
 return {
  schema:'london-road-step05-v1',step:'05',title:'Generate and Optimise the Road Network',
  provenance:{tensor:'London Map calculated, imported 2100 year',
    flood:'same computed 2100 snapshot',crs:'EPSG:4326',
    metricBasis:'EPSG:3857 in worker, latitude corrected for physical widths',
    reality:'Computational planning proposal; road alignments and access not field verified',
    missing:'Official rights-of-way, junction engineering, road safety, agricultural soil suitability'},
  createdAt:new Date().toISOString(),mode,parameters,
  siteBoundary:boundary,mainRoads:network.mainRoads,
  secondaryRoads:network.secondaryRoads,localRoads:network.localRoads,
  roadCenterlines:network.roadCenterlines,roadHierarchy:{main:'main',secondary:'secondary',local:'local'},
  roadTopologyGraph:network.topology,
  roadPolygons:network.roadFootprints,
  reservedFloodEcologicalCorridors:floodReserves(domain),
  accessPublicNodes:accessNodes,candidateNodes,
  buildableMask:{grid:{left:domain.left,top:domain.top,cellProjectedM:domain.cell},
    cols:domain.w,rows:domain.h,crs:'EPSG:3857',valuesRLE:rle(domain.safe),
    hydrologyNotes:'safe mask threshold and DEM-derived drainage; cannot claim planning permission'},
  notes:{step06:'Union road strips, subtract from site polygon together with reserved flood corridors; polygonize remaining connected blocks. Do not mistake conceptual agricultural nodes for assigned zoning.',
    localRoadsAreConceptual:true,finalUseZoningIsNotGenerated:true},
  diagnostics:{...network.statistics,skeleton:plan.stats,wool:wool.stats,
    sourceValidCells:domain.dryCells+domain.wetCells,safeCells:domain.dryCells,
    hazardCells:domain.wetCells},
 };
}
async function run(id,mode,params){
 if(!source||!ring)throw Error('STEP 05 尚未导入同一场地的真实张量与洪涝数据');
 parameters={...params};
 send(id,.07,'校验真实场地、洪涝深度与张量方向…');
 const domain=makeRoadDomain(source,parameters);
 send(id,.15,'已计算可建设区域与保留洪涝走廊');
 const skeleton=initialRoadSkeleton(domain,parameters,(progress,message)=>send(id,progress,message));
 const wool=optimiseWool(skeleton,domain,{...parameters,
  woolStrength:mode==='generate'?0:parameters.woolStrength},(progress,message)=>send(id,progress,message));
 send(id,.88,'正在计算道路交叉口、路面宽度与真实拓扑…');
 const network=createRoadTopology(wool,domain,parameters,(progress,message)=>send(id,progress,message));
 const output=packageNetwork(domain,skeleton,network,wool,mode);
 latest=output;
 send(id,1,'STEP 05 已生成可导出的真实场地道路几何与拓扑');
 postMessage({type:'done',id,result:output});
}
onmessage=async event=>{
 const d=event.data||{},id=d.id;
 try{
  if(d.type==='source'){
   source=readSiteTensor(d.snapshot,d.ring);
   ring=d.ring;latest=null;
   postMessage({type:'ready',id,diagnostics:{year:source.year,
    cells:source.cols*source.rows,
    tensorSource:source.source,
    validCells:source.valid.reduce((s,v)=>s+(v>0?1:0),0)}});
  }else if(d.type==='generate'||d.type==='optimise'){
   await run(id,d.type,d.params||{});
  }else if(d.type==='clear'){latest=null;postMessage({type:'cleared',id});}
 }catch(error){
  postMessage({type:'error',id,message:error?.message||String(error)});
 }
};
