/* STEP05 local-road candidates grown along the STEP04-derived smoothed tensor.
   No rotated Voronoi hatch, fixed road templates or invented flow measurements. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export function growOrganicLocalRoads(domain,field,collectors,parameters={}){
 const {w,h}=domain,size=Math.min(w,h),n=w*h;
 const density=clamp(Number(parameters.roadDensity??88)/100,.05,1);
 const gap=Math.max(2.8,size/(8+12*density));
 const target=Math.min(210,Math.max(18,Math.round(domain.dryCells*(.018+.008*density))));
 const occupied=[new Uint8Array(n),new Uint8Array(n)],roads=[];
 const idx=p=>{const x=Math.floor(p[0]),y=Math.floor(p[1]);return x>=0&&y>=0&&x<w&&y<h?y*w+x:-1;};
 const safe=p=>{const i=idx(p);return i>=0&&domain.safe[i]&&field.at(...p)>=0;};
 function clear(a,b){
  const steps=Math.max(1,Math.ceil(dist(a,b)/.22));
  for(let k=0;k<=steps;k++)if(!safe(mix(a,b,k/steps)))return false;
  return true;
 }
 function trace(seed,secondary,sign){
  const first=field.read(...seed,secondary);if(!first)return [];
  let heading=[first[0]*sign,first[1]*sign],p=seed.slice();
  const path=[p],step=.52;
  for(let k=0;k<Math.min(450,Math.ceil(Math.hypot(w,h)*2.2/step));k++){
   const here=field.read(...p,secondary,heading);if(!here)break;
   const mid=[p[0]+here[0]*step*.5,p[1]+here[1]*step*.5];
   const dir=field.read(...mid,secondary,heading);if(!dir)break;
   const q=[p[0]+dir[0]*step,p[1]+dir[1]*step];
   if(!clear(p,q)||path.length>12&&dist(q,seed)<step*3)break;
   path.push(q);p=q;heading=dir;
  }
  return path;
 }
 // Nearest physical collector centreline, not a line drawn on the screen.
 const segments=[];
 for(const line of collectors||[])for(let k=1;k<line.length;k++){
  const a=line[k-1],b=line[k],vx=b[0]-a[0],vy=b[1]-a[1],den=vx*vx+vy*vy;
  if(den>1e-8)segments.push({a,vx,vy,den});
 }
 function snap(p){
  let best=null,md=Infinity;
  for(const e of segments){
   const t=clamp(((p[0]-e.a[0])*e.vx+(p[1]-e.a[1])*e.vy)/e.den,0,1);
   const q=[e.a[0]+t*e.vx,e.a[1]+t*e.vy],d=dist(p,q);
   if(d<md){best=q;md=d;}
  }
  return md<gap*1.8&&best&&clear(p,best)?best:null;
 }
 const seeds=[];
 for(let y=gap*.5;y<h;y+=gap)for(let x=gap*.5;x<w;x+=gap){
  const hash=Math.sin(x*12.9898+y*78.233)*43758.5453;
  const jitter=(hash-Math.floor(hash)-.5)*gap*.24;
  const p=[clamp(x+jitter,1,w-1),clamp(y-jitter*.4,1,h-1)];
  if(safe(p))seeds.push(p);
 }
 const score=p=>{const i=idx(p);
  return i<0?0:(Math.max(.02,domain.certainty[i]||0)*(1-.65*Math.min(1,domain.depth[i]/.15)));
 };
 // Use a tile-first spatial ordering; never exhaust the budget in one corner.
 seeds.sort((a,b)=>score(b)-score(a)||a[1]-b[1]||a[0]-b[0]);
 let rejectedUnsafe=0,rejectedDisconnected=0,rejectedShort=0;
 for(const seed of seeds){
  if(roads.length>=target)break;
  for(const family of [0,1]){
   if(roads.length>=target)break;
   const i=idx(seed);if(i<0||occupied[family][i])continue;
   const back=trace(seed,family===1,-1),forward=trace(seed,family===1,1);
   if(back.length+forward.length<16){rejectedShort++;continue;}
   const path=back.slice(1).reverse().concat(forward);
   const first=snap(path[0]),last=snap(path.at(-1));
   if(!first&&!last){rejectedDisconnected++;continue;}
   if(first)path.unshift(first);
   if(last)path.push(last);
   if(path.length<10){rejectedShort++;continue;}
   if(!path.every((p,k)=>safe(p)&&(!k||clear(p,path[k-1])))){
    rejectedUnsafe++;continue;
   }
   roads.push({kind:'local',points:path,source:'smoothed-source-tensor',family});
   const radius=Math.max(1,Math.floor(gap*.52));
   for(let k=0;k<path.length;k+=Math.max(1,Math.floor(gap/.52))){
    const p=path[k];
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){
     if(ox*ox+oy*oy>radius*radius)continue;
     const cell=idx([p[0]+ox,p[1]+oy]);if(cell>=0)occupied[family][cell]=1;
    }
   }
  }
 }
 return {roads,diagnostics:{seeds:seeds.length,target,accepted:roads.length,
  rejectedUnsafe,rejectedDisconnected,rejectedShort,method:'RK2-like bidirectional tensor integration with collector snapping'}};
}
