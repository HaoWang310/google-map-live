const R=6378137;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let demConfig=null;
let demPromise=null;
let drainagePromise=null;
let sim=null;
let running=false;
const annualStateCache=new Map();
let annualCacheKey='';
let annualFrameYear=null;
let annualRiskForecast=null;
let annualAreaStage=null;
let timer=null;
let params={
  rainfall:20,infiltration:0.5,duration:120,openBoundary:true,
  assumedUrbanDrainageMmH:0,
  drainageGuide:true,drainageThreshold:1,rainSeriesMm15:null,
  interventions:[],showFlow:true,floodMode:'rain',externalStageM:null,
  stormProfile:'uniform',externalInlet:'low',externalRiseMin:30,externalFallMin:90
};

function mercator(lng,lat){
  const lon=lng*Math.PI/180;
  const phi=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return [R*lon,R*Math.log(Math.tan(Math.PI/4+phi/2))];
}

function lngLat(x,y){
  return [x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
}

function pointInRing(x,y,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}

function pointInPolygon(x,y,rings){
  if(!rings?.length||!pointInRing(x,y,rings[0]))return false;
  for(let i=1;i<rings.length;i++)if(pointInRing(x,y,rings[i]))return false;
  return true;
}

function geometryPolygons(geometry){
  if(!geometry)return [];
  if(geometry.type==='Polygon')return [geometry.coordinates];
  if(geometry.type==='MultiPolygon')return geometry.coordinates;
  return [];
}

function toMercatorRings(rings){
  return rings.map(ring=>ring.map(([lng,lat])=>mercator(lng,lat)));
}

function bboxOfRings(rings){
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
  for(const ring of rings)for(const [x,y] of ring){
    if(x<left)left=x;if(x>right)right=x;if(y<bottom)bottom=y;if(y>top)top=y;
  }
  return {left,right,bottom,top};
}

async function loadDem(){
  if(demPromise)return demPromise;
  demPromise=(async()=>{
    const response=await fetch(demConfig.demUrl,{cache:'force-cache'});
    if(!response.ok)throw new Error('50 m 地形数据加载失败（'+response.status+'）');
    const bitmap=await createImageBitmap(await response.blob());
    if(bitmap.width!==demConfig.demWidth||bitmap.height!==demConfig.demHeight){
      bitmap.close();
      throw new Error('50 m 地形数据尺寸不匹配');
    }
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0);
    bitmap.close();
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const codes=new Uint16Array(canvas.width*canvas.height);
    for(let i=0;i<codes.length;i++)codes[i]=(rgba[i*4]<<8)|rgba[i*4+1];
    canvas.width=1;canvas.height=1;
    return codes;
  })().catch(error=>{demPromise=null;throw error;});
  return demPromise;
}

function decodeDem(code){
  if(!code)return NaN;
  return demConfig.demEncoding.minimum + (code-1)*demConfig.demEncoding.step;
}

function sampleDem(codes,x,y){
  const b=demConfig.demBounds;
  if(x<b.left||x>b.right||y<b.bottom||y>b.top)return NaN;
  const sx=(x-b.left)/(b.right-b.left)*demConfig.demWidth-.5;
  const sy=(b.top-y)/(b.top-b.bottom)*demConfig.demHeight-.5;
  const x0=clamp(Math.floor(sx),0,demConfig.demWidth-1),x1=clamp(x0+1,0,demConfig.demWidth-1);
  const y0=clamp(Math.floor(sy),0,demConfig.demHeight-1),y1=clamp(y0+1,0,demConfig.demHeight-1);
  const tx=clamp(sx-Math.floor(sx),0,1),ty=clamp(sy-Math.floor(sy),0,1);
  const vals=[
    decodeDem(codes[y0*demConfig.demWidth+x0]),
    decodeDem(codes[y0*demConfig.demWidth+x1]),
    decodeDem(codes[y1*demConfig.demWidth+x0]),
    decodeDem(codes[y1*demConfig.demWidth+x1])
  ];
  const valid=vals.filter(Number.isFinite);
  if(!valid.length)return NaN;
  for(let i=0;i<4;i++)if(!Number.isFinite(vals[i]))vals[i]=valid[0];
  const a=vals[0]*(1-tx)+vals[1]*tx;
  const btm=vals[2]*(1-tx)+vals[3]*tx;
  return a*(1-ty)+btm*ty;
}


const DRAINAGE_MIN_KM2=0.0025;
const DRAINAGE_MAX_KM2=20000;
function accumulationCode(areaKm2){
  const clamped=clamp(Number(areaKm2)||0,DRAINAGE_MIN_KM2,DRAINAGE_MAX_KM2);
  return 1+Math.round(
    Math.log(clamped/DRAINAGE_MIN_KM2)/
    Math.log(DRAINAGE_MAX_KM2/DRAINAGE_MIN_KM2)*65534
  );
}

async function loadDrainageCodes(){
  if(!demConfig?.drainageUrl)return null;
  if(drainagePromise)return drainagePromise;
  drainagePromise=(async()=>{
    const response=await fetch(demConfig.drainageUrl,{cache:'force-cache'});
    if(!response.ok)throw new Error('50 m 汇水栅格不可用');
    const bitmap=await createImageBitmap(await response.blob());
    try{
      if(bitmap.width!==demConfig.demWidth||bitmap.height!==demConfig.demHeight){
        throw new Error('汇水栅格与地形栅格尺寸不匹配');
      }
      const cv=new OffscreenCanvas(bitmap.width,bitmap.height);
      const ctx=cv.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0);
      const rgba=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
      const codes=new Uint16Array(bitmap.width*bitmap.height);
      for(let i=0;i<codes.length;i++)codes[i]=(rgba[i*4]<<8)|rgba[i*4+1];
      cv.width=1;cv.height=1;
      return codes;
    }finally{bitmap.close();}
  })().catch(error=>{drainagePromise=null;throw error;});
  return drainagePromise;
}

function sampleDrainageCode(codes,x,y){
  if(!codes)return 0;
  const b=demConfig.demBounds;
  if(x<b.left||x>b.right||y<b.bottom||y>b.top)return 0;
  const sx=Math.floor((x-b.left)/(b.right-b.left)*demConfig.demWidth);
  const sy=Math.floor((b.top-y)/(b.top-b.bottom)*demConfig.demHeight);
  const col=clamp(sx,0,demConfig.demWidth-1);
  const row=clamp(sy,0,demConfig.demHeight-1);
  return codes[row*demConfig.demWidth+col];
}

function chooseCellSize(width,height){
  const target=Math.max(width/240,height/240,10);
  return clamp(Math.ceil(target/5)*5,10,50);
}

function polygonIntersectsCell(cx,cy,cell,rings){
  if(pointInPolygon(cx,cy,rings))return true;
  const h=cell*.5;
  const corners=[[cx-h,cy-h],[cx+h,cy-h],[cx+h,cy+h],[cx-h,cy+h]];
  if(corners.some(([x,y])=>pointInPolygon(x,y,rings)))return true;
  const outer=rings[0]||[];
  return outer.some(([x,y])=>x>=cx-h&&x<=cx+h&&y>=cy-h&&y<=cy+h);
}

function rasterizeBuilding(simulation,building){
  const polygons=geometryPolygons(building.geometry);
  for(const poly of polygons){
    const rings=toMercatorRings(poly);
    if(!rings.length)continue;
    const box=bboxOfRings(rings);
    if(box.right<simulation.left||box.left>simulation.right||
       box.top<simulation.bottom||box.bottom>simulation.top)continue;
    const c0=clamp(Math.floor((box.left-simulation.left)/simulation.cell),0,simulation.cols-1);
    const c1=clamp(Math.ceil((box.right-simulation.left)/simulation.cell),0,simulation.cols-1);
    const r0=clamp(Math.floor((simulation.top-box.top)/simulation.cell),0,simulation.rows-1);
    const r1=clamp(Math.ceil((simulation.top-box.bottom)/simulation.cell),0,simulation.rows-1);
    for(let row=r0;row<=r1;row++){
      const y=simulation.top-(row+.5)*simulation.cell;
      for(let col=c0;col<=c1;col++){
        const i=row*simulation.cols+col;
        if(!simulation.inside[i])continue;
        const x=simulation.left+(col+.5)*simulation.cell;
        if(polygonIntersectsCell(x,y,simulation.cell,rings)){
          simulation.obstacle[i]=1;
          const nextId=building.id+1;
          const previousId=simulation.buildingIds[i];
          // Several OSM vector-tile fragments can occupy the same hydrology
          // cell. Never overwrite the first building id and lose the others:
          // every overlaid footprint must receive the same flood collision.
          if(previousId&&previousId!==nextId){
            let extras=simulation.overlappingBuildingIds.get(i);
            if(!extras){
              extras=new Set([previousId]);
              simulation.overlappingBuildingIds.set(i,extras);
            }
            extras.add(nextId);
          }else if(!previousId){
            simulation.buildingIds[i]=nextId;
          }
        }
      }
    }
  }
}

async function setup(data){
  const codes=await loadDem();
  // Derived accumulation is advisory, not a pipe system or rainfall-water depth.
  // Failure is non-fatal: the original DEM-only simulation still works.
  let upstreamCodes=null;
  if(demConfig.drainageUrl){
    try{upstreamCodes=await loadDrainageCodes();}
    catch(error){console.warn('Using DEM-only fallback:',error);}
  }
  const selectionRings=toMercatorRings(data.polygon);
  const box=bboxOfRings(selectionRings);
  const width=box.right-box.left,height=box.top-box.bottom;
  if(!(width>0&&height>0))throw new Error('圈选范围无效');
  if(width>12000||height>12000)throw new Error('圈选范围过大；请控制在约 12 km × 12 km 内');

  const cell=chooseCellSize(width,height);
  const cols=Math.max(1,Math.ceil(width/cell));
  const rows=Math.max(1,Math.ceil(height/cell));
  if(cols*rows>70000)throw new Error('圈选范围过大；模拟网格超过 70,000 个单元');

  const terrain=new Float32Array(cols*rows);
  const inside=new Uint8Array(cols*rows);
  const obstacle=new Uint8Array(cols*rows);
  const buildingIds=new Uint32Array(cols*rows);
  const boundary=new Uint8Array(cols*rows);
  const accumulation=new Uint16Array(cols*rows);
  terrain.fill(NaN);

  let siteGridCells=0,validTerrainCells=0;
  for(let row=0;row<rows;row++){
    const y=box.top-(row+.5)*cell;
    for(let col=0;col<cols;col++){
      const x=box.left+(col+.5)*cell;
      const i=row*cols+col;
      if(!pointInPolygon(x,y,selectionRings))continue;
      siteGridCells++;
      const z=sampleDem(codes,x,y);
      if(!Number.isFinite(z))continue;
      validTerrainCells++;
      inside[i]=1;
      terrain[i]=z;
      if(upstreamCodes)accumulation[i]=sampleDrainageCode(upstreamCodes,x,y);
    }
  }

  // Do not silently extrapolate the London 50 m DEM to unrelated locations.
  // An incomplete/missing DEM would falsely suggest zero hazard.
  if(!siteGridCells||validTerrainCells/siteGridCells<0.9){
    throw new Error('所选区域缺少足够的真实 OS Terrain 50 高程数据。目前计算范围限于伦敦研究区有效 DEM 覆盖，不生成虚假洪水结果。');
  }

  sim={
    left:box.left,right:box.right,bottom:box.bottom,top:box.top,
    cols,rows,cell,terrain,inside,obstacle,buildingIds,boundary,
    overlappingBuildingIds:new Map(),
    accumulation,drainageAvailable:Boolean(upstreamCodes),
    water:new Float32Array(cols*rows),
    delta:new Float32Array(cols*rows),
    timeSec:0,
    visualPhase:0,
    buildings:data.buildings||[],
    polygon:data.polygon,
    svCapacity:new Float32Array(cols*rows),
    svInfilMmH:new Float32Array(cols*rows),
    spongeInfilM3:0,
    spongeCellCount:0,spongeFacilityCount:0
  };

  for(const building of sim.buildings)rasterizeBuilding(sim,building);
  applySpongeInterventions();

  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const i=row*cols+col;
    if(!inside[i]||obstacle[i])continue;
    if(row===0||col===0||row===rows-1||col===cols-1){boundary[i]=1;continue;}
    const n=[i-cols,i+1,i+cols,i-1];
    if(n.some(j=>!inside[j]))boundary[i]=1;
  }

  let insideCount=0,buildingCells=0,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<inside.length;i++){
    if(inside[i]){
      insideCount++;
      if(terrain[i]<minZ)minZ=terrain[i];
      if(terrain[i]>maxZ)maxZ=terrain[i];
    }
    if(obstacle[i])buildingCells++;
  }

  // Select the low-lying tenth of boundary cells as a provisional inlet
  // instead of unrealistically flooding the entire study-area perimeter.
  const perimeter=[];
  for(let i=0;i<boundary.length;i++){
    if(boundary[i]&&inside[i]&&!obstacle[i]&&Number.isFinite(terrain[i]))
      perimeter.push(i);
  }
  const sorted=perimeter.slice().sort((a,b)=>terrain[a]-terrain[b]);
  const lowCount=Math.max(1,Math.ceil(sorted.length*.1));
  sim.inletBoundaryCells=sorted.slice(0,lowCount);
  await loadPublishedRiskForSite();
  postMessage({
    type:'setup-complete',
    requestId:data.requestId,
    cols,rows,cellSizeM:cell,
    widthM:width,heightM:height,
    insideCells:insideCount,buildingCells,
    buildingCount:sim.buildings.length,
    terrainMinM:Number.isFinite(minZ)?minZ:null,
    terrainMaxM:Number.isFinite(maxZ)?maxZ:null,
    drainageAvailable:Boolean(upstreamCodes),
    riskAvailable:Boolean(sim.riskAvailable),riskInfo:sim.riskInfo,
    riskMappedCells:sim.riskMappedCount||0,
    boundsLngLat:[
      lngLat(box.left,box.top),
      lngLat(box.right,box.top),
      lngLat(box.right,box.bottom),
      lngLat(box.left,box.bottom)
    ]
  });
  sendFrame();
}



/*
 * EA present-day flood-risk overlay sampled at the SAME EPSG:3857 locations
 * as the solver. This is the independently decoded EA Surface Water
 * (RoFSW) ordinal raster, NOT river/sea flood risk or a water-depth map.
 * It is used for spatial diagnostics, never converted to metres of water.
 */
async function loadPublishedRiskForSite(){
  const ranks=new Uint8Array(sim.inside.length);
  try{
    if(!demConfig.riskMetaUrl||!Array.isArray(demConfig.riskTileUrls)||
       demConfig.riskTileUrls.length!==4)throw Error('EA source assets missing');
    const res=await fetch(demConfig.riskMetaUrl,{cache:'force-cache'});
    if(!res.ok)throw Error('EA metadata HTTP '+res.status);
    const meta=await res.json(),grid=meta.web_grid;
    if(meta.source_type!=='surface_water'||!Array.isArray(meta.products)||meta.products.length!==4)
      throw Error('仅允许独立 EA Surface Water 分类风险栅格；禁止综合或河流/海洋图作为降雨引导');
    if(!grid?.bounds_m||grid.width!==5736||grid.height!==5750)
      throw Error('EA raster alignment metadata differs');
    const [left,bottom,right,top]=grid.bounds_m;
    const tw=grid.width/2,th=grid.height/2;
    const coords=Array.from({length:4},()=>[]);
    for(let row=0;row<sim.rows;row++)for(let col=0;col<sim.cols;col++){
      const i=row*sim.cols+col;
      if(!sim.inside[i])continue;
      const x=sim.left+(col+.5)*sim.cell;
      const y=sim.top-(row+.5)*sim.cell;
      const gx=Math.floor((x-left)/(right-left)*grid.width);
      const gy=Math.floor((top-y)/(top-bottom)*grid.height);
      if(gx<0||gy<0||gx>=grid.width||gy>=grid.height)continue;
      const tile=(gy>=th?2:0)+(gx>=tw?1:0);
      coords[tile].push([i,gx%tw,gy%th]);
    }
    const colours=[
      [156,221,234,1],[247,211,89,2],[242,157,56,3],
      [215,55,49,4],[153,156,158,5]
    ];
    for(let tile=0;tile<4;tile++){
      if(!coords[tile].length)continue;
      const resp=await fetch(demConfig.riskTileUrls[tile],{cache:'force-cache'});
      if(!resp.ok)throw Error('EA risk tile HTTP '+resp.status);
      const bitmap=await createImageBitmap(await resp.blob());
      try{
        if(bitmap.width!==tw||bitmap.height!==th)throw Error('EA tile dimensions');
        const cv=new OffscreenCanvas(tw,th);
        const ctx=cv.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);
        const rgba=ctx.getImageData(0,0,tw,th).data;
        for(const [idx,px,py] of coords[tile]){
          const n=(py*tw+px)*4;
          if(rgba[n+3]<100)continue;
          let best=0,bestD=Infinity;
          for(const [r,g,b,c] of colours){
            const d=(rgba[n]-r)**2+(rgba[n+1]-g)**2+(rgba[n+2]-b)**2;
            if(d<bestD){bestD=d;best=c;}
          }
          if(bestD<1200)ranks[idx]=best;
        }
      }finally{bitmap.close();}
    }
    // A tile request can succeed while no classified EA cells are present.
    let mapped=0;
    for(let i=0;i<ranks.length;i++){
      if(sim.inside[i]&&!sim.obstacle[i]&&ranks[i]>=1&&ranks[i]<=4)mapped++;
    }
    sim.riskRank=ranks;
    sim.riskMappedCount=mapped;
    sim.riskAvailable=mapped>0;
    sim.riskInfo=mapped>0
      ?'EA Surface Water (RoFSW) official classes mapped; rivers/sea excluded (NOT flood depth)'
      :'EA Surface Water source contains no classified risk cells for this site';
  }catch(error){
    sim.riskRank=ranks;
    sim.riskMappedCount=0;
    sim.riskAvailable=false;
    sim.riskInfo='EA risk overlay not available: '+(error?.message||String(error));
  }
}

const SPONGE_ASSUMPTIONS={
  rainGarden:{storageM:.18,extraInfilMmH:35},
  wetland:{storageM:.38,extraInfilMmH:6},
  agriculture:{storageM:.24,extraInfilMmH:10},
  floodPark:{storageM:.50,extraInfilMmH:12},
  permeable:{storageM:.075,extraInfilMmH:45}
};

function applySpongeInterventions(){
  if(!sim)return;
  const {cols,rows,cell,inside,obstacle}=sim;
  if(!sim.svCapacity||sim.svCapacity.length!==cols*rows){
    sim.svCapacity=new Float32Array(cols*rows);
    sim.svInfilMmH=new Float32Array(cols*rows);
  }else{
    sim.svCapacity.fill(0);
    sim.svInfilMmH.fill(0);
  }
  const treatments=Array.isArray(params.interventions)?params.interventions.slice(0,200):[];
  let applied=0;
  for(const facility of treatments){
    const rule=SPONGE_ASSUMPTIONS[facility?.type];
    if(!rule)continue;
    const lng=Number(facility.lng),lat=Number(facility.lat);
    const radius=Number(facility.radiusM);
    if(!Number.isFinite(lng)||!Number.isFinite(lat)||!Number.isFinite(radius))continue;
    if(!(radius>=2&&radius<=150))continue;
    const [cx,cy]=mercator(lng,lat);
    const projectedRadius=radius/Math.max(.15,Math.cos(lat*Math.PI/180));
    const r2=projectedRadius*projectedRadius;
    const c0=clamp(Math.floor((cx-projectedRadius-sim.left)/cell),0,cols-1);
    const c1=clamp(Math.ceil((cx+projectedRadius-sim.left)/cell),0,cols-1);
    const row0=clamp(Math.floor((sim.top-(cy+projectedRadius))/cell),0,rows-1);
    const row1=clamp(Math.ceil((sim.top-(cy-projectedRadius))/cell),0,rows-1);
    let painted=false;
    for(let r=row0;r<=row1;r++){
      const y=sim.top-(r+.5)*cell;
      for(let c=c0;c<=c1;c++){
        const x=sim.left+(c+.5)*cell;
        if((x-cx)**2+(y-cy)**2>r2)continue;
        const idx=r*cols+c;
        if(!inside[idx]||obstacle[idx])continue;
        // Overlapping facilities never stack beyond the single most generous
        // assumption. This avoids double counting infiltration and storage.
        sim.svCapacity[idx]=Math.max(sim.svCapacity[idx],rule.storageM);
        sim.svInfilMmH[idx]=Math.max(sim.svInfilMmH[idx],rule.extraInfilMmH);
        painted=true;
      }
    }
    if(painted)applied++;
  }
  sim.spongeCellCount=0;
  for(let i=0;i<sim.svCapacity.length;i++){
    if(sim.svCapacity[i]>0||sim.svInfilMmH[i]>0)sim.spongeCellCount++;
  }
  sim.spongeFacilityCount=applied;
}

function simulationStep(dt=5){
  if(!sim)return;
  const {cols,rows,cell,terrain,inside,obstacle,water,delta,boundary,accumulation,
    svCapacity,svInfilMmH}=sim;
  const useDrainage=Boolean(params.drainageGuide&&sim.drainageAvailable);
  const threshold=accumulationCode(params.drainageThreshold);
  // EA tipping-bucket readings are accumulated mm per quarter hour.
  // When a verified, complete 16-bin 4h record is selected, drive the solver
  // by its actual measured temporal profile instead of inventing a uniform storm.
  const series=Array.isArray(params.rainSeriesMm15)&&params.rainSeriesMm15.length===16
    ?params.rainSeriesMm15:null;
  const slot=Math.min(15,Math.max(0,Math.floor(sim.timeSec/900)));
  const observed=series&&sim.timeSec<4*3600?Number(series[slot]):NaN;
  // Event hyetograph: unit-mean temporal patterns keep the entered event
  // total rainfall unchanged, rather than inventing additional rain volume.
  const eventSec=Math.max(60,(Number(params.duration)||60)*60);
  const progress=clamp(sim.timeSec/eventSec,0,1);
  // v3.22.21: one fixed triangular design storm with a single maximum
  // at 50% event elapsed time; time-mean profile = 1 (conserves event rain).
  // A genuine 15-minute gauge series below still overrides this design curve.
  const profile=0.25+1.5*(1-Math.abs(2*progress-1));
  const rain=params.floodMode==='external'?0:(Number.isFinite(observed)&&observed>=0
    ?observed/1000/900*dt
    :Math.max(0,Number(params.rainfall)||0)/1000/3600*dt*profile);
  // The catchment-wide drainage capacity is a declared exploratory assumption,
  // NOT a measured sewer-network capacity. Do not infer it from EA probability.
  const infil=(Math.max(0,Number(params.infiltration)||0)+
    Math.max(0,Number(params.assumedUrbanDrainageMmH)||0))/1000/3600*dt;

  for(let i=0;i<water.length;i++){
    if(!inside[i]||obstacle[i])continue;
    const gross=Math.max(0,water[i]+rain-infil);
    const spongeLoss=Math.min(gross,svInfilMmH[i]/1000/3600*dt);
    water[i]=gross-spongeLoss;
    sim.spongeInfilM3+=spongeLoss*cell*cell;
  }

  // Manually supplied external stage is an exploratory boundary condition,
  // never inferred from a static EA flood-probability raster.
  if((params.floodMode==='external'||params.floodMode==='coupled')&&
     params.externalStageM!==null&&Number.isFinite(Number(params.externalStageM))){
    const stage=Number(params.externalStageM);
    const riseSec=Math.max(60,Number(params.externalRiseMin||30)*60);
    const fallSec=Math.max(riseSec+60,Number(params.externalFallMin||90)*60);
    const tideProgress=clamp(sim.timeSec/riseSec,0,1);
    const recession=clamp((fallSec-sim.timeSec)/(fallSec-riseSec),0,1);
    // Ramp the inundation depth at the boundary, not the DEM datum.
    const stageFraction=Math.min(tideProgress,recession);
    const lowBoundary=sim.inletBoundaryCells||[];
    const boundarySelection=params.externalInlet==='all'?null:lowBoundary;
    for(let i=0;i<water.length;i++){
      if(!inside[i]||obstacle[i]||!boundary[i])continue;
      if(boundarySelection&&!boundarySelection.includes(i))continue;
      const target=Math.max(0,stage-terrain[i])*stageFraction;
      water[i]+=Math.min(Math.max(0,target-water[i]),0.025*dt);
    }
  }
  delta.fill(0);
  for(let row=0;row<rows;row++){
    for(let col=0;col<cols;col++){
      const i=row*cols+col;
      const h=Math.max(0,water[i]-svCapacity[i]);
      if(h<0.0001||!inside[i]||obstacle[i])continue;
      const head=terrain[i]+h;
      const neigh=[];
      if(row>0)neigh.push(i-cols);
      if(col<cols-1)neigh.push(i+1);
      if(row<rows-1)neigh.push(i+cols);
      if(col>0)neigh.push(i-1);

      let sumDrop=0,sumWeight=0;
      const weights=[];
      for(const j of neigh){
        if(!inside[j]||obstacle[j]){weights.push(0);continue;}
        const drop=Math.max(0,head-(terrain[j]+Math.max(0,water[j]-svCapacity[j])));
        sumDrop+=drop;
        // Preserve strictly downhill transfer. A mapped D8 accumulation
        // corridor only biases the distribution of EXISTING downhill flow;
        // it never creates water or imposes a fictitious hydraulic head.
        const preferCorridor=useDrainage&&accumulation[j]>=threshold&&
          accumulation[j]>accumulation[i];
        // Existing DOWNHILL transfers only: EA categories softly bias the
        // preference of already-eligible paths, NOT the water level or volume.
        const riskClass=params.floodMode==='rain-risk'&&sim.riskAvailable
          ?sim.riskRank?.[j]||0:0;
        const riskBias=riskClass===4?1.28:riskClass===3?1.17:
          riskClass===2?1.08:1;
        const weight=drop*(preferCorridor?1.5:1)*riskBias;
        weights.push(weight);
        sumWeight+=weight;
      }

      if(sumDrop>0&&sumWeight>0){
        const transferable=Math.min(h*0.36,sumDrop*0.08);
        for(let k=0;k<neigh.length;k++){
          if(weights[k]<=0)continue;
          const q=transferable*weights[k]/sumWeight;
          delta[i]-=q;
          delta[neigh[k]]+=q;
        }
      }

      if(params.openBoundary&&boundary[i]&&
         (params.floodMode==='rain'||params.floodMode==='rain-risk')){
        delta[i]-=Math.min(Math.max(0,h+delta[i]),h*0.035);
      }
    }
  }

  for(let i=0;i<water.length;i++){
    if(!inside[i]||obstacle[i]){water[i]=0;continue;}
    water[i]=Math.max(0,water[i]+delta[i]);
  }
  sim.timeSec+=dt;
}

// Depth-encoded map colours. The reference EA probability map is NOT used to
// generate these values: each pixel comes from simulated water in metres.
const SIM_DEPTH_BOUNDS=[0.001,0.05,0.15,0.30,0.60,1.20];
const SIM_DEPTH_COLOURS=[
  [190,236,255,135], // 0.001–0.05 m: shallow wet film to ponding, physically solved
  [127,207,255,168], // 0.05–0.15 m: translucent pale azure
  [68,162,249,202],  // 0.15–0.30 m: flowing sky blue
  [43,109,233,225],  // 0.30–0.60 m: saturated river blue
  [45,70,197,238],   // 0.60–1.20 m: deep cobalt
  [39,45,141,248]    // >=1.20 m: indigo deepest water
];

function depthBandIndex(depth){
  if(!(depth>=SIM_DEPTH_BOUNDS[0]))return -1;
  for(let i=1;i<SIM_DEPTH_BOUNDS.length;i++){
    if(depth<SIM_DEPTH_BOUNDS[i])return i-1;
  }
  return SIM_DEPTH_BOUNDS.length-1;
}

function depthColour(depth,pulse=0,flowStrength=0){
  const band=depthBandIndex(depth);
  if(band<0)return [0,0,0,0];
  const current=SIM_DEPTH_COLOURS[band];
  const next=SIM_DEPTH_COLOURS[Math.min(band+1,SIM_DEPTH_COLOURS.length-1)];
  const begin=SIM_DEPTH_BOUNDS[band];
  const end=SIM_DEPTH_BOUNDS[Math.min(band+1,SIM_DEPTH_BOUNDS.length-1)];
  // Continuous hue at depth transitions prevents harsh fake risk-grid edges.
  const t=band===SIM_DEPTH_BOUNDS.length-1?
    0:clamp((depth-begin)/Math.max(0.0001,end-begin),0,1);
  const blend=t*t*(3-2*t);
  let red=current[0]+(next[0]-current[0])*blend;
  let green=current[1]+(next[1]-current[1])*blend;
  let blue=current[2]+(next[2]-current[2])*blend;
  const alpha=current[3]+(next[3]-current[3])*blend;
  // Subtle display-only shimmer; no random patches or changes to water mass.
  const shimmer=clamp((pulse*0.5+0.5)*(0.012+0.045*flowStrength),0,0.07);
  red+=(240-red)*shimmer;
  green+=(250-green)*shimmer;
  blue+=(255-blue)*shimmer;
  return [
    Math.round(red),Math.round(green),Math.round(blue),Math.round(alpha)
  ];
}

function flowVisual(simulation,row,col,i){
  const {cols,rows,terrain,inside,obstacle,water,visualPhase,svCapacity}=simulation;
  const head=terrain[i]+Math.max(0,water[i]-svCapacity[i]);
  const getHead=(r,c)=>{
    if(r<0||c<0||r>=rows||c>=cols)return head;
    const j=r*cols+c;
    if(!inside[j]||obstacle[j])return head;
    return terrain[j]+Math.max(0,water[j]-svCapacity[j]);
  };
  const left=getHead(row,col-1),right=getHead(row,col+1);
  const up=getHead(row-1,col),down=getHead(row+1,col);
  const dx=left-right;
  const dy=up-down;
  const mag=Math.hypot(dx,dy);
  const nx=mag>1e-6?dx/mag:0.7071;
  const ny=mag>1e-6?dy/mag:0.7071;
  const flowStrength=clamp(mag/0.25,0,1);
  const stripe=Math.sin((col*nx+row*ny)*1.55-visualPhase*2.7);
  const ripple=Math.sin((col+row)*0.52-visualPhase*1.9);
  return {
    pulse:stripe*0.72+ripple*0.28,
    flowStrength:Math.max(0.16,flowStrength),
    nx,ny,gradient:mag
  };
}


/**
 * Display-only hydrological direction and RELATIVE intensity field.
 * Gradients use DEM + modeled water depth; buildings and the site boundary
 * are impermeable. No velocity calibration is implied by these values.
 * Eight-neighbour downhill integration allows water to turn around structures
 * while forbidding diagonal shortcuts through blocked corners.
 */
function buildHydroFlowField(force=false){
  if(!sim||(!force&&params.showFlow===false))return null;
  const {cols,rows,cell,terrain,inside,obstacle,water,svCapacity}=sim;
  const length=cols*rows;
  const vx=new Int8Array(length),vy=new Int8Array(length);
  const intensity=new Uint8Array(length);
  const directions=[
    [-1,0],[1,0],[0,-1],[0,1],
    [-1,-1],[1,-1],[-1,1],[1,1]
  ];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const i=row*cols+col;
    if(!inside[i]||obstacle[i])continue;
    const depth=Math.max(0,water[i]-svCapacity[i]);
    if(depth<0.008)continue;
    const head=terrain[i]+depth;
    let sumX=0,sumY=0,meanSlope=0,totalWeight=0;
    for(const [dx,dy] of directions){
      const x=col+dx,y=row+dy;
      if(x<0||x>=cols||y<0||y>=rows)continue;
      const j=y*cols+x;
      if(!inside[j]||obstacle[j])continue;
      // No streamline may cut a diagonal corner through a building.
      if(dx&&dy){
        const sideX=row*cols+x,sideY=y*cols+col;
        if(!inside[sideX]||!inside[sideY]||
           obstacle[sideX]||obstacle[sideY])continue;
      }
      const neighbourHead=terrain[j]+Math.max(0,water[j]-svCapacity[j]);
      const distance=Math.hypot(dx,dy);
      const slope=Math.max(0,(head-neighbourHead)/(cell*distance));
      if(slope<1e-7)continue;
      const weight=Math.sqrt(slope);
      sumX+=dx/distance*weight;
      sumY+=dy/distance*weight;
      totalWeight+=weight;
      meanSlope+=slope*weight;
    }
    const directionMagnitude=Math.hypot(sumX,sumY);
    if(directionMagnitude<1e-7||totalWeight===0)continue;
    const gradient=meanSlope/totalWeight;
    // Unitless relative intensity proxy, NOT measured m/s.
    const strength=clamp(2.5*Math.sqrt(9.81*depth*gradient),0,1);
    vx[i]=Math.round(sumX/directionMagnitude*127);
    vy[i]=Math.round(sumY/directionMagnitude*127);
    intensity[i]=Math.max(6,Math.round(strength*255));
  }
  return {cols,rows,vx,vy,intensity,units:'relative'};
}

function sendFrame(){
  if(!sim)return;
  const {cols,rows,inside,obstacle,buildingIds,water,cell,svCapacity}=sim;
  const pixels=new Uint8ClampedArray(cols*rows*4);
  // Visual 3D water uses the SAME obstacle-masked solver depths. Quantized
  // millimetres avoid a second high-bandwidth float field per frame.
  const depthMm=new Uint16Array(cols*rows);
  // Exact solver-cell visibility mask for antialiased rendering: prevent
  // water softness from bleeding over building footprints or off the parcel.
  const validMask=new Uint8Array(cols*rows);
  for(let i=0;i<validMask.length;i++)
    validMask[i]=inside[i]&&!obstacle[i]?1:0;
  const contactMask=new Uint8Array(cols*rows);
  let maxDepth=0,wetCells=0,shallowCells=0,volume=0,retainedM3=0;
  let riskOverlapCells=0,riskKnownCells=0;
  const depthCells=new Uint32Array(SIM_DEPTH_BOUNDS.length);
  const impacted=new Set();
  const markCollidingBuilding=cellIndex=>{
    if(!obstacle[cellIndex])return;
    const primaryId=buildingIds[cellIndex];
    if(primaryId)impacted.add(primaryId-1);
    const overlaps=sim.overlappingBuildingIds.get(cellIndex);
    if(overlaps)for(const id of overlaps)impacted.add(id-1);
  };
  sim.visualPhase+=0.19;

  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const i=row*cols+col;
    // Strict polygon mask: outside the selected area is always fully transparent.
    if(!inside[i]||obstacle[i])continue;
    const h=Math.max(0,water[i]-svCapacity[i]);
    if(h>=0.001){
      depthMm[i]=Math.min(65535,Math.round(h*1000));
      const touchesBuilding=
        (row>0&&obstacle[i-cols])||
        (col<cols-1&&obstacle[i+1])||
        (row<rows-1&&obstacle[i+cols])||
        (col>0&&obstacle[i-1]);
      if(touchesBuilding)contactMask[i]=1;
    }
    retainedM3+=Math.min(water[i],svCapacity[i])*cell*cell;
    if(h>maxDepth)maxDepth=h;
    if(h>=0.001)shallowCells++; // >=1 mm wet surface, NOT >2 cm flooding
    const depthBand=depthBandIndex(h);
    if(depthBand>=0)depthCells[depthBand]++;
    if(h>=0.02){
      wetCells++;volume+=h*cell*cell;
      if(sim.riskRank?.[i]>0&&sim.riskRank[i]<5)riskOverlapCells++;
    }
    if(sim.riskRank?.[i]>0&&sim.riskRank[i]<5)riskKnownCells++;
    const showFlow=params.showFlow!==false;
    const flow=(showFlow&&h>=.005)?flowVisual(sim,row,col,i):{
      pulse:0,flowStrength:0,nx:0,ny:0,gradient:0
    };
    const colour=depthColour(h,flow.pulse,flow.flowStrength);
    const p=i*4;
    pixels[p]=colour[0];pixels[p+1]=colour[1];pixels[p+2]=colour[2];pixels[p+3]=colour[3];

    if(h>=0.05){
      if(row>0)markCollidingBuilding(i-cols);
      if(col<cols-1)markCollidingBuilding(i+1);
      if(row<rows-1)markCollidingBuilding(i+cols);
      if(col>0)markCollidingBuilding(i-1);
    }
  }

  const activeSeries=Array.isArray(params.rainSeriesMm15)&&params.rainSeriesMm15.length===16?
    params.rainSeriesMm15:null;
  const seriesSlot=Math.max(0,Math.min(15,Math.floor(Math.max(0,sim.timeSec-0.01)/900)));
  const currentRainMmH=activeSeries?
    Math.max(0,Number(activeSeries[seriesSlot])||0)*4:
    Math.max(0,Number(params.rainfall)||0);
  const flowField=buildHydroFlowField();
  const buffers=[pixels.buffer,depthMm.buffer,contactMask.buffer,validMask.buffer];
  if(flowField)buffers.push(flowField.vx.buffer,
    flowField.vy.buffer,flowField.intensity.buffer);
  postMessage({
    type:'frame',scenarioYear:annualFrameYear,
    annualAreaStage,
    width:cols,height:rows,pixels:pixels.buffer,
    depthMm:depthMm.buffer,contactMask:contactMask.buffer,
    validMask:validMask.buffer,
    flowField:flowField?{
      cols:flowField.cols,rows:flowField.rows,units:'relative',
      vx:flowField.vx.buffer,vy:flowField.vy.buffer,
      intensity:flowField.intensity.buffer
    }:null,
    stats:{
      currentRainMmH,
      timeMin:sim.timeSec/60,
      depthCells:Array.from(depthCells),
      depthAreaM2:Array.from(depthCells,n=>n*cell*cell),
      maxDepthM:maxDepth,
      wetAreaM2:wetCells*cell*cell,
      shallowWetAreaM2:shallowCells*cell*cell, // distinct from flooded-area threshold
      volumeM3:volume,
      retainedM3,
      spongeInfiltrationM3:sim.spongeInfilM3,
      spongeCells:sim.spongeCellCount,
      spongeFacilities:sim.spongeFacilityCount,
      impactedCount:impacted.size,
      eaRiskOverlapPercent:wetCells>0?100*riskOverlapCells/wetCells:0,
      eaRiskMappedCells:riskKnownCells,
      eaRiskAvailable:Boolean(sim.riskAvailable)
    },
    impactedIds:[...impacted]
  },buffers);
}

function annualStorageStep(data,emit=true,facilitiesReady=false){
  if(!sim)return;
  // Baseline means no proposed sponge installations are active.
  if(!facilitiesReady){
    params={...params,interventions:[]};
    applySpongeInterventions();
  }
  const rainMm=clamp(Number(data.annualRainMm)||0,0,5000);
  const lossMm=clamp(Number(data.annualLossMm)||0,0,5000);
  const input=Math.max(0,rainMm-lossMm)/1000;
  const depletion=Math.max(0,lossMm-rainMm)/1000;
  for(let i=0;i<sim.water.length;i++){
    if(!sim.inside[i]||sim.obstacle[i])continue;
    sim.water[i]=Math.max(0,sim.water[i]+input-depletion);
  }
  // Relax the retained water along DEM gradients without injecting a new
  // hourly rainstorm. Reuses the existing routing solver with zero sources.
  const oldParams=params;
  params={...params,rainfall:0,infiltration:0,rainSeriesMm15:null,floodMode:'rain',openBoundary:false};
  for(let n=0;n<16;n++)simulationStep(5);
  params=oldParams;
  if(emit)sendFrame();
}

function tick(){
  if(!running||!sim)return;
  const endSec=Math.max(1,Number(params.duration)||60)*60;
  // Annual playback accelerates a representative event; approximate, not engineering-grade.
  const fast=Boolean(params.annualPreview);
  const dt=fast?12:3,iterations=fast?30:2;
  for(let i=0;i<iterations&&sim.timeSec<endSec;i++)simulationStep(Math.min(dt,endSec-sim.timeSec));
  sendFrame();
  if(sim.timeSec>=endSec){
    running=false;
    postMessage({type:'status',state:'complete'});
    return;
  }
  timer=setTimeout(tick,params.annualPreview?8:48);
}

onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      demConfig={
        demUrl:data.demUrl,
        demBounds:data.demBounds,
        demWidth:data.demWidth,
        demHeight:data.demHeight,
        demEncoding:data.demEncoding,
        drainageUrl:data.drainageUrl||null,
        riskMetaUrl:data.riskMetaUrl||null,
        riskTileUrls:data.riskTileUrls||null
      };
      return;
    }
    if(data.type==='setup'){
      annualStateCache.clear();annualCacheKey='';annualFrameYear=null;
      annualRiskForecast=null;annualAreaStage=null;
      running=false;clearTimeout(timer);timer=null;
      await setup(data);
      return;
    }
    if(data.type==='params'){
      const changed=Object.prototype.hasOwnProperty.call(data.params||{},'interventions');
      params={...params,...data.params};
      if(changed)applySpongeInterventions();
      if(sim&&!running)sendFrame();
      return;
    }
    if(data.type==='request-flow-field'){
      // A dedicated presentation-only request. Existing floodwater and
      // statistics are untouched; the user may switch the independent layer
      // on without running a fresh flood simulation.
      const field=buildHydroFlowField(true);
      const buffers=field?
        [field.vx.buffer,field.vy.buffer,field.intensity.buffer]:[];
      postMessage({
        type:'flow-field',
        flowField:field?{
          cols:field.cols,rows:field.rows,units:'relative',
          vx:field.vx.buffer,vy:field.vy.buffer,
          intensity:field.intensity.buffer
        }:null
      },buffers);
      return;
    }
    if(data.type==='seek-year'){
      if(!sim)return;
      running=false;clearTimeout(timer);timer=null;
      const year=clamp(Math.round(Number(data.year)||2026),2026,2100);
      const eventIntensity=clamp(Number(data.eventRainMmH)||0,0,150);
      const duration=clamp(Number(data.durationMin)||60,15,240);
      const infiltration=clamp(Number(data.infiltrationMmH??0.5),0,100);
      const assumedUrbanDrainage=clamp(Number(data.assumedUrbanDrainageMmH??0),0,100);
      const scenario='fixed-official-reference'; // user selects an absolute 2h rain event, not a climate increment
      const storm='peak'; // only the single-maximum design storm is available
      const drainage=data.drainageGuide!==false;
      const mode=['rain','rain-risk','external','coupled'].includes(data.floodMode)?
        data.floodMode:'rain';
      const externalStage=data.externalStageM===null?null:Number(data.externalStageM);
      if((mode==='external'||mode==='coupled')&&!Number.isFinite(externalStage))
        throw Error('外部洪水需要可信的绝对边界水位。');
      if(mode==='rain-risk'&&!sim.riskAvailable)
        throw Error('未取得该场地 EA 官方地表水风险栅格及有效分类；本模式不能以河流/海洋风险替代。');
      const key=[eventIntensity,duration,infiltration,assumedUrbanDrainage,scenario,storm,drainage,mode,externalStage,
        data.externalRiseMin,data.externalFallMin,data.externalInlet,
        Number(data.drainageThreshold)||0].join(':');
      if(!annualRiskForecast||annualRiskForecast.key!==key){
        postMessage({type:'status',state:'preparing',
          message:mode==='rain-risk'
            ?'正在计算 DEM 降雨汇流，并以 EA 现状风险等级轻度引导下坡流动（非水深校准）…'
            :'正在运行两场独立设计事件，并对照 EA 洪涝风险位置…'});
        const priorParams=params;
        const runEvent=factor=>{
          sim.water.fill(0);sim.delta.fill(0);
          sim.timeSec=0;sim.visualPhase=0;sim.spongeInfilM3=0;
          params={...params,rainfall:mode==='external'?0:eventIntensity*factor,
            infiltration,duration,stormProfile:storm,
            assumedUrbanDrainageMmH:assumedUrbanDrainage,
            rainSeriesMm15:null,externalStageM:externalStage,floodMode:mode,
            externalRiseMin:Number(data.externalRiseMin)||30,
            externalFallMin:Number(data.externalFallMin)||90,
            externalInlet:data.externalInlet==='all'?'all':'low',
            interventions:[],openBoundary:true,
            drainageGuide:drainage,
            drainageThreshold:Number(data.drainageThreshold)||0};
          applySpongeInterventions();
          const steps=Math.ceil(duration*60/12);
          for(let i=0;i<steps;i++)
            simulationStep(Math.min(12,duration*60-sim.timeSec));
          return new Float32Array(sim.water);
        };
        try{
          const baseline=runEvent(1);
          const futureFactor=1; // v3.22.22: only selected, reference-based 2h rainfall scenario; no hidden +10/+25/+40 uplift
          const future=runEvent(futureFactor);
          // Compute both scenario storms for reference, but the VIDEO timeline
          // starts at a NO-ADDITIONAL-WATER scene in 2026. This is a visual
          // baseline, NOT a claim of zero real-world flood risk in 2026.
          // Year 2100 uses exactly the event-solver's future result. Intermediate
          // frames reveal equal fractions of FINAL mapped inundation. Never
          // synthesize flood cells outside the independently calculated future.
          const visibleWet=[],visibleShallow=[];
          let finalWetCount=0;
          const colourThreshold=.001,wetThreshold=.02;
          for(let i=0;i<sim.water.length;i++){
            if(!sim.inside[i]||sim.obstacle[i])continue;
            const depth=future[i]-sim.svCapacity[i];
            if(depth>=wetThreshold){visibleWet.push(i);finalWetCount++;}
            else if(depth>=colourThreshold)visibleShallow.push(i);
          }
          const risk=i=>{
            const code=sim.riskRank?.[i]||0;
            return code>=1&&code<=4?code:0;
          };
          const sortByRiskAndLowTerrain=(a,b)=>
            risk(b)-risk(a)||
            sim.terrain[a]-sim.terrain[b]||
            future[b]-future[a]||a-b;
          visibleWet.sort(sortByRiskAndLowTerrain);
          visibleShallow.sort(sortByRiskAndLowTerrain);
          annualRiskForecast={key,baseline,future,futureFactor,
            eventIntensity,duration,infiltration,assumedUrbanDrainage,
            scenario,mode,riskAvailable:sim.riskAvailable,
            visibleWet,visibleShallow,finalWetCount,
            wetThreshold,colourThreshold};
        }finally{params=priorParams;applySpongeInterventions();}
      }
      const forecast=annualRiskForecast;
      const progress=(year-2026)/74;
      sim.water.fill(0);sim.delta.fill(0);
      // BOTH wet-area and shallow-colour cells are revealed in 74 equal
      // yearly fractions. Water depths increase towards the computed final
      // field. No 2026 model flood is displayed; none of these interim years
      // is a physically solved future annual flood.
      const wetVisible=Math.round(progress*forecast.visibleWet.length);
      const shallowVisible=Math.round(progress*forecast.visibleShallow.length);
      const reveal=(sorted,count,threshold)=>{
        for(let k=0;k<count;k++){
          const i=sorted[k],finalDepth=Math.max(0,forecast.future[i]);
          // Newly visible cells begin near their respective display
          // thresholds then deepen; never exceed the final computed depth.
          const birth=(k+.5)/Math.max(1,sorted.length);
          const age=Math.max(0,Math.min(1,
            (progress-birth)/Math.max(1/74,1-birth)));
          const depth=Math.min(finalDepth,
            Math.max(threshold,finalDepth*(.20+.80*age)));
          sim.water[i]=depth;
        }
      };
      if(year>2026){
        reveal(forecast.visibleWet,wetVisible,forecast.wetThreshold+.0001);
        reveal(forecast.visibleShallow,shallowVisible,forecast.colourThreshold+.0001);
      }
      // The animation begins dry and ends exactly on the computed result.
      if(year===2100)sim.water.set(forecast.future);
      sim.timeSec=0;
      annualFrameYear=year;
      annualAreaStage={
        kind:'rainfall-risk-scenario',year,fraction:progress,
        floodMode:forecast.mode,
        baseRainMmH:forecast.mode==='external'?0:forecast.eventIntensity,
        designRainMmH:forecast.mode==='external'?0:forecast.eventIntensity*
          (1+(forecast.futureFactor-1)*progress),
        durationMin:forecast.duration,
        assumedUrbanDrainageMmH:forecast.assumedUrbanDrainage,
        baselineWetAreaM2:0,
        finalWetAreaM2:forecast.finalWetCount*sim.cell*sim.cell,
        targetWetAreaM2:wetVisible*sim.cell*sim.cell,
        addedCellCount:forecast.visibleWet.length,
        removedCellCount:0,
        zeroWaterAt2026:true,areaStaging:true,
        riskAvailable:forecast.riskAvailable,
        riskReference:'EA RoFSW surface-water ordinal categories; guidance only; RoFRS excluded',
        methodologicalNote:mode==='rain-risk'
          ?'Rainfall supplies water; DEM/buildings/drainage govern movement. Mapped EA ordinal flood-risk classes guide downhill path preference and visual ordering, never add flood depth or boundary inflow. 2026 is a dry visual start, not actual historical flood conditions.'
          :'2026 is a zero-additional-water PRESENTATION baseline. 2100 is an independently modeled design storm; mapped cells and depth build gradually over 74 steps. EA risk guides ordering only. This is NOT a historical or annual flood prediction.'
      };
      sendFrame();
      annualFrameYear=null;annualAreaStage=null;
      return;
    }
    if(data.type==='annual-step'){
      annualFrameYear=Number(data.climateYear)||null;
      if(running)throw new Error('请先暂停短时模拟，再运行年度蓄水情景');
      annualStorageStep(data);annualFrameYear=null;return;
    }
    if(data.type==='start'){
      params={...params,...data.params};
      if(!sim)throw new Error('请先圈选并准备模拟区域');
      applySpongeInterventions();
      if(running)return;
      running=true;
      postMessage({type:'status',state:'running'});
      tick();
      return;
    }
    if(data.type==='pause'){
      running=false;clearTimeout(timer);timer=null;
      postMessage({type:'status',state:'paused'});
      return;
    }
    if(data.type==='reset-initial'){
      running=false;clearTimeout(timer);timer=null;
      annualStateCache.clear();annualCacheKey='';
      annualRiskForecast=null;
      annualFrameYear=null;annualAreaStage=null;
      if(sim){
        sim.water.fill(0);
        sim.delta.fill(0);
        sim.timeSec=0;sim.visualPhase=0;sim.spongeInfilM3=0;
        params={...params,interventions:[]};
        applySpongeInterventions();
        annualFrameYear=2026;
        annualAreaStage={kind:'rainfall-risk-scenario',resetInitial:true,
          year:2026,fraction:0,targetAreaM2:0,finalAreaM2:0,totalNetRainMm:0};
        sendFrame();
        annualFrameYear=null;annualAreaStage=null;
      }
      postMessage({type:'status',state:'reset'});
      return;
    }
    if(data.type==='reset'){
      annualFrameYear=null;
      running=false;clearTimeout(timer);timer=null;
      if(sim){
        sim.water.fill(0);sim.timeSec=0;sim.visualPhase=0;
        sim.spongeInfilM3=0;
        if(!data.silent)sendFrame();
      }
      postMessage({type:'status',state:'reset'});
    }
  }catch(error){
    running=false;clearTimeout(timer);timer=null;
    postMessage({type:'error',requestId:data.requestId||0,message:error?.message||String(error)});
  }
};
