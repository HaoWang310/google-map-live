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
 const targetSpacing=clamp(Math.sqrt(area)/(4+7*density),groundCell*7,groundCell*30);
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
  candidates.push({i:pick,role:domain.certainty[pick]>.15&&depth[pick]<.04?
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
   const reuse=usage[j]>0?1-bundle*.48:1;
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
  start,end,lengthM:(ids.length-1)*cell*scale,
  provenance:'deterministic tensor-aligned flood-aware A* spine'};
}
export function initialRoadSkeleton(domain,parameters={},progress=()=>{}){
 const {w,h,safe,groundCell}=domain,n=w*h;
 const usage=new Uint8Array(n),roads=[],access=nearestCells(domain),
  anchors=candidateNodes(domain,parameters);
 if(access.length<2)throw Error('安全场地边缘不足以生成可靠道路出入口');
 const usedNodes=[...access],core=anchors.filter(x=>x.role==='candidate_residential');
 if(core.length)usedNodes.push(core[Math.floor(core.length/2)].i);
 if(usedNodes.length<3)throw Error('无法识别可连接的公共/居住候选节点');
 function add(a,b,kind){
  if(a===b||roads.length>=170)return null;
  const r=search(domain,a,b,usage,parameters,kind);
  if(!r)return null;
  const usable=r.indices.filter(i=>safe[i]);
  if(usable.length<2)return null;
  for(const i of usable)usage[i]=Math.min(255,usage[i]+1);
  roads.push(r);return r;
 }
 // Kruskal-like growing connection of border accesses and public hub.
 const connected=[usedNodes[0]],remaining=new Set(usedNodes.slice(1));
 while(remaining.size){
  let best=null,d=Infinity;
  for(const a of connected)for(const b of remaining){
   const r=length(domain.toPoint(a),domain.toPoint(b));
   if(r<d){d=r;best=[a,b]}
  }
  if(!best)break;
  add(best[0],best[1],'main');connected.push(best[1]);remaining.delete(best[1]);
 }
 // Add a few loops between nearby access nodes instead of a spanning tree.
 for(let i=0;i<access.length;i++){
  const a=access[i],b=access[(i+1)%access.length];
  if(length(domain.toPoint(a),domain.toPoint(b))*domain.scale>groundCell*8)
   add(a,b,'main');
 }
 progress(.29,'主干道路骨架已形成');
 // Secondary roads connect real dry candidate zones to the existing spine.
 const secondaryCandidates=anchors.filter(a=>!usedNodes.includes(a.i));
 const branching=clamp(Number(parameters.branchingStrength??60)/100,0,1);
 for(const a of secondaryCandidates){
  if(roads.length>=150)break;
  let best=-1,d=Infinity;
  const stride=Math.max(1,Math.floor(n/2000));
  for(let i=0;i<n;i+=stride){
   if(!usage[i])continue;
   const dd=length(domain.toPoint(a.i),domain.toPoint(i));
   if(dd<d){d=dd;best=i}
  }
  if(best<0||d*domain.scale<groundCell*3)continue;
  if(a.role==='candidate_agricultural'&&d*domain.scale<groundCell*(12-branching*3))continue;
  add(a.i,best,'secondary');
 }
 progress(.53,'次级道路与公共节点连接完成');
 // Local loops: connect close but distinct existing corridors, not dead-end trees.
 const localSpacing=clamp(groundCell*(12-Number(parameters.roadDensity??55)/12),
  groundCell*5,groundCell*17);
 const localSeeds=anchors.filter(a=>a.role==='candidate_residential');
 let generated=0;
 for(let i=0;i<localSeeds.length;i++){
  const a=localSeeds[i].i;
  if(usage[a]||!safe[a])continue;
  let candidates=[];
  for(let j=i+1;j<localSeeds.length;j++){
   const b=localSeeds[j].i,d=length(domain.toPoint(a),domain.toPoint(b))*domain.scale;
   if(d>localSpacing*.7&&d<localSpacing*2.8)candidates.push({b,d});
  }
  candidates.sort((x,y)=>x.d-y.d);
  for(const pair of candidates.slice(0,2)){
   if(add(a,pair.b,'local'))generated++;
   if(generated>Math.round(22+Number(parameters.roadDensity??55)*.65))break;
  }
  if(generated>Math.round(22+Number(parameters.roadDensity??55)*.65))break;
 }
 progress(.67,'局部连接及街区环路已初始化');
 if(!roads.length)throw Error('真实地形/洪涝约束下无法构建道路骨架');
 return {roads,access:access.map(i=>domain.toPoint(i)),
  candidates:anchors.map(a=>({...a,point:domain.toPoint(a.i)})),
  stats:{main:roads.filter(r=>r.kind==='main').length,
   secondary:roads.filter(r=>r.kind==='secondary').length,
   local:roads.filter(r=>r.kind==='local').length,localConnections:generated}};
}
