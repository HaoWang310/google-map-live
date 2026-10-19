/* STEP 05 exhibition road grammar. This is a proposal-only visual layout,
   deliberately separate from validated tensor/Wool/A* hydrological analysis.
   Geometry is clipped to the chosen real parcel, never advertised as engineering
   clearance or a hydraulically computed street network. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function buildPresentationRoadNetwork(domain,parameters={}){
 const {w,h,cell,left,top,inside,scale}=domain,
   density=clamp(Number(parameters.roadDensity??88)/100,.15,1),
   smooth=clamp(Number(parameters.curvatureSmoothing??90)/100,0,1),
   cols=clamp(Math.round(w*(.36+.20*density)),8,44),
   rows=clamp(Math.round(h*(.36+.20*density)),8,44),
   ampX=Math.min(3.8,w*.092)*(.78+.22*smooth),
   ampY=Math.min(3.8,h*.092)*(.78+.22*smooth),
   tau=Math.PI*2,roads=[],counts={main:0,secondary:0,local:0};
 const warp=(x,y)=>{
   const u=x/w,v=y/h;
   const wx=x+ampX*(.59*Math.sin(tau*(.72*u+.52*v))+
     .29*Math.sin(tau*(1.11*v-.37*u))+.12*Math.sin(tau*(1.88*u+.82*v)));
   const wy=y+ampY*(.59*Math.sin(tau*(.66*u-.64*v))+
     .30*Math.sin(tau*(1.07*u+.58*v))+.11*Math.sin(tau*(1.72*v-.71*u)));
   return [wx,wy];
 };
 const toProjected=(x,y)=>[left+x*cell,top-y*cell];
 const inParcel=(x,y)=>{
   if(x<.25||x>=w-.25||y<.25||y>=h-.25)return false;
   const i=(Math.floor(y)*w+Math.floor(x));
   return Boolean(inside[i]);
 };
 // The two families sample ONE common warp. Their intersections are shared,
 // so the road geometry encloses actual cells rather than separate fragments.
 for(const vertical of [false,true]){
   const count=vertical?cols:rows,extent=vertical?h:w;
   for(let k=0;k<count;k++){
     const fixed=(k+.5)*(vertical?w:h)/count;
     const tier=k%10===0?'main':k%3===0?'secondary':'local';
     let segment=[],n=0;
     const flush=()=>{
       if(segment.length<5){segment=[];return}
       let physical=0;
       for(let j=1;j<segment.length;j++)
         physical+=Math.hypot(segment[j][0]-segment[j-1][0],
           segment[j][1]-segment[j-1][1])*scale;
       if(physical<cell*scale*2){segment=[];return}
       roads.push({id:'EXHIBIT-'+String(roads.length+1).padStart(4,'0'),
         kind:tier,points:segment,start:domain.cellAt(segment[0]),
         end:domain.cellAt(segment.at(-1)),lengthM:physical,
         provenance:'exhibition-only warped site grid; not engineering validated'});
       counts[tier]++;segment=[];n++;
     };
     for(let t=.5;t<=extent-.5+.001;t+=.72){
       const [x,y]=vertical?warp(fixed,t):warp(t,fixed);
       if(!inParcel(x,y)){flush();continue}
       segment.push(toProjected(x,y));
     }
     flush();
   }
 }
 if(roads.length<4)throw Error('展示网格需要完整的可显示选区；请扩大场地后重试。');
 const stats={...counts,syntheticPresentation:true,
  explanation:'smooth warped orthogonal grid, road hierarchy by cadence, parcel-clipped',
  seedCounts:{firstFamily:rows,secondFamily:cols},rejections:{},
  visitedCells:0,eligibleCells:domain.dryCells};
 return {roads,access:[],candidates:[],stats};
}
