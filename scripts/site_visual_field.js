/* Confidence-aware smoothing of the SAME computed unoriented tensor axes.
   Coordinates are raster x/east, y/south; no new hydrological axes are invented.
   This module is shared by STEP04 display and STEP05 road direction guidance. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function smoothSiteField({w,h,mask,ax,ay,wet,confidence,anisotropy,obstacle},amount=.8){
 const n=w*h,active=new Uint8Array(n),rawC=new Float32Array(n),rawS=new Float32Array(n);
 const reliability=new Float32Array(n),water0=new Float32Array(n);
 let c=new Float32Array(n),s=new Float32Array(n),water=new Float32Array(n);
 for(let i=0;i<n;i++){
  if(!mask?.[i]||obstacle?.[i])continue;
  active[i]=1;water0[i]=water[i]=clamp(Number(wet?.[i]||0),0,1);
  const x=Number(ax?.[i]||0),y=Number(ay?.[i]||0),d=x*x+y*y;
  if(d<.0625)continue;
  rawC[i]=c[i]=(x*x-y*y)/d;rawS[i]=s[i]=2*x*y/d;
  const evidence=confidence?clamp(Number(confidence[i]||0),0,1):1;
  const directional=anisotropy?clamp(Number(anisotropy[i]||0),0,1):1;
  reliability[i]=Math.max(.025,evidence)*(.2+.8*directional);
 }
 // Doubled angles treat u and -u as equivalent. A weighted bilateral
 // diffusion maintains authentic turns and wetness boundaries without
 // blending axes through invalid cells or obstacles.
 const passes=Math.round(8+25*clamp(amount,0,1)),anchor=.11+.26*(1-amount);
 let nc=new Float32Array(n),ns=new Float32Array(n),nw=new Float32Array(n);
 for(let pass=0;pass<passes;pass++){
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x;if(!active[i])continue;
   const localAnchor=anchor+Math.min(.33,reliability[i]*.36);
   let cc=c[i]*(1.3+reliability[i]),ss=s[i]*(1.3+reliability[i]);
   let ww=water[i]*2,total=1.3+reliability[i],wetTotal=2;
   for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
    if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const j=yy*w+xx;if(!active[j])continue;
    const dot=clamp(c[i]*c[j]+s[i]*s[j],-1,1);
    const agreement=.2+.8*Math.sqrt(Math.max(0,(1+dot)*.5));
    const wetBarrier=1-.82*Math.min(1,Math.abs(water0[i]-water0[j])*2);
    const wt=(.15+.85*reliability[j])*agreement*wetBarrier;
    cc+=c[j]*wt;ss+=s[j]*wt;total+=wt;
    ww+=water[j];wetTotal++;
   }
   const smC=cc/Math.max(1e-8,total),smS=ss/Math.max(1e-8,total);
   nc[i]=smC*(1-localAnchor)+rawC[i]*localAnchor;
   ns[i]=smS*(1-localAnchor)+rawS[i]*localAnchor;
   nw[i]=ww/wetTotal;
  }
  [c,nc]=[nc,c];[s,ns]=[ns,s];[water,nw]=[nw,water];
 }
 const at=(x,y)=>{
  const xx=Math.floor(x),yy=Math.floor(y);
  return xx>=0&&yy>=0&&xx<w&&yy<h&&active[yy*w+xx]?yy*w+xx:-1;
 };
 function read(x,y,secondary=false,previous=null){
  if(at(x,y)<0)return null;
  const bx=Math.floor(x-.5),by=Math.floor(y-.5),fx=x-.5-bx,fy=y-.5-by;
  let cc=0,ss=0,ww=0,total=0;
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
   const xx=bx+ox,yy=by+oy,j=at(xx+.5,yy+.5);
   if(j<0)continue;
   // A diagonal interpolation must not jump over a masked corner.
   if(ox!==oy&&at(x,yy+.5)<0&&at(xx+.5,y)<0)continue;
   const t=(ox?fx:1-fx)*(oy?fy:1-fy);
   if(t<=0)continue;
   cc+=c[j]*t;ss+=s[j]*t;ww+=water[j]*t;total+=t;
  }
  if(total<.001||Math.hypot(cc,ss)<.055*total)return null;
  const theta=.5*Math.atan2(ss,cc)+(secondary?Math.PI/2:0);
  let ux=Math.cos(theta),uy=Math.sin(theta);
  if(previous&&ux*previous[0]+uy*previous[1]<0){ux=-ux;uy=-uy;}
  return [ux,uy,ww/total];
 }
 const smoothPrimaryX=new Float32Array(n),smoothPrimaryY=new Float32Array(n);
 const smoothedValidMask=new Uint8Array(n);
 let supported=0,angleSum=0,angleMax=0;
 for(let i=0;i<n;i++)if(active[i]&&Math.hypot(c[i],s[i])>.055){
  const angle=.5*Math.atan2(s[i],c[i]);
  smoothPrimaryX[i]=Math.cos(angle);smoothPrimaryY[i]=Math.sin(angle);
  smoothedValidMask[i]=1;
  if(reliability[i]>.02){
   const u=Math.atan2(rawS[i],rawC[i]),v=Math.atan2(s[i],c[i]);
   const e=.5*Math.abs(Math.atan2(Math.sin(u-v),Math.cos(u-v)))*180/Math.PI;
   angleSum+=e;angleMax=Math.max(angleMax,e);supported++;
  }
 }
 return {w,h,mask:smoothedValidMask,c,s,water,at,read,passes,
  smoothPrimaryX,smoothPrimaryY,confidence:reliability,validMask:smoothedValidMask,
  diagnostics:{sourceValid:active.reduce((a,v)=>a+v,0),smoothedValid:smoothedValidMask.reduce((a,v)=>a+v,0),
   meanAngleErrorDeg:angleSum/Math.max(1,supported),maxAngleErrorDeg:angleMax,
   source:'same computed doubled-angle hydrological tensor; visualization smoothing only'}};
}
export function traceSiteWeave(field,{density=.8,dx=1,dy=1,direction='dual'}={}){
 const {w,h,at,read}=field,lines=[];
 // Stable geographic placement: camera/zoom never affects seed coordinates.
 const gap=Math.max(.65,Math.min(w,h)/(22+42*density));
 const step=Math.min(.42,gap*.42),metric=Math.min(dx,dy);
 const families=direction==='dual'?['primary','secondary']:[direction];
 const diagnostics={};
 for(const branch of families){
  const secondary=branch==='secondary',bins=new Map();
  const key=(x,y)=>Math.floor(x/gap)+','+Math.floor(y/gap);
  function near(x,y,r){
   const bx=Math.floor(x/gap),by=Math.floor(y/gap);
   for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)
    for(const p of bins.get((bx+ox)+','+(by+oy))||[])
     if(Math.hypot(x-p[0],y-p[1])<r)return true;
   return false;
  }
  function trace(seed,sign){
   const points=[],seen=new Map();let p=seed.slice(),prev=null;
   for(let k=0;k<Math.ceil(Math.hypot(w,h)*4/step);k++){
    const a=read(...p,secondary,prev);if(!a)break;
    const b=read(p[0]+sign*a[0]*step*metric/dx/2,p[1]+sign*a[1]*step*metric/dy/2,secondary,a);
    if(!b)break;
    const q=[p[0]+sign*b[0]*step*metric/dx,p[1]+sign*b[1]*step*metric/dy];
    // Check midpoint and end; never bridge a hole or isolated grid component.
    if(at(...q)<0||at((p[0]+q[0])/2,(p[1]+q[1])/2)<0||near(...q,gap*.70))break;
    const cell=key(...q),last=seen.get(cell);
    if(last!==undefined&&k-last>Math.ceil(6*gap/step))break;
    if(last===undefined)seen.set(cell,k);
    points.push({x:q[0],y:q[1],rank:b[2],water:b[2],confidence:1});p=q;prev=b;
   }
   return points;
  }
  // Seed interior first, then fill remaining uncovered strips in a second pass.
  const seeds=[];
  for(let y=gap*.5;y<h;y+=gap*.86)for(let x=gap*.5;x<w;x+=gap*.86)
   if(at(x,y)>=0)seeds.push([x,y]);
  seeds.sort((a,b)=>{
   const edge=p=>Math.min(p[0],p[1],w-p[0],h-p[1]);return edge(b)-edge(a);
  });
  let attempts=0;
  for(const seed of seeds){
   if(near(...seed,gap*.95)||!read(...seed,secondary))continue;
   attempts++;
   const back=trace(seed,-1),forward=trace(seed,1);
   const path=[...back.reverse(),{x:seed[0],y:seed[1],confidence:1,rank:0,water:0},...forward];
   if(path.length<8)continue;
   let lengthM=0;for(let k=1;k<path.length;k++)lengthM+=Math.hypot((path[k].x-path[k-1].x)*dx,(path[k].y-path[k-1].y)*dy);
   if(lengthM<gap*metric*3)continue;
   for(const p of path){const id=key(p.x,p.y);if(!bins.has(id))bins.set(id,[]);bins.get(id).push([p.x,p.y]);}
   lines.push({branch,kind:'field',path,lengthM,rank:.55,wetSupport:path.reduce((a,p)=>a+(p.water||0),0)/path.length,visualizationOnly:true});
   if(lines.reduce((a,l)=>a+l.path.length,0)>130000)break;
  }
  const lengths=lines.filter(l=>l.branch===branch).map(l=>l.lengthM).sort((a,b)=>a-b),sum=lengths.reduce((a,b)=>a+b,0);
  diagnostics[branch]={candidateSeeds:seeds.length,integrationAttempts:attempts,integrationSucceeded:lengths.length,finalLines:lengths.length,totalLengthM:sum,meanLengthM:sum/Math.max(1,lengths.length),medianLengthM:lengths[Math.floor(lengths.length/2)]||0,visualizationOnly:true,stopReasons:{}};
 }
 return {lines,diagnostics,gap};
}
