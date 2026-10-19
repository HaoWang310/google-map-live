/* STEP 05 initial graph; real tensor/flood raster, deterministic A*.
   These are tentative paths that MUST pass the wool and topology stages. */
import {length} from './parcel_road_constraints.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
class Heap{
 constructor(){this.a=[]}
 push(v,p){const a=this.a;let i=a.length;a.push([v,p]);while(i){const k=(i-1)>>1;if(a[k][1]<=p)break;a[i]=a[k];i=k;}a[i]=[v,p]}
 pop(){const a=this.a;if(!a.length)return null;const top=a[0],tail=a.pop();if(a.length){let i=0;while(true){let k=i*2+1;if(k>=a.length)break;if(k+1<a.length&&a[k+1][1]<a[k][1])k++;if(a[k][1]>=tail[1])break;a[i]=a[k];i=k;}a[i]=tail;}return top[0]}
 get length(){return this.a.length}
}
const OFFSETS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function nearestCells(domain){
 const {w,h,safe,groundCell}=domain,options=[];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;if(!safe[i])continue;
  let exposed=false;
  for(const [dx,dy] of OFFSETS.slice(0,4))if(!safe[(y+dy)*w+x+dx])exposed=true;
  if(exposed)options.push(i);
 }
 if(options.length<4)return [];
 // Deterministic, well-spaced boundary access candidates from 8 angular sectors.
 const cx=w*.5,cy=h*.5,access=[];
 for(let sector=0;sector<8;sector++){
  let best=-1,score=-Infinity;
  for(const i of options){
   const x=i%w,y=Math.floor(i/w),angle=Math.atan2(y-cy,x-cx);
   const target=-Math.PI+(sector+.5)*Math.PI/4;
   const angleError=Math.abs(Math.atan2(Math.sin(angle-target),Math.cos(angle-target)));
   const cornerDist=Math.hypot(x-cx,y-cy);
   const s=cornerDist-.75*angleError*Math.max(w,h);
   if(s>score){score=s;best=i}
  }
  if(best>=0&&!access.some(j=>length(domain.toPoint(j),domain.toPoint(best))*domain.scale<groundCell*5))
   access.push(best);
 }
 return access;
}
function candidateNodes(domain,parameters){
 const {w,h,safe,depth,hydro,groundCell}=domain,area=w*h*groundCell*groundCell;
 const density=clamp(Number(parameters.roadDensity??55)/100,.1,1);
 const farmContinuity=clamp(Number(parameters.agriculturalContinuity??75)/100,0,1);
 const targetSpacing=clamp(Math.sqrt(area)/(4+7*density),groundCell*7,groundCell*30);
 // More continuous agricultural land = fewer candidate service nodes.
 const step=Math.max(3,Math.round(targetSpacing/groundCell));
 const candidates=[];
 // Symmetric lattice only selects anchor *regions*, not roads. Real local
 // tensor and A* subsequently shape the actual paths (never a grid drawing).
 for(let y=Math.floor(step/2);y<h;y+=step)for(let x=Math.floor(step/2);x<w;x+=step){
  let pick=-1,best=-Infinity;
  for(let dy=-Math.floor(step*.48);dy<=Math.floor(step*.48);dy++)
   for(let dx=-Math.floor(step*.48);dx<=Math.floor(step*.48);dx++){
    const xx=x+dx,yy=y+dy;
    if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const i=yy*w+xx;if(!safe[i])continue;
    // Prefer safer centres with actual tensor evidence and low channel impact.
    const s=1.5*domain.certainty[i]-.8*depth[i]-.5*hydro[i]-
     .04*Math.hypot(dx,dy);
    if(s>best){best=s;pick=i}
   }
  if(pick<0)continue;
  const residential=domain.certainty[pick]>.15&&depth[pick]<.04;
  if(!residential&&((Math.floor(x/step)*7+Math.floor(y/step)*11)%10)<Math.round(8*farmContinuity))
    continue; // Preserve larger unfragmented potential agricultural blocks.
  candidates.push({i:pick,role:residential?
   'candidate_residential':'candidate_agricultural',
    evidence:'dryness and DEM tensor confidence; not validated zoning'});
 }
 return candidates.slice(0,100);
}
function search(domain,start,end,usage,parameters,kind){
 const {w,h,safe,ax,ay,cost,cell,scale}=domain,n=w*h;
 if(!safe[start]||!safe[end])return null;
 const g=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1);
 const heap=new Heap();g[start]=0;heap.push(start,0);
 const tx=end%w,ty=Math.floor(end/w),alignment=clamp(Number(parameters.tensorAlignment??75)/100,0,1),
  bundle=clamp(Number(parameters.bundleStrength??60)/100,0,1);
 let expanded=0;
 while(heap.length&&expanded<Math.min(n*5,75000)){
  const i=heap.pop();if(i===end)break;expanded++;
  const x=i%w,y=Math.floor(i/w);
  for(const [dx,dy] of OFFSETS){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;
   const j=yy*w+xx;if(!safe[j])continue;
   if(dx&&dy&&(!safe[y*w+xx]||!safe[yy*w+x]))continue;
   const len=Math.hypot(dx,dy),tanX=dx/len,tanY=-dy/len,
    projection=Math.abs(tanX*ax[j]+tanY*ay[j]);
   const directionCost=alignment*(1-projection)*1.6;
   const areaCost=.5*(cost[i]+cost[j]);
   const reuse=usage[j]>0?(kind==='main'?1-bundle*.18:1+Math.min(2,usage[j])*(kind==='secondary'?.3:.65)):1;
   const edge=len*(areaCost+directionCost)*reuse;
   const next=g[i]+edge;
   if(next<g[j]){g[j]=next;prev[j]=i;
     heap.push(j,next+Math.hypot(tx-xx,ty-yy)*.96);}
  }
 }
 if(!Number.isFinite(g[end]))return null;
 const ids=[];for(let i=end;i>=0;i=prev[i]){
  ids.push(i);if(i===start)break;
  if(ids.length>n)throw Error('Road path predecessor loop');
 }
 if(ids.at(-1)!==start)return null;
 ids.reverse();
 if(ids.length<2)return null;
 const sampled=[ids[0]];
 for(let i=1;i<ids.length-1;i++){
  const a=sampled.at(-1),b=ids[i],c=ids[i+1];
  if(Math.abs((b%w-a%w)*(Math.floor(c/w)-Math.floor(b/w))-
     (Math.floor(b/w)-Math.floor(a/w))*(c%w-b%w))>0)
    sampled.push(b);
 }
 sampled.push(ids.at(-1));
 return {kind,indices:ids,points:sampled.map(i=>domain.toPoint(i)),
  start,end,lengthM:ids.slice(1).reduce((sum,j,k)=>sum+length(domain.toPoint(ids[k]),domain.toPoint(j))*scale,0),
  provenance:'deterministic tensor-aligned flood-aware A* spine'};
}
// Multi-scale organic street network: access spine → district loops → local mesh.
// Every seed and connection is derived from the validated DEM/flood tensor grid.
export function initialRoadSkeleton(domain,parameters={},progress=()=>{}){
 const {w,h,safe,groundCell,ax,ay,certainty,cost}=domain,n=w*h,
  d=clamp(Number(parameters.roadDensity??88)/100,.05,1),
  branching=clamp(Number(parameters.branchingStrength??78)/100,0,1),
  reconnect=clamp(Number(parameters.reconnectionStrength??86)/100,0,1),
  agriculture=clamp(Number(parameters.agriculturalContinuity??65)/100,0,1);
 const usage=new Uint16Array(n),roads=[],access=nearestCells(domain),
  anchors=candidateNodes(domain,parameters),occupied=[],rejections={unsafe:0,duplicate:0,short:0,disconnected:0};
 if(access.length<2)throw Error('没有足够安全的场地边界入口，无法生成主道路');
 const maxRoads=Math.min(370,Math.max(75,Math.round(domain.dryCells*(.016+.013*d))));
 const sampleOccupied=(p,minimum,limit=14)=>{
  const candidates=[];
  // Candidates are drawn from actual computed corridors, never random locations.
  const stride=Math.max(1,Math.floor(occupied.length/2400));
  for(let k=0;k<occupied.length;k+=stride){
   const i=occupied[k];if(i===p||!safe[i])continue;
   const distance=length(domain.toPoint(p),domain.toPoint(i))*domain.scale;
   if(distance<minimum||distance>groundCell*55)continue;
   candidates.push({i,distance});
  }
  return candidates.sort((a,b)=>a.distance-b.distance).slice(0,limit);
 };
 const add=(a,b,kind)=>{
  if(a===b||roads.length>=maxRoads)return null;
  if(!safe[a]||!safe[b]){rejections.unsafe++;return null}
  const r=search(domain,a,b,usage,parameters,kind);
  if(!r){rejections.disconnected++;return null}
  const novel=r.indices.reduce((count,i)=>count+(usage[i]===0?1:0),0);
  if(r.lengthM<groundCell*(kind==='main'?5:2.5)){rejections.short++;return null}
  if(kind!=='main'&&novel<Math.max(3,r.indices.length*.12)){
   rejections.duplicate++;return null;
  }
  const first=roads.find(p=>p.start===a&&p.end===b||p.start===b&&p.end===a);
  if(first){rejections.duplicate++;return null}
  for(const i of r.indices){
   if(!usage[i])occupied.push(i);
   usage[i]=Math.min(65535,usage[i]+1);
  }
  roads.push(r);return r;
 };
 const nearestSafe=(x,y,radius)=>{
  let best=-1,value=Infinity;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;
   const i=yy*w+xx;if(!safe[i])continue;
   const mag=Math.hypot(ax[i],ay[i]);
   const weight=(dx*dx+dy*dy)+cost[i]*.3+(1-mag)*.3;
   if(weight<value){value=weight;best=i}
  }
  return best;
 };
 function seeds(spacing,limit){
  const list=[],seen=new Set(),half=Math.max(1,Math.floor(spacing*.5));
  for(let y=half;y<h;y+=spacing)for(let x=half;x<w;x+=spacing){
   // Deterministic pseudo-jitter prevents the seed sites forming a Cartesian pattern.
   const jx=((x*37+y*17)%Math.max(1,spacing))-half;
   const jy=((x*19+y*43)%Math.max(1,spacing))-half;
   const i=nearestSafe(x+jx,y+jy,half+2);
   if(i<0||seen.has(i))continue;seen.add(i);
   const suitability=certainty[i]*1.3-cost[i]*.14+Math.hypot(ax[i],ay[i])*.2;
   // More agricultural continuity removes low-evidence local development nodes.
   if(suitability<-.05&&((x+y)%7)<Math.round(agriculture*5))continue;
   list.push({i,suitability,ordinal:(x*13+y*31)%97});
  }
  // Spread rather than only pick the first (northwest) region.
  list.sort((a,b)=>b.suitability-a.suitability||a.ordinal-b.ordinal);
  return list.slice(0,limit).map(x=>x.i);
 }
 // Phase 1: long-access spines followed by redundant access-to-access links.
 const hub=anchors.find(x=>x.role==='candidate_residential')?.i??
  nearestSafe(Math.floor(w/2),Math.floor(h/2),Math.ceil(Math.max(w,h)/3));
 if(hub>=0&&safe[hub]){
  for(const i of access){add(hub,i,'main')}
 }
 if(!roads.length)add(access[0],access.at(-1),'main');
 for(let i=0;i<access.length;i++){
  if(roads.filter(r=>r.kind==='main').length>=14)break;
  const j=(i+Math.max(2,Math.floor(access.length/2)))%access.length;
  add(access[i],access[j],'main');
 }
 progress(.27,'主道路：连接场地入口和安全中心，形成连续骨架');
 // Phase 2: district-level branches and loops. Each distinct seed attempts
 // two connections to spatially separated points on the existing network.
 const secondaryStep=clamp(Math.round(15-8*d),5,15);
 const secondary=seeds(secondaryStep,Math.round(19+105*d));
 let secondaryLoops=0;
 for(const seed of secondary){
  if(roads.length>=maxRoads*.59)break;
  if(usage[seed])continue;
  const targets=sampleOccupied(seed,groundCell*2.8,60);
  if(!targets.length){rejections.disconnected++;continue}
  const primary=targets[0].i,first=add(seed,primary,'secondary');
  if(!first)continue;
  if(reconnect<.2)continue;
  const firstPt=domain.toPoint(primary),seedPt=domain.toPoint(seed);
  const ranked=targets.filter(t=>t.i!==primary&&
    length(domain.toPoint(t.i),firstPt)*domain.scale>
      Math.max(groundCell*4,targets[0].distance*.55));
  // A second remote attachment creates a loop, not a redundant line stub.
  ranked.sort((a,b)=>{
   const sep=p=>{
    const u=domain.toPoint(p.i),
      ux=(u[0]-seedPt[0]),uy=(u[1]-seedPt[1]),
      vx=firstPt[0]-seedPt[0],vy=firstPt[1]-seedPt[1];
    return Math.abs(ux*vy-uy*vx)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)+1);
   };
   return b.distance*.025-a.distance*.025+sep(b)-sep(a);
  });
  const second=ranked[0];
  if(second&&add(seed,second.i,'secondary'))secondaryLoops++;
 }
 progress(.46,'次道路：扩展安全片区并尝试跨路网闭环');
 // Phase 3: compact local service mesh, with perpendicular tensor hints and
 // independently sampled local sites. Never artificially draw a raster grid.
 const localStep=clamp(Math.round(8-5*d),3,8);
 const localSeeds=seeds(localStep,Math.round(30+265*d));
 let localLoops=0,localLinks=0;
 for(const seed of localSeeds){
  if(roads.length>=maxRoads)break;
  if(usage[seed])continue;
  // Preserve flood/continuous farm corridors without eliminating all streets.
  if(domain.hydro[seed]||domain.depth[seed]>.055)continue;
  const targets=sampleOccupied(seed,groundCell*2,64);
  if(!targets.length)continue;
  let connected=add(seed,targets[0].i,'local');
  if(!connected)continue;
  localLinks++;
  if(reconnect<.25||roads.length>=maxRoads)continue;
  const a=domain.toPoint(targets[0].i),p=domain.toPoint(seed);
  const options=targets.filter(t=>t.i!==targets[0].i&&
    length(domain.toPoint(t.i),a)*domain.scale>groundCell*3.5);
  options.sort((x,y)=>{
   const deviation=q=>{
    const z=domain.toPoint(q.i),v=[a[0]-p[0],a[1]-p[1]],u=[z[0]-p[0],z[1]-p[1]];
    return Math.abs(u[0]*v[1]-u[1]*v[0])/(Math.hypot(...u)*Math.hypot(...v)+1);
   };
   return deviation(y)-deviation(x)||x.distance-y.distance;
  });
  if(options.length&&add(seed,options[0].i,'local'))localLoops++;
 }
 progress(.67,'局部支路：加密内部街坊，完成多级连接与闭环');
 if(!roads.length)throw Error('真实 DEM/洪涝约束下没有可生成的合法道路');
 const hierarchy={main:0,secondary:0,local:0};
 for(const r of roads)hierarchy[r.kind]++;
 return {roads,access:access.map(i=>domain.toPoint(i)),
  candidates:anchors.map(a=>({...a,point:domain.toPoint(a.i)})),
  stats:{...hierarchy,secondaryLoops,localLoops,localConnections:localLinks,
   targetRoads:maxRoads,rejections,eligibleCells:domain.dryCells,
   visitedCells:usage.reduce((s,v)=>s+(v>0),0),
   seedCounts:{secondary:secondary.length,local:localSeeds.length},
   note:'Three-tier tensor-guided A*; deterministic adaptive seeds; flood masks remain authoritative'}};
}
