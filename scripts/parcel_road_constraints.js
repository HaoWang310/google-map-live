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
 if(!Array.isArray(data)||data.length!==n)throw Error('STEP 05 缺失或错误的真实场地数据：'+name);
 return Float32Array.from(data,v=>Number.isFinite(Number(v))?Number(v):0);
}
export function readSiteTensor(input,ring){
 const snapshot=input?.schema==='london-tensor-site-v1'?(input.scenarios||[])
   .find(s=>s?.scenario?.year===2100)??input.current:input;
 if(!snapshot)throw Error('请导入 London Map 导出的张量诊断 JSON');
 const cols=Number(snapshot.cols),rows=Number(snapshot.rows),n=cols*rows;
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||n<16||n>70000)
  throw Error('张量场格网尺寸无效');
 const grid=snapshot.grid;
 if(!grid||!Number.isFinite(grid.left)||!Number.isFinite(grid.top)||
    !(grid.cellProjectedM>0))throw Error('缺少原始 EPSG:3857 网格元数据');
 const f=snapshot.fields||snapshot;
 const primaryX=decoded(f.primaryX,n,'primaryX'),primaryY=decoded(f.primaryY,n,'primaryY');
 const confidence=decoded(f.confidence,n,'confidence');
 const valid=decoded(f.validMask,n,'validMask');
 const depth=decoded(snapshot.depthMm,n,'depthMm');
 const drainage=decoded(f.drainageMask,n,'drainageMask');
 const polygon=ring.map(merc);
 const minX=grid.left,maxX=grid.left+cols*grid.cellProjectedM;
 const maxY=grid.top,minY=grid.top-rows*grid.cellProjectedM;
 const contained=polygon.filter(p=>p[0]>=minX-2*grid.cellProjectedM&&
  p[0]<=maxX+2*grid.cellProjectedM&&p[1]>=minY-2*grid.cellProjectedM&&p[1]<=maxY+2*grid.cellProjectedM);
 if(contained.length<polygon.length-1)
  throw Error('导入的张量/洪涝格网与当前红色场地不匹配，请重新导出同一地块');
 let active=0,oriented=0;
 for(let i=0;i<n;i++)if(valid[i]>0){active++;if(Math.hypot(primaryX[i],primaryY[i])>.4)oriented++;}
 if(active<16||oriented<8)throw Error('张量方向证据不足；请先在 London Map 完成真实张量计算');
 // A current-year 2026 snapshot cannot stand in for the 2100 flood constraints.
 const year=Number(snapshot.scenario?.year??snapshot.scenarioYear);
 if(year!==2100)throw Error('请导入含有 2100 年计算结果的场地诊断 JSON（不是仅2026年的预览）');
 return {cols,rows,grid:{left:grid.left,top:grid.top,cellProjectedM:grid.cellProjectedM},
  primaryX,primaryY,confidence,valid,depth,drainage,polygon,
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
  certainty=new Float32Array(count),hydro=new Uint8Array(count),cost=new Float32Array(count);
 const maxNormal=clamp(Number(parameters.floodLimitM??.15),.03,.6)*1000;
 const avoid=clamp(Number(parameters.floodAvoidance??85)/100,0,1);
 const floodLimit=maxNormal*(1.25-avoid*.25);
 let dry=0,wet=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,sx=Math.min(cols-1,x*stride+Math.floor(stride/2)),
    sy=Math.min(rows-1,y*stride+Math.floor(stride/2)),j=sy*cols+sx;
  const center=[grid.left+(x+.5)*cell,grid.top-(y+.5)*cell];
  if(!pointInPolygon(center,source.polygon)||!source.valid[j])continue;
  inside[i]=1;depth[i]=source.depth[j]/1000;
  const v=Math.hypot(source.primaryX[j],source.primaryY[j]);
  if(v>.25){ax[i]=source.primaryX[j]/v;ay[i]=-source.primaryY[j]/v;}
  certainty[i]=source.confidence[j];
  hydro[i]=source.drainage[j]>0?1:0;
  const dangerous=source.depth[j]>=floodLimit||hydro[i]&&source.depth[j]>=30;
  if(!dangerous){safe[i]=1;dry++}else wet++;
  cost[i]=1+avoid*Math.pow(Math.max(0,depth[i])/.2,1.5)*4+
   (hydro[i]?avoid*2.5:0);
 }
 if(dry<36)throw Error('洪涝/地形约束后可规划格网不足；请检查场地或水深阈值');
 const siteGroundCell=cell*metricScale;
 return {w,h,cell,groundCell:siteGroundCell,left:grid.left,top:grid.top,
  inside,safe,depth,ax,ay,certainty,hydro,cost,dryCells:dry,wetCells:wet,
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
