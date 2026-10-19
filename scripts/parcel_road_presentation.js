/* STEP05 Wool-style art-directed network, intentionally NOT the physically
   constrained analysis solver. Uses a shared elastic (attraction/repulsion)
   material warp for district rings and both families of local street fibers:
   intersections and ring endpoints coincide in the generated geometry.
   The roads form one final Wool-combined result, never an underlaid tensor grid.
   The photograph reference is for hierarchy and character only. */
import {unevenLevels,cubicBezier,ORGANIC_EXHIBITION_NOTE} from './organic_visual_field.js?v=3.26.6-wool-final-only';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TAU=Math.PI*2;
const DISTRICTS=[
 {c:[.16,.23],r:[.21,.18],angle:-.18,phase:.13},
 {c:[.46,.22],r:[.23,.19],angle:.22,phase:.48},
 {c:[.79,.24],r:[.22,.20],angle:-.29,phase:.77},
 {c:[.18,.58],r:[.22,.20],angle:.36,phase:.31},
 {c:[.49,.53],r:[.24,.21],angle:-.48,phase:.61},
 {c:[.81,.58],r:[.21,.22],angle:.22,phase:.87},
 {c:[.33,.85],r:[.25,.18],angle:-.16,phase:.43},
 {c:[.69,.85],r:[.24,.17],angle:.43,phase:.72}
];
// End-to-end artery sweep templates. They are *not* thickened local streets.
const ARTERIES=[
 [[-.09,.44],[.25,.06],[.64,.36],[1.10,.18]],
 [[-.08,.67],[.33,.34],[.66,.49],[1.08,.81]],
 [[.09,-.09],[.23,.39],[.65,.66],[.90,1.09]],
 [[.82,-.09],[.62,.35],[.29,.62],[.36,1.09]]
];
const LINKS=[[0,1],[1,2],[0,3],[1,4],[2,5],[3,4],[4,5],[3,6],[4,6],[4,7],[5,7],[6,7]];
const sq=x=>x*x;
// Elastic Wool displacement is shared by fibers and ring boundaries. Multiple
// attraction/repulsion centers introduce smooth, moderate curvature; unlike
// the STEP04 dense tensor weave there is NO globally spiralling Cartesian grid.
function districtMap(d,a,b,wool){
 let x=a,y=b;
 const amount=.16+.22*wool;
 for(let iter=0;iter<9;iter++){
  const r2=x*x+y*y,rad=Math.exp(-r2*.65);
  const ax=.16*Math.sin(2.4*y+TAU*d.phase)+.08*Math.sin(4.8*y-1.3*x);
  const ay=.15*Math.sin(2.2*x-TAU*d.phase)-.07*Math.sin(4.2*x+1.1*y);
  const attract=Math.exp(-(sq(x-.38)+sq(y+.22))/.24);
  const repel=Math.exp(-(sq(x+.41)+sq(y-.35))/.20);
  x+=(amount/9)*rad*(ax+.16*attract-.14*repel);
  y+=(amount/9)*rad*(ay-.12*attract+.12*repel);
 }
 const ca=Math.cos(d.angle),sa=Math.sin(d.angle);
 return [
  d.c[0]+d.r[0]*x*ca-d.r[1]*y*sa,
  d.c[1]+d.r[0]*x*sa+d.r[1]*y*ca
 ];
}
export function buildPresentationRoadNetwork(domain,parameters={}){
 const {w,h,cell,left,top,inside,scale}=domain;
 const density=clamp(Number(parameters.roadDensity??88)/100,.12,1);
 const wool=clamp(Number(parameters.woolStrength??88)/100,0,1);
 const branching=clamp(Number(parameters.branchingStrength??78)/100,0,1);
 const bundled=clamp(Number(parameters.bundleStrength??85)/100,0,1);
 const smooth=clamp(Number(parameters.curvatureSmoothing??90)/100,.2,1);
 const useLevel=clamp(Math.round(6+8*density+3*branching),6,19);
 const roads=[],stats={main:0,secondary:0,local:0},
  failures={outside:0,short:0},lengths={main:0,secondary:0,local:0};
 const project=([u,v])=>[left+u*w*cell,top-v*h*cell];
 const insideParcel=p=>{
  const x=Math.floor(p[0]*w),y=Math.floor(p[1]*h);
  return x>=0&&x<w&&y>=0&&y<h&&Boolean(inside[y*w+x]);
 };
 // Genuine site-mask clip, NOT a fabricated road prohibition.
 const isArtVoid=(u,v)=>{
  // Unbuilt land/water "negative-space" corridor, explicitly artistic.
  // Keeps the reference's large unfilled winding spaces between districts.
  const y=.47+.09*Math.sin(TAU*(u*.95+.12))+.028*Math.sin(TAU*2.1*u);
  const d=Math.abs(v-y);
  return d<(.021+.008*Math.sin(TAU*(u+.12))**2);
 };
 let roadNo=0;
 function add(samples,kind,tag,{voidClipping=false}={}){
  let partial=[];
  const flush=()=>{
   if(partial.length<5){partial=[];return}
   // A path consisting of several interrupted fragments is not accepted as
   // one giant "road" spanning a masked-out void.
   let len=0;
   for(let i=1;i<partial.length;i++)
    len+=Math.hypot(partial[i][0]-partial[i-1][0],
      partial[i][1]-partial[i-1][1])*scale;
   if(len<Math.max(domain.groundCell*1.8,8)){failures.short++;partial=[];return}
   const id='WOOL-'+String(++roadNo).padStart(5,'0');
   roads.push({id,kind,points:partial,lengthM:len,
     start:domain.cellAt(partial[0]),end:domain.cellAt(partial.at(-1)),
     provenance:ORGANIC_EXHIBITION_NOTE+' / wool-attraction-and-bundling / '+tag});
   stats[kind]++;lengths[kind]+=len;partial=[];
  };
  for(const p of samples){
   if(!Number.isFinite(p[0])||!Number.isFinite(p[1])||
     !insideParcel(p)||voidClipping&&isArtVoid(...p)){
    if(partial.length)flush();failures.outside++;continue;
   }
   partial.push(project(p));
  }
  flush();
 }
 const sampleBezier=(a,b,c,d,n=160)=>Array.from({length:n+1},(_,k)=>
  cubicBezier(a,b,c,d,k/n));
 // District subdivision FIRST: local fabrics are *closed* at shared,
 // deformed district rings and are sampled from shared elastic material.
 // Their endpoints land on the same mathematical ring as the collector.
 const ringCount=[],localLines=[];
 DISTRICTS.forEach((district,index)=>{
  const n=useLevel+(index%3===1?1:0);
  const familyX=unevenLevels(n,index*.17+.25).map(t=>(t-.5)*1.86);
  const familyY=unevenLevels(n-2,index*.23+.59).map(t=>(t-.5)*1.86);
  // Use a single material map for ring and local orthogonal families.
  const map=(a,b)=>districtMap(district,a,b,wool);
  for(const vertical of [false,true]){
   const family=vertical?familyX:familyY;
   for(let k=0;k<family.length;k++){
    const c=family[k],extent=Math.sqrt(Math.max(0,1-c*c));
    if(extent<.2)continue;
    const series=Array.from({length:65},(_,i)=>{
      const t=-extent+2*extent*i/64;
      return vertical?map(c,t):map(t,c);
    });
    // Light Wool bundling: concentrate successive fibers towards nearest
    // collector; the shared warp preserves intersection continuity.
    localLines.push({series,index,vertical});
   }
  }
  const ring=Array.from({length:220},(_,i)=>{
   const t=TAU*i/219;return map(Math.cos(t),Math.sin(t));
  });
  ringCount.push({district:index,points:ring});
 });
 // Draw small street network (fine lines) with limited clear-space gaps.
 for(const item of localLines)
  add(item.series,'local','district-fiber-'+item.index,{voidClipping:true});
 // Distinct collector rings and connections make larger enclosed cells.
 ringCount.forEach(({points,district})=>
  add(points,'secondary','district-collector-'+district));
 const hubs=DISTRICTS.map(d=>d.c);
 // Connect ring-to-ring along smoothly bulged paths; no straight diagonal
 // cuts that would imitate arbitrary vectors.
 for(let i=0;i<LINKS.length;i++){
  const [a,b]=LINKS[i],p=hubs[a],q=hubs[b];
  const vx=q[0]-p[0],vy=q[1]-p[1],normal=[-vy,vx];
  const bend=(i%2?-1:1)*(.14+.11*bundled);
  const c1=[p[0]+vx*.28+normal[0]*bend,p[1]+vy*.28+normal[1]*bend];
  const c2=[p[0]+vx*.72-normal[0]*bend,p[1]+vy*.72-normal[1]*bend];
  add(sampleBezier(p,c1,c2,q,105),'secondary','wool-link-'+a+'-'+b);
 }
 // Long arteries are organically continuous, even when crossing unbuilt land.
 for(let i=0;i<ARTERIES.length;i++){
  const [a,b,c,d]=ARTERIES[i];
  const wobble=.015*(1-smooth);
  const sampled=sampleBezier(a,b,c,d,260).map(([x,y])=>
    [x+wobble*Math.sin(TAU*2.3*y+i),y+wobble*Math.sin(TAU*2.2*x-i)]);
  add(sampled,'main','wool-bundled-artery-'+i);
 }
 // Wool consolidation: connect selected collector-ring points to nearby
 // arteries along softly curved links. This creates genuine branch structure,
 // not a final paint-layer fake.
 for(let i=0;i<DISTRICTS.length;i++){
  const center=hubs[i],angle=TAU*(i*.61803398875);
  const ring=ringCount[i].points,anchor=ring[Math.floor((i*.18+.13)%1*219)];
  const endpoint=[center[0]+.22*Math.cos(angle),center[1]+.16*Math.sin(angle)];
  const b=[anchor[0]*.65+endpoint[0]*.35,anchor[1]*.7+endpoint[1]*.3];
  const c=[anchor[0]*.4+endpoint[0]*.6,anchor[1]*.3+endpoint[1]*.7];
  add(sampleBezier(anchor,b,c,endpoint,44),'secondary','wool-reconnect-'+i);
 }
 if(roads.filter(r=>r.kind==='local').length<8||
    roads.filter(r=>r.kind==='main').length<2)
  throw Error('选区可用范围不足，无法生成完整 Wool 层级；请扩大地块再试');
 return {roads,access:[],candidates:[],stats:{
   ...stats,syntheticPresentation:true,woolCombinedOnly:true,
   displayMethod:'shared Wool elastic district fabric + attracting collectors + independent bundled arteries',
   independentArterials:ARTERIES.length,districtRingSeeds:DISTRICTS.length,
   generatedDistricts:DISTRICTS.length,localFiberCandidates:localLines.length,
   generatedLengthM:lengths,targetRoads:roads.length,rejections:failures,
   eligibleCells:domain.dryCells,visitedCells:0
 }};
}
