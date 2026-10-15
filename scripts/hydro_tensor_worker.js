/* London Map · v3.22.43-tensor-ribbon · independent, design-oriented tensor solver.
   GIS/DEM resolution is inherited from existing simulation cells.
   NO changes to the flood hydraulics, rainfall or collision solver.
   Four-RoSy is a ROAD direction equivalence class; flow vectors only contribute
   orientation evidence and are never blindly drawn as proposed roads. */
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
  const wa=clamp(Number(cfg.avoidance??70)/100,0,1);
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
  // Sum symmetric LINE tensors in double-angle form. This correctly
  // identifies d and -d as the same axis.
  const addAxis=(a,weight,sums)=>{
    if(!(weight>EPS)||!Number.isFinite(a))return;
    sums[0]+=weight*Math.cos(2*a);
    sums[1]+=weight*Math.sin(2*a);
    sums[2]+=weight;
  };
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(!validMask[i])continue;
    const gx=slopeX[i],gy=slopeY[i],steep=Math.hypot(gx,gy);
    const trunk=Math.sqrt(drainageRank[i]);
    // Roads often follow contours on steep slopes. A 4-RoSy system can
    // still use the orthogonal secondary axis for crossing where appropriate.
    const contour=Math.atan2(gx,-gy);
    const terrainStrength=clamp(steep/.075,0,1);
    const sum=[0,0,0];
    if(steep>1e-5)addAxis(contour,wt*(.2+.8*terrainStrength),sum);
    // Downhill drainage guide, but place proposed roads on the flanks,
    // not in the flood channel core. The channel direction is an INPUT.
    let downX=-gx,downY=-gy;
    if(Math.hypot(downX,downY)>EPS){
      const downstream=Math.atan2(downY,downX);
      addAxis(downstream,wd*(.18+.82*trunk),sum);
    }
    // When calculated rainfall flow has strong support it contributes a
    // little directional evidence. It never directly becomes the output.
    const hydStrength=waterActive[i];
    if(Math.hypot(hydX[i],hydY[i])>.5){
      addAxis(Math.atan2(hydY[i],hydX[i]),
        wd*.28*hydStrength*(.35+.65*trunk),sum);
    }
    // Flood-edge avoidance: follow the edge tangent to stay clear of
    // inundated areas. This is a directional avoidance constraint.
    const lx=x>0?i-1:i,rx=x+1<w?i+1:i;
    const uy=y>0?i-w:i,ly=y+1<h?i+w:i;
    const dgx=(validMask[lx]&&validMask[rx]?
      danger[rx]-danger[lx]:0)/(Math.max(1,(rx-lx)*dx));
    const dgy=(validMask[uy]&&validMask[ly]?
      danger[ly]-danger[uy]:0)/(Math.max(1,(ly-uy)/w*dy));
    const dgm=Math.hypot(dgx,dgy);
    if(dgm>1e-6)addAxis(Math.atan2(dgx,-dgy),
      wa*Math.min(1,dgm*dx*12),sum);
    // Use danger as a road-placement COST, not a fabricated water velocity.
    const normalizedDanger=clamp(.76*(depth[i]/1000)/.35+
      .24*floodProximity[i],0,1);
    avoidMask[i]=clamp(normalizedDanger*wa,0,1);
    suitability[i]=clamp(
      (1-avoidMask[i])*(1-.28*terrainStrength)*
      (1-.38*trunk*normalizedDanger),0,1);
    // Interior of strongly flooded corridors is not road-seedable.
    if(depth[i]>=300)suitability[i]*=.05;
    // If no resolved directional evidence, leave cell as isotropic;
    // explicit low confidence prevents presenting arbitrary axes as fact.
    const angle=sum[2]>EPS?.5*Math.atan2(sum[1],sum[0]):0;
    const coherence=sum[2]>EPS?clamp(Math.hypot(sum[0],sum[1])/sum[2],0,1):0;
    const conf=clamp(coherence*(.25+.75*sum[2]/(sum[2]+.2)),0,1);
    const cu=Math.cos(angle),sv=Math.sin(angle);
    const anisotropy=.05+.82*conf;
    const minor=.07,major=minor+anisotropy;
    tensorXX[i]=minor+(major-minor)*cu*cu;
    tensorXY[i]=(major-minor)*cu*sv;
    tensorYY[i]=minor+(major-minor)*sv*sv;
    cos2[i]=Math.cos(2*angle);sin2[i]=Math.sin(2*angle);
    confidence[i]=conf;
  }
  // Native-cell, obstacle-preserving nematic smoothing.
  const tmpC=new Float32Array(n),tmpS=new Float32Array(n);
  const iterations=Math.round(smooth*4);
  for(let pass=0;pass<iterations;pass++){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!validMask[i])continue;
      let c=cos2[i]*4,s=sin2[i]*4,sum=4;
      const neigh=[x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1];
      for(const j of neigh){
        if(j<0||!validMask[j]||suitability[j]<.05)continue;
        const weight=.5+.5*confidence[j];
        c+=cos2[j]*weight;s+=sin2[j]*weight;sum+=weight;
      }
      tmpC[i]=c/sum;tmpS[i]=s/sum;
    }
    for(let i=0;i<n;i++)if(validMask[i]){
      const mag=Math.hypot(tmpC[i],tmpS[i]);
      if(mag>1e-5){cos2[i]=tmpC[i]/mag;sin2[i]=tmpS[i]/mag}
    }
  }
  // Direction matrix, eigen decomposition and true 4-RoSy representation.
  for(let i=0;i<n;i++){
    if(!validMask[i])continue;
    const theta=.5*Math.atan2(sin2[i],cos2[i]);
    const ux=Math.cos(theta),uy=Math.sin(theta);
    primaryX[i]=ux;primaryY[i]=uy;
    // Cross-field strength is site-dependent: on accessible and gently
    // sloped dry land allow balanced orthogonal urban layout.
    const slope=Math.hypot(slopeX[i],slopeY[i]);
    const crossAllowed=cross*clamp(1-slope/.12,0,1)*suitability[i];
    crossSuitability[i]=crossAllowed;
    const minor=.06+.36*crossAllowed;
    const major=minor+.1+.72*confidence[i];
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
    dataSource:'OS Terrain 50 DEM at >=50m derivative support / terrain drainage / rainfall scenario',
    fields:{tensorXX,tensorXY,tensorYY,primaryX,primaryY,
      crossCos4,crossSin4,confidence,suitability,
      drainageRank,avoidMask,floodProximity,crossSuitability,validMask,
      slopeX,slopeY,corridorRank,corridorAxisX,corridorAxisY,
      corridorDistance,trunkMask}};
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