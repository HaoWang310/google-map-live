const R=6378137;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let demConfig=null;
let demPromise=null;
let drainagePromise=null;
let sim=null;
let running=false;
let timer=null;
let params={
  rainfall:50,infiltration:5,duration:60,openBoundary:true,
  drainageGuide:true,drainageThreshold:1,rainSeriesMm15:null,
  interventions:[],showFlow:true,floodMode:'rain',externalStageM:null
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
    boundsLngLat:[
      lngLat(box.left,box.top),
      lngLat(box.right,box.top),
      lngLat(box.right,box.bottom),
      lngLat(box.left,box.bottom)
    ]
  });
  sendFrame();
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
  const rain=params.floodMode==='external'?0:(Number.isFinite(observed)&&observed>=0
    ?observed/1000/900*dt
    :Math.max(0,Number(params.rainfall)||0)/1000/3600*dt);
  const infil=Math.max(0,Number(params.infiltration)||0)/1000/3600*dt;

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
    for(let i=0;i<water.length;i++){
      if(!inside[i]||obstacle[i]||!boundary[i])continue;
      const target=Math.max(0,stage-terrain[i]);
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
        const weight=drop*(preferCorridor?1.5:1);
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

      if(params.openBoundary&&boundary[i]&&params.floodMode==='rain'){
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
const SIM_DEPTH_BOUNDS=[0.005,0.05,0.15,0.30,0.60,1.20];
const SIM_DEPTH_COLOURS=[
  [54,197,218,150],  // 0.005–0.05 m: legible shallow cyan
  [16,177,209,190],  // 0.05–0.15 m: blue-green
  [23,151,215,210],  // 0.15–0.30 m: clear turquoise blue
  [24,104,198,230],  // 0.30–0.60 m: saturated blue
  [20,64,167,241],   // 0.60–1.20 m: deep blue
  [11,35,111,248]    // >=1.20 m: deep navy
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

function sendFrame(){
  if(!sim)return;
  const {cols,rows,inside,obstacle,buildingIds,water,cell,svCapacity}=sim;
  const pixels=new Uint8ClampedArray(cols*rows*4);
  // Visual 3D water uses the SAME obstacle-masked solver depths. Quantized
  // millimetres avoid a second high-bandwidth float field per frame.
  const depthMm=new Uint16Array(cols*rows);
  const contactMask=new Uint8Array(cols*rows);
  let maxDepth=0,wetCells=0,volume=0,retainedM3=0;
  const depthCells=new Uint32Array(SIM_DEPTH_BOUNDS.length);
  const impacted=new Set();
  const markCollidingBuilding=cellIndex=>{
    if(!obstacle[cellIndex])return;
    const primaryId=buildingIds[cellIndex];
    if(primaryId)impacted.add(primaryId-1);
    const overlaps=sim.overlappingBuildingIds.get(cellIndex);
    if(overlaps)for(const id of overlaps)impacted.add(id-1);
  };
  const vectors=[];
  sim.visualPhase+=0.19;

  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const i=row*cols+col;
    // Strict polygon mask: outside the selected area is always fully transparent.
    if(!inside[i]||obstacle[i])continue;
    const h=Math.max(0,water[i]-svCapacity[i]);
    if(h>=0.005){
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
    const depthBand=depthBandIndex(h);
    if(depthBand>=0)depthCells[depthBand]++;
    if(h>=0.02){wetCells++;volume+=h*cell*cell;}
    const showFlow=params.showFlow!==false;
    const shouldArrow=showFlow&&h>.025&&row%6===3&&col%6===3&&vectors.length<180;
    const flow=(showFlow&&h>=.005)?flowVisual(sim,row,col,i):{
      pulse:0,flowStrength:0,nx:0,ny:0,gradient:0
    };
    if(shouldArrow&&flow.gradient>0.001){
      vectors.push([col,row,flow.nx,flow.ny]);
    }
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
  postMessage({
    type:'frame',width:cols,height:rows,pixels:pixels.buffer,
    depthMm:depthMm.buffer,contactMask:contactMask.buffer,
    vectors,
    stats:{
      currentRainMmH,
      timeMin:sim.timeSec/60,
      depthCells:Array.from(depthCells),
      depthAreaM2:Array.from(depthCells,n=>n*cell*cell),
      maxDepthM:maxDepth,
      wetAreaM2:wetCells*cell*cell,
      volumeM3:volume,
      retainedM3,
      spongeInfiltrationM3:sim.spongeInfilM3,
      spongeCells:sim.spongeCellCount,
      spongeFacilities:sim.spongeFacilityCount,
      impactedCount:impacted.size
    },
    impactedIds:[...impacted]
  },[pixels.buffer,depthMm.buffer,contactMask.buffer]);
}

function tick(){
  if(!running||!sim)return;
  const endSec=Math.max(1,Number(params.duration)||60)*60;
  // Smaller physical increments make the propagation visible instead of jumping.
  for(let i=0;i<2&&sim.timeSec<endSec;i++)simulationStep(3);
  sendFrame();
  if(sim.timeSec>=endSec){
    running=false;
    postMessage({type:'status',state:'complete'});
    return;
  }
  timer=setTimeout(tick,48);
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
        drainageUrl:data.drainageUrl||null
      };
      return;
    }
    if(data.type==='setup'){
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
    if(data.type==='reset'){
      running=false;clearTimeout(timer);timer=null;
      if(sim){
        sim.water.fill(0);sim.timeSec=0;sim.visualPhase=0;
        sim.spongeInfilM3=0;sendFrame();
      }
      postMessage({type:'status',state:'reset'});
    }
  }catch(error){
    running=false;clearTimeout(timer);timer=null;
    postMessage({type:'error',requestId:data.requestId||0,message:error?.message||String(error)});
  }
};
