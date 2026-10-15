/* London Map · v3.22.47-tensor-logic.
   Hydro tensor only: OS Terrain 50 DEM, contributing-area drainage,
   modeled 2026-2100 depth/head-gradient and real OSM building barriers.
   The symmetric 2x2 tensor is hydrological ORIENTATION, not measured velocity,
   not a designed road centerline, and not higher-resolution DEM information. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const EPS=1e-9;
function solve(data){
  const {cols:w,rows:h}=data,n=w*h;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||n>70000)throw Error('Invalid tensor grid');
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
  const dx=Number(data.cellX),dy=Number(data.cellY);
  if(!(Number.isFinite(dx)&&Number.isFinite(dy)&&dx>0&&dy>0))throw Error('Missing ground-metre grid spacing');
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
  const cos2=new Float32Array(n),sin2=new Float32Array(n),evidence=new Float32Array(n);
  const eigenvalueMajor=new Float32Array(n),eigenvalueMinor=new Float32Array(n);
  const drainageX=new Float32Array(n),drainageY=new Float32Array(n),
    drainageConfidence=new Float32Array(n),drainageAreaKm2=new Float32Array(n);
  const drainageMask=new Uint8Array(n),terrainDirectionValid=new Uint8Array(n);
  const hydraulicConfidence=new Float32Array(n),slopeMagnitude=new Float32Array(n);
  const aspectRadians=new Float32Array(n);aspectRadians.fill(NaN);
  const threshold=clamp(Number(data.drainageThresholdKm2??1),.0025,20000);
  // Match drainage_worker.js's encoded threshold exactly, including rounding.
  const thresholdCode=1+Math.round(Math.log(threshold/.0025)/Math.log(20000/.0025)*65534);
  const slopeX=new Float32Array(n),slopeY=new Float32Array(n);
  const waterActive=new Float32Array(n),hydX=new Float32Array(n),hydY=new Float32Array(n);
  const valid=i=>i>=0&&i<n&&inside[i]!==0&&!barrier[i]&&Number.isFinite(terrain[i]);
  // Decode the raster's LOG upstream-area encoding to a normalized log rank,
  // never treat codes as rainfall volume or an actual measured drain flow.
  for(let i=0;i<n;i++){
    if(!valid(i))continue;
    validMask[i]=1;
    drainageRank[i]=accumulation[i]>0?(accumulation[i]-1)/65534:0;
    waterActive[i]=clamp(depth[i]/140,0,1);
    if(accumulation[i]){
      drainageAreaKm2[i]=.0025*Math.exp(drainageRank[i]*Math.log(20000/.0025));
      drainageMask[i]=accumulation[i]>=thresholdCode?1:0;
    }
  }
  // Physical topography exists under buildings; barriers mask water routing,
  // not the underlying DEM derivative. Do not cross parcel/NoData gaps.
  const terrainValid=i=>i>=0&&i<n&&inside[i]!==0&&Number.isFinite(terrain[i]);
  function derivative(x,y,ox,oy,radius,spacing){
    const i=y*w+x;let lo=0,hi=0;
    for(let k=1;k<=radius;k++){
      const xx=x-ox*k,yy=y-oy*k;
      if(xx<0||yy<0||xx>=w||yy>=h||!terrainValid(yy*w+xx))break;
      lo=k;
    }
    for(let k=1;k<=radius;k++){
      const xx=x+ox*k,yy=y+oy*k;
      if(xx<0||yy<0||xx>=w||yy>=h||!terrainValid(yy*w+xx))break;
      hi=k;
    }
    if(!lo&&!hi||(lo+hi)*spacing<50)return null;
    return (terrain[i+hi*(oy*w+ox)]-terrain[i-lo*(oy*w+ox)])/((lo+hi)*spacing);
  }
  function connected(x,y,xx,yy){
    const steps=Math.max(Math.abs(xx-x),Math.abs(yy-y));let px=x,py=y;
    for(let k=1;k<=steps;k++){
      const nx=Math.round(x+(xx-x)*k/steps),ny=Math.round(y+(yy-y)*k/steps);
      if(!valid(ny*w+nx))return false;
      if(nx!==px&&ny!==py&&(!valid(py*w+nx)||!valid(ny*w+px)))return false;
      px=nx;py=ny;
    }
    return true;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!valid(i))continue;
    const gx=derivative(x,y,1,0,demRadiusX,dx),gy=derivative(x,y,0,1,demRadiusY,dy);
    if(gx!==null&&gy!==null){slopeX[i]=gx;slopeY[i]=gy;terrainDirectionValid[i]=1}
    // Recompute from the accepted depth snapshot, including risk envelopes.
    // A cached event vector can otherwise silently belong to a different year.
    if(depth[i]<8)continue;
    const head=terrain[i]+depth[i]/1000;let ax=0,ay=0,total=0;
    for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
      const xx=x+ox,yy=y+oy;
      if(xx<0||yy<0||xx>=w||yy>=h||!connected(x,y,xx,yy))continue;
      const j=yy*w+xx,distance=Math.hypot(ox*dx,oy*dy);
      const drop=head-terrain[j]-depth[j]/1000;if(drop<=1e-7)continue;
      const weight=Math.sqrt(drop/distance);
      ax+=ox*dx/distance*weight;ay+=oy*dy/distance*weight;total+=weight;
    }
    const magnitude=Math.hypot(ax,ay);
    if(magnitude>EPS){hydX[i]=ax/magnitude;hydY[i]=ay/magnitude;hydraulicConfidence[i]=magnitude/total}
  }
  // The published area raster has no D8 codes. Infer an UNDIRECTED network
  // ridge tangent from independent area geometry, never from DEM downhill.
  // >=50m sample spacing avoids counting repeated fine-grid values as new data.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!validMask[i]||!drainageMask[i])continue;
    const samples=[];let maximum=0,minimum=Infinity;
    for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
      const xx=x+ox*demRadiusX,yy=y+oy*demRadiusY;
      if(xx<0||yy<0||xx>=w||yy>=h||!connected(x,y,xx,yy))continue;
      const area=drainageAreaKm2[yy*w+xx];if(!(area>0))continue;
      samples.push({x:(xx-x)*dx,y:(yy-y)*dy,area});
      maximum=Math.max(maximum,area);minimum=Math.min(minimum,area);
    }
    const cut=Math.max(threshold,maximum*.12),selected=samples.filter(p=>p.area>=cut);
    if(selected.length<3||samples.length<5||maximum<minimum*1.5)continue;
    let weight=0,mx=0,my=0;
    for(const p of selected){p.weight=1+Math.log(p.area/cut);weight+=p.weight;mx+=p.x*p.weight;my+=p.y*p.weight}
    mx/=weight;my/=weight;
    let xx=0,xy=0,yy=0;
    for(const p of selected){const a=p.x-mx,b=p.y-my;xx+=p.weight*a*a;xy+=p.weight*a*b;yy+=p.weight*b*b}
    const trace=xx+yy,gap=Math.hypot(xx-yy,2*xy),coherence=trace>EPS?gap/trace:0;
    if(coherence<.20||trace/weight<500)continue;
    const theta=.5*Math.atan2(2*xy,xx-yy);
    drainageX[i]=Math.cos(theta);drainageY[i]=Math.sin(theta);
    drainageConfidence[i]=coherence*clamp(Math.log(maximum/minimum)/Math.log(10),0,1);
  }
  // Valid topographic gradient evidence underpins an always-visible BASE
  // tensor layer. Accumulation ranks strengthen coherence but never invent
  // an absolute direction where no downhill information exists.
  for(let i=0;i<n;i++)if(validMask[i]){
    const gx=slopeX[i],gy=slopeY[i],steep=Math.hypot(gx,gy);
    slopeMagnitude[i]=steep;
    if(terrainDirectionValid[i]&&steep>1e-6){
      aspectRadians[i]=Math.atan2(-gy,-gx);
      basePrimaryX[i]=-gx/steep;basePrimaryY[i]=-gy/steep;
      baseConfidence[i]=clamp(.26+.74*steep/(steep+.012),0,1);
      baseIntensity[i]=clamp(.30+.44*Math.sqrt(drainageRank[i])+
        .26*baseConfidence[i],0,1);
    }
  }
  // No directional evidence is invented for flat or unsupported DEM cells.
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

    }
    if(drainageConfidence[i]>.02){
      addAxis(Math.atan2(drainageY[i],drainageX[i]),
        wd*(.18+.82*trunk)*drainageConfidence[i],sum);
    }
    if(water>.008&&Math.hypot(hydX[i],hydY[i])>.5){
      addAxis(Math.atan2(hydY[i],hydX[i]),
        wa*water*(.32+.68*trunk)*hydraulicConfidence[i],sum);
    }
    // Depth-edge gradients are exported as scalar constraints, not an extra
    // hydraulic axis: a flood outline normal is not a measured flow vector.
    // Previously "suitability" removed inundated cells as poor ROAD land.
    // It now means hydrological sample reliability. Water is allowed and
    // highlighted; building / outside-site cells remain exactly invalid.
    avoidMask[i]=floodConstraint[i];
    suitability[i]=clamp(.32+.43*trunk+.25*water,0,1);
    const coherence=sum[2]>EPS?
      clamp(Math.hypot(sum[0],sum[1])/sum[2],0,1):0;
    const directionalEvidence=clamp(sum[2]/(sum[2]+.12),0,1);
    confidence[i]=clamp(coherence*directionalEvidence,0,1);
    // Store the anisotropic components and trace of SUM(weight * u u^T).
    cos2[i]=sum[0];sin2[i]=sum[1];evidence[i]=sum[2];
  }
  // Smooth the actual symmetric tensor components, retaining cue magnitude
  // and cancellation. Never normalize an unsupported angle to east.
  const tmpC=new Float32Array(n),tmpS=new Float32Array(n),tmpE=new Float32Array(n);
  for(let pass=0;pass<Math.round(smooth*4);pass++){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!validMask[i]||evidence[i]<=EPS)continue;
      let c=cos2[i]*4,s=sin2[i]*4,e=evidence[i]*4,weight=4;
      for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1]){
        if(j<0||!validMask[j]||evidence[j]<=EPS)continue;
        c+=cos2[j];s+=sin2[j];e+=evidence[j];weight++;
      }
      tmpC[i]=c/weight;tmpS[i]=s/weight;tmpE[i]=e/weight;
    }
    cos2.set(tmpC);sin2.set(tmpS);evidence.set(tmpE);
  }
  for(let i=0;i<n;i++){
    if(!validMask[i])continue;
    const trace=evidence[i],gap=Math.min(trace,Math.hypot(cos2[i],sin2[i]));
    eigenvalueMajor[i]=(trace+gap)/2;eigenvalueMinor[i]=Math.max(0,(trace-gap)/2);
    tensorXX[i]=(trace+cos2[i])/2;tensorXY[i]=sin2[i]/2;tensorYY[i]=(trace-cos2[i])/2;
    confidence[i]=trace>EPS?clamp(gap/trace*trace/(trace+.12),0,1):0;
    crossSuitability[i]=confidence[i];
    // An isotropic tensor has no unique principal direction.
    if(gap<=1e-6||gap/Math.max(EPS,trace)<=.02)continue;
    const theta=.5*Math.atan2(sin2[i],cos2[i]),ux=Math.cos(theta),uy=Math.sin(theta);
    primaryX[i]=ux;primaryY[i]=uy;secondaryX[i]=-uy;secondaryY[i]=ux;
    crossCos4[i]=Math.cos(4*theta);crossSin4[i]=Math.sin(4*theta);
  }
  // Network corridors use only the independent accumulation ridge tangent.
  // No DEM fallback and no guessed site-percentile "network" threshold.
  let coreCount=0;
  for(let i=0;i<n;i++)if(validMask[i]){
    corridorAxisX[i]=drainageX[i];corridorAxisY[i]=drainageY[i];
    corridorRank[i]=clamp(.82*Math.sqrt(drainageRank[i])+.18*waterActive[i],0,1);
    if(drainageMask[i]&&drainageConfidence[i]>.20){trunkMask[i]=1;coreCount++}
  }
  // Bounded graph distances use the correct rectangular ground-metre grid.
  corridorDistance.fill(-1);
  for(let i=0;i<n;i++)if(trunkMask[i])corridorDistance[i]=0;
  for(let pass=0;coreCount&&pass<14;pass++){
    const next=new Float32Array(corridorDistance);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!validMask[i])continue;
      for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
        const j=yy*w+xx;if(corridorDistance[j]<0)continue;
        const distance=corridorDistance[j]+(ox?dx:dy);
        if(next[i]<0||distance<next[i])next[i]=distance;
      }
    }
    corridorDistance.set(next);
  }
  const counts={valid:0,terrain:0,drainage:0,hydraulic:0,tensor:0};
  for(let i=0;i<n;i++)if(validMask[i]){
    counts.valid++;
    if(Math.hypot(basePrimaryX[i],basePrimaryY[i])>.5)counts.terrain++;
    if(drainageConfidence[i]>.02)counts.drainage++;
    if(hydraulicConfidence[i]>.02)counts.hydraulic++;
    if(Math.hypot(primaryX[i],primaryY[i])>.5)counts.tensor++;
  }
  const out={type:'result',requestId:data.requestId,cols:w,rows:h,
    cellX:dx,cellY:dy,grid:data.grid,scenario:data.scenario,
    drainageThresholdKm2:threshold,
    drainageDirectionMethod:'local accumulation-ridge PCA; undirected; not D8 connectivity',
    diagnostics:{counts,drainageD8Available:false,groundMetreBasis:true,
      hydraulicDepthAvailable:data.depthAvailable!==false},
    demNativeResolutionM:demSupportMeters,
    terrainGradientSupportM:[demRadiusX*dx,demRadiusY*dy],
    dataSource:'OS Terrain 50 DEM (>=50m gradient support), contributing area, dynamic modeled rainfall/depth and building mask',
    fieldSemantics:'symmetric hydrological tensor; relative intensity; no measured speed, no roads',
    fields:{tensorXX,tensorXY,tensorYY,primaryX,primaryY,
      crossCos4,crossSin4,confidence,suitability,
      drainageRank,avoidMask,floodProximity,crossSuitability,validMask,
      slopeX,slopeY,slopeMagnitude,aspectRadians,terrainDirectionValid,
      drainageX,drainageY,drainageConfidence,drainageAreaKm2,drainageMask,
      eigenvalueMajor,eigenvalueMinor,hydraulicX:hydX,hydraulicY:hydY,hydraulicConfidence,
      corridorRank,corridorAxisX,corridorAxisY,
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