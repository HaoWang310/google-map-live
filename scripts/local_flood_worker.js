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
  drainageGuide:true,drainageThreshold:1
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
          simulation.buildingIds[i]=building.id+1;
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

  for(let row=0;row<rows;row++){
    const y=box.top-(row+.5)*cell;
    for(let col=0;col<cols;col++){
      const x=box.left+(col+.5)*cell;
      const i=row*cols+col;
      if(!pointInPolygon(x,y,selectionRings))continue;
      const z=sampleDem(codes,x,y);
      if(!Number.isFinite(z))continue;
      inside[i]=1;
      terrain[i]=z;
      if(upstreamCodes)accumulation[i]=sampleDrainageCode(upstreamCodes,x,y);
    }
  }

  sim={
    left:box.left,right:box.right,bottom:box.bottom,top:box.top,
    cols,rows,cell,terrain,inside,obstacle,buildingIds,boundary,
    accumulation,drainageAvailable:Boolean(upstreamCodes),
    water:new Float32Array(cols*rows),
    delta:new Float32Array(cols*rows),
    timeSec:0,
    visualPhase:0,
    buildings:data.buildings||[],
    polygon:data.polygon
  };

  for(const building of sim.buildings)rasterizeBuilding(sim,building);

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

function simulationStep(dt=5){
  if(!sim)return;
  const {cols,rows,terrain,inside,obstacle,water,delta,boundary,accumulation}=sim;
  const useDrainage=Boolean(params.drainageGuide&&sim.drainageAvailable);
  const threshold=accumulationCode(params.drainageThreshold);
  const rain=Math.max(0,Number(params.rainfall)||0)/1000/3600*dt;
  const infil=Math.max(0,Number(params.infiltration)||0)/1000/3600*dt;

  for(let i=0;i<water.length;i++){
    if(!inside[i]||obstacle[i])continue;
    water[i]=Math.max(0,water[i]+rain-infil);
  }

  delta.fill(0);
  for(let row=0;row<rows;row++){
    for(let col=0;col<cols;col++){
      const i=row*cols+col;
      const h=water[i];
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
        const drop=Math.max(0,head-(terrain[j]+water[j]));
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

      if(params.openBoundary&&boundary[i]){
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

function depthColour(depth,pulse=0,flowStrength=0){
  if(depth<0.005)return [0,0,0,0];
  const stops=[
    [0.005,160,232,255,38],
    [0.03,82,207,255,112],
    [0.10,31,163,255,165],
    [0.30,16,116,222,198],
    [0.60,18,73,167,220],
    [1.20,13,44,110,238]
  ];
  let a=stops[0],b=stops[stops.length-1];
  for(let i=1;i<stops.length;i++)if(depth<=stops[i][0]){a=stops[i-1];b=stops[i];break;}
  const t=clamp((depth-a[0])/(b[0]-a[0]||1),0,1);
  let r=a[1]+(b[1]-a[1])*t;
  let g=a[2]+(b[2]-a[2])*t;
  let blue=a[3]+(b[3]-a[3])*t;
  let alpha=a[4]+(b[4]-a[4])*t;

  // Display-only moving highlight: the hydrodynamic state remains unchanged.
  const glint=clamp((pulse*.5+.5)*(0.05+0.18*flowStrength),0,0.24);
  r=r+(255-r)*glint;
  g=g+(255-g)*glint;
  blue=blue+(255-blue)*glint*.75;
  alpha*=0.88+0.12*(pulse*.5+.5);

  return [Math.round(r),Math.round(g),Math.round(blue),Math.round(alpha)];
}

function flowVisual(simulation,row,col,i){
  const {cols,rows,terrain,inside,obstacle,water,visualPhase}=simulation;
  const head=terrain[i]+water[i];
  const getHead=(r,c)=>{
    if(r<0||c<0||r>=rows||c>=cols)return head;
    const j=r*cols+c;
    if(!inside[j]||obstacle[j])return head;
    return terrain[j]+water[j];
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
    flowStrength:Math.max(0.16,flowStrength)
  };
}

function sendFrame(){
  if(!sim)return;
  const {cols,rows,inside,obstacle,buildingIds,water,cell}=sim;
  const pixels=new Uint8ClampedArray(cols*rows*4);
  let maxDepth=0,wetCells=0,volume=0;
  const impacted=new Set();
  sim.visualPhase+=0.19;

  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const i=row*cols+col;
    // Strict polygon mask: outside the selected area is always fully transparent.
    if(!inside[i]||obstacle[i])continue;
    const h=water[i];
    if(h>maxDepth)maxDepth=h;
    if(h>=0.02){wetCells++;volume+=h*cell*cell;}
    const flow=flowVisual(sim,row,col,i);
    const colour=depthColour(h,flow.pulse,flow.flowStrength);
    const p=i*4;
    pixels[p]=colour[0];pixels[p+1]=colour[1];pixels[p+2]=colour[2];pixels[p+3]=colour[3];

    if(h>=0.05){
      if(row>0&&obstacle[i-cols]&&buildingIds[i-cols])impacted.add(buildingIds[i-cols]-1);
      if(col<cols-1&&obstacle[i+1]&&buildingIds[i+1])impacted.add(buildingIds[i+1]-1);
      if(row<rows-1&&obstacle[i+cols]&&buildingIds[i+cols])impacted.add(buildingIds[i+cols]-1);
      if(col>0&&obstacle[i-1]&&buildingIds[i-1])impacted.add(buildingIds[i-1]-1);
    }
  }

  postMessage({
    type:'frame',width:cols,height:rows,pixels:pixels.buffer,
    stats:{
      timeMin:sim.timeSec/60,
      maxDepthM:maxDepth,
      wetAreaM2:wetCells*cell*cell,
      volumeM3:volume,
      impactedCount:impacted.size
    },
    impactedIds:[...impacted]
  },[pixels.buffer]);
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
      params={...params,...data.params};
      return;
    }
    if(data.type==='start'){
      params={...params,...data.params};
      if(!sim)throw new Error('请先圈选并准备模拟区域');
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
      if(sim){sim.water.fill(0);sim.timeSec=0;sim.visualPhase=0;sendFrame();}
      postMessage({type:'status',state:'reset'});
    }
  }catch(error){
    running=false;clearTimeout(timer);timer=null;
    postMessage({type:'error',requestId:data.requestId||0,message:error?.message||String(error)});
  }
};
