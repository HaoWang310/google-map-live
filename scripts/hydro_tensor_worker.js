/* London Map · v3.22.46-tensor-base-wet.
   Hydro tensor only: OS Terrain 50 DEM, contributing-area drainage,
   modeled 2026-2100 depth/head-gradient and real OSM building barriers.
   The symmetric 2x2 tensor is hydrological ORIENTATION, not measured velocity,
   not a designed road centerline, and not higher-resolution DEM information. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const EPS=1e-9;
function solve(data){
  const {cols:w,rows:h}=data,n=w*h;
  if(!Number.isInteger(n)||n<=0||n>70000)throw Error('Invalid tensor grid');
  const terrain=new Float32Array(data.terrain);
  const accumulation=new Uint16Array(data.accumulation);
  const inside=new Uint8Array(data.inside);
  const barrier=new Uint8Array(data.obstacle);
  const depth=new Uint16Array(data.depthMm);
  const flowX=new Int8Array(data.vx),flowY=new Int8Array(data.vy);
  const flowPower=new Uint8Array(data.intensity);
  if([terrain,accumulation,inside,barrier,depth,flowX,flowY,flowPower]
    .some(a=>a.length!==n))throw Error('Tensor input grid mismatch');
  const cfg=data.config||{};
  const wt=clamp(Number(cfg.terrainWeight??35)/100,0,1);
  const wd=clamp(Number(cfg.drainageWeight??45)/100,0,1);
  // Former UI "flood avoidance" is now hydrological wetness influence.
  // Keep avoidance key as a backward-compatible read-only configuration field.
  const wa=clamp(Number(cfg.wetnessWeight??cfg.avoidance??70)/100,0,1);
  const smooth=clamp(Number(cfg.smoothness??60)/100,0,1);
  const cross=clamp(Number(cfg.crossStrength??60)/100,0,1);
  const dx=Math.max(1,Number(data.cellX)||10),dy=Math.max(1,Number(data.cellY)||10);
  // OS Terrain 50 contributes no new independent elevations at 10m grid
  // spacing. Estimate DEM gradients at >=50m neighbour SUPPORT, while retaining
  // the original solver grid only for obstacles, water and drawing placement.
  const demSupportMeters=50;
  const demRadiusX=Math.max(1,Math.ceil(demSupportMeters/dx));
  const demRadiusY=Math.max(1,Math.ceil(demSupportMeters/dy));
  const tensorXX=new Float32Array(n),tensorXY=new Float32Array(n),tensorYY=new Float32Array(n);
  const primaryX=new Float32Array(n),primaryY=new Float32Array(n);
  // A distinct terrain/catchment orientation persists even when depth=0.
  // These are only derived from measured DEM gradients, never generated
  // arbitrarily on unsupported perfectly flat areas.
  const basePrimaryX=new Float32Array(n),basePrimaryY=new Float32Array(n);
  const baseConfidence=new Float32Array(n),baseIntensity=new Float32Array(n);
  const crossCos4=new Float32Array(n),crossSin4=new Float32Array(n);
  const confidence=new Float32Array(n),suitability=new Float32Array(n);
  const crossSuitability=new Float32Array(n);
  const drainageRank=new Float32Array(n),avoidMask=new Float32Array(n);
  const floodProximity=new Float32Array(n),validMask=new Uint8Array(n);
  // Read-only, native-grid hydrological corridor diagnostics. These are
  // NOT road centerlines and do not change flood hydraulics.
  const corridorRank=new Float32Array(n),corridorAxisX=new Float32Array(n),
    corridorAxisY=new Float32Array(n),corridorDistance=new Float32Array(n);
  const trunkMask=new Uint8Array(n);
  const cos2=new Float32Array(n),sin2=new Float32Array(n);
  const slopeX=new Float32Array(n),slopeY=new Float32Array(n);
  const waterActive=new Float32Array(n),hydX=new Float32Array(n),hydY=new Float32Array(n);
  const valid=i=>i>=0&&i<n&&inside[i]!==0&&!barrier[i]&&Number.isFinite(terrain[i]);
  // Decode the raster's LOG upstream-area encoding to a normalized log rank,
  // never treat codes as rainfall volume or an actual measured drain flow.
  for(let i=0;i<n;i++){
    if(!valid(i))continue;
    validMask[i]=1;
    drainageRank[i]=accumulation[i]>0?(accumulation[i]-1)/65534:0;
    waterActive[i]=Math.max(
      clamp((depth[i]/1000)/.14,0,1),
      clamp(flowPower[i]/255,0,1)
    );
    const f=Math.hypot(flowX[i],flowY[i]);
    if(f>2){hydX[i]=flowX[i]/f;hydY[i]=flowY[i]/f}
  }
  // First, compute local terrain gradient without crossing barriers.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(!valid(i))continue;
    const left=x>0?y*w+Math.max(0,x-demRadiusX):i;
    const right=x+1<w?y*w+Math.min(w-1,x+demRadiusX):i;
    const top=y>0?Math.max(0,y-demRadiusY)*w+x:i;
    const bottom=y+1<h?Math.min(h-1,y+demRadiusY)*w+x:i;
    if(left!==right&&valid(left)&&valid(right))
      slopeX[i]=(terrain[right]-terrain[left])/((right-left)*dx);
    if(top!==bottom&&valid(top)&&valid(bottom))
      slopeY[i]=(terrain[bottom]-terrain[top])/((bottom-top)/w*dy);
  }
  // Valid topographic gradient evidence underpins an always-visible BASE
  // tensor layer. Accumulation ranks strengthen coherence but never invent
  // an absolute direction where no downhill information exists.
  for(let i=0;i<n;i++)if(validMask[i]){
    const gx=slopeX[i],gy=slopeY[i],steep=Math.hypot(gx,gy);
    if(steep>1e-6){
      basePrimaryX[i]=-gx/steep;basePrimaryY[i]=-gy/steep;
      baseConfidence[i]=clamp(.26+.74*steep/(steep+.012),0,1);
      baseIntensity[i]=clamp(.30+.44*Math.sqrt(drainageRank[i])+
        .26*baseConfidence[i],0,1);
    }
  }
  // Propagate an observed local DEM orientation only across adjacent valid
  // cells and no more than 50m. This bridges building-edge derivative gaps
  // without treating interpolated guidance as independent high-res DEM data.
  const baseRadius=Math.max(0,Math.min(4,Math.floor(50/Math.max(dx,dy))));
  if(baseRadius>0){
    const nextX=new Float32Array(n),nextY=new Float32Array(n),
      nextC=new Float32Array(n);
    for(let pass=0;pass<baseRadius;pass++){
      nextX.set(basePrimaryX);nextY.set(basePrimaryY);
      nextC.set(baseConfidence);
      let updated=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=y*w+x;
        if(!validMask[i]||baseConfidence[i]>.0001)continue;
        let ax=0,ay=0,weight=0;
        const neighbors=[x>0?i-1:-1,x+1<w?i+1:-1,
          y>0?i-w:-1,y+1<h?i+w:-1];
        for(const j of neighbors){
          if(j<0||!validMask[j]||baseConfidence[j]<=.05)continue;
          const strength=baseConfidence[j];
          ax+=basePrimaryX[j]*strength;
          ay+=basePrimaryY[j]*strength;
          weight+=strength;
        }
        const magnitude=Math.hypot(ax,ay);
        if(weight>.15&&magnitude/weight>.40){
          nextX[i]=ax/magnitude;nextY[i]=ay/magnitude;
          nextC[i]=Math.min(.6,weight/4)*Math.pow(.72,pass+1);
          updated++;
        }
      }
      if(!updated)break;
      basePrimaryX.set(nextX);basePrimaryY.set(nextY);
      baseConfidence.set(nextC);
    }
    for(let i=0;i<n;i++)if(validMask[i]&&baseConfidence[i]>.02&&
      baseIntensity[i]===0){
      baseIntensity[i]=clamp(.21+.42*Math.sqrt(drainageRank[i])+
        .20*baseConfidence[i],0,1);
    }
  }
  // Precompute flood avoidance PROXIMITY by a bounded, masked diffusion
  // in native cells, not by creating spurious high-resolution sample points.
  const danger=new Float32Array(n),buffer=new Float32Array(n);
  for(let i=0;i<n;i++)if(validMask[i])
    danger[i]=clamp((depth[i]/1000-.015)/.26,0,1);
  for(let pass=0;pass<3;pass++){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!validMask[i])continue;
      let total=danger[i]*4,count=4;
      const neigh=[x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1];
      for(const j of neigh){if(j>=0&&validMask[j]){total+=danger[j];count++}}
      buffer[i]=total/count;
    }
    danger.set(buffer);
  }
  for(let i=0;i<n;i++)floodProximity[i]=danger[i];
  // Construct two orthogonal hydrographic principal axes as a symmetric
  // 2nd-order tensor. Each directional cue is an undirected line orientation
  // (cos(2theta), sin(2theta)), not a random motion or street network.
  const rainfallInfluence=new Float32Array(n);
  const hydroIntensity=new Float32Array(n);
  const floodConstraint=new Float32Array(n);
  const secondaryX=new Float32Array(n),secondaryY=new Float32Array(n);
  const addAxis=(angle,weight,sum)=>{
    if(!(weight>EPS)||!Number.isFinite(angle))return;
    sum[0]+=weight*Math.cos(2*angle);
    sum[1]+=weight*Math.sin(2*angle);
    sum[2]+=weight;
  };
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(!validMask[i])continue;
    const gx=slopeX[i],gy=slopeY[i],slope=Math.hypot(gx,gy);
    const catchment=clamp(drainageRank[i],0,1);
    const trunk=Math.sqrt(catchment);
    const water=clamp(waterActive[i],0,1);
    const floodEdge=clamp(floodProximity[i],0,1);
    rainfallInfluence[i]=water;
    floodConstraint[i]=clamp(.65*water+.35*floodEdge,0,1);
    // Dry 2026 still shows real DEM-derived directional potential, faintly.
    // Water depth amplifies the same field and, where available, reorients
    // the tensor toward the current modeled hydraulic-head gradient.
    hydroIntensity[i]=clamp(
      (.10+.29*trunk)*(.30+.70*(1-wd*.25))+
      (.28+.30*trunk)*water,0,1);
    const sum=[0,0,0];
    const downhillX=-gx,downhillY=-gy;
    if(slope>1e-6){
      const downhillAngle=Math.atan2(downhillY,downhillX);
      addAxis(downhillAngle,wt*(.15+.85*clamp(slope/.08,0,1)),sum);
      // Contributing area is a strength of topographically derived water
      // pathways: it is not a separate fake measured velocity vector.
      addAxis(downhillAngle,wd*(.18+.82*trunk),sum);
    }
    if(water>.008&&Math.hypot(hydX[i],hydY[i])>.5){
      addAxis(Math.atan2(hydY[i],hydX[i]),
        wa*water*(.32+.68*trunk),sum);
    }
    // The actual modeled inundation gradient bends hydrography along
    // the interface between water and dry terrain, but must not replace
    // the downhill/drainage evidence with a proposed avoidance road.
    const left=x>0?i-1:i,right=x+1<w?i+1:i;
    const top=y>0?i-w:i,bottom=y+1<h?i+w:i;
    const wx=validMask[left]&&validMask[right]?
      (floodProximity[right]-floodProximity[left])/
        Math.max(1,(right-left)*dx):0;
    const wy=validMask[top]&&validMask[bottom]?
      (floodProximity[bottom]-floodProximity[top])/
        Math.max(1,(bottom-top)/w*dy):0;
    const edgeMag=Math.hypot(wx,wy);
    if(edgeMag>1e-7&&water>.005){
      addAxis(Math.atan2(wy,wx),
        wa*water*.25*clamp(edgeMag*Math.max(dx,dy)*8,0,1),sum);
    }
    // Previously "suitability" removed inundated cells as poor ROAD land.
    // It now means hydrological sample reliability. Water is allowed and
    // highlighted; building / outside-site cells remain exactly invalid.
    avoidMask[i]=floodConstraint[i];
    suitability[i]=clamp(.32+.43*trunk+.25*water,0,1);
    const coherence=sum[2]>EPS?
      clamp(Math.hypot(sum[0],sum[1])/sum[2],0,1):0;
    const directionalEvidence=clamp(sum[2]/(sum[2]+.12),0,1);
    confidence[i]=clamp(coherence*directionalEvidence,0,1);
    const angle=sum[2]>EPS?.5*Math.atan2(sum[1],sum[0]):0;
    cos2[i]=Math.cos(2*angle);
    sin2[i]=Math.sin(2*angle);
  }
  // Native cell orientation smoothing across valid open terrain only.
  // No smoothing through any building or outside the selected parcel.
  const tmpC=new Float32Array(n),tmpS=new Float32Array(n);
  for(let pass=0;pass<Math.round(smooth*4);pass++){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!validMask[i])continue;
      let c=cos2[i]*4*confidence[i],s=sin2[i]*4*confidence[i],weight=4*confidence[i];
      const neighbors=[x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1];
      for(const j of neighbors){
        if(j<0||!validMask[j]||confidence[j]<.02)continue;
        const wj=.25+.75*confidence[j];
        c+=cos2[j]*wj;s+=sin2[j]*wj;weight+=wj;
      }
      if(weight>EPS){tmpC[i]=c/weight;tmpS[i]=s/weight}
      else{tmpC[i]=cos2[i];tmpS[i]=sin2[i]}
    }
    for(let i=0;i<n;i++)if(validMask[i]){
      const length=Math.hypot(tmpC[i],tmpS[i]);
      if(length>1e-5){cos2[i]=tmpC[i]/length;sin2[i]=tmpS[i]/length}
    }
  }
  for(let i=0;i<n;i++){
    if(!validMask[i])continue;
    const theta=.5*Math.atan2(sin2[i],cos2[i]);
    const ux=Math.cos(theta),uy=Math.sin(theta);
    primaryX[i]=ux;primaryY[i]=uy;
    secondaryX[i]=-uy;secondaryY[i]=ux;
    // Secondary direction is an orthogonal eigendirection of the same
    // hydrological tensor, not a road crossfield imposed on urban blocks.
    crossSuitability[i]=confidence[i];
    const major=.08+.72*confidence[i]+.20*rainfallInfluence[i];
    const minor=.06+.12*(1-confidence[i]);
    tensorXX[i]=minor+(major-minor)*ux*ux;
    tensorXY[i]=(major-minor)*ux*uy;
    tensorYY[i]=minor+(major-minor)*uy*uy;
    crossCos4[i]=Math.cos(4*theta);
    crossSin4[i]=Math.sin(4*theta);
  }
  // Identify the site's dominant contiguous drainage contribution zone.
  // Site-specific percentiles avoid a fixed guessed rainfall threshold.
  // The core always derives from actual accumulated drainage, never noise.
  const ranks=[];
  for(let i=0;i<n;i++)if(validMask[i]&&drainageRank[i]>0)ranks.push(drainageRank[i]);
  ranks.sort((a,b)=>a-b);
  const q=p=>ranks[Math.min(ranks.length-1,Math.floor(p*(ranks.length-1)))]||0;
  const q25=q(.25),q82=q(.82),q95=q(.95);
  const hasDrainageContrast=ranks.length>24&&q95-q25>.08;
  const qCore=hasDrainageContrast?Math.max(q82,q25+.15):Infinity;
  let coreCount=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!validMask[i])continue;
    const rank=drainageRank[i];
    // Use DEM-derived downhill axis as the default and the computed
    // hydraulic vector only as supplementary evidence where water exists.
    let ax=-slopeX[i],ay=-slopeY[i];
    if(waterActive[i]>.12&&Math.hypot(hydX[i],hydY[i])>.5){
      const weight=Math.min(.55,waterActive[i]*.42);
      const len=Math.hypot(ax,ay)||1;
      ax=ax/len*(1-weight)+hydX[i]*weight;
      ay=ay/len*(1-weight)+hydY[i]*weight;
    }
    const len=Math.hypot(ax,ay);
    if(len>1e-8){corridorAxisX[i]=ax/len;corridorAxisY[i]=ay/len}
    corridorRank[i]=clamp(
      .82*Math.sqrt(rank)+.18*waterActive[i],0,1);
    if(rank>=qCore&&len>1e-8){
      // An isolated high-accumulation pixel is not a corridor. Require
      // downstream/upstream continuity with at least one valid neighbour.
      let adjacent=0;
      for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nx=x+ox,ny=y+oy;
        if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const j=ny*w+nx;
        if(validMask[j]&&drainageRank[j]>=qCore*.92)adjacent++;
      }
      if(adjacent){trunkMask[i]=1;coreCount++}
    }
  }
  // Distance transform remains on source cells, never pretending to add
  // higher-resolution observations. Obstacles and parcel borders are hard.
  corridorDistance.fill(-1);
  if(coreCount){
    const queue=new Int32Array(n);let head=0,tail=0;
    for(let i=0;i<n;i++)if(trunkMask[i]){
      queue[tail++]=i;corridorDistance[i]=0;
    }
    const maxSteps=14;
    while(head<tail){
      const i=queue[head++],steps=corridorDistance[i];
      if(steps>=maxSteps)continue;
      const x=i%w,y=(i/w)|0;
      for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nx=x+ox,ny=y+oy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const j=ny*w+nx;
        if(!validMask[j]||corridorDistance[j]>=0)continue;
        corridorDistance[j]=steps+1;
        queue[tail++]=j;
      }
    }
    for(let i=0;i<n;i++)if(corridorDistance[i]>=0){
      // metres of approximate native-grid graph distance for UI only.
      corridorDistance[i]*=Math.min(dx,dy);
    }
  }
  const out={type:'result',requestId:data.requestId,cols:w,rows:h,
    cellX:dx,cellY:dy,
    demNativeResolutionM:demSupportMeters,
    terrainGradientSupportM:[demRadiusX*dx,demRadiusY*dy],
    dataSource:'OS Terrain 50 DEM (>=50m gradient support), contributing area, dynamic modeled rainfall/depth and building mask',
    fieldSemantics:'symmetric hydrological tensor; relative intensity; no measured speed, no roads',
    fields:{tensorXX,tensorXY,tensorYY,primaryX,primaryY,
      crossCos4,crossSin4,confidence,suitability,
      drainageRank,avoidMask,floodProximity,crossSuitability,validMask,
      slopeX,slopeY,corridorRank,corridorAxisX,corridorAxisY,
      corridorDistance,trunkMask,secondaryX,secondaryY,
      rainfallInfluence,hydroIntensity,floodConstraint,
      basePrimaryX,basePrimaryY,baseConfidence,baseIntensity}};
  return out;
}
self.onmessage=event=>{
  const data=event.data||{};
  if(data.type!=='solve')return;
  try{
    const out=solve(data);
    const buffers=Object.values(out.fields).map(array=>array.buffer);
    self.postMessage(out,buffers);
  }catch(error){
    self.postMessage({type:'error',requestId:data.requestId,
      message:error?.message||String(error)});
  }
};