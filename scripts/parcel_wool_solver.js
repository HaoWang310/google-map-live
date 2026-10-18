/* STEP 05 wool physics: elastic fibres on a REAL accessible raster.
   No random polylines. Endpoints remain fixed; collisions are checked. */
import {length} from './parcel_road_constraints.js';
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
export function optimiseWool(skeleton,domain,parameters={},progress=()=>{}){
 const strength=clamp(Number(parameters.woolStrength??70)/100,0,1),
   alignment=clamp(Number(parameters.tensorAlignment??75)/100,0,1),
   bundle=clamp(Number(parameters.bundleStrength??60)/100,0,1),
   smooth=clamp(Number(parameters.curvatureSmoothing??75)/100,0,1),
   branch=clamp(Number(parameters.branchingStrength??60)/100,0,1);
 const step=clamp(domain.cell*.95,domain.cell*.65,domain.cell*1.6);
 const roads=skeleton.roads.map((r,k)=>({
  ...r,id:'ROAD-'+String(k+1).padStart(4,'0'),
  points:resample(r.points,step)
 }));
 // Endpoint graph vertices are fixed; all fibre relaxation is interior-only.
 const rounds=Math.max(0,Math.round(strength*15));
 const proximity=domain.cell*(2.0+bundle*1.8);
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
    const p=a[j],prev=a[j-1],post=a[j+1];
    const mid=[(prev[0]+post[0])*.5,(prev[1]+post[1])*.5];
    // Elastic bending: fibre tension straightens micro-kinks while
    // tensor alignment and barriers preserve longer-scale organic motion.
    let target=mix(p,mid,.11+.36*smooth);
    const i=domain.cellAt(p);
    if(i>=0&&domain.safe[i]){
     const ux=domain.ax[i],uy=domain.ay[i];
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
       if(roads[other.k].kind!==road.kind&&road.kind==='main')continue;
       const d=length(p,other.p);
       if(d<domain.cell*.7||d>proximity)continue;
       const w=(1-d/proximity)**2;
       wx+=other.p[0]*w;wy+=other.p[1]*w;wSum+=w;
      }
     }
     if(wSum>0){
      const centroid=[wx/wSum,wy/wSum];
      target=mix(target,centroid,Math.min(.12,bundle*.09));
     }
    }
    const taper=Math.min(1,j/4,(a.length-1-j)/4);
    // Slow branching increases curvature transition length near junctions.
    const pull=taper*(.3+.45*strength)*(.65+.35*branch);
    const candidate=mix(p,target,pull);
    if(safePoint(domain,candidate)&&safeSegment(domain,prev,candidate)&&
       safeSegment(domain,candidate,post))next[j]=candidate;
   }
   road.points=next;
  }
  if(pass%3===2)progress(.68+.18*(pass+1)/Math.max(1,rounds),
    'Wool 弹性松弛 '+(pass+1)+'/'+rounds);
 }
 // Curve sampling remains dense, preserving narrow valid corridors.
 for(const road of roads){
  let count=0;
  for(let i=1;i<road.points.length;i++){
   if(!safeSegment(domain,road.points[i-1],road.points[i]))
    throw Error('Wool 路径碰撞验证失败；已禁止穿越不可建设或深水区域');
   count+=length(road.points[i-1],road.points[i])*domain.scale;
  }
  road.lengthM=count;
 }
 return {roads,stats:{iterations:rounds,optimizedRoads:roads.length,
  totalLengthM:roads.reduce((sum,r)=>sum+r.lengthM,0),
  formula:'elastic tension + principal-axis correction + fibre bundle attraction; flood collision projection'}};
}
