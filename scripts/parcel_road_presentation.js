/* STEP 05 organic exhibition road morphology.
   Separate from the actual DEM/rainfall/tensor/A* analysis pipeline.
   Builds nonuniform advected neighborhood fibers and independent sweeping
   arteries, radial collectors and curved district rings. It is NOT an
   engineering-validated street proposal or a hydrological prediction. */
import {organicWarp,unevenLevels,cubicBezier,ORGANIC_EXHIBITION_NOTE} from './organic_visual_field.js?v=3.26.3-organic-art-direction';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TAU=Math.PI*2;
export function buildPresentationRoadNetwork(domain,parameters={}){
 const {w,h,cell,left,top,inside,scale}=domain;
 const density=clamp(Number(parameters.roadDensity??88)/100,.1,1);
 const smooth=clamp(Number(parameters.curvatureSmoothing??90)/100,.1,1);
 const distortion=1.05+.48*smooth;
 const colCount=clamp(Math.round(w*(.40+.21*density)),10,47);
 const rowCount=clamp(Math.round(h*(.40+.21*density)),10,47);
 const xLevels=unevenLevels(colCount,.51),yLevels=unevenLevels(rowCount,.18);
 const inParcel=(u,v)=>{
  const x=u*w,y=v*h;
  if(x<.05||x>=w-.05||y<.05||y>=h-.05)return false;
  const i=Math.floor(y)*w+Math.floor(x);
  return Boolean(inside[i]); // only the REAL selected polygon is authoritative here
 };
 const project=(u,v)=>[left+u*w*cell,top-v*h*cell];
 const roads=[],stats={main:0,secondary:0,local:0},
  reasons={short:0,outside:0};
 function addCurve(parameters,kind,label,minPoints=5){
  let part=[],validCount=0;
  const flush=()=>{
   if(part.length<minPoints){reasons.short++;part=[];return}
   const lengthM=part.slice(1).reduce((d,p,j)=>d+
    Math.hypot(p[0]-part[j][0],p[1]-part[j][1])*scale,0);
   if(lengthM<domain.groundCell*1.6){reasons.short++;part=[];return}
   roads.push({id:'ART-'+String(roads.length+1).padStart(4,'0'),
    kind,points:part,start:domain.cellAt(part[0]),end:domain.cellAt(part.at(-1)),
    provenance:ORGANIC_EXHIBITION_NOTE+' / '+label,lengthM});
   stats[kind]++;part=[];
  };
  for(const [u,v] of parameters){
   const p=organicWarp(u,v,distortion);
   if(!inParcel(...p)){if(part.length)flush();reasons.outside++;continue}
   part.push(project(...p));validCount++;
  }
  flush();
  return validCount;
 }
 // Local fabric retains cellular topology but its spacings and deformation
 // are nonuniform; a vortex/curl advected field replaces rectangular warps.
 const sampleCount=Math.min(250,Math.max(70,Math.round(Math.max(w,h)*1.9)));
 for(const vertical of [false,true]){
  const levels=vertical?xLevels:yLevels;
  for(const fixed of levels){
   const coordinates=[];
   for(let j=0;j<=sampleCount;j++){
    const t=.002+.996*j/sampleCount;
    coordinates.push(vertical?[fixed,t]:[t,fixed]);
   }
   addCurve(coordinates,'local',vertical?'local-cross':'local-long');
  }
 }
 // Diagonal meanders periodically connect small blocks and counter the
 // visual repetition of a rigid underlying quadrilateral fabric.
 for(let i=1;i<xLevels.length-1;i+=2)for(let j=1;j<yLevels.length-1;j+=3){
  if(((i*31+j*17)%7)>2)continue;
  const endX=Math.min(xLevels.length-1,i+2),
   endY=Math.min(yLevels.length-1,j+2);
  const a=[xLevels[i],yLevels[j]],
    d=[xLevels[endX],yLevels[endY]],
    b=[a[0]+.43*(d[0]-a[0]),a[1]+.09*(d[1]-a[1])],
    c=[a[0]+.56*(d[0]-a[0]),a[1]+.88*(d[1]-a[1])];
  const line=Array.from({length:16},(_,k)=>cubicBezier(a,b,c,d,k/15));
  addCurve(line,'local','diagonal-permeability',6);
 }
 // Strong high-level ribbons: long curved arterials intentionally DO NOT
 // follow a every-nth subdivision line. Shared anchors encourage hubs.
 const hubs=[[.21,.31],[.73,.29],[.45,.53],[.23,.79],[.80,.77]];
 const primaries=[
  [[-.08,.18],[.30,.10],[.51,.74],[1.10,.71]],
  [[.09,-.09],[.24,.42],[.63,.44],[.97,1.08]],
  [[1.11,.07],[.61,.19],[.52,.85],[-.12,.94]],
  [[-.10,.61],[.35,.69],[.72,.14],[1.09,.35]],
  [[.36,-.12],[.45,.22],[.74,.59],[.64,1.10]]
 ];
 for(let k=0;k<primaries.length;k++){
  const [a,b,c,d]=primaries[k];
  const curves=Array.from({length:240},(_,i)=>cubicBezier(a,b,c,d,i/239));
  addCurve(curves,'main','sweeping-artery-'+k);
 }
 // Elliptical district collectors and radial connecting lines create curved
 // enclosing parcels, roundabout-like hubs and nonrectangular district cells.
 for(let j=0;j<hubs.length;j++){
  const center=hubs[j],rx=.105+.026*(j%3),ry=.080+.024*((j+1)%3);
  const loop=Array.from({length:140},(_,k)=>{
   const t=TAU*k/139;
   return [center[0]+rx*Math.cos(t)-.025*Math.sin(t),
     center[1]+ry*Math.sin(t)+.021*Math.sin(t)*Math.sin(t)];
  });
  addCurve(loop,'secondary','district-ring-'+j,9);
 }
 const pairs=[[0,2],[1,2],[2,3],[2,4],[0,3],[1,4],[3,4]];
 for(let k=0;k<pairs.length;k++){
  const [i,j]=pairs[k],a=hubs[i],d=hubs[j],
   dx=d[0]-a[0],dy=d[1]-a[1],
   bend=(k%2?1:-1)*(.08+.02*(k%3)),
   b=[a[0]+dx*.32-dy*bend,a[1]+dy*.32+dx*bend],
   c=[a[0]+dx*.72+dy*bend,a[1]+dy*.72-dx*bend];
  const line=Array.from({length:110},(_,z)=>cubicBezier(a,b,c,d,z/109));
  addCurve(line,'secondary','district-connector-'+k);
 }
 if(roads.length<10)throw Error('当前地块太小或有效选区不足，展示模式无法形成连续街区');
 return {
  roads,access:[],candidates:[],
  stats:{...stats,syntheticPresentation:true,
   displayMethod:'nonuniform flow-advection + sweeping artery Béziers + organic district rings',
   underlyingGridFamilies:{x:colCount,y:rowCount},
   independentArterials:primaries.length,districtRingSeeds:hubs.length,
   targetRoads:roads.length,rejections:reasons,
   eligibleCells:domain.dryCells,visitedCells:0}
 };
}
