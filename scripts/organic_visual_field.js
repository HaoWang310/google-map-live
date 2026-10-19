/* London 2100 | shared, deterministic exhibition geometry.
   Pure visual displacement. No claim of physical tensor or hydrological precision.
   Advect both parameter-line families through ONE smooth velocity field so their
   crossings coincide; avoid independent random noise on each street. */
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const VORTICES=[
 [.20,.27, .95,.22],[.73,.24,-1.06,.24],
 [.49,.56, 1.16,.29],[.18,.81,-.84,.24],
 [.84,.79, .91,.26],[.66,.91,-.52,.23]
];
export function organicWarp(u,v,strength=1){
 let x=u,y=v;
 const power=clamp(Number(strength)||0,.25,1.8);
 // Time-stepped flow mapping keeps intersecting warped lines topologically
 // coherent. Do not jitter individual vertices or use uncorrelated noise.
 for(let k=0;k<15;k++){
  let vx=0,vy=0;
  for(const [cx,cy,rotation,radius] of VORTICES){
   const dx=x-cx,dy=y-cy,
    weight=Math.exp(-((dx*dx+dy*dy)/(radius*radius)));
   vx+=-dy*rotation*weight;
   vy+= dx*rotation*weight;
  }
  // Multiscale coherent curl, broad spatial bending and local variation.
  vx+=.082*Math.sin(TAU*(.71*x+.43*y))+
     .045*Math.cos(TAU*(1.31*y-.48*x));
  vy+=.072*Math.sin(TAU*(.56*x-.69*y))-
     .045*Math.cos(TAU*(1.07*x+.82*y));
  x+=(vx*power)/15;
  y+=(vy*power)/15;
 }
 return [x,y];
}
export function unevenLevels(count,phase=0){
 const n=Math.max(2,Math.floor(count)),weights=[];
 for(let i=0;i<n+1;i++){
  const t=(i+.5)/(n+1);
  weights.push(Math.max(.28,1+.32*Math.sin(TAU*(1.17*t+.31*phase))+
      .20*Math.sin(TAU*(3.17*t+.23*phase))+
      .12*Math.cos(TAU*(5.13*t+.17*phase))));
 }
 const total=weights.reduce((a,b)=>a+b,0);
 let cumulative=0;
 return weights.slice(0,n).map(w=>{cumulative+=w;return .018+.962*cumulative/total});
}
export function cubicBezier(a,b,c,d,t){
 const q=1-t;
 return [
   q*q*q*a[0]+3*q*q*t*b[0]+3*q*t*t*c[0]+t*t*t*d[0],
   q*q*q*a[1]+3*q*q*t*b[1]+3*q*t*t*c[1]+t*t*t*d[1]
 ];
}
export const ORGANIC_EXHIBITION_NOTE=
 'ARTISTIC PREVIEW — deterministic procedural road fabric, not flood-safe engineering roads';
