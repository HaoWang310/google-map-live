/* STEP04 Presentation: one globally deformed parametric lattice.
   U and V are sampled through the SAME bilinear F(u,v). No local seed
   tracing, Voronoi templates, invented vortex centres or hydrology writes.
   The 2D line field is not guaranteed to admit an exact smooth isometry:
   quantify orientation residual and suppress folds instead of fabricating it. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hypot=Math.hypot;
const tau=Math.PI*2;
export function buildGlobalWarpedWeave(field,{density=.7,dx=1,dy=1,direction='dual'}={}){
 const {w,h,at}=field;
 const n=w*h;
 if(w<2||h<2||!field?.c||!field?.s)throw Error('STEP04 global mapping requires source-derived smooth tensor');
 // The extended canonical sheet covers every portion of the selected parcel,
 // even after the elastic mapping changes its orientation.
 const padding=Math.max(5,Math.ceil(Math.hypot(w,h)*.23));
 const xMin=-padding,yMin=-padding,xRange=w+padding*2,yRange=h+padding*2;
 const pitch=Math.max(1,Math.max(xRange,yRange)/125);
 const nx=Math.max(12,Math.ceil(xRange/pitch)),ny=Math.max(12,Math.ceil(yRange/pitch));
 const sx=xRange/nx,sy=yRange/ny,N=(nx+1)*(ny+1);
 const vx=new Float64Array(N),vy=new Float64Array(N),active=new Uint8Array(N);
 const fIndex=(x,y)=>y*(nx+1)+x, coords=i=>[xMin+(i%(nx+1))*sx,yMin+Math.floor(i/(nx+1))*sy];
 let meanC=0,meanS=0,sourceSamples=0;
 for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
  const k=fIndex(i,j),x=xMin+i*sx,y=yMin+j*sy;
  // Source raster represents cell centre at x+.5,y+.5.
  const xx=Math.floor(x),yy=Math.floor(y),id=xx>=0&&yy>=0&&xx<w&&yy<h?yy*w+xx:-1;
  if(id>=0&&at(x,y)>=0){
   const cc=field.c[id],ss=field.s[id],mag=hypot(cc,ss);
   if(mag>.04){
    vx[k]=cc/mag;vy[k]=ss/mag;active[k]=1;
    meanC+=vx[k];meanS+=vy[k];sourceSamples++;
   }
  }
 }
 if(sourceSamples<8)throw Error('STEP04 Presentation lacks enough real tensor directions for global mapping');
 const meanTheta=.5*Math.atan2(meanS,meanC);
 // Extend measured doubled-angle axes beyond parcel edges by shortest raster
 // distance, solely to give the common global sheet consistent boundary data.
 // These extensions are NEVER interpreted as measurements or drawn off-site.
 const nearest=new Int32Array(N).fill(-1),queue=new Int32Array(N);
 let head=0,tail=0;
 for(let i=0;i<N;i++)if(active[i]){nearest[i]=i;queue[tail++]=i;}
 while(head<tail){
  const id=queue[head++],x=id%(nx+1),y=Math.floor(id/(nx+1));
  const neighbors=[x>0?id-1:-1,x<nx?id+1:-1,y>0?id-(nx+1):-1,y<ny?id+(nx+1):-1];
  for(const j of neighbors)if(j>=0&&nearest[j]<0){nearest[j]=nearest[id];queue[tail++]=j;}
 }
 for(let i=0;i<N;i++)if(!active[i]&&nearest[i]>=0){
  vx[i]=vx[nearest[i]];vy[i]=vy[nearest[i]];
 }
 // Relax orientation outside known data to the measured mean; all sampled
 // interior axes remain unchanged. This avoids abrupt extrapolation seams.
 const exC=new Float64Array(vx),exS=new Float64Array(vy);
 for(let pass=0;pass<8;pass++){
  for(let y=1;y<ny;y++)for(let x=1;x<nx;x++){
   const i=fIndex(x,y);
   if(active[i])continue;
   exC[i]=(exC[i]*2+vx[i-1]+vx[i+1]+vx[i-(nx+1)]+vx[i+(nx+1)])/6;
   exS[i]=(exS[i]*2+vy[i-1]+vy[i+1]+vy[i-(nx+1)]+vy[i+(nx+1)])/6;
  }
  for(let i=0;i<N;i++)if(!active[i]){
   const m=hypot(exC[i],exS[i]);
   if(m>.001){vx[i]=exC[i]/m;vy[i]=exS[i]/m;}
  }
 }
 // Unwrap unoriented eigenvectors continuously across the same lattice.
 const ux=new Float64Array(N),uy=new Float64Array(N);
 const seen=new Uint8Array(N),walk=new Int32Array(N);
 head=0;tail=0;
 let root=0,best=Infinity;
 for(let i=0;i<N;i++)if(active[i]){
  const [x,y]=coords(i),d=hypot(x-w*.5,y-h*.5);
  if(d<best){best=d;root=i;}
 }
 function orient(i,parent){
  const a=.5*Math.atan2(vy[i],vx[i]);let x=Math.cos(a),y=Math.sin(a);
  const refX=parent>=0?ux[parent]:Math.cos(meanTheta),refY=parent>=0?uy[parent]:Math.sin(meanTheta);
  if(x*refX+y*refY<0){x=-x;y=-y;}
  ux[i]=x;uy[i]=y;seen[i]=1;walk[tail++]=i;
 }
 orient(root,-1);
 let frustration=0,edgesChecked=0;
 while(head<tail){
  const id=walk[head++],x=id%(nx+1),y=Math.floor(id/(nx+1));
  for(const p of [x>0?id-1:-1,x<nx?id+1:-1,y>0?id-(nx+1):-1,y<ny?id+(nx+1):-1]){
   if(p<0)continue;
   if(!seen[p])orient(p,id);
   else{
    const dot=ux[id]*ux[p]+uy[id]*uy[p];
    if(dot<-.1)frustration++;
    edgesChecked++;
   }
  }
 }
 // A single global deformation minimizes mismatch to the unoriented field
 // while anchoring the grid near its starting position. It is the same
 // least-squares elastic map for both U and V families.
 const baseX=new Float64Array(N),baseY=new Float64Array(N),
  fx=new Float64Array(N),fy=new Float64Array(N);
 const baseAngle=clamp(meanTheta,-.75,.75)*.55;
 const co=Math.cos(baseAngle),si=Math.sin(baseAngle),centerX=w*.5,centerY=h*.5;
 for(let i=0;i<N;i++){
  const [x,y]=coords(i),a=x-centerX,b=y-centerY;
  baseX[i]=centerX+a*co-b*si;
  baseY[i]=centerY+a*si+b*co;
  fx[i]=baseX[i];fy[i]=baseY[i];
 }
 // Iterative Poisson reconstruction of a curl-inconsistent target Jacobian:
 // X(right)-X(left) ≈ spacing * principal direction,
 // X(down)-X(up) ≈ spacing * orthogonal direction.
 const passes=205,tether=.001;
 const nextX=new Float64Array(N),nextY=new Float64Array(N);
 const stride=nx+1;
 for(let pass=0;pass<passes;pass++){
  // Gauss-Seidel on interior; regularizing to the shared global sheet avoids
  // arbitrary offsets and one-cell vortices.
  for(let y=1;y<ny;y++)for(let x=1;x<nx;x++){
   const i=y*stride+x,L=i-1,R=i+1,U=i-stride,D=i+stride;
   const hxL=(ux[L]+ux[i])*.5*sx,hxR=(ux[i]+ux[R])*.5*sx;
   const hyL=(uy[L]+uy[i])*.5*sx,hyR=(uy[i]+uy[R])*.5*sx;
   const jxU=-(uy[U]+uy[i])*.5*sy,jxD=-(uy[i]+uy[D])*.5*sy;
   const jyU=(ux[U]+ux[i])*.5*sy,jyD=(ux[i]+ux[D])*.5*sy;
   const t=tether*(active[i]?1:2.3);
   nextX[i]=(fx[L]+hxL+fx[R]-hxR+fx[U]+jxU+fx[D]-jxD+t*baseX[i])/(4+t);
   nextY[i]=(fy[L]+hyL+fy[R]-hyR+fy[U]+jyU+fy[D]-jyD+t*baseY[i])/(4+t);
  }
  // Preserve free but affine-consistent edge vertices; their values also
  // come from the SAME shared map.
  for(let x=0;x<=nx;x++)for(const y of [0,ny]){
   const i=fIndex(x,y);nextX[i]=baseX[i];nextY[i]=baseY[i];
  }
  for(let y=0;y<=ny;y++)for(const x of [0,nx]){
   const i=fIndex(x,y);nextX[i]=baseX[i];nextY[i]=baseY[i];
  }
  fx.set(nextX);fy.set(nextY);
 }
 function minDeterminant(t){
  let lowest=Infinity,flipped=0;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const a=fIndex(i,j),b=a+1,d=a+stride,e=d+1;
   // Test Jacobian at all 4 corners of each bilinear cell.
   for(const [rx,ry] of [[0,0],[1,0],[0,1],[1,1]]){
    const dxA=(1-ry)*(baseX[b]-baseX[a])+ry*(baseX[e]-baseX[d]);
    const dyA=(1-ry)*(baseY[b]-baseY[a])+ry*(baseY[e]-baseY[d]);
    const dxB=(1-ry)*(fx[b]-fx[a])+ry*(fx[e]-fx[d]);
    const dyB=(1-ry)*(fy[b]-fy[a])+ry*(fy[e]-fy[d]);
    const exA=(1-rx)*(baseX[d]-baseX[a])+rx*(baseX[e]-baseX[b]);
    const eyA=(1-rx)*(baseY[d]-baseY[a])+rx*(baseY[e]-baseY[b]);
    const exB=(1-rx)*(fx[d]-fx[a])+rx*(fx[e]-fx[b]);
    const eyB=(1-rx)*(fy[d]-fy[a])+rx*(fy[e]-fy[b]);
    const vx0=dxA*(1-t)+dxB*t,vy0=dyA*(1-t)+dyB*t;
    const wx0=exA*(1-t)+exB*t,wy0=eyA*(1-t)+eyB*t;
    const det=(vx0*wy0-vy0*wx0)/(sx*sy);
    lowest=Math.min(lowest,det);if(det<=.2)flipped++;
   }
  }
  return {minimum:lowest,invalid:flipped};
 }
 // Maximise coherent field-driven deformation without crossing the
 // .30 Jacobian safety margin. Binary search avoids arbitrary 30% jumps
 // that made some real parcels unnecessarily rigid.
 let low=0,high=4.8,folds=minDeterminant(high);
 for(let iter=0;iter<11;iter++){
  const mid=(low+high)*.5,d=minDeterminant(mid);
  if(d.invalid||d.minimum<.30)high=mid;
  else low=mid;
 }
 let strength=low*.985;folds=minDeterminant(strength);
 if(folds.invalid){strength=0;folds=minDeterminant(0);}
 for(let i=0;i<N;i++){
  fx[i]=baseX[i]+strength*(fx[i]-baseX[i]);
  fy[i]=baseY[i]+strength*(fy[i]-baseY[i]);
 }
 function map(x,y){
  const gx=clamp((x-xMin)/sx,0,nx-1e-7),gy=clamp((y-yMin)/sy,0,ny-1e-7);
  const i=Math.floor(gx),j=Math.floor(gy),tx=gx-i,ty=gy-j,
    a=fIndex(i,j),b=a+1,d=a+stride,e=d+1;
  const v=(array)=>(1-ty)*((1-tx)*array[a]+tx*array[b])+ty*((1-tx)*array[d]+tx*array[e]);
  return [v(fx),v(fy)];
 }
 const valid=p=>at(p[0],p[1])>=0;
 const smoothDensity=clamp(density,0,1);
 const gap=Math.max(.9,Math.min(w,h)/(24+58*smoothDensity));
 const sampleStep=Math.min(.45,Math.min(sx,sy)*.38,gap*.32);
 const familyLimit=115000;
 const lines=[],counts={primary:0,secondary:0};
 let pointsBudget=0,segmentsRejected=0;
 function addRun(run,branch){
  if(run.length<8){if(run.length)segmentsRejected++;return;}
  const start=run[0],last=run.at(-1);
  const physical=hypot((last.x-start.x)*dx,(last.y-start.y)*dy);
  if(physical<Math.min(dx,dy)*.9){segmentsRejected++;return;}
  let lengthM=0,wetSum=0;
  for(let i=1;i<run.length;i++)lengthM+=hypot((run[i].x-run[i-1].x)*dx,(run[i].y-run[i-1].y)*dy);
  for(const p of run){const i=at(p.x,p.y);wetSum+=i<0?0:field.water?.[i]||0;}
  lines.push({branch,kind:'field',path:run,lengthM,rank:.55,
    wetSupport:wetSum/run.length,visualizationOnly:true,sharedGlobalWarp:true});
  counts[branch]++;pointsBudget+=run.length;
 }
 // Uniform U / V isocurves sample the SAME F, so their crossings coincide.
 const branchList=direction==='primary'?['primary']:direction==='secondary'?['secondary']:['primary','secondary'];
 // Every U/V intersection is sampled explicitly as a common vertex,
 // not merely approximated by two independent drawing polylines.
 const levels=(min,max)=>{
  const out=[];const start=Math.ceil(min/gap);
  for(let i=start; i*gap<=max+1e-8; i++)out.push(i*gap);
  return out;
 };
 const levelsX=levels(xMin,xMin+xRange),levelsY=levels(yMin,yMin+yRange);
 function parameters(min,max,levelList){
  const cuts=[min,...levelList.filter(v=>v>min+1e-8&&v<max-1e-8),max];
  const values=[];
  for(let i=1;i<cuts.length;i++){
   const a=cuts[i-1],b=cuts[i],steps=Math.max(1,Math.ceil((b-a)/sampleStep));
   for(let k=0;k<steps;k++)values.push(a+(b-a)*k/steps);
  }
  values.push(max);return values;
 }
 const sampleX=parameters(xMin,xMin+xRange,levelsX);
 const sampleY=parameters(yMin,yMin+yRange,levelsY);
 for(const branch of branchList){
  const familyStart=pointsBudget,isU=branch==='primary';
  const constants=isU?levelsY:levelsX,variables=isU?sampleX:sampleY;
  for(const constant of constants){
   let run=[],last=null;
   for(const variable of variables){
    const pos=isU?map(variable,constant):map(constant,variable);
    const p={x:pos[0],y:pos[1]};
    const ok=valid(pos);
    // A full site-wide lattice may pass outside the selected parcel or into
    // truly masked obstacles. Such gaps are clipped, NEVER filled with
    // invented direction or passed off as additional roads.
    if(!ok){addRun(run,branch);run=[];last=null;continue;}
    if(last){
     const steps=Math.max(1,Math.ceil(hypot(p.x-last.x,p.y-last.y)/.30));
     let blocked=false;
     for(let k=1;k<steps;k++){
      const mid=[last.x+(p.x-last.x)*k/steps,last.y+(p.y-last.y)*k/steps];
      if(!valid(mid)){blocked=true;break;}
     }
     if(blocked){addRun(run,branch);run=[];}
    }
    run.push(p);last=p;
   }
   addRun(run,branch);
   if(pointsBudget-familyStart>=familyLimit)break;
  }
 }
 // Residual estimates the angular difference, not a claim that an arbitrary
 // non-integrable line field can be represented exactly by one diffeomorphism.
 let sumAngle=0,angleSamples=0,largestAngle=0,intersections=0,maxCrossingError=0;
 for(let j=4;j<ny-4;j+=3)for(let i=4;i<nx-4;i+=3){
  const x=xMin+i*sx,y=yMin+j*sy,p=map(x,y);
  if(!valid(p))continue;
  const ex=map(x+sx*.2,y),ey=map(x,y+sy*.2);
  const a=[ex[0]-p[0],ex[1]-p[1]],b=[ey[0]-p[0],ey[1]-p[1]];
  const angleField=field.read(p[0],p[1],false);
  if(angleField){
   const error=Math.acos(clamp(Math.abs((a[0]*angleField[0]+a[1]*angleField[1])/Math.max(1e-6,hypot(...a))),0,1))*180/Math.PI;
   sumAngle+=error;largestAngle=Math.max(largestAngle,error);angleSamples++;
  }
  // One bilinear map owns both families: identical parametric intersection
  // coordinates, by construction (no separately-integrated crossing offset).
  const check=map(x,y);maxCrossingError=Math.max(maxCrossingError,hypot(p[0]-check[0],p[1]-check[1]));intersections++;
 }
 const lengths=lines.map(l=>l.lengthM).sort((a,b)=>a-b);
 const perBranch={};
 for(const branch of branchList){
  const branchLines=lines.filter(l=>l.branch===branch),lens=branchLines.map(l=>l.lengthM).sort((a,b)=>a-b);
  const totalLengthM=lens.reduce((a,b)=>a+b,0);
  perBranch[branch]={candidateSeeds:0,integrationAttempts:0,integrationSucceeded:branchLines.length,
   finalLines:branchLines.length,totalLengthM,meanLengthM:totalLengthM/Math.max(1,lens.length),
   medianLengthM:lens[Math.floor(lens.length/2)]||0,
   stopReasons:{},visualizationOnly:true,geometryMethod:'single-shared-global-bilinear-mapping'};
 }
 return {lines,gap,diagnostics:perBranch,
  globalMapping:{
   schema:'site-derived-shared-parametric-grid-v1',solver:'regularized-Jacobian Poisson / global bilinear map',
   sourceDirectionSamples:sourceSamples,orientationMeanRadians:meanTheta,orientationMeanResidualDeg:sumAngle/Math.max(1,angleSamples),
   maxOrientationResidualDeg:largestAngle,orientationSamples:angleSamples,
   singularityConflictEdges:frustration,checkedOrientationEdges:edgesChecked,
   warpStrength:strength,minimumJacobian:folds.minimum,foldedCells:folds.invalid,
   crossingSamples:intersections,maxCrossingError,gridNodes:N,
   outputLines:lines.length,outputVertices:pointsBudget,rejectedShortPieces:segmentsRejected,
   interpretation:'conceptual common-surface visualization, not measured flow/road geometry'
  }};
}
