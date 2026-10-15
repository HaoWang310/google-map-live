/**
 * London 2100 · Hydrological Vector Field
 * Visualization only. All directions/intensities come from the DEM +
 * modeled hydraulic-head field on the existing flood worker grid.
 * No random vectors, no inferred measured velocity, no solver changes.
 */
export function createHydroVectorRenderer({map,sourceId,particleSourceId,glowLayerId,lineLayerId,particleLayerId,getBounds,onStatus}){
  const empty=()=>({type:'FeatureCollection',features:[]});
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const preset={density:55,length:65,width:1.4,opacity:.85,glow:.5,speed:1,growth:1,mode:'analysis'};
  let config={...preset},enabled=false,field=null,context=null,bounds=null;
  let terrainGuide=null,stage={year:2026,kind:'design-envelope'};
  let modeledDepthMm=null;
  let traces=[],segments=[],lastDraw=0,lastGeometry=0,raf=0,start=0,lastMessage='';
  let progress=1,wasAnimating=false,epoch=0;
  const R=6378137;
  const merc=([lon,lat])=>[lon*Math.PI/180*R,
    Math.log(Math.tan(Math.PI/4+clamp(lat,-85.05112878,85.05112878)*Math.PI/180/2))*R];
  const unmerc=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const lineSource=()=>map.getSource(sourceId);
  const dotSource=()=>map.getSource(particleSourceId);
  const fieldCopy=f=>{
    if(!f)return null;
    const n=f.cols*f.rows;
    const vx=new Int8Array(f.vx),vy=new Int8Array(f.vy),strength=new Uint8Array(f.intensity);
    if(!(n>0&&n<=70000)||vx.length!==n||vy.length!==n||strength.length!==n)return null;
    return {cols:f.cols,rows:f.rows,vx,vy,strength,units:'relative'};
  };
  function setStatus(s){
    if(s===lastMessage)return;
    lastMessage=s;onStatus?.(s);
  }
  const geoContext=()=>{
    const b=getBounds();
    if(!b)return null;
    const nw=merc(b[0]),ne=merc(b[1]),sw=merc(b[3]);
    return {nw,dx:(ne[0]-nw[0])/field.cols,dy:(nw[1]-sw[1])/field.rows};
  };
  function cellIndex(x,y){
    const col=Math.floor(x),row=Math.floor(y);
    if(col<0||row<0||col>=field.cols||row>=field.rows)return -1;
    return row*field.cols+col;
  }
  function validAt(x,y){
    const i=cellIndex(x,y);
    if(i<0||context?.obstacle?.[i]||context?.inside?.[i]===0)return false;
    // Terrain potential is valid even at zero simulated rainfall. It is NOT
    // interpreted as a physically moving flow until the solver reports water.
    return terrainGuide?terrainGuide.mask[i]!==0:field.strength[i]>=6;
  }
  function encodedCatchment(i){
    // The drainage area file uses LOGARITHMIC encoding of upstream km²,
    // not linear runoff volume. Use its normalized log rank only.
    const code=context?.accumulation?.[i]||0;
    return code>0?(code-1)/65534:0;
  }
  function makeTerrainGuide(){
    if(!field||!context?.terrain)return null;
    const {cols,rows}=field,n=cols*rows;
    const dirX=new Float32Array(n),dirY=new Float32Array(n);
    const slope=new Float32Array(n),catchment=new Float32Array(n),mask=new Uint8Array(n);
    const geo=geoContext();
    const cellX=Math.abs(geo?.dx||1),cellY=Math.abs(geo?.dy||1);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*cols+x,z=context.terrain[i];
      if(context.inside[i]===0||context.obstacle[i]||
        !Number.isFinite(z))continue;
      catchment[i]=encodedCatchment(i);
      let dx=0,dy=0,total=0,downhill=0;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        if(!ox&&!oy)continue;
        const nx=x+ox,ny=y+oy;
        if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
        const j=ny*cols+nx;
        if(context.inside[j]===0||context.obstacle[j]||
          !Number.isFinite(context.terrain[j]))continue;
        // No cutting diagonally across a blocked building corner.
        if(ox&&oy){
          const a=y*cols+nx,b=ny*cols+x;
          if(!context.inside[a]||!context.inside[b]||
            context.obstacle[a]||context.obstacle[b])continue;
        }
        const distance=Math.hypot(ox*cellX,oy*cellY);
        const localSlope=Math.max(0,(z-context.terrain[j])/Math.max(1,distance));
        if(localSlope<=1e-8)continue;
        // Upstream accumulation encourages convergence within downhill
        // paths, but it can NEVER reverse drainage uphill.
        const corridor=0.65+0.35*Math.sqrt(encodedCatchment(j));
        const weight=Math.sqrt(localSlope)*corridor;
        dx+=ox*cellX/distance*weight;
        dy+=oy*cellY/distance*weight;
        downhill+=localSlope*weight;
        total+=weight;
      }
      const length=Math.hypot(dx,dy);
      if(total<=0||length<1e-8)continue;
      dirX[i]=dx/length;dirY[i]=dy/length;
      slope[i]=downhill/total;mask[i]=1;
    }
    return {dirX,dirY,slope,catchment,mask};
  }
  const hydraulicActivity=i=>{
    const water=modeledDepthMm?.[i]||0;
    const depth=Math.min(1,water/80); // 80 mm is only a visual normalization
    const solved=field.strength[i]/255;
    return Math.min(1,Math.max(depth,solved));
  };
  // Continuous integration of DEM downhill directions, selectively blended
  // with the current modeled hydraulic-head flow where real water is present.
  // Waterless 2026 paths remain a subdued drainage POTENTIAL only.
  function sample(x,y){
    if(!validAt(x,y))return null;
    const ix=Math.floor(x-.5),iy=Math.floor(y-.5),fx=x-.5-ix,fy=y-.5-iy;
    let dx=0,dy=0,power=0,acc=0,wet=0,slope=0,total=0;
    for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
      const cx=ix+ox,cy=iy+oy;
      const weight=(ox?fx:1-fx)*(oy?fy:1-fy);
      if(weight<=0||!validAt(cx+.5,cy+.5))continue;
      const j=cy*field.cols+cx;
      const topoX=terrainGuide?.dirX[j]||0,topoY=terrainGuide?.dirY[j]||0;
      const w=hydraulicActivity(j);
      const hydX=field.vx[j]/127,hydY=field.vy[j]/127;
      const simulatedFlow=w>0.015&&Math.hypot(hydX,hydY)>.1;
      // Predominantly the solver direction where modeled surface flow exists.
      const bias=simulatedFlow?Math.min(.94,.72+.22*w):0;
      dx+=(topoX*(1-bias)+hydX*bias)*weight;
      dy+=(topoY*(1-bias)+hydY*bias)*weight;
      const catchment=terrainGuide?.catchment[j]??encodedCatchment(j);
      const relief=terrainGuide?.slope[j]||0;
      acc+=catchment*weight;
      slope+=relief*weight;
      wet+=w*weight;
      // Main stream channels require catchment area AND modeled runoff.
      const wetStrength=(field.strength[j]/255*.58+
        Math.min(1,(modeledDepthMm?.[j]||0)/100)*.42);
      const coverage=.30+.70*Math.sqrt(catchment);
      power+=wetStrength*coverage*weight;
      total+=weight;
    }
    const len=Math.hypot(dx,dy);
    if(total<.15||len<.14)return null;
    const water=wet/total;
    return {
      x:dx/len,y:dy/len,
      power:Math.min(1,power/total),
      catchment:Math.min(1,acc/total),
      wet:water,
      slope:slope/total,
      // Never label dry DEM potential as observed runoff.
      potential:water<.02
    };
  }
  function trace(sx,sy,dir,steps){
    let x=sx,y=sy,last=null,turnLimit=0;
    const pts=[];
    for(let i=0;i<steps;i++){
      const v=sample(x,y);
      if(!v)break;
      const step=.46;
      const mid=sample(x+v.x*dir*step*.5,y+v.y*dir*step*.5);
      if(!mid)break;
      if(last&&mid.x*last.x+mid.y*last.y<-.15)break;
      const nx=x+mid.x*dir*step,ny=y+mid.y*dir*step;
      if(!validAt(nx,ny)||!validAt((nx+x)/2,(ny+y)/2))break;
      // Prevent building-corner diagonal leakage.
      if(Math.floor(nx)!==Math.floor(x)&&Math.floor(ny)!==Math.floor(y)){
        if(!validAt(nx,y)||!validAt(x,ny))break;
      }
      pts.push({x,y,power:v.power,catchment:v.catchment});
      x=nx;y=ny;last=mid;
    }
    return pts;
  }
  function color(v){
    // Cyan -> electric blue -> blue-violet, a relative intensity legend.
    const stops=[[0,[69,212,239]],[.4,[41,156,245]],[.75,[54,110,247]],[1,[130,100,242]]];
    let a=stops[0],b=stops[stops.length-1];
    for(let i=1;i<stops.length;i++)if(v<=stops[i][0]){a=stops[i-1];b=stops[i];break}
    const t=clamp((v-a[0])/Math.max(.00001,b[0]-a[0]),0,1);
    return '#'+a[1].map((c,k)=>Math.round(c+(b[1][k]-c)*t).toString(16).padStart(2,'0')).join('');
  }
  function pointGeo(p){
    return unmerc(bounds.nw[0]+p.x*bounds.dx,bounds.nw[1]-p.y*bounds.dy);
  }
  function build(){
    if(!field){traces=[];segments=[];return}
    bounds=geoContext();
    if(!bounds){traces=[];segments=[];return}
    const {cols,rows,strength}=field;
    // Deterministic adaptive seeding. A single local high-gradient seed per bin.
    const stride=clamp(Math.round(15-config.density*.12),2,15);
    const candidates=[];
    for(let y=1;y<rows-1;y+=stride)for(let x=1;x<cols-1;x+=stride){
      let best=-1,score=0;
      const extent=Math.max(1,Math.floor(stride*.55));
      for(let dy=0;dy<=extent;dy++)for(let dx=0;dx<=extent;dx++){
        const px=Math.min(cols-2,x+dx),py=Math.min(rows-2,y+dy),idx=py*cols+px;
        // DEM downhill potential remains eligible at 2026 even when
        // the hydraulic solver has zero water. Rendering stays subdued.
        if(!validAt(px+.5,py+.5))continue;
        const catchment=terrainGuide?.catchment[idx]??encodedCatchment(idx);
        const wet=Math.max(strength[idx]/255,(modeledDepthMm?.[idx]||0)/80);
        const slope=Math.min(1,(terrainGuide?.slope[idx]||0)*28);
        const rank=.48*Math.sqrt(catchment)+.32*Math.min(1,wet)+.20*slope;
        if(rank>score){score=rank;best=idx}
      }
      if(best>=0)candidates.push({x:best%cols+.5,y:Math.floor(best/cols)+.5,score,best});
    }
    candidates.sort((a,b)=>b.score-a.score||a.best-b.best);
    const maxLines=Math.min(300,Math.round(40+config.density*2.4));
    const occupancy=new Uint8Array(cols*rows);
    const lines=[];
    for(const seed of candidates){
      if(lines.length>=maxLines)break;
      const index=cellIndex(seed.x,seed.y);
      if(index<0||occupancy[index])continue;
      const maxSteps=Math.round((18+config.length*1.25)*(0.66+.80*seed.score));
      const back=trace(seed.x,seed.y,-1,Math.round(maxSteps*.37));
      const forward=trace(seed.x,seed.y,1,Math.round(maxSteps*.63));
      const points=back.reverse().slice(0,-1).concat(forward);
      if(points.length<7)continue;
      // Avoid parallel mechanical repeats and suppress crossings near a trunk.
      let overlaps=0;
      for(let i=0;i<points.length;i+=4){
        const ix=cellIndex(points[i].x,points[i].y);
        if(ix>=0&&occupancy[ix])overlaps++;
      }
      if(overlaps>Math.max(2,points.length/12))continue;
      let avg=0,acc=0,wet=0;
      for(const p of points){avg+=p.power;acc+=p.catchment;wet+=p.wet}
      avg/=points.length;acc/=points.length;wet/=points.length;
      // A high-catchment channel becomes prominent only with active rainfall;
      // dry channels retain a low-contrast geomorphological guidance layer.
      const rank=clamp(avg*.40+Math.sqrt(acc)*.42+wet*.18,0,1);
      const coords=points.map(pointGeo);
      let total=0;const lengths=[0];
      for(let i=1;i<points.length;i++){
        total+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
        lengths.push(total);
      }
      const line={points,coords,lengths,total,power:avg,rank,wet,
        alpha:wet<.025?.19:Math.min(1,.30+.70*Math.sqrt(wet)),
        color:color(rank),id:lines.length};
      lines.push(line);
      for(let i=0;i<points.length;i+=2){
        const ix=cellIndex(points[i].x,points[i].y);
        if(ix>=0)occupancy[ix]=1;
      }
    }
    traces=lines;segments=[];
    for(const line of traces){
      for(let i=0;i<line.coords.length-1;i+=5){
        const end=Math.min(line.coords.length-1,i+5);
        const points=line.coords.slice(i,end+1);
        const local=line.points.slice(i,end+1);
        const intensity=local.reduce((s,p)=>s+p.power,0)/local.length;
        const gradient=clamp(.55*intensity+.45*line.rank,0,1);
        segments.push({
          type:'Feature',
          properties:{color:color(gradient),analysisColor:'#9aa9b9',
            width:(.65+1.85*line.rank)*config.width,
            alpha:line.alpha,
            relativeIntensity:gradient,catchmentRank:line.rank,
            flowKind:line.wet<.025?'terrain-potential':'modeled-runoff',
            order:line.id},
          geometry:{type:'LineString',coordinates:points}
        });
      }
      // A small geometrically aligned chevron at each downstream line tip.
      // Its direction comes from the integrated path tangent; never random.
      const tip=line.points.at(-1),tail=line.points.at(-3);
      if(tip&&tail){
        const vx=tip.x-tail.x,vy=tip.y-tail.y,len=Math.hypot(vx,vy);
        if(len>.01){
          const ux=vx/len,uy=vy/len,base=.45,wing=.22;
          const left={x:tip.x-ux*base-uy*wing,y:tip.y-uy*base+ux*wing};
          const right={x:tip.x-ux*base+uy*wing,y:tip.y-uy*base-ux*wing};
          segments.push({type:'Feature',
            properties:{color:line.color,analysisColor:'#9aa9b9',
              width:(1+1.55*line.rank)*config.width,alpha:line.alpha,
              flowKind:line.wet<.025?'terrain-potential':'modeled-runoff',
              relativeIntensity:line.power,arrowhead:true,order:line.id},
            geometry:{type:'LineString',
              coordinates:[pointGeo(left),pointGeo(tip),pointGeo(right)]}});
        }
      }
    }
    setStatus(traces.length?traces.length+' 条地形汇流／雨水流线 · 2026–2100 设计情景 · 相对强度，非 m/s':
      '当前情景没有达到流场显示阈值的有效水流，请选择较晚年份并运行');
  }
  function applyStyle(){
    if(!map.getLayer(lineLayerId))return;
    const present=config.mode==='presentation';
    map.setPaintProperty(lineLayerId,'line-color',present?['get','color']:['get','analysisColor']);
    map.setPaintProperty(lineLayerId,'line-width',['*',['get','width'],present?1:.83]);
    map.setPaintProperty(lineLayerId,'line-opacity',
      ['*',config.opacity*(present?1:.82),['coalesce',['get','alpha'],1]]);
    if(map.getLayer(glowLayerId)){
      map.setPaintProperty(glowLayerId,'line-width',['*',['get','width'],2.0+config.glow*3]);
      map.setPaintProperty(glowLayerId,'line-opacity',
        ['*',present?config.opacity*config.glow*.42:0,
          ['coalesce',['get','alpha'],1]]);
      map.setPaintProperty(glowLayerId,'line-blur',1+config.glow*3);
    }
    if(map.getLayer(particleLayerId)){
      map.setLayoutProperty(particleLayerId,'visibility',enabled&&present?'visible':'none');
      map.setPaintProperty(particleLayerId,'circle-opacity',config.opacity*.9);
    }
  }
  function renderLines(frac=1){
    const source=lineSource();if(!source)return;
    if(frac>=1){source.setData({type:'FeatureCollection',features:segments});return}
    // Reveal real integrated paths progressively in presentation mode.
    const count=Math.floor(segments.length*clamp(frac,0,1));
    source.setData({type:'FeatureCollection',features:segments.slice(0,count)});
  }
  function renderParticles(elapsed,visibleFraction){
    const source=dotSource();if(!source)return;
    if(config.mode!=='presentation'||!enabled||!traces.length){
      source.setData(empty());return;
    }
    const count=Math.min(150,Math.round(25+config.density*1.0));
    const features=[];
    for(let i=0;i<count;i++){
      const line=traces[(i*31)%traces.length];
      const lineAllowed=traces.length*visibleFraction>line.id;
      if(!lineAllowed||line.total<=0)continue;
      const u=(elapsed*config.speed*(.08+.1*line.rank)+(i*.61803398875))%1;
      const target=u*line.total;
      let lo=0,hi=line.lengths.length-1;
      while(lo+1<hi){const mid=(lo+hi)>>1;if(line.lengths[mid]<target)lo=mid;else hi=mid}
      const a=line.coords[lo],b=line.coords[hi];
      const t=clamp((target-line.lengths[lo])/Math.max(.00001,line.lengths[hi]-line.lengths[lo]),0,1);
      features.push({type:'Feature',properties:{color:line.color,
        radius:.9+1.6*line.rank},
        geometry:{type:'Point',coordinates:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}});
    }
    source.setData({type:'FeatureCollection',features});
  }
  function stop(){
    if(raf)cancelAnimationFrame(raf);
    raf=0;wasAnimating=false;
  }
  function animate(time){
    if(!enabled||config.mode!=='presentation'){stop();return}
    raf=requestAnimationFrame(animate);
    if(time-lastDraw<55)return;
    lastDraw=time;
    const elapsed=(time-start)/1000;
    const fraction=clamp(elapsed*config.growth/2.6,0,1);
    if(fraction<1||!wasAnimating){
      renderLines(fraction);
      wasAnimating=fraction<1;
    }
    renderParticles(elapsed,fraction);
  }
  function restart(){
    stop();lastDraw=0;start=performance.now();
    if(!enabled)return;
    applyStyle();
    if(config.mode==='presentation'){
      wasAnimating=true;
      raf=requestAnimationFrame(animate);
    }else{
      renderLines();dotSource()?.setData(empty());
    }
  }
  function configure(patch){
    const next={...config,...patch};
    for(const key of ['density','length'])next[key]=clamp(Number(next[key])||0,0,100);
    next.width=clamp(Number(next.width)||.5,.5,3.5);
    next.opacity=clamp(Number(next.opacity)||.1,.1,1);
    next.glow=clamp(Number(next.glow)||0,0,1);
    next.speed=clamp(Number(next.speed)||0,0,3);
    next.growth=clamp(Number(next.growth)||.5,.5,3);
    next.mode=next.mode==='presentation'?'presentation':'analysis';
    const regenerate=next.density!==config.density||next.length!==config.length||next.width!==config.width;
    const switchMode=next.mode!==config.mode;
    config=next;
    if(regenerate)build();
    applyStyle();
    if(regenerate||switchMode)restart();
  }
  function setField(incoming,spatialContext,meta={}){
    const next=fieldCopy(incoming);
    if(!next)return;
    field=next;
    stage={year:Number(meta.year)||2026,kind:meta.kind||'design-envelope'};
    if(meta.depthMm){
      const depth=new Uint16Array(meta.depthMm);
      modeledDepthMm=depth.length===next.cols*next.rows?depth:null;
    }else modeledDepthMm=null;
    if(spatialContext&&spatialContext.cols===next.cols&&spatialContext.rows===next.rows){
      const n=next.cols*next.rows;
      const arrays={
        terrain:new Float32Array(spatialContext.terrain),
        accumulation:new Uint16Array(spatialContext.accumulation),
        inside:new Uint8Array(spatialContext.inside),
        obstacle:new Uint8Array(spatialContext.obstacle)
      };
      if(Object.values(arrays).every(a=>a.length===n)){
        context=arrays;
        terrainGuide=makeTerrainGuide();
      }
    }
    if(!enabled)return;
    build();
    // A new hydraulic frame must never restart the animation; preserve
    // its elapsed phase and reveal newly calculated segments immediately.
    if(config.mode==='presentation'&&raf){
      const elapsed=(performance.now()-start)/1000;
      renderLines(clamp(elapsed*config.growth/2.6,0,1));
    }else restart();
  }
  function setEnabled(on){
    enabled=Boolean(on);
    const state=enabled?'visible':'none';
    for(const id of [lineLayerId,glowLayerId]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',state);
    }
    if(!enabled){stop();lineSource()?.setData(empty());dotSource()?.setData(empty());return}
    build();restart();
  }
  function clear(){
    stop();field=null;context=null;terrainGuide=null;
    modeledDepthMm=null;traces=[];segments=[];
    lineSource()?.setData(empty());dotSource()?.setData(empty());
    setStatus('等待水文流场数据 · 先运行降雨模拟');
  }
  function demSlopes(){
    const n=field.cols*field.rows,x=new Float32Array(n),y=new Float32Array(n);
    if(!context?.terrain)return {x,y};
    const grid=geoContext();
    const dx=Math.abs(grid?.dx||1),dy=Math.abs(grid?.dy||1);
    const inside=i=>context.inside?.[i]!==0&&!context.obstacle?.[i]
      &&Number.isFinite(context.terrain[i]);
    for(let row=0;row<field.rows;row++)for(let col=0;col<field.cols;col++){
      const i=row*field.cols+col;
      if(!inside(i))continue;
      const west=col>0?i-1:i,east=col<field.cols-1?i+1:i;
      const north=row>0?i-field.cols:i,south=row<field.rows-1?i+field.cols:i;
      if(inside(west)&&inside(east)&&east!==west)
        x[i]=(context.terrain[east]-context.terrain[west])/(dx*(east===i||west===i?1:2));
      if(inside(north)&&inside(south)&&south!==north)
        y[i]=(context.terrain[south]-context.terrain[north])/(dy*(south===i||north===i?1:2));
    }
    return {x,y};
  }
  function exportStructuredData(){
    if(!field)return null;
    const slope=context?.terrain?demSlopes():null;
    const n=field.cols*field.rows;
    const tensorXX=new Float32Array(n),tensorXY=new Float32Array(n),
      tensorYY=new Float32Array(n),guideIntensity=new Float32Array(n);
    const guideMask=new Uint8Array(n);
    // Symmetric positive semidefinite 2x2 tensor with principal axis
    // along rainwater convergence / DEM gradient direction.
    for(let i=0;i<n;i++){
      if(!terrainGuide?.mask[i])continue;
      const wet=hydraulicActivity(i);
      const hydX=field.vx[i]/127,hydY=field.vy[i]/127;
      const actual=Math.hypot(hydX,hydY)>.1&&wet>.015;
      const mixing=actual?Math.min(.94,.72+.22*wet):0;
      const gx=terrainGuide.dirX[i]*(1-mixing)+hydX*mixing;
      const gy=terrainGuide.dirY[i]*(1-mixing)+hydY*mixing;
      const length=Math.hypot(gx,gy)||1;
      const u=gx/length,v=gy/length;
      const catchment=terrainGuide.catchment[i];
      const primary=.25+.55*Math.sqrt(catchment)+.20*wet;
      const minor=.06+.12*(1-catchment);
      tensorXX[i]=minor+(primary-minor)*u*u;
      tensorXY[i]=(primary-minor)*u*v;
      tensorYY[i]=minor+(primary-minor)*v*v;
      guideIntensity[i]=primary;guideMask[i]=1;
    }
    return {
      source:'OS Terrain 50 DEM + modeled hydraulic gradient + building mask',
      CRS:'EPSG:4326',vectorCRS:'solver-grid',units:'relative (not m/s)',
      cols:field.cols,rows:field.rows,boundsLngLat:getBounds(),
      scenarioYear:stage.year,scenarioKind:stage.kind,
      tensorBasis:'DEM downhill + logarithmically encoded upstream catchment; water depth / solver flow for activity',
      tensorXX,tensorXY,tensorYY,terrainGuidanceStrength:guideIntensity,
      tensorValidMask:guideMask,
      modeledDepthMm:modeledDepthMm?new Uint16Array(modeledDepthMm):null,
      vectorX:new Int8Array(field.vx),vectorY:new Int8Array(field.vy),
      relativeIntensity:new Uint8Array(field.strength),
      elevationM:context?.terrain?new Float32Array(context.terrain):null,
      demSlopeX:slope?.x||null,demSlopeY:slope?.y||null,
      drainageAccumulationEncoded:context?.accumulation?new Uint16Array(context.accumulation):null,
      wetFlowConstraintMask:Uint8Array.from(field.strength,p=>p>=6?1:0),
      parcelMask:context?.inside?new Uint8Array(context.inside):null,
      buildingBarrierMask:context?.obstacle?new Uint8Array(context.obstacle):null,
      semantics:{direction:'DEM downhill potential blended with modelled hydraulic head when wet',
        rainfall:'Modeled depth / direction from current design-stage frame; no measured velocity',
        drainageAccumulation:'Log-encoded upstream contributing area, NOT a direct rainfall volume or drain pipe network',
        tensor:'2x2 symmetric principal-axis field; relative design guidance, not validated hydrodynamic stress tensor',
        constraint:'terrain / modeled wetness / parcel / building raster',
        intendedDownstream:['tensor-field','wool-road-growth','parcel-subdivision']}
    };
  }
  return {configure,setField,setEnabled,clear,dispose:stop,exportStructuredData,getConfig:()=>({...config})};
}
