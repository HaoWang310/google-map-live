/* STEP 05 wool physics: elastic fibres on a REAL accessible raster.
   No random polylines. Endpoints remain fixed; collisions are checked. */
import {length} from './parcel_road_constraints.js?v=3.29.4-english';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t];
function safePoint(domain,p){
 const i=domain.cellAt(p);
 return i>=0&&domain.safe[i];
}
function safeSegment(domain,a,b){
 const count=Math.max(2,Math.ceil(length(a,b)/(domain.cell*.38)));
 for(let k=0;k<=count;k++)if(!safePoint(domain,mix(a,b,k/count)))return false;
 return true;
}
function resample(points,spacing){
 const result=[points[0]];
 for(let k=1;k<points.length;k++){
  const a=points[k-1],b=points[k],d=length(a,b),steps=Math.ceil(d/spacing);
  for(let j=1;j<=steps;j++)result.push(mix(a,b,j/Math.max(1,steps)));
 }
 return result;
}
// Dynamic Wool fiber growth. Existing primary/secondary tensor lines are parents:
// each seed branches along the complementary tensor eigen-axis, with local
// repulsion from already occupied cells and a snap to an existing safe fiber.
function woolAxis(domain,p,perpendicular=false,reference=null){
 const i=domain.cellAt(p);
 if(i<0||!domain.safe[i])return null;
 // Blend computed analysis eigenaxis with its SAME-source smoothed
 // guidance. High-confidence cells remain dominated by the true axis.
 const rx=domain.ax[i],ry=domain.ay[i],rm=Math.hypot(rx,ry);
 let sx=domain.smoothAxisX?.[i]||0,sy=domain.smoothAxisY?.[i]||0;
 const sm=Math.hypot(sx,sy);
 if(rm<.25&&sm<.25)return null;
 if(sm>.25){sx/=sm;sy/=sm;}
 if(rm>.25&&rx*sx+ry*sy<0){sx=-sx;sy=-sy;}
 const wt=rm>.25&&sm>.25?clamp(.16+.49*(1-(domain.certainty?.[i]||0)),.16,.65):sm>.25?1:0;
 const vx=(rm>.25?rx/rm:0)*(1-wt)+sx*wt;
 const vy=(rm>.25?ry/rm:0)*(1-wt)+sy*wt;
 const mag=Math.hypot(vx,vy);
 if(mag<.15)return null;
 let v=perpendicular?[-vy/mag,vx/mag]:[vx/mag,vy/mag];
 if(reference&&v[0]*reference[0]+v[1]*reference[1]<0)v=[-v[0],-v[1]];
 return v;
}
function woolGrowth(skeleton,domain,parameters,progress){
 const density=clamp(Number(parameters.roadDensity??88)/100,.05,1),
  branching=clamp(Number(parameters.branchingStrength??78)/100,0,1),
  reconnect=clamp(Number(parameters.reconnectionStrength??86)/100,0,1),
  farm=clamp(Number(parameters.agriculturalContinuity??65)/100,0,1),
  roads=skeleton.roads.map(r=>({...r,points:r.points.map(p=>p.slice()),pins:new Set()})),
  cell=domain.cell,scale=domain.scale,
  bucketSize=cell*2.5,buckets=new Map(),rejected={flood:0,short:0,collision:0},
  maxRoads=Math.min(220,Math.max(60,Math.round(domain.dryCells*(.014+.016*density))));
 function hash(p){
  return Math.floor(p[0]/bucketSize)+','+Math.floor(p[1]/bucketSize);
 }
 function record(k){
  const pts=roads[k].points;
  for(let j=0;j<pts.length;j+=2){
   const p=pts[j],key=hash(p);
   if(!buckets.has(key))buckets.set(key,[]);
   buckets.get(key).push({k,j,p});
  }
  const j=pts.length-1,p=pts[j],key=hash(p);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push({k,j,p});
 }
 function neighbours(p,skip){
  const gx=Math.floor(p[0]/bucketSize),gy=Math.floor(p[1]/bucketSize),all=[];
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
   for(const x of buckets.get((gx+ox)+','+(gy+oy))||[]){
    if(x.k!==skip)all.push({...x,dist:length(x.p,p)});
   }
  }
  return all.sort((a,b)=>a.dist-b.dist);
 }
 roads.forEach((_,k)=>record(k));
 const branchCount={secondary:0,local:0},snaps={secondary:0,local:0};
 function tryGrow(parentIndex,controlIndex,kind,ordinal){
  const parent=roads[parentIndex],origin=parent.points[controlIndex],cellId=domain.cellAt(origin);
  if(cellId<0||!domain.safe[cellId]||domain.hydro[cellId]&&farm>.65)return false;
  const before=parent.points[controlIndex-1],after=parent.points[controlIndex+1];
  if(!before||!after)return false;
  const tangent=[after[0]-before[0],after[1]-before[1]];
  const tnorm=Math.hypot(...tangent)||1;
  const a=[tangent[0]/tnorm,tangent[1]/tnorm],
    major=woolAxis(domain,origin,false),minor=woolAxis(domain,origin,true);
  if(!major||!minor)return false;
  // Choose the eigen-axis that *branches away* from its parent fiber.
  let perpendicular=Math.abs(a[0]*major[0]+a[1]*major[1])>
    Math.abs(a[0]*minor[0]+a[1]*minor[1]);
  let crossAxis=perpendicular?minor:major;
  if(kind==='local'&&ordinal%3===0){
   crossAxis=major;perpendicular=false; // Local fibers use both eigen-families.
  }
  const densityAt=p=>neighbours(p,parentIndex).filter(x=>x.dist<cell*2.2).length;
  const offset=cell*1.1;
  const plus=[origin[0]+crossAxis[0]*offset,origin[1]+crossAxis[1]*offset],
    minus=[origin[0]-crossAxis[0]*offset,origin[1]-crossAxis[1]*offset];
  const firstChoice=safeSegment(domain,origin,plus),secondChoice=safeSegment(domain,origin,minus);
  if(!firstChoice&&!secondChoice){rejected.flood++;return false;}
  if(!firstChoice||secondChoice&&densityAt(minus)<densityAt(plus)){
   crossAxis=[-crossAxis[0],-crossAxis[1]];
  }
  const step=cell*.65,limit=kind==='secondary'?47:28,
   path=[origin],sourceDir=crossAxis;
  let heading=sourceDir,hit=null;
  for(let k=0;k<limit;k++){
   const p=path.at(-1),mid=[p[0]+heading[0]*step*.5,p[1]+heading[1]*step*.5];
   const at=woolAxis(domain,mid,perpendicular,heading)||
     woolAxis(domain,mid,false,heading);
   if(!at)break;
   const cross=heading[0]*at[0]+heading[1]*at[1];
   if(cross<-.05)break;
   let dir=[heading[0]*.28+at[0]*.72,heading[1]*.28+at[1]*.72];
   const len=Math.hypot(...dir);if(len<.1)break;
   dir=[dir[0]/len,dir[1]/len];
   const candidate=[p[0]+dir[0]*step,p[1]+dir[1]*step];
   if(!safeSegment(domain,p,candidate))break;
   const ci=domain.cellAt(candidate);
   if(ci<0)break;
   const near=neighbours(candidate,parentIndex);
   if(path.length>8&&near.length&&near[0].dist<cell*1.15&&
      near[0].k!==parentIndex&&reconnect>.1){
    const q=near[0].p;
    if(safeSegment(domain,p,q)&&length(p,q)<cell*1.6){
     path.push(q.slice());hit=near[0];break;
    }
   }
   // Avoid collapsing Wool fibers on top of existing streets.
   if(path.length>7&&near.some(x=>x.dist<cell*.55))break;
   if(domain.cost[ci]>7&&kind==='local')break;
   path.push(candidate);heading=dir;
  }
  const physical=path.slice(1).reduce((z,p,j)=>z+length(path[j],p)*scale,0);
  if(path.length<(kind==='secondary'?9:7)||physical<(kind==='secondary'?7:5)*domain.groundCell){
   rejected.short++;return false;
  }
  // Branch is actually produced by Wool, not by A*.
  parent.pins.add(controlIndex);
  roads.push({kind,points:path,start:domain.cellAt(path[0]),
   end:domain.cellAt(path.at(-1)),provenance:'wool-tensor-branch-grow',
   lengthM:physical,pins:new Set([0,path.length-1])});
  const k=roads.length-1;record(k);branchCount[kind]++;
  if(hit){snaps[kind]++;roads[hit.k].pins.add(hit.j);}
  return true;
 }
 function growTier(kind,target,spacing){
  let accepted=0;
  const selected=[];
  for(let k=0;k<roads.length;k++){
   if(kind==='secondary'&&roads[k].kind!=='main')continue;
   if(kind==='local'&&roads[k].kind==='local')continue;
   const line=roads[k].points;
   for(let i=2;i<line.length-2;i+=spacing){
    const id=domain.cellAt(line[i]);
    if(id<0||!domain.safe[id])continue;
    selected.push({k,i,rank:(Math.imul(id+29,2654435761)>>>0)});
   }
  }
  // Spread candidates through the whole parcel instead of growing from one corner.
  selected.sort((a,b)=>a.rank-b.rank);
  for(let j=0;j<selected.length&&accepted<target&&roads.length<maxRoads;j++){
   const c=selected[j];
   if(tryGrow(c.k,c.i,kind,j))accepted++;
  }
 }
 growTier('secondary',Math.min(70,Math.max(8,Math.round(domain.dryCells*.010*density*branching))),7);
 progress(.48,'Wool has grown secondary branches and local connections from primary fibers');
 growTier('local',Math.min(130,Math.max(12,Math.round(domain.dryCells*.023*density*branching))),5);
 progress(.58,'Wool has branched local road fibers along both tensor directions');
 return {roads,stats:{grownSecondary:branchCount.secondary,
  grownLocal:branchCount.local,snappedSecondary:snaps.secondary,
  snappedLocal:snaps.local,growthRejected:rejected,branchCandidates:roads.length,
  mechanism:'tensor-axis branching / repulsion / elastic bundling / safe snapping'}};
}

export function optimiseWool(skeleton,domain,parameters={},progress=()=>{}){
 const strength=clamp(Number(parameters.woolStrength??70)/100,0,1),
   alignment=clamp(Number(parameters.tensorAlignment??75)/100,0,1),
   bundle=clamp(Number(parameters.bundleStrength??60)/100,0,1),
   smooth=clamp(Number(parameters.curvatureSmoothing??75)/100,0,1),
   branch=clamp(Number(parameters.branchingStrength??60)/100,0,1);
 const step=clamp(domain.cell*.95,domain.cell*.65,domain.cell*1.6);
 // A* provides a full chain of flood-safe grid cells. Its presentation
 // simplification (r.points) may cut diagonally through forbidden cells.
 // Relax the ORIGINAL path instead of resampling those unsafe shortcuts.
 const grown=strength>0&&domain.certainty&&domain.cost&&domain.hydro?
  woolGrowth(skeleton,domain,parameters,progress):
  {roads:skeleton.roads.map(r=>({...r})),stats:{grownSecondary:0,grownLocal:0,
    snappedSecondary:0,snappedLocal:0,growthRejected:{}}};
 const roads=grown.roads.map((r,k)=>{
  const spine=r.indices?.length>1?r.indices.map(i=>domain.toPoint(i)):r.points;
  if(!spine?.length||spine.length<2)
   throw Error('No traversable source A* path; display curves cannot substitute for routing');
  const points=r.indices?.length>1?resample(spine,step):spine.map(p=>p.slice());
  return {...r,id:'ROAD-'+String(k+1).padStart(4,'0'),points};
 });
 const pathSafe=a=>a.every((p,i)=>safePoint(domain,p)&&
  (i===0||safeSegment(domain,a[i-1],p)));
 const basePaths=roads.map(r=>r.points.map(p=>p.slice()));
 for(let k=0;k<roads.length;k++)
  if(!pathSafe(roads[k].points))
   throw Error('Road '+roads[k].id+' A* source route crosses a restricted area; check road skeleton data');
 // Endpoint graph vertices are fixed; all fibre relaxation is interior-only.
 const rounds=Math.max(0,Math.round(strength*19));
 const proximity=domain.cell*(2.0+bundle*2.2);
 let unsafeRejected=0,relaxedPoints=0,filamentPairs=0;
 let relaxedRollback=0,curveRollbacks=0;
 for(let pass=0;pass<rounds;pass++){
  const cellSize=Math.max(domain.cell*1.8,proximity),buckets=new Map();
  const key=p=>Math.floor(p[0]/cellSize)+','+Math.floor(p[1]/cellSize);
  for(let k=0;k<roads.length;k++)for(let j=1;j<roads[k].points.length-1;j++){
   const p=roads[k].points[j],id=key(p);
   if(!buckets.has(id))buckets.set(id,[]);
   buckets.get(id).push({k,j,p});
  }
  for(let k=0;k<roads.length;k++){
   const road=roads[k],a=road.points;
   if(a.length<3)continue;
   const next=a.map(p=>p.slice());
   for(let j=1;j<a.length-1;j++){
    if(road.pins?.has(j))continue;
    const p=a[j],prev=next[j-1],post=a[j+1];
    const mid=[(prev[0]+post[0])*.5,(prev[1]+post[1])*.5];
    // Elastic bending: fibre tension straightens micro-kinks while
    // tensor alignment and barriers preserve longer-scale organic motion.
    let target=mix(p,mid,.11+.36*smooth);
    const i=domain.cellAt(p);
    if(i>=0&&domain.safe[i]){
     const guide=woolAxis(domain,p,false);
     const ux=guide?.[0]||0,uy=guide?.[1]||0;
     const mag=Math.hypot(ux,uy);
     if(mag>.25){
      const tangent=[post[0]-prev[0],post[1]-prev[1]];
      const dot=tangent[0]*ux+tangent[1]*uy;
      const sign=dot>=0?1:-1,normal=[-uy,ux];
      const error=(target[0]-p[0])*normal[0]+(target[1]-p[1])*normal[1];
      const ortho=-error*.15*alignment;
      target=[target[0]+ortho*normal[0],target[1]+ortho*normal[1]];
      // Normalised tensor keeps orientation, never forces a fixed travel direction.
      void sign;
     }
    }
    if(bundle>0){
     const gx=Math.floor(p[0]/cellSize),gy=Math.floor(p[1]/cellSize);
     let wx=0,wy=0,wSum=0;
     for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      const neighbors=buckets.get((gx+ox)+','+(gy+oy))||[];
      for(const other of neighbors){
       if(other.k===k)continue;
       // Do not pull major roads into thin local branches. Fibres in the
       // same hierarchy may share a bundle, but must remain distinct streets.
       if(roads[other.k].kind!==road.kind)continue;
       const d=length(p,other.p);
       if(d<domain.cell*.85||d>proximity)continue;
       const w=(1-d/proximity)**2;
       filamentPairs++;
       wx+=other.p[0]*w;wy+=other.p[1]*w;wSum+=w;
      }
     }
     if(wSum>0){
      const centroid=[wx/wSum,wy/wSum];
      target=mix(target,centroid,Math.min(.09,bundle*.075));
     }
    }
    const taper=Math.min(1,j/4,(a.length-1-j)/4);
    // Slow branching increases curvature transition length near junctions.
    const pull=taper*(.3+.45*strength)*(.65+.35*branch);
    const candidate=mix(p,target,pull);
    if(safePoint(domain,candidate)&&safeSegment(domain,prev,candidate)&&
       safeSegment(domain,candidate,post)){
      next[j]=candidate;relaxedPoints++;
    }else unsafeRejected++;
   }
   // Changing two adjacent vertices against their *old* neighbours used to
   // create new invalid connectors. Sequential updates plus whole-path check
   // ensure that each accepted pass is a valid walk through the hard mask.
   if(pathSafe(next))road.points=next;
   else{relaxedRollback++;road.points=a;}
  }
  if(pass%3===2)progress(.68+.18*(pass+1)/Math.max(1,rounds),
    'Wool elastic relaxation '+(pass+1)+'/'+rounds);
 }
 // Constrained Chaikin-like refinement: round away 45-degree A* corners,
 // but reject any new tangent which cuts across flood/DEM exclusion cells.
 let curveRefinements=0;
 for(const road of roads){
  if(strength===0||road.points.length<4||road.pins?.size)continue;
  const input=road.points,refined=[input[0]];
  for(let k=0;k<input.length-1;k++){
   const a=input[k],b=input[k+1];
   if(k===0||k===input.length-2){
    refined.push(b);continue;
   }
   const q=mix(a,b,.25),r=mix(a,b,.75);
   const previous=refined.at(-1);
   const next=input[k+2];
   if(safePoint(domain,q)&&safePoint(domain,r)&&
       safeSegment(domain,previous,q)&&safeSegment(domain,q,r)&&
       safeSegment(domain,r,next)){
    refined.push(q,r);
    curveRefinements++;
   }else refined.push(b);
  }
  if(refined.length>1&&refined.length<=input.length*2){
   // Check the assembled polyline, not just candidate-to-old-neighbour
   // segments. Later Chaikin pairs can otherwise invalidate earlier ones.
   if(pathSafe(refined))road.points=refined;
   else curveRollbacks++;
  }
 }
 // Curve sampling remains dense, preserving narrow valid corridors.
 for(const road of roads){
  let count=0;
  for(let i=1;i<road.points.length;i++){
   if(!safeSegment(domain,road.points[i-1],road.points[i]))
    throw Error('Wool path collision validation failed; passage through unbuildable or deep-water zones is prohibited');
   count+=length(road.points[i-1],road.points[i])*domain.scale;
  }
  road.lengthM=count;
 }
 return {roads,stats:{iterations:rounds,optimizedRoads:roads.length,
  totalLengthM:roads.reduce((sum,r)=>sum+r.lengthM,0),
  grownSecondary:grown.stats.grownSecondary,grownLocal:grown.stats.grownLocal,
  snappedSecondary:grown.stats.snappedSecondary,snappedLocal:grown.stats.snappedLocal,
  growthRejected:grown.stats.growthRejected,
  unsafeRejected,relaxedPoints,filamentPairs,curveRefinements,
  relaxedRollback,curveRollbacks,fullAStarCells:basePaths.reduce((n,p)=>n+p.length,0),
  formula:'same-source analysis+smoothed tensor weighted guidance + Wool growth / elastic relaxation + flood-safe Chaikin'}};
}
