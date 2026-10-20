/* STEP 05: real hydrological tensor-integrated road fibers. A* is only for repair. */
import {length} from './parcel_road_constraints.js?v=3.29.4-english';
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
// STEP05 generation deliberately begins with tensor integration, NOT A*.
// A* is retained solely as a late connectivity-repair utility.
function axisAt(domain,p,secondary=false,reference=null){
 const {w,h,cell,left,top,ax,ay,safe,certainty}=domain;
 const fx=(p[0]-left)/cell-.5,fy=(top-p[1])/cell-.5,
  x0=Math.floor(fx),y0=Math.floor(fy),dx=fx-x0,dy=fy-y0;
 let c=0,s=0,total=0;
 for(const [ox,oy,weight] of [
  [0,0,(1-dx)*(1-dy)],[1,0,dx*(1-dy)],
  [0,1,(1-dx)*dy],[1,1,dx*dy]]){
  const x=x0+ox,y=y0+oy;
  if(x<0||x>=w||y<0||y>=h||weight<=0)continue;
  const j=y*w+x,vx=ax[j],vy=ay[j],mag=Math.hypot(vx,vy);
  if(!safe[j]||mag<.25)continue;
  const k=weight*(.12+Math.max(0,certainty[j]));
  c+=k*(vx*vx-vy*vy)/(mag*mag);
  s+=k*2*vx*vy/(mag*mag);total+=k;
 }
 if(total<1e-5||Math.hypot(c,s)/total<.09)return null;
 const angle=.5*Math.atan2(s,c)+(secondary?Math.PI/2:0);
 let out=[Math.cos(angle),Math.sin(angle)];
 if(reference&&out[0]*reference[0]+out[1]*reference[1]<0)out=[-out[0],-out[1]];
 return out;
}
function segmentSafe(domain,a,b){
 const k=Math.max(2,Math.ceil(length(a,b)/(domain.cell*.28)));
 for(let j=0;j<=k;j++){
  const p=[a[0]+(b[0]-a[0])*j/k,a[1]+(b[1]-a[1])*j/k],
   z=domain.cellAt(p);
  if(z<0||!domain.safe[z])return false;
 }
 return true;
}
function integrate(domain,origin,secondary,sign,maxSteps,step){
 const initial=axisAt(domain,origin,secondary);
 if(!initial)return [origin];
 let heading=sign<0?[-initial[0],-initial[1]]:initial;
 const line=[origin],seen=new Set();
 for(let iter=0;iter<maxSteps;iter++){
  const p=line.at(-1),q=[p[0]+heading[0]*step*.5,p[1]+heading[1]*step*.5];
  const mid=axisAt(domain,q,secondary,heading);
  if(!mid)break;
  const turn=heading[0]*mid[0]+heading[1]*mid[1];
  if(turn<.05)break;
  const blended=[heading[0]*.3+mid[0]*.7,heading[1]*.3+mid[1]*.7],
   norm=Math.hypot(...blended);
  if(norm<.01)break;
  const dir=[blended[0]/norm,blended[1]/norm],
   next=[p[0]+dir[0]*step,p[1]+dir[1]*step];
  if(!segmentSafe(domain,p,next))break;
  const z=domain.cellAt(next);
  const key=z+'|'+(Math.round(Math.atan2(dir[1],dir[0])*4));
  if(seen.has(key)&&iter>9)break;
  seen.add(key);
  line.push(next);heading=dir;
 }
 return line;
}
function trace(domain,i,secondary,maxSteps){
 const origin=domain.toPoint(i),step=domain.cell*.64,
  backward=integrate(domain,origin,secondary,-1,maxSteps,step),
  forward=integrate(domain,origin,secondary,1,maxSteps,step);
 return backward.reverse().concat(forward.slice(1));
}
function lengthOf(domain,points){
 let sum=0;
 for(let i=1;i<points.length;i++)sum+=length(points[i-1],points[i])*domain.scale;
 return sum;
}
function selectSeeds(domain,spacing,limit,offset=0){
 const {w,h,safe,certainty,depth,hydro,cost}=domain,chosen=[],
  half=Math.max(1,Math.floor(spacing/2));
 for(let row=half;row<h;row+=spacing)for(let col=half;col<w;col+=spacing){
  let best=-1,score=-Infinity;
  for(let oy=-half;oy<=half;oy++)for(let ox=-half;ox<=half;ox++){
   const x=col+ox,y=row+oy;if(x<1||x>=w-1||y<1||y>=h-1)continue;
   const i=y*w+x;
   if(!safe[i])continue;
   const criterion=certainty[i]*2.1-.2*cost[i]-1.2*depth[i]-
      .3*hydro[i]-.018*(ox*ox+oy*oy)+
      .01*Math.sin(i*1.73+offset);
   if(criterion>score){score=criterion;best=i}
  }
  if(best>=0)chosen.push({i:best,score,
   order:(Math.imul(best+17,2654435761)>>>0)});
 }
 // Alternating spatial bins prevent clusters in one corner; no random geometry.
 chosen.sort((a,b)=>b.score-a.score);
 const bySector=Array.from({length:9},()=>[]);
 for(const item of chosen){
  const x=item.i%w,y=Math.floor(item.i/w),
   sec=Math.min(8,Math.floor(x*3/w)+3*Math.floor(y*3/h));
  bySector[sec].push(item.i);
 }
 const picked=[];
 while(picked.length<limit&&bySector.some(a=>a.length)){
  for(const bucket of bySector){
   if(bucket.length&&picked.length<limit)picked.push(bucket.shift());
  }
 }
 return picked;
}
export function initialRoadSkeleton(domain,parameters={},progress=()=>{}){
 const d=clamp(Number(parameters.roadDensity??88)/100,.05,1),
  agriculture=clamp(Number(parameters.agriculturalContinuity??65)/100,0,1),
  maxMain=Math.min(22,Math.max(4,Math.round(domain.dryCells*(.0008+.0012*d)))),
  mainSpacing=clamp(Math.round(Math.sqrt(domain.dryCells/Math.max(3,maxMain))),5,24),
  seeds=selectSeeds(domain,mainSpacing,maxMain*3),
  maxSteps=Math.min(125,Math.max(20,Math.round(Math.hypot(domain.w,domain.h)*.67)));
 const roads=[],used=new Uint16Array(domain.w*domain.h),
  access=nearestCells(domain),
  candidates=candidateNodes(domain,parameters),
  rejects={short:0,unsafe:0,duplicate:0,disconnected:0};
 function add(points,kind,provenance){
  if(points.length<6)return false;
  const len=lengthOf(domain,points);
  if(len<(kind==='main'?9:5)*domain.groundCell){rejects.short++;return false}
  if(!points.every((p,k)=>segmentSafe(domain,p,k?points[k-1]:p))){
   rejects.unsafe++;return false;
  }
  let newCells=0;
  const visited=new Set();
  for(const p of points){const i=domain.cellAt(p);if(i>=0)visited.add(i)}
  for(const i of visited)if(!used[i])newCells++;
  if(newCells<Math.max(3,visited.size*.18)){rejects.duplicate++;return false}
  const a=points[0],b=points.at(-1);
  if(roads.some(r=>length(r.points[0],a)<domain.cell*2&&
    length(r.points.at(-1),b)<domain.cell*2)){rejects.duplicate++;return false}
  roads.push({kind,points,start:domain.cellAt(a),end:domain.cellAt(b),
   provenance,lengthM:len});
  for(const i of visited)used[i]++;
  return true;
 }
 // Principal fibers are integrated bidirectionally from real directional evidence.
 for(const i of seeds){
  if(roads.filter(r=>r.kind==='main').length>=maxMain)break;
  add(trace(domain,i,false,maxSteps),'main','tensor-primary-rk2');
 }
 // Orthogonal secondary fibers are ALSO integrated, instead of joining A* pairs.
 const secSeeds=selectSeeds(domain,clamp(Math.round(mainSpacing*.72),4,17),
   Math.min(64,maxMain*6),13);
 for(const i of secSeeds){
  if(roads.filter(r=>r.kind==='secondary').length>=Math.max(8,maxMain*2))break;
  if(domain.hydro[i]&&agriculture>.7)continue;
  add(trace(domain,i,true,Math.round(maxSteps*.55)),'secondary','tensor-secondary-rk2');
 }
 if(!roads.some(r=>r.kind==='main'))throw Error('Insufficient tensor orientation evidence to integrate main road fibers');
 progress(.34,'Initial continuous fibers integrated along tensor directions; preparing Wool branch growth');
 const hierarchy={main:0,secondary:0,local:0};
 for(const r of roads)hierarchy[r.kind]++;
 return {roads,access:access.map(i=>domain.toPoint(i)),candidates:
  candidates.map(c=>({...c,point:domain.toPoint(c.i)})),
  stats:{...hierarchy,secondaryLoops:0,localLoops:0,localConnections:0,
   targetRoads:Math.min(240,Math.max(65,Math.round(domain.dryCells*.032*d))),
   rejections:rejects,seedCounts:{main:seeds.length,secondary:secSeeds.length},
   eligibleCells:domain.dryCells,visitedCells:used.reduce((v,i)=>v+(i>0),0),
   note:'Bidirectional RK2 integration on real primary and secondary tensor axes; no A* in primary growth'}};
}
// Called *after* Wool growth. A* may connect safe disconnected fiber components,
// but it is never used to create the initial road hierarchy.
export function repairRoadConnectivity(network,domain,parameters={},progress=()=>{}){
 const roads=network.roads,usage=new Uint16Array(domain.w*domain.h),
  seen=new Set(),repairs=[];
 for(const r of roads)for(const p of r.points){
  const i=domain.cellAt(p);if(i>=0)usage[i]++;
 }
 const anchors=roads.filter(r=>r.kind==='main').map(r=>domain.cellAt(r.points[0]))
   .filter(i=>i>=0&&domain.safe[i]);
 if(anchors.length<2)return {...network,stats:{...network.stats,astarRepairs:0}};
 const group=[anchors[0]];
 const maxRepairs=Math.min(8,Math.max(2,Math.round(anchors.length/2)));
 for(let round=0;round<maxRepairs;round++){
  const remain=anchors.filter(a=>!seen.has(a)&&!group.includes(a));
  if(!remain.length)break;
  let pair=null,best=Infinity;
  for(const a of remain)for(const b of group){
   const d=length(domain.toPoint(a),domain.toPoint(b))*domain.scale;
   if(d<best){best=d;pair=[a,b]}
  }
  if(!pair)break;
  const [a,b]=pair;seen.add(a);
  // Short safe direct links need no pathfinder. For longer/unsafe links A*
  // repairs only the missing connection and respects the hard flood mask.
  const path=search(domain,a,b,usage,parameters,'secondary');
  if(!path){continue}
  if(path.indices.length<2||path.lengthM<domain.groundCell*2)continue;
  // Connecting separate safe islands is impossible without bridging; preserve
  // that disconnect rather than inventing a road through inundated cells.
  repairs.push({...path,points:path.indices.map(i=>domain.toPoint(i)),
   id:'REPAIR-'+(repairs.length+1),provenance:'astar-connectivity-repair'});
  group.push(a);
 }
 progress(.9,'A* repaired limited safe gaps where needed; other directions derive from tensor integration and Wool growth');
 return {...network,roads:roads.concat(repairs),
  stats:{...network.stats,astarRepairs:repairs.length}};
}
