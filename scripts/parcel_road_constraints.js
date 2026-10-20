/* STEP 05: source-validated real parcel grid. EPSG:3857 metric geometry
   is converted back to EPSG:4326 for exports. No artificial tensor input. */
export const R=6378137;
export const merc=p=>[R*p[0]*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,p[1]))*Math.PI/360))];
export const lonlat=p=>[p[0]/R*180/Math.PI,(2*Math.atan(Math.exp(p[1]/R))-Math.PI/2)*180/Math.PI];
export const length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function pointInPolygon(point,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if(((a[1]>point[1])!==(b[1]>point[1]))&&
     point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
function decoded(entry,n,name){
 const data=entry?.values??entry;
 if(!Array.isArray(data)||data.length!==n)throw Error('STEP 05 missing or invalid real-site data: '+name);
 return Float32Array.from(data,v=>Number.isFinite(Number(v))?Number(v):0);
}
export function readSiteTensor(input,ring){
 const snapshot=input?.schema==='london-tensor-site-v1'?(input.scenarios||[])
   .find(s=>s?.scenario?.year===2100)??input.current:input;
 if(!snapshot)throw Error('Import the tensor diagnostics JSON exported by London Map');
 const cols=Number(snapshot.cols),rows=Number(snapshot.rows),n=cols*rows;
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||n<16||n>70000)
  throw Error('Invalid tensor raster dimensions');
 const grid=snapshot.grid;
 if(!grid||!Number.isFinite(grid.left)||!Number.isFinite(grid.top)||
    !(grid.cellProjectedM>0))throw Error('Original EPSG:3857 raster metadata missing');
 const f=snapshot.fields||snapshot;
 const primaryX=decoded(f.primaryX,n,'primaryX'),primaryY=decoded(f.primaryY,n,'primaryY');
 const confidence=decoded(f.confidence,n,'confidence');
 const anisotropy=decoded(f.anisotropy,n,'anisotropy');
 const valid=decoded(f.validMask,n,'validMask');
 const depth=decoded(snapshot.depthMm,n,'depthMm');
 const sourceRevision=[snapshot.scenario?.year,snapshot.scenario?.token,
  snapshot.scenario?.rainfallCase,grid.left,grid.top,grid.cellProjectedM,cols,rows].join(':');
 const drainage=decoded(f.drainageMask,n,'drainageMask');
 // Native DEM may be exported with the tensor; optional for older auditable
 // fixtures, but always reuses the same original georeferenced grid.
 const nativeTerrain=snapshot.input?.terrain?.values??snapshot.input?.terrain;
 const terrain=Array.isArray(nativeTerrain)&&nativeTerrain.length===n?
  Float32Array.from(nativeTerrain,v=>Number.isFinite(Number(v))?Number(v):NaN):null;
 // If the export carries the original selected polygon, verify the exact
 // parcel rather than only accepting any other site inside the same raster.
 const original=input?.selection?.coordinates?.[0];
 if(original?.length>=4){
  const a=ring.slice(0,-1).map(merc);
  const b=original.slice(0,-1).map(merc);
  const near=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])*
    Math.cos(ring[0][1]*Math.PI/180)<3.0;
  if(!a.every(p=>b.some(q=>near(p,q)))||!b.every(p=>a.some(q=>near(p,q))))
   throw Error('Imported JSON belongs to another site; use tensor/flood data for the current red boundary');
 }
 const polygon=ring.map(merc);
 const minX=grid.left,maxX=grid.left+cols*grid.cellProjectedM;
 const maxY=grid.top,minY=grid.top-rows*grid.cellProjectedM;
 const contained=polygon.filter(p=>p[0]>=minX-2*grid.cellProjectedM&&
  p[0]<=maxX+2*grid.cellProjectedM&&p[1]>=minY-2*grid.cellProjectedM&&p[1]<=maxY+2*grid.cellProjectedM);
 if(contained.length<polygon.length-1)
  throw Error('Imported tensor/flood raster does not match the selected site; export the same site again');
 let active=0,oriented=0;
 for(let i=0;i<n;i++)if(valid[i]>0){active++;if(Math.hypot(primaryX[i],primaryY[i])>.4)oriented++;}
 if(active<16||oriented<8)throw Error('Insufficient tensor orientation evidence; complete tensor calculation in London Map first');
 // A current-year 2026 snapshot cannot stand in for the 2100 flood constraints.
 const year=Number(snapshot.scenario?.year??snapshot.scenarioYear);
 if(year!==2100)throw Error('Import site diagnostics containing computed 2100 results, not only a 2026 preview');
 return {cols,rows,grid:{left:grid.left,top:grid.top,cellProjectedM:grid.cellProjectedM},
  primaryX,primaryY,confidence,anisotropy,valid,depth,drainage,terrain,polygon,
  sourceRevision,scenarioToken:snapshot.scenario?.token||null,rainfallCase:snapshot.scenario?.rainfallCase||null,
  year,source:'London Map computed hydrological tensor + 2100 flood depth',
  metricScale:Math.cos(ring.reduce((s,p)=>s+p[1],0)/ring.length*Math.PI/180)};
}
export function makeRoadDomain(source,parameters={}){
 const {cols,rows,grid,metricScale}=source;
 // Downsample high-resolution presentation grids to control graph search cost.
 const stride=Math.max(1,Math.ceil(Math.sqrt(cols*rows/14000)));
 const w=Math.ceil(cols/stride),h=Math.ceil(rows/stride),cell=grid.cellProjectedM*stride;
 const count=w*h;
 const inside=new Uint8Array(count),safe=new Uint8Array(count),
  depth=new Float32Array(count),ax=new Float32Array(count),ay=new Float32Array(count),
  certainty=new Float32Array(count),anisotropy=new Float32Array(count),hydro=new Uint8Array(count),cost=new Float32Array(count),
  slope=new Float32Array(count);
 const maxNormal=clamp(Number(parameters.floodLimitM??.15),.03,.6)*1000;
 const avoid=clamp(Number(parameters.floodAvoidance??85)/100,0,1);
 const floodLimit=maxNormal*(1.25-avoid*.25);
 let dry=0,wet=0,steep=0,shallow=0,deep=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,sx=Math.min(cols-1,x*stride+Math.floor(stride/2)),
    sy=Math.min(rows-1,y*stride+Math.floor(stride/2)),j=sy*cols+sx;
  const center=[grid.left+(x+.5)*cell,grid.top-(y+.5)*cell];
  if(!pointInPolygon(center,source.polygon)||!source.valid[j])continue;
  // Conservative downsampling: NEVER accept a dry centre sample as proof
  // that a narrow deep-water channel is safe. Use the source-cell peak and
  // maximum drainage evidence within the coarse planning cell.
  let maximumDepth=0,drainageEvidence=0,invalidCount=0,sourceCount=0;
  for(let oy=0;oy<stride;oy++)for(let ox=0;ox<stride;ox++){
    const xx=x*stride+ox,yy=y*stride+oy;
    if(xx>=cols||yy>=rows)continue;
    const z=yy*cols+xx;
    maximumDepth=Math.max(maximumDepth,source.depth[z]);
    drainageEvidence=Math.max(drainageEvidence,source.drainage[z]);
    sourceCount++;if(!source.valid[z])invalidCount++;
  }
  inside[i]=1;depth[i]=maximumDepth/1000;
  const v=Math.hypot(source.primaryX[j],source.primaryY[j]);
  if(v>.25){ax[i]=source.primaryX[j]/v;ay[i]=-source.primaryY[j]/v;}
  certainty[i]=source.confidence[j];anisotropy[i]=source.anisotropy[j];
  hydro[i]=drainageEvidence>0?1:0;
  // Real physical slope is estimated from DEM elevations in ground metres.
  // Keep the DEM as a *cost*, not a reason to fabricate a new street direction.
  if(source.terrain){
   const dem=source.terrain,cols0=source.cols,rows0=source.rows;
   const a=dem[sy*cols0+Math.max(0,sx-1)],
     b=dem[sy*cols0+Math.min(cols0-1,sx+1)],
     c=dem[Math.max(0,sy-1)*cols0+sx],
     e=dem[Math.min(rows0-1,sy+1)*cols0+sx];
   if([a,b,c,e].every(Number.isFinite)){
    const unit=Math.max(1,source.grid.cellProjectedM*metricScale);
    slope[i]=Math.hypot((b-a)/(2*unit),(e-c)/(2*unit));
   }
  }
  // Deep inundation and major actively flooded drainage are hard exclusion.
  // Shallow wet edges are traversable but increasingly expensive; the solver
  // always validates its centreline against the hard mask.
  const invalid=sourceCount===0||invalidCount>sourceCount*.3;
  const dangerous=invalid||maximumDepth>=floodLimit||
    (hydro[i]&&maximumDepth>=Math.min(floodLimit,90))||slope[i]>.65;
  if(!dangerous){safe[i]=1;dry++;if(maximumDepth>=20)shallow++}
  else{wet++;if(slope[i]>.65)steep++;if(maximumDepth>=floodLimit)deep++}
  const wetCost=Math.pow(Math.max(0,depth[i])/.12,1.45)*avoid*3.6;
  cost[i]=1+wetCost+(hydro[i]?avoid*(depth[i]>.02?1.5:.7):0)+
    Math.min(8,slope[i]*slope[i]*12);

 }
 if(dry<36&&parameters.visualMode!=='presentation')throw Error('Too few buildable cells remain after flood/terrain constraints; check site and depth threshold');
 const siteGroundCell=cell*metricScale;
 return {w,h,cell,groundCell:siteGroundCell,left:grid.left,top:grid.top,
  inside,safe,depth,ax,ay,certainty,anisotropy,hydro,cost,slope,
  sourceRevision:source.sourceRevision,scenarioToken:source.scenarioToken,sourceYear:source.year,
  dryCells:dry,wetCells:wet,
  diagnostics:{steepExcluded:steep,deepExcluded:deep,shallowTraversable:shallow},
  boundary:source.polygon,scale:metricScale,stride,
  toPoint:i=>[grid.left+((i%w)+.5)*cell,grid.top-(Math.floor(i/w)+.5)*cell],
  cellAt:p=>{
   const x=Math.floor((p[0]-grid.left)/cell),y=Math.floor((grid.top-p[1])/cell);
   return x>=0&&y>=0&&x<w&&y<h?y*w+x:-1;
  }};
}
export function floodReserves(domain){
 // Raw safe/danger raster cells become a bounded, honest planning display,
 // not artificially smoothed rivers or fake "mapped wetlands".
 const {w,h,cell,left,top}=domain,features=[];
 const every=Math.max(1,Math.ceil(Math.sqrt((w*h)/3500)));
 for(let y=0;y<h;y+=every)for(let x=0;x<w;x+=every){
  const i=y*w+x;if(!domain.inside[i]||domain.safe[i])continue;
  const x0=left+x*cell,y0=top-y*cell,dx=cell*every;
  const ring=[[x0,y0],[x0+dx,y0],[x0+dx,y0-dx],[x0,y0-dx],[x0,y0]].map(lonlat);
  features.push({type:'Feature',properties:{category:'reserved_flood_corridor',
     source:'simulated 2100 depth > threshold; raster footprint, not ecological designation',
     maxSampleDepthM:domain.depth[i]},geometry:{type:'Polygon',coordinates:[ring]}});
 }
 return {type:'FeatureCollection',features};
}
