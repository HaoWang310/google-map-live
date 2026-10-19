/* Display-only coarse graining of the CURRENT parcel tensor. No synthetic
   vortex centres, global curve templates, or writes to hydrology inputs. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function smoothSiteField({w,h,mask,ax,ay,wet},amount=.8){
 const n=w*h,rawC=new Float32Array(n),rawS=new Float32Array(n),weight=new Float32Array(n);
 let c=new Float32Array(n),s=new Float32Array(n),water=new Float32Array(n);
 for(let i=0;i<n;i++)if(mask[i]){
  const x=ax?.[i]||0,y=ay?.[i]||0,d=x*x+y*y;
  if(d>.01){weight[i]=1;rawC[i]=c[i]=(x*x-y*y)/d;rawS[i]=s[i]=2*x*y/d;}
  water[i]=clamp(wet?.[i]||0,0,1);
 }
 // Doubled angles respect the u == -u symmetry. Repeated diffusion removes
 // cell-scale singularities, retaining a weak source anchor at every cell.
 const passes=Math.round(14+46*amount),anchor=.008+.024*(1-amount);
 let nc=new Float32Array(n),ns=new Float32Array(n),nw=new Float32Array(n);
 for(let pass=0;pass<passes;pass++){
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x;if(!mask[i])continue;
   let cc=c[i]*2,ss=s[i]*2,ww=water[i]*2,total=2;
   for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
    if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const j=yy*w+xx;if(!mask[j])continue;
    cc+=c[j];ss+=s[j];ww+=water[j];total++;
   }
   nc[i]=(1-anchor)*cc/total+anchor*rawC[i];
   ns[i]=(1-anchor)*ss/total+anchor*rawS[i];nw[i]=ww/total;
  }
  [c,nc]=[nc,c];[s,ns]=[ns,s];[water,nw]=[nw,water];
 }
 const at=(x,y)=>{const xx=Math.floor(x),yy=Math.floor(y);
  return xx>=0&&yy>=0&&xx<w&&yy<h&&mask[yy*w+xx]?yy*w+xx:-1;};
 function read(x,y,secondary=false,previous=null){
  if(at(x,y)<0)return null;
  const bx=Math.floor(x-.5),by=Math.floor(y-.5),fx=x-.5-bx,fy=y-.5-by;
  let cc=0,ss=0,ww=0,total=0;
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
   const j=at(bx+ox+.5,by+oy+.5);if(j<0)continue;
   const t=(ox?fx:1-fx)*(oy?fy:1-fy);cc+=c[j]*t;ss+=s[j]*t;ww+=water[j]*t;total+=t;
  }
  if(total<.001||Math.hypot(cc,ss)<.015*total)return null;
  const theta=.5*Math.atan2(ss,cc)+(secondary?Math.PI/2:0);
  let ux=Math.cos(theta),uy=Math.sin(theta);
  if(previous&&ux*previous[0]+uy*previous[1]<0){ux=-ux;uy=-uy;}
  return [ux,uy,ww/total];
 }
 return {w,h,mask,c,s,water,at,read,passes};
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
