/* Site-derived 2D Wool drawing. A shared planar district partition is pulled
   through the current hydrological field. Local streets end at collectors;
   adjacent districts never overlap. Display bundles are separate from roads. */
import {smoothSiteField} from './site_visual_field.js?v=3.28.0-tensor-wool-linked';
import {growOrganicLocalRoads} from './parcel_road_organic.js?v=3.28.0-tensor-wool-linked';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const key=p=>p.map(x=>Math.round(x*100000)).join(',');
function clip(poly,nx,ny,limit){
 const out=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=a[0]*nx+a[1]*ny-limit,db=b[0]*nx+b[1]*ny-limit;
  if(da<=1e-8)out.push(a);
  if((da<0)!==(db<0))out.push(mix(a,b,da/(da-db)));
 }
 return out;
}
function voronoi(seeds,w,h){
 return seeds.map((p,i)=>{
  let poly=[[.01,.01],[w-.01,.01],[w-.01,h-.01],[.01,h-.01]];
  for(let j=0;j<seeds.length&&poly.length;j++)if(i!==j){
   const q=seeds[j];poly=clip(poly,q[0]-p[0],q[1]-p[1],(q[0]**2+q[1]**2-p[0]**2-p[1]**2)/2);
  }
  return poly;
 });
}
function areaCentroid(poly){
 let area=0,x=0,y=0;
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],v=a[0]*b[1]-b[0]*a[1];area+=v;x+=(a[0]+b[0])*v;y+=(a[1]+b[1])*v;
 }
 return Math.abs(area)>1e-8?[x/(3*area),y/(3*area)]:poly[0];
}
export function buildPresentationRoadNetwork(domain,parameters={}){
 const {w,h,cell,left,top,inside,scale}=domain,n=w*h;
 const density=clamp((parameters.roadDensity??88)/100,.05,1),wool=clamp((parameters.woolStrength??88)/100,0,1);
 const bundle=clamp((parameters.bundleStrength??85)/100,0,1),avoid=clamp((parameters.floodAvoidance??58)/100,0,1);
 const wet=Float32Array.from({length:n},(_,i)=>(domain.depth?.[i]||0)/((domain.depth?.[i]||0)+.16));
 const field=domain.presentationTensor?.field||smoothSiteField({w,h,mask:domain.safe,ax:domain.ax,ay:domain.ay?Float32Array.from(domain.ay,v=>-v):null,
   confidence:domain.certainty,anisotropy:domain.anisotropy,wet},.55+.45*clamp((parameters.curvatureSmoothing??90)/100,0,1));
 const size=Math.min(w,h),roads=[],bundles=[],displayRoads=[],lengths={main:0,secondary:0,local:0};
 const stats={main:0,secondary:0,local:0},rejections={outside:0,short:0};
 const cellAt=([x,y])=>{const xx=Math.floor(x),yy=Math.floor(y);return xx>=0&&yy>=0&&xx<w&&yy<h?yy*w+xx:-1;};
 const inSite=p=>{const i=cellAt(p);return i>=0&&inside[i];};
 const waterAt=p=>{const i=cellAt(p);return i>=0?field.water[i]:0;};
 // No pseudo-random template: flood distribution, eigenaxes and parcel mask
 // all influence seed placement. Uniform input is allowed to stay uniform.
 const candidates=[];
 for(let y=1;y<h;y+=2)for(let x=1;x<w;x+=2)if(inSite([x,y]))candidates.push([x,y]);
 if(candidates.length<8)throw Error('场地有效范围不足，无法生成二维羊毛图案');
 let mean=[0,0];for(const p of candidates){mean[0]+=p[0];mean[1]+=p[1];}mean=mean.map(v=>v/candidates.length);
 const seedCount=Math.round(15+12*density+3*(parameters.branchingStrength??78)/100);
 const seeds=[];
 for(let k=0;k<seedCount;k++){
  let best=null,score=-Infinity;
  for(const p of candidates){
   const d=k?Math.min(...seeds.map(q=>dist(p,q))):-dist(p,mean);
   const value=d*(1-.45*waterAt(p)*avoid)+(k?0:waterAt(p)*size*.06);
   if(value>score){score=value;best=p;}
  }
  if(!best||seeds.some(p=>dist(p,best)<.1))break;seeds.push(best.slice());
 }
 // Two centroidal relaxation passes; boundary clipped cells retain coverage.
 for(let k=0;k<2;k++){
  const cells=voronoi(seeds,w,h);
  for(let i=0;i<seeds.length;i++)if(cells[i].length>2){
   const q=mix(seeds[i],areaCentroid(cells[i]),.7);if(inSite(q))seeds[i]=q;
  }
 }
 const cells=voronoi(seeds,w,h);
 function scalar(data,x,y){
  const bx=Math.floor(x-.5),by=Math.floor(y-.5),fx=x-.5-bx,fy=y-.5-by;let sum=0,total=0;
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
   const i=cellAt([bx+ox+.5,by+oy+.5]);if(i<0||!inside[i])continue;
   const t=(ox?fx:1-fx)*(oy?fy:1-fy);sum+=(data[i]||0)*t;total+=t;
  }return total?sum/total:0;
 }
 function warp(p){
  let [x,y]=p;
  for(let k=0;k<12;k++){
   const c=scalar(field.c,x,y),s=scalar(field.s,x,y);
   const gx=(scalar(field.water,x+1,y)-scalar(field.water,x-1,y))*.5;
   const gy=(scalar(field.water,x,y+1)-scalar(field.water,x,y-1))*.5;
   const edge=clamp(Math.min(x,y,w-x,h-y)/(size*.12),0,1);
   // Coherent elastic pull + water repulsion applied to every road point.
   const vx=(c*.12-s*.06-gx*2.8*avoid),vy=(s*.14-gy*2.8*avoid);
   x+=vx*size*wool*edge/12;y+=vy*size*wool*edge/12;
  }
  return [x,y];
 }
 const project=p=>[left+p[0]*cell,top-p[1]*cell];
 let serial=0;
 function add(samples,kind,tag,decorative=false,display=false){
  let run=[];
  const flush=()=>{
   if(run.length<3){run=[];return;}
   let lengthM=0;for(let i=1;i<run.length;i++)lengthM+=dist(run[i-1],run[i])*cell*scale;
   if(lengthM<domain.groundCell*.75){rejections.short++;run=[];return;}
   const points=run.map(project);
   if(display)displayRoads.push({kind,points});
   else if(decorative)bundles.push({kind,points});
   else{roads.push({id:'WOOL-'+String(++serial).padStart(5,'0'),kind,points,lengthM,
    start:domain.cellAt(points[0]),end:domain.cellAt(points.at(-1)),
    provenance:'ARTISTIC PREVIEW / site-derived wool-attraction-and-bundling / '+tag});stats[kind]++;lengths[kind]+=lengthM;}
   run=[];
  };
  for(const p of samples){
   // Local streets leave actual wet negative space. No invented sine river.
   const i=cellAt(p);
    const allowed=inSite(p)&&(decorative||display||Boolean(domain.safe[i]))&&
     (kind!=='local'||waterAt(p)<.32+.25*(1-avoid));
   if(!allowed){flush();rejections.outside++;continue;}
   // Also inspect segment interior to prevent holes being bridged.
   if(run.length){const a=run.at(-1);let clear=true;
    for(let t=.2;t<1;t+=.2){const probe=mix(a,p,t),ci=cellAt(probe);
      if(!inSite(probe)||(!decorative&&!display&&(ci<0||!domain.safe[ci]))){clear=false;break;}}
    if(!clear)flush();
   }run.push(p);
  }flush();
 }
 // Unique district edges produce one planar collector graph, not overlapping rings.
 const nodes=[],nodeMap=new Map(),edges=[],edgeMap=new Map();
 const node=p=>{const k=key(p);if(!nodeMap.has(k)){nodeMap.set(k,nodes.length);nodes.push({p,edges:[]});}return nodeMap.get(k);};
 cells.forEach((poly,d)=>{for(let j=0;j<poly.length;j++){
  const a=poly[j],b=poly[(j+1)%poly.length];if(dist(a,b)<.02)continue;
  const u=node(a),v=node(b),k=[u,v].sort((a,b)=>a-b).join(':');
  if(edgeMap.has(k)){edges[edgeMap.get(k)].districts.push(d);continue;}
  const index=edges.length;edgeMap.set(k,index);edges.push({u,v,districts:[d],kind:'secondary'});nodes[u].edges.push(index);nodes[v].edges.push(index);
 }});
 // Select a few long connected routes along the graph, never independent diagonals.
 function shortest(start,end){
  const costs=nodes.map(()=>Infinity),prev=new Map(),todo=new Set(nodes.map((_,i)=>i));costs[start]=0;
  while(todo.size){let u=-1,best=Infinity;for(const i of todo)if(costs[i]<best){u=i;best=costs[i];}if(u<0||u===end)break;todo.delete(u);
   for(const ei of nodes[u].edges){const e=edges[ei],v=e.u===u?e.v:e.u;
    const p=mix(nodes[u].p,nodes[v].p,.5),axis=field.read(...p),delta=[nodes[v].p[0]-nodes[u].p[0],nodes[v].p[1]-nodes[u].p[1]],len=dist(nodes[u].p,nodes[v].p);
    const alignment=axis?Math.abs((delta[0]*axis[0]+delta[1]*axis[1])/Math.max(.001,len)):0;
    const cost=len*(1+waterAt(p)*avoid*2+(.4*(parameters.tensorAlignment??78)/100)*(1-alignment))*(e.kind==='main'?.68:1);
    if(costs[u]+cost<costs[v]){costs[v]=costs[u]+cost;prev.set(v,[u,ei]);}
   }
  }
  const path=[];let u=end;while(prev.has(u)&&path.length<edges.length){const [v,e]=prev.get(u);path.push(e);u=v;}return u===start?path:[];
 }
 const nearest=p=>nodes.reduce((best,node,i)=>dist(node.p,p)<dist(nodes[best].p,p)?i:best,0);
 // Choose macro-road endpoints from CURRENT safe-site geometry and tensor
 // evidence rather than fixed relative-coordinate diagonals or templates.
 const accessible=nodes.map((node,i)=>({i,p:node.p})).filter(n=>{
  const id=cellAt(n.p);return id>=0&&domain.safe[id];
 });
 const pool=accessible.filter((_,i)=>i%Math.max(1,Math.floor(accessible.length/65))===0);
 const usedPairs=[];
 for(let round=0;round<3&&pool.length>1;round++){
  let best=null,bestScore=-Infinity;
  for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
   const a=pool[i],b=pool[j],d=dist(a.p,b.p);
   if(d<size*.36)continue;
   const mid=mix(a.p,b.p,.5),axis=field.read(...mid);
   const tangent=[(b.p[0]-a.p[0])/d,(b.p[1]-a.p[1])/d];
   const alignment=axis?Math.abs(tangent[0]*axis[0]+tangent[1]*axis[1]):.25;
   const separation=usedPairs.reduce((score,pair)=>{
    const da=Math.min(dist(a.p,pair[0]),dist(a.p,pair[1]));
    const db=Math.min(dist(b.p,pair[0]),dist(b.p,pair[1]));
    return Math.min(score,clamp((da+db)/(size*.75),.18,1));
   },1);
   const score=d*(.48+.52*alignment)*(1-.55*waterAt(mid)*avoid)*separation;
   if(score>bestScore){bestScore=score;best=[a,b];}
  }
  if(!best)break;
  const path=shortest(best[0].i,best[1].i);
  if(path.length<2)break;
  path.forEach(e=>edges[e].kind='main');
  usedPairs.push([best[0].p,best[1].p]);
 }
 function edgeSamples(a,b){const count=Math.max(8,Math.ceil(dist(a,b)/.75));return Array.from({length:count+1},(_,i)=>warp(mix(a,b,i/count)));}
 for(const e of edges){e.samples=edgeSamples(nodes[e.u].p,nodes[e.v].p);add(e.samples,e.kind,'collector');}
 // Organic local roads guided by the SAME smoothed source tensor as STEP04.
 const organic=growOrganicLocalRoads(domain,field,edges.map(e=>e.samples),parameters);
 let localCandidates=0;
 for(const road of organic.roads){
  const before=roads.length;
  add(road.points,'local','analysis-linked-organic-integration');
  localCandidates+=roads.length-before;
 }
 // Rounded Y junction fibres: these are display-only strands of the final
 // bundles, never counted as extra roads, loops or planning area.
 const strandCount=Math.round(2+4*bundle),radius=size*(.016+.026*wool);
 // Rounded display strokes share edge anchors with the junction fans.
 // The analytical graph remains separately available for STEP06.
 for(const e of edges){
  const a=nodes[e.u],b=nodes[e.v],len=dist(a.p,b.p);
  const ta=a.edges.length>=3?Math.min(.32,radius/len):0;
  const tb=b.edges.length>=3?Math.min(.32,radius/len):0;
  add(edgeSamples(mix(a.p,b.p,ta),mix(b.p,a.p,tb)),e.kind,'rounded-collector',false,true);
 }
 for(let ni=0;ni<nodes.length;ni++){
  const node=nodes[ni];if(node.edges.length<3)continue;
  const incident=node.edges.map(ei=>{const e=edges[ei],other=nodes[e.u===ni?e.v:e.u];return {e,p:other.p,angle:Math.atan2(other.p[1]-node.p[1],other.p[0]-node.p[0])};}).sort((a,b)=>a.angle-b.angle);
  for(let j=0;j<incident.length;j++){
   const a=incident[j],b=incident[(j+1)%incident.length],kind=a.e.kind==='main'||b.e.kind==='main'?'main':'secondary';
   const anchorA=mix(node.p,a.p,Math.min(.32,radius/dist(node.p,a.p)));
   const anchorB=mix(node.p,b.p,Math.min(.32,radius/dist(node.p,b.p)));
   const rounded=Array.from({length:33},(_,i)=>{const t=i/32,z=1-t;return warp([z*z*anchorA[0]+2*z*t*node.p[0]+t*t*anchorB[0],z*z*anchorA[1]+2*z*t*node.p[1]+t*t*anchorB[1]]);});
   add(rounded,a.e.kind==='main'&&b.e.kind==='main'?'main':'secondary','rounded-junction',false,true);
   for(let k=0;k<strandCount;k++){
    const r=radius*(.60+k*.18),p=mix(node.p,a.p,Math.min(.42,r/dist(node.p,a.p))),q=mix(node.p,b.p,Math.min(.42,r/dist(node.p,b.p)));
    const samples=Array.from({length:25},(_,i)=>{const t=i/24,z=1-t;return warp([z*z*p[0]+2*z*t*node.p[0]+t*t*q[0],z*z*p[1]+2*z*t*node.p[1]+t*t*q[1]]);});
    add(samples,kind,'junction-strand',true);
   }
  }
 }
 // Parallel bundled filaments follow final collector curves with tapered ends.
 for(const e of edges){
  const count=e.kind==='main'?strandCount:2;
  for(let k=1;k<=count;k++)for(const side of [-1,1]){
   const samples=e.samples.map((p,i,a)=>{
    const before=a[Math.max(0,i-1)],after=a[Math.min(a.length-1,i+1)],len=Math.max(.001,dist(before,after));
    const offset=side*k*size*.0012*bundle*Math.sin(Math.PI*i/(a.length-1));
    return [p[0]-(after[1]-before[1])/len*offset,p[1]+(after[0]-before[0])/len*offset];
   });add(samples,e.kind,'parallel-strand',true);
  }
 }
 return {roads,bundles,displayRoads,access:[],candidates:[],stats:{...stats,
  syntheticPresentation:false,siteDerived:true,woolCombinedOnly:true,
  displayMethod:'source analysis tensor -> shared weighted field -> organic Wool road growth',
  generatedDistricts:cells.length,localFiberCandidates:localCandidates,
   organicDiagnostics:organic.diagnostics,presentationDirection:field.diagnostics,bundleStrands:bundles.length,
  generatedLengthM:lengths,targetRoads:roads.length,rejections,eligibleCells:domain.dryCells,visitedCells:0}};
}
