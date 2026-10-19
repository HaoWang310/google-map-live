/* STEP 05 planar street topology and ground-metre carriageway strips.
   Full face subdivision and semantic zoning belong to STEP 06, not STEP 05. */
import {lonlat,length} from './parcel_road_constraints.js';
const widths={main:14,secondary:9,local:5};
const round=n=>Math.round(n*100)/100;
const nodeKey=p=>Math.round(p[0])+'|'+Math.round(p[1]);
const intersect=(a,b,c,d)=>{
 const dx=b[0]-a[0],dy=b[1]-a[1],ex=d[0]-c[0],ey=d[1]-c[1],
  cross=dx*ey-dy*ex;
 if(Math.abs(cross)<1e-10)return null;
 const u=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/cross;
 const v=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/cross;
 if(u<-1e-7||u>1+1e-7||v<-1e-7||v>1+1e-7)return null;
 return {u:Math.max(0,Math.min(1,u)),v:Math.max(0,Math.min(1,v)),
  point:[a[0]+u*dx,a[1]+u*dy]};
};
function strip(a,b,width,scale){
 const len=length(a,b);if(len<.001)return null;
 const r=width/Math.max(.15,scale)/2,n=[-(b[1]-a[1])/len*r,(b[0]-a[0])/len*r];
 const coords=[[a[0]+n[0],a[1]+n[1]],[b[0]+n[0],b[1]+n[1]],
 [b[0]-n[0],b[1]-n[1]],[a[0]-n[0],a[1]-n[1]]];
 coords.push(coords[0]);
 return {type:'Polygon',coordinates:[coords.map(lonlat)]};
}
function sampleRoadPoints(points,resolution){
 const result=[points[0]];
 for(let k=1;k<points.length;k++){
  const a=points[k-1],b=points[k],d=length(a,b);
  const n=Math.max(1,Math.ceil(d/resolution));
  for(let i=1;i<=n;i++)result.push([
   a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);
 }
 return result;
}
export function createRoadTopology(optimised,domain,parameters={},progress=()=>{}){
 const roads=optimised.roads,scale=domain.scale,roadLines=[],footprints=[],segments=[];
 for(const road of roads){
  if(!road.points||road.points.length<2)continue;
  const width=widths[road.kind],sample=sampleRoadPoints(road.points,domain.cell*.9);
  roadLines.push({type:'Feature',properties:{roadId:road.id,
    hierarchy:road.kind,widthMetres:width,lengthM:round(road.lengthM),
    source:'computed Wool / tensor / simulated flood; planning proposal'},
    geometry:{type:'LineString',coordinates:sample.map(lonlat)}});
  for(let i=1;i<sample.length;i++){
   const a=sample[i-1],b=sample[i],len=length(a,b);
   if(len<.02)continue;
   segments.push({a,b,kind:road.kind,roadId:road.id,width,marks:[{t:0,p:a},{t:1,p:b}]});
   const geom=strip(a,b,width,scale);
   if(geom)footprints.push({type:'Feature',properties:{
      roadId:road.id,hierarchy:road.kind,widthMetres:width,
      footprint:'road-surface-segment; overlapping strips require union before STEP 06 faces'},
      geometry:geom});
  }
 }
 if(segments.length>30000)throw Error('道路细分量超过30,000段，请降低密度或缩小场地');
 const bucketSize=domain.cell*3,boxes=new Map();
 const overlaps=(s,t)=>!((Math.max(s.a[0],s.b[0])<Math.min(t.a[0],t.b[0])-1e-4)||
  (Math.max(t.a[0],t.b[0])<Math.min(s.a[0],s.b[0])-1e-4)||
  (Math.max(s.a[1],s.b[1])<Math.min(t.a[1],t.b[1])-1e-4)||
  (Math.max(t.a[1],t.b[1])<Math.min(s.a[1],s.b[1])-1e-4));
 let crossings=0,checkedPairs=new Set();
 for(let i=0;i<segments.length;i++){
  const s=segments[i],x0=Math.floor(Math.min(s.a[0],s.b[0])/bucketSize),
   x1=Math.floor(Math.max(s.a[0],s.b[0])/bucketSize),
   y0=Math.floor(Math.min(s.a[1],s.b[1])/bucketSize),
   y1=Math.floor(Math.max(s.a[1],s.b[1])/bucketSize);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const k=x+','+y;const entries=boxes.get(k)||[];
   for(const j of entries){
    const pair=j+'|'+i;if(checkedPairs.has(pair))continue;
    checkedPairs.add(pair);
    const t=segments[j];
    if(!overlaps(s,t))continue;
    const hit=intersect(s.a,s.b,t.a,t.b);if(!hit)continue;
    // Splitting colocated endpoints via a shared node is handled below.
    s.marks.push({t:hit.u,p:hit.point});
    t.marks.push({t:hit.v,p:hit.point});
    if(hit.u>1e-4&&hit.u<1-1e-4&&hit.v>1e-4&&hit.v<1-1e-4)crossings++;
   }
   entries.push(i);boxes.set(k,entries);
  }
 }
 progress(.94,'已检测道路交叉并建立路口连接');
 const nodes=[],nodeMap=new Map(),edges=[],edgeKeys=new Set();
 const id=p=>{
  const key=nodeKey(p);if(nodeMap.has(key))return nodeMap.get(key);
  const n='N'+String(nodes.length+1).padStart(6,'0');
  nodeMap.set(key,n);nodes.push({id:n,coordinates:lonlat(p),metric:p,degree:0});return n;
 };
 for(const s of segments){
  const marks=s.marks.sort((a,b)=>a.t-b.t).filter((p,i,a)=>i===0||length(p.p,a[i-1].p)>.25/domain.scale);
  for(let j=1;j<marks.length;j++){
   const a=marks[j-1].p,b=marks[j].p;
   if(length(a,b)<.5/domain.scale)continue;
   const start=id(a),end=id(b);if(start===end)continue;
   const ek=[start,end].sort().join('|');
   if(edgeKeys.has(ek))continue;
   edgeKeys.add(ek);
   const edge={id:'E'+String(edges.length+1).padStart(6,'0'),
    source:start,target:end,roadId:s.roadId,hierarchy:s.kind,
    lengthM:round(length(a,b)*scale),widthMetres:s.width};
   edges.push(edge);
  }
 }
 const degrees=new Map();for(const edge of edges){
  degrees.set(edge.source,(degrees.get(edge.source)||0)+1);
  degrees.set(edge.target,(degrees.get(edge.target)||0)+1);
 }
 for(const node of nodes)node.degree=degrees.get(node.id)||0;
 // Explicit undirected graph connectivity and cycle rank. Count cycles by
 // E−V+C rather than treating every visual crossing as a valid road loop.
 const parent=new Map(nodes.map(n=>[n.id,n.id]));
 const root=a=>{let p=a;while(parent.get(p)!==p)p=parent.get(p);
  while(parent.get(a)!==a){const b=parent.get(a);parent.set(a,p);a=b}
  return p;
 };
 for(const e of edges){const a=root(e.source),b=root(e.target);if(a!==b)parent.set(b,a)}
 const componentCount=new Set(nodes.filter(n=>n.degree>0).map(n=>root(n.id))).size;
 const isolatedEnds=nodes.filter(n=>n.degree===1).length;
 const cyclicRank=Math.max(0,edges.length-nodes.filter(n=>n.degree>0).length+componentCount);
 // Planar half-edge walks locate *candidate* inner faces. This is a
 // diagnostic only; exact geometric union/subtraction belongs to STEP 06.
 const adj=new Map(nodes.map(n=>[n.id,[]]));
 const projected=new Map(nodes.map(n=>[n.id,n.metric]));
 for(const e of edges){
  adj.get(e.source).push(e.target);
  adj.get(e.target).push(e.source);
 }
 for(const [id,neighbors] of adj){
  const p=projected.get(id);
  neighbors.sort((a,b)=>{
   const q=projected.get(a),r=projected.get(b);
   return Math.atan2(q[1]-p[1],q[0]-p[0])-
    Math.atan2(r[1]-p[1],r[0]-p[0]);
  });
 }
 const seen=new Set(),potentialBlocks=[],stepsLimit=Math.max(300,edges.length*3);
 for(const e of edges)for(const [u0,v0] of [[e.source,e.target],[e.target,e.source]]){
  const key=u0+'>'+v0;if(seen.has(key))continue;
  let u=u0,v=v0,ring=[],closed=false;
  for(let iter=0;iter<stepsLimit;iter++){
   const k=u+'>'+v;if(seen.has(k))break;seen.add(k);
   ring.push(projected.get(u));
   const nexts=adj.get(v),idx=nexts.indexOf(u);
   if(idx<0||!nexts.length)break;
   // Immediate clockwise turn keeps bounded planar faces on the left.
   const w=nexts[(idx-1+nexts.length)%nexts.length];
   u=v;v=w;
   if(u===u0&&v===v0){closed=true;break}
  }
  if(!closed||ring.length<3)continue;
  let twiceArea=0;
  for(let j=0;j<ring.length;j++){
   const a=ring[j],b=ring[(j+1)%ring.length];
   twiceArea+=a[0]*b[1]-b[0]*a[1];
  }
  // Ignore outer/infinite face (opposite winding) and tiny sliver intersections.
  const areaM2=twiceArea*.5*scale*scale;
  if(areaM2>domain.groundCell*domain.groundCell*.85&&
     areaM2<domain.dryCells*domain.groundCell*domain.groundCell*.98)
    potentialBlocks.push({areaM2,vertices:ring.length});
 }
 const blockAreas=potentialBlocks.map(b=>b.areaM2).sort((a,b)=>a-b);
 const medianBlockAreaM2=blockAreas.length?
  round(blockAreas[Math.floor(blockAreas.length/2)]):0;
 const preliminaryBlockAreaM2=round(blockAreas.reduce((a,b)=>a+b,0));
 progress(.975,'已检查路网连通分量、潜在闭环和候选街区面积');
 const topology={type:'planar-street-graph',crs:'EPSG:4326',
  nodes:nodes.map(({metric,...n})=>n),edges,
  properties:{crossings,junctions:nodes.filter(n=>n.degree>=3).length,
   topologyVerified:true,closedFacesComputed:false,
   potentialClosedLoops:cyclicRank,connectedComponents:componentCount,
   deadEndNodes:isolatedEnds,candidateFacesDiagnosed:true,
   candidateBlockCount:potentialBlocks.length,
   preliminaryBlockAreaM2,medianBlockAreaM2,
   faceWarning:'Candidate cycles are provisional only. STEP06 must polygonize/clip and exclude flood corridors.',
   warning:'Buffer footprints are segment strips; STEP 06 must union/clip them and polygonize blocks'}};
 const collection=features=>({type:'FeatureCollection',features});
 return {mainRoads:collection(roadLines.filter(f=>f.properties.hierarchy==='main')),
  secondaryRoads:collection(roadLines.filter(f=>f.properties.hierarchy==='secondary')),
  localRoads:collection(roadLines.filter(f=>f.properties.hierarchy==='local')),
  roadCenterlines:collection(roadLines),roadFootprints:collection(footprints),topology,
  statistics:{roadCount:roadLines.length,segments:segments.length,
   nodes:nodes.length,edges:edges.length,crossings,junctions:topology.properties.junctions,
   components:componentCount,deadEnds:isolatedEnds,cycleRank:cyclicRank,
   candidateBlocks:potentialBlocks.length,medianBlockAreaM2,preliminaryBlockAreaM2,
   lengthKm:round(roadLines.reduce((sum,f)=>sum+f.properties.lengthM,0)/1000),
   mainKm:round(roadLines.filter(f=>f.properties.hierarchy==='main')
    .reduce((s,f)=>s+f.properties.lengthM,0)/1000),
   secondaryKm:round(roadLines.filter(f=>f.properties.hierarchy==='secondary')
    .reduce((s,f)=>s+f.properties.lengthM,0)/1000),
   localKm:round(roadLines.filter(f=>f.properties.hierarchy==='local')
    .reduce((s,f)=>s+f.properties.lengthM,0)/1000)}};
}
