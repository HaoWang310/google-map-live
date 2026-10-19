/* STEP05 worker: real tensor streamlines -> Wool branch growth/relaxation ->
   minimal A* connectivity repair -> flood-safe planar topology -> export. */
import {readSiteTensor,makeRoadDomain,floodReserves,lonlat} from './parcel_road_constraints.js';
import {initialRoadSkeleton,repairRoadConnectivity} from './parcel_road_skeleton.js';
import {buildPresentationRoadNetwork} from './parcel_road_presentation.js';
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
 const used=new Set();
 for(const road of wool.roads)for(let j=1;j<road.points.length;j++){
  const a=road.points[j-1],b=road.points[j];
  const steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(domain.cell*.45));
  for(let k=0;k<=steps;k++){
   const p=[a[0]+(b[0]-a[0])*k/Math.max(1,steps),
    a[1]+(b[1]-a[1])*k/Math.max(1,steps)];
   const i=domain.cellAt(p);
   if(i>=0&&domain.safe[i])used.add(i);
  }
 }
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
  schema:'london-road-step05-v1',step:'05',title:'Tensor-integrated Wool-grown Road Network',
  provenance:{tensor:'London Map computed 2100 tensor, same-parcel memory snapshot',
    designMode:parameters.visualMode==='presentation'?
      'ARTISTIC PRESENTATION ONLY — warped road grid is not a hydrological solver result':
      'analysis with original physical safety masks',
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
    localRoadsAreConceptual:true,finalUseZoningIsNotGenerated:true,
    presentationOnly:parameters.visualMode==='presentation',
    doNotUseForEngineering:parameters.visualMode==='presentation'},
  diagnostics:{...network.statistics,skeleton:plan.stats,wool:wool.stats,
    sourceValidCells:domain.dryCells+domain.wetCells,safeCells:domain.dryCells,
    hazardCells:domain.wetCells,
    safeAreaM2:Math.round(domain.dryCells*domain.groundCell**2),
    unsafeAreaM2:Math.round(domain.wetCells*domain.groundCell**2),
    rasterCorridorCoveragePct:Math.round(10000*used.size/Math.max(1,domain.dryCells))/100,
    grewRoads:(wool.stats.grownSecondary||0)+(wool.stats.grownLocal||0),
    astarRepairs:wool.stats.astarRepairs||0,
    generationMethod:parameters.visualMode==='presentation'?
      'artistic smooth-warp lattice (site clipped), not physically validated':
      'tensor bidirectional RK2 + Wool active branching; A* connectivity repair only',
    visualMode:parameters.visualMode||'analysis',
    cycleRank:network.statistics.cycleRank,
    approximateCycleDensity:Math.round(1000*network.statistics.cycleRank/
      Math.max(1,network.statistics.roadCount))/1000,
    terrainAndFlood:domain.diagnostics,
    failureCounts:plan.stats.rejections,
    qualityFlags:[
      ...(network.localRoads.features.length<6?['local-network-sparse']:[]),
      ...(used.size/Math.max(1,domain.dryCells)<.08?['low-centerline-cell-coverage']:[]),
      ...(network.statistics.components>1?['disconnected-components']:[]),
      ...(network.statistics.cycleRank<2?['few-loops']:[])
    ]},
 };
}
async function run(id,mode,params){
 if(!source||!ring)throw Error('STEP 05 尚未收到同一地块的2100年真实张量与洪涝结果');
 const started=performance.now();
 parameters={...params};
 send(id,.07,'校验真实场地、洪涝深度与张量方向…');
 const domain=makeRoadDomain(source,parameters);
 send(id,.15,'已完成 DEM 坡度、深水禁建区与浅水绕行成本计算');
 let skeleton,repaired;
 if(parameters.visualMode==='presentation'){
   send(id,.32,'展示模式：生成连续的柔性路网网格与主次层级（艺术概念示意）…');
   skeleton=buildPresentationRoadNetwork(domain,parameters);
   repaired={roads:skeleton.roads,stats:{...skeleton.stats,
     grownSecondary:0,grownLocal:0,astarRepairs:0,
     exhibitionOnly:true}};
 }else{
   skeleton=initialRoadSkeleton(domain,parameters,(progress,message)=>send(id,progress,message));
   const wool=optimiseWool(skeleton,domain,{...parameters,
     woolStrength:mode==='generate'?0:parameters.woolStrength},(progress,message)=>send(id,progress,message));
   repaired=repairRoadConnectivity(wool,domain,parameters,
     (progress,message)=>send(id,progress,message));
 }
 send(id,.88,'正在计算分级道路交叉、路网闭环与概念街区…');
 const network=createRoadTopology(repaired,domain,parameters,(progress,message)=>send(id,progress,message));
 const output=packageNetwork(domain,skeleton,network,repaired,mode);
 output.diagnostics.elapsedMs=Math.round(performance.now()-started);
 latest=output;
 send(id,1,parameters.visualMode==='presentation'?
   '展示模式完成：艺术形态已生成，未进行道路工程与洪涝通行验证':
   '分析模式完成：张量积分 → Wool 生长 → A* 安全修复 → 路网拓扑');
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
