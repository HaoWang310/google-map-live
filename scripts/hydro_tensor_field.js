import {unpackTensorGeometryPacket} from './hydro_tensor_geometry.js?v=3.28.0-tensor-wool-linked';
import {rasterizeSitePlanning} from './site_planning_tensor.js?v=3.27.0-site-wool';
import {sameHydroGrid,validHydroGrid,gridRenderGeometry,tensorDiagnosticGeoJSON} from './hydro_tensor_grid.js?v=3.22.49-tensor-streamlines';
import {baseTensorMaterial,ribbonTensorMaterial,particleTensorMaterial,traceGradient,traceGrowthWave,traceGrowthProgress,TENSOR_TRACE_WAVES} from './hydro_tensor_visual.js?v=3.22.68-particle-trace-growth';
import {selectSpatialParticlePaths,thinVisibleParticles} from './hydro_tensor_particle_layout.js?v=3.22.76-tensor-particle-balance';
import {buildTensorGapDiagnostic} from './hydro_tensor_gap_diagnostic.js?v=3.22.78-tensor-gap-diagnostic';
/* v3.22.76-tensor-particle-balance · DISPLAY ONLY. Current computed eigenfield,
   original streamline geometry and flood physics are unchanged. Particle
   sampling and visual brightness are spatially balanced. Blue-violet colours encode artistic visual hierarchy only,
   not measured rainfall intensity, velocity or calibrated water depth. */
export function createHydroTensorRenderer(args){
  const {map,sourceId,particleSourceId,glowLayerId,lineLayerId,particleLayerId,
    ribbonSourceId,ribbonLayerId,ribbonGlowLayerId,getBounds,onStatus,onProgress,onGeometryReady,
    gapSourceId,gapWetLayerId,gapCategoryLayerId,onGapDiagnostic}=args;
  const empty=()=>({type:'FeatureCollection',features:[]});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const presets={
    terrainWeight:35,drainageWeight:45,avoidance:70,
    smoothness:60,crossStrength:60,
    density:55,length:65,width:1.4,opacity:.85,glow:.35,
    speed:1,growth:1,mode:'presentation',direction:'dual',
    showRibbon:true,showFilaments:true,ribbonConcentration:68,
    ribbonWidth:42,trunkEmphasis:75,curvatureSmoothing:65
  };
  let settings={...presets},enabled=false,disposed=false,renderSuppressed=false;
  let context=null,flow=null,scenario={year:2026,kind:'design-envelope'};
  let depth=null,result=null,worker=null,submitted=null;
  let drainageThresholdKm2=1;
  let workerGeneration=0,requestId=0,requestTimer=0,lastSubmitted=0;
  let tensorBusy=false,tensorActiveRequest=0;
  let pendingFrame=null,lines=[],baseLines=[],wetLines=[],features=[],animation=0,animationOrigin=0;
  let ribbons=[],ribbonFeatures=[],hydroCorePaths=[],geometryDiagnostics=null;
  let geometryTimer=0,controlsGeometryTimer=0,geometryAbortTimer=0,lastViewKey='';
  let geometryWorker=null,geometryBusy=false,geometryDesired=0,geometryPending=null,geometrySnapshot=null;
  let geometryActiveId=0,geometryStartedAt=0,provisionalLineCount=0,previewBaseSettings=null;
  const scenarioSnapshots=new Map();
  let lastAnimationDraw=0,renderedFraction=0,reported='';
  // A complete geometry collection is published once per accepted Worker
  // packet. Animation only adjusts MapLibre paint; no geometry copies/tiles.
  let uploadedField=null,uploadedRibbon=null,uploadedDirection=null;
  const invalidateUploaded=()=>{
    uploadedField=null;uploadedRibbon=null;uploadedDirection=null;
  };
  // The year controls an explicit *visual line reveal*, not invented hydraulic data.
  let timelineYear=2026;
  const revealForYear=y=>{const t=clamp((y-2026)/74,0,1);return .08+.92*t*t*(3-2*t)};
  let yearGrowth=revealForYear(timelineYear),growthFrom=yearGrowth,growthTo=yearGrowth,growthChangeAt=0;
  let lastRenderedYear=2026,replayGrowthActive=false;
  let continuousPlayback=null; // presentation clock, independent of 9 physical solve keyframes
  const TENSOR_PLAYBACK_RATES=Object.freeze([.5,1.25,1.5,2,3,5]);
  let playbackRate=1.25;
  let particleClockSeconds=0,particleClockAt=null;
  function advanceParticleClock(time){
    if(particleClockAt===null){particleClockAt=time;return;}
    particleClockSeconds+=Math.max(0,time-particleClockAt)/1000*playbackRate;
    particleClockAt=time;
  }
  // Move the presentation time base rather than restarting its animation.
  // Clock references use requestAnimationFrame timestamps / performance.now.
  function advancePlaybackClock(clock,time){
    if(!clock||clock.paused||clock.done)return;
    const delta=Math.max(0,time-clock.clockAt);
    clock.positionMs=clamp(clock.positionMs+delta*clock.rate,0,clock.durationMs);
    clock.clockAt=time;
  }
  function setPlaybackRate(value){
    const rate=Number(value);
    if(!TENSOR_PLAYBACK_RATES.includes(rate))return false;
    const now=performance.now();
    if(particleClockAt!==null&&!continuousPlayback?.paused)
      advanceParticleClock(now);
    if(continuousPlayback)advancePlaybackClock(continuousPlayback,now);
    playbackRate=rate;
    if(continuousPlayback)continuousPlayback.rate=rate;
    return true;
  }
  const getPlaybackState=()=>({
    ready:Boolean(geometrySnapshot&&(features.length>0||ribbonFeatures.length>0)),
    running:Boolean(continuousPlayback&&!continuousPlayback.done&&!continuousPlayback.paused),
    paused:Boolean(continuousPlayback?.paused),
    finished:Boolean(continuousPlayback?.done),
    fraction:clamp(yearGrowth,0,1),year:timelineYear,rate:playbackRate
  });
  const R=6378137;
  const toMerc=([lng,lat])=>[R*lng*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/180/2))];
  const fromMerc=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const src=()=>map.getSource(sourceId),dots=()=>map.getSource(particleSourceId);
  const ribbonSource=()=>ribbonSourceId?map.getSource(ribbonSourceId):null;
  const status=t=>{if(t!==reported){reported=t;onStatus?.(t)}};
  let gapEnabled=false,gapRevision=0,lastGapRevision=-1,gapSummary=null;
  const gapSource=()=>gapSourceId?map.getSource(gapSourceId):null;
  function syncGapDiagnostic(force=false){
    const visible=enabled&&!renderSuppressed&&gapEnabled;
    for(const id of [gapWetLayerId,gapCategoryLayerId]){
      if(id&&map.getLayer(id))map.setLayoutProperty(id,'visibility',
        visible?'visible':'none');
    }
    if(!visible)return;
    if(!result?.fields||!gapSource()){
      onGapDiagnostic?.(null);return;
    }
    if(!force&&lastGapRevision===gapRevision)return;
    const matched=Boolean(geometrySnapshot&&
      sameHydroGrid(geometrySnapshot.grid,result.grid)&&
      geometrySnapshot.scenario?.year===result.scenario?.year&&
      (features.length||ribbonFeatures.length));
    const evaluated=buildTensorGapDiagnostic({
      result:{...result,geometrySpacingM:matched?
        geometryDiagnostics?.primarySpacingM:null},
      streamlines:matched?[...features,...ribbonFeatures]:[],
      geometryMatched:matched
    });
    if(!evaluated)return;
    gapSource().setData(evaluated.geojson);
    gapSummary=evaluated.stats;lastGapRevision=gapRevision;
    onGapDiagnostic?.(gapSummary);
  }
  function setGapDiagnosticEnabled(value){
    gapEnabled=Boolean(value);
    if(!gapEnabled)onGapDiagnostic?.(null);
    syncGapDiagnostic(true);
  }
  // Line sources are stable; only GPU gradient paint changes while tracing.
  const traceGroups=['primary','secondary'].flatMap(branch=>
    Array.from({length:TENSOR_TRACE_WAVES},(_,wave)=>({
      branch,wave,
      coreId:lineLayerId+'-trace-'+branch+'-'+wave,
      glowId:lineLayerId+'-wake-'+branch+'-'+wave
    })));
  const headHaloLayerId=particleLayerId+'-halo';
  let lastTraceHeads=new Map(),particlePaths=[],headsActive=false,lastStaticPaintKey='';
  function ensureTraceLayers(){
    if(!map.getLayer(lineLayerId)||!map.getLayer(ribbonGlowLayerId))return;
    for(const group of traceGroups){
      for(const glow of [true,false]){
        const id=glow?group.glowId:group.coreId;
        if(map.getLayer(id))continue;
        map.addLayer({id,type:'line',source:sourceId,
          filter:['all',['==',['get','branch'],group.branch],
            ['==',['get','growthWave'],group.wave]],
          layout:{visibility:'none','line-cap':'round','line-join':'round'},
          paint:{
            'line-color':group.branch==='primary'?'#518DCE':'#EDBDF9',
            'line-gradient':traceGradient(0,group.branch,glow),
            'line-width':['*',['get','width'],glow?3.1:1.16],
            'line-blur':glow?1.15:0,
            'line-opacity':0
          }},ribbonGlowLayerId);
      }
    }
    if(particleLayerId&&map.getLayer(particleLayerId)&&
       !map.getLayer(headHaloLayerId)){
      map.addLayer({id:headHaloLayerId,type:'circle',source:particleSourceId,
        layout:{visibility:'none'},paint:{
          'circle-color':['get','color'],
          'circle-radius':['*',['get','radius'],2.35],
          'circle-opacity':['*',.20,['coalesce',['get','opacity'],1]],'circle-blur':.82
        }},particleLayerId);
    }
  }
  // All selected paths are samples of existing verified streamlines.
  // Spatial balancing changes only which curves carry moving particle heads.
  function prepareParticlePaths(){
    const source=features.filter(f=>f.geometry?.coordinates?.length>1);
    const midpoint=item=>{
      const coords=item.coordinates||item.geometry?.coordinates;
      return coords?.[Math.floor((coords.length-1)/2)]||[NaN,NaN];
    };
    const pick=(items,count)=>
      selectSpatialParticlePaths(items,count,midpoint);
    const ribbonPicked=pick(ribbons.filter(r=>r.hierarchy==='trunk'),48)
      .concat(pick(ribbons.filter(r=>r.hierarchy!=='trunk'),22));
    const primaryPicked=pick(source.filter(f=>f.properties.branch==='primary'),75);
    const secondaryPicked=pick(source.filter(f=>f.properties.branch==='secondary'),58);
    particlePaths=[...ribbonPicked.map(r=>({
      coordinates:r.coordinates,branch:'ribbon',wave:0,rank:r.rank||.6
    })),...primaryPicked.concat(secondaryPicked).map(f=>({
      coordinates:f.geometry.coordinates,branch:f.properties.branch,
      wave:f.properties.growthWave||0,rank:f.properties.relativeGuidance||0
    }))].map(item=>{
      const coordinates=item.coordinates,dist=new Float64Array(coordinates.length);
      let total=0,prev=toMerc(coordinates[0]);
      for(let i=1;i<coordinates.length;i++){
        const current=toMerc(coordinates[i]);
        total+=Math.hypot(current[0]-prev[0],current[1]-prev[1]);
        dist[i]=total;prev=current;
      }
      return {...item,dist,total};
    }).filter(item=>item.total>0);
  }
  // Protect both moving particle types against visual hotspots on screen.
  // Project into screen pixels (zoom-aware); this never alters paths/positions.
  function balanceParticleDraw(points){
    return thinVisibleParticles(points,
      typeof map.project==='function'?coord=>map.project(coord):null,14);
  }
  function headCoordinate(line,progress){
    const at=line.total*clamp(progress,0,1),d=line.dist,coords=line.coordinates;
    let lo=1,hi=d.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(d[mid]<at)lo=mid+1;else hi=mid;}
    const j=Math.max(1,lo),span=d[j]-d[j-1];
    const k=span>0?(at-d[j-1])/span:0;
    return [coords[j-1][0]+(coords[j][0]-coords[j-1][0])*k,
      coords[j-1][1]+(coords[j][1]-coords[j-1][1])*k];
  }
  function drawGrowthHeads(fraction,active){
    if(!dots())return;
    if(!active||!settings.showFilaments&&!settings.showRibbon){
      if(headsActive){dots().setData(empty());headsActive=false;}
      return;
    }
    const points=[];
    for(let i=0;i<particlePaths.length;i++){
      const path=particlePaths[i];
      if(path.branch==='ribbon'&&!settings.showRibbon)continue;
      if(path.branch!=='ribbon'&&(!settings.showFilaments||
        settings.direction!=='dual'&&settings.direction!==path.branch))continue;
      const progress=traceGrowthProgress(fraction,path.branch,path.wave);
      if(progress<=.012||progress>=.998)continue;
      const p=headCoordinate(path,progress);
      const core=path.branch==='ribbon';
      // Deterministic asynchronous brightness makes neighbouring heads less
      // likely to form a synchronous white blob; the traced geometry stays put.
      const pulse=.74+.18*Math.sin(fraction*20+i*2.3999632);
      points.push({type:'Feature',properties:{
        color:core?'#E3F4FF':path.branch==='secondary'?'#EDBDF9':'#9DDCFF',
        radius:core?1.65:path.branch==='primary'?1.16:.92,
        opacity:Math.max(.48,Math.min(.94,pulse))
      },geometry:{type:'Point',coordinates:p}});
    }
    const visible=balanceParticleDraw(points);
    dots().setData({type:'FeatureCollection',features:visible});
    headsActive=visible.length>0;
  }
  const isNumericArray=(v,n)=>v?.length===n;
  const sameArray=(a,b)=>a===b||Boolean(a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])));
  function workerStart(){
    if(worker)return true;
    try{
      worker=new Worker(new URL('./hydro_tensor_worker.js?v=3.27.0-site-wool',import.meta.url),{type:'module'});
      const current=worker;
      worker.onerror=e=>{
        if(disposed||worker!==current)return;
        tensorBusy=false;
        status('张量计算 Worker 失败：'+(e.message||'检查浏览器控制台'));
      };
      worker.onmessage=({data})=>{
        if(disposed||worker!==current||!enabled||!data)return;
        if(data.requestId===tensorActiveRequest)tensorBusy=false;
        if(data.requestId!==requestId)return;
        if(data.type==='error'){status('张量场计算失败：'+data.message);return}
        if(data.type!=='result'||!data.fields)return;
        const n=data.cols*data.rows;
        const fields={};
        for(const [key,buffer] of Object.entries(data.fields)){
          const Type=['validMask','trunkMask','drainageMask','terrainDirectionValid','dominantProcess'].includes(key)?Uint8Array:Float32Array;
          fields[key]=new Type(buffer);
          if(fields[key].length!==n)return;
        }
        if(!submitted||!sameHydroGrid(data.grid,submitted.context.grid))return;
        result={...data,fields,context:submitted.context,depth:submitted.depth,
          parameters:submitted.parameters,planningDiagnostics:submitted.planningDiagnostics};
        gapRevision++;syncGapDiagnostic();
        if([2026,2100].includes(data.scenario?.year))scenarioSnapshots.set(data.scenario.year,result);
        lastSubmitted=performance.now();
        // Show real eigenvectors immediately while expensive integral curves run.
        if(!features.length)installDirectionalPreview(result);
        queueGeometry();
      };
      return true;
    }catch(error){
      status('张量 Worker 未启动：'+error.message);
      return false;
    }
  }
  // Kept OSM elements are held separately from physical flood inputs.
  // A changed plan invalidates the cached raster once, not on every year.
  let planningFeatures=[],planningRevision=0,planningRaster=null;
  function setPlanningFeatures(features){
    planningFeatures=Array.isArray(features)?features.filter(f=>f?.geometry&&
      f.properties?.planDecision==='keep').map(f=>({
        type:'Feature',properties:{...f.properties},geometry:f.geometry})).slice(0,15000):[];
    planningRevision++;
    planningRaster=null;
    if(enabled&&flow&&context)queueSolve(true);
  }
  function tensorPlanningRaster(grid,cols,rows){
    const key=[grid.left,grid.top,grid.cellProjectedM,cols,rows,planningRevision].join('|');
    if(planningRaster?.key===key)return planningRaster.raster;
    const raster=rasterizeSitePlanning(planningFeatures,grid,cols,rows);
    planningRaster={key,raster};
    return raster;
  }
  function queueSolve(immediate=false){
    requestId++; // Invalidate an in-flight result as soon as inputs change.
    // Never invalidate an already-running useful geometry merely because
    // the next hydrological tensor is being calculated. Keep it on screen.
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    if(!enabled||!flow||!context||disposed)return;
    status(scenario.year+' 年 · 正在计算方向场'+(geometrySnapshot?
      '（暂留 '+geometrySnapshot.scenario.year+' 年几何；尚未更新）':'，尚无线场结果'));
    requestTimer=setTimeout(()=>{
      requestTimer=0;if(!enabled||!flow||!context||disposed)return;
      // Drop an obsolete expensive tensor solve rather than queueing it ahead
      // of the user's most recent slider input on the same Worker.
      if(worker&&tensorBusy){
        worker.terminate();worker=null;tensorBusy=false;tensorActiveRequest=0;
      }
      if(!workerStart())return;
      const n=flow.cols*flow.rows;
      if(!n||n>70000)return;
      const grid=context.grid;
      if(!validHydroGrid(grid,flow.cols,flow.rows)||!sameHydroGrid(grid,flow.grid)){
        status('张量输入缺少匹配的原始洪水网格');return;
      }
      const planning=tensorPlanningRaster(grid,flow.cols,flow.rows);
      submitted={context,depth,scenario:{...scenario},parameters:{...settings},
        planningDiagnostics:planning.diagnostics};
      const request={
        type:'solve',requestId:++requestId,cols:flow.cols,rows:flow.rows,
        grid,scenario:{...scenario},depthAvailable:Boolean(depth),drainageThresholdKm2,
        cellX:grid.cellProjectedM*grid.groundScale,
        cellY:grid.cellProjectedM*grid.groundScale,
        terrain:context.terrain,accumulation:context.accumulation,
        inside:context.inside,obstacle:context.obstacle,
        // Planning-only masks do not overwrite the physical obstacle grid.
        retainedMask:planning.mask,
        retainedRoadX:planning.roadX,retainedRoadY:planning.roadY,
        retainedRoadWeight:planning.roadWeight,
        planningDiagnostics:planning.diagnostics,
        depthMm:depth||new Uint16Array(n),
        vx:flow.vx,vy:flow.vy,intensity:flow.intensity,
        config:{
          terrainWeight:settings.terrainWeight,
          drainageWeight:settings.drainageWeight,
          avoidance:settings.avoidance,
          smoothness:settings.smoothness,
          crossStrength:settings.crossStrength
        }
      };
      tensorBusy=true;tensorActiveRequest=request.requestId;
      worker.postMessage(request);
    },immediate?0:Math.max(75,145-(performance.now()-lastSubmitted)));
  }
  let renderGeo=null;
  function toGeo(p){
    return fromMerc(renderGeo.nw[0]+p.x*renderGeo.dx,renderGeo.nw[1]-p.y*renderGeo.dy);
  }
  function viewOptions(){
    // Geometry covers the ENTIRE selected site. A camera pan, zoom, pitch,
    // right-click rotation or resize must never rerun expensive integration.
    // The original native grid and slider parameters own its stable scale.
    if(!result)return {metersPerPixel:1,viewRect:[0,0,1,1]};
    return {
      metersPerPixel:clamp(result.cellX/12,.65,1.8),
      viewRect:[0,0,result.cols,result.rows]
    };
  }
  function installDirectionalPreview(computed){
    if(!computed?.fields||features.length||!enabled)return false;
    const f=computed.fields,g=computed.grid,w=computed.cols,h=computed.rows;
    const stride=Math.max(3,Math.ceil(Math.sqrt(w*h/370)));
    const candidates=[];
    const validAt=(x,y)=>{
      const xx=Math.floor(x),yy=Math.floor(y),i=yy*w+xx;
      return xx>=0&&xx<w&&yy>=0&&yy<h&&f.validMask[i]&&
        f.confidence[i]>=.075&&f.anisotropy[i]>.02&&
        Math.hypot(f.primaryX[i],f.primaryY[i])>.5;
    };
    const toCoordinate=p=>fromMerc(
      g.left+p.x*g.cellProjectedM,g.top-p.y*g.cellProjectedM);
    const trace=(x,y,branch,sign)=>{
      let px=x,py=y,previous=null;
      const points=[{x,y}];
      for(let k=0;k<7;k++){
        if(!validAt(px,py))break;
        const idx=Math.floor(py)*w+Math.floor(px);
        const ux=f.primaryX[idx],uy=f.primaryY[idx];
        let vx=branch==='primary'?ux:-uy,vy=branch==='primary'?uy:ux;
        if(previous&&vx*previous[0]+vy*previous[1]<0){vx=-vx;vy=-vy}
        if(!previous&&sign<0){vx=-vx;vy=-vy}
        const nx=px+vx*.68,ny=py+vy*.68;
        if(!validAt(nx,ny))break;
        // No diagonal corner-cutting beyond the actual supported field.
        if(Math.floor(nx)!==Math.floor(px)&&Math.floor(ny)!==Math.floor(py)&&
           (!validAt(nx,py)||!validAt(px,ny)))break;
        points.push({x:nx,y:ny});px=nx;py=ny;previous=[vx,vy];
      }
      return points;
    };
    for(let y=stride*.5;y<h;y+=stride)for(let x=stride*.5;x<w;x+=stride){
      if(!validAt(x,y))continue;
      for(const branch of ['primary','secondary']){
        const back=trace(x,y,branch,-1),forward=trace(x,y,branch,1);
        const path=back.slice(1).reverse().concat(forward);
        if(path.length<4)continue;
        const material=baseTensorMaterial({branch,rank:0,wetSupport:0});
        candidates.push({type:'Feature',properties:{
          color:material.color,analysisColor:material.color,
          width:branch==='primary'?1.05:.75,
          opacity:material.opacity,glowFactor:material.glowFactor,
          family:'base',branch,growthWave:traceGrowthWave(candidates.length),preview:true
        },geometry:{type:'LineString',coordinates:path.map(toCoordinate)}});
      }
    }
    if(!candidates.length)return false;
    features=candidates;
    features.forEach((feature,i)=>{
      feature.properties.revealOrder=i/Math.max(1,features.length);
    });
    provisionalLineCount=candidates.length;
    previewBaseSettings={...settings};
    prepareParticlePaths();
    drawLines(growthTo);renderedFraction=growthTo;
    status((computed.scenario?.year??timelineYear)+' 年 · 已显示真实张量方向预览 '+candidates.length+
      ' 条；长流线正在后台积分，预览并非最终曲线');
    return true;
  }
  function geometryStatus(){
    if(!geometryDiagnostics)return;
    const d=geometryDiagnostics,r=d.ribbons;
    const reasons={no_network_above_threshold:'本场地无达到阈值的汇水格',
      network_mask_covers_site:'汇水阈值掩膜几乎覆盖全场，无法定位独立通道',
      no_supported_skeleton:'没有可连续提取的骨架',no_supported_seeds:'骨架种子缺少方向支持',
      integration_blocked_or_ambiguous:'积分受边界、障碍或方向歧义阻断',
      all_below_physical_length:'积分均未达到物理长度要求',spacing_or_length_rejection:'间距或长度筛选淘汰'};
    if(d.visualizationOnly){
      const a=d.field.primary,b=d.field.secondary;
      status('展示模式 · 当前地块水文张量网格 '+(a?.finalLines||0)+' / '+(b?.finalLines||0)+
        ' 组曲线 · 从当前积水与地形张量平滑积分生成。'+
        '\n展示与分析共用场地数据；展示曲线经过平滑，不等于实际水流速度。');
      return;
    }
    const a=d.field.primary,b=d.field.secondary,pct=v=>(100*(v||0)).toFixed(1)+'%';
    const wet=result?.diagnostics?.rainfallResponse;
    const wetText=wet?(' · 受淹格(≥2cm) '+wet.wetCells20mm+
      ' / '+(result?.diagnostics?.counts?.valid||0)+
      ' · 平均积水 '+wet.meanSiteDepthMm.toFixed(1)+'mm'):'';

    status((geometrySnapshot?.scenario?.year??2026)+' 年 · 方向证据 '+d.supportedDirectionCells+'/'+d.validCells+' 格（'+pct(d.directionEvidenceRatio)+'）'+
      '\n主/次线 '+(a?.finalLines??0)+' / '+(b?.finalLines??0)+
      ' · 全场覆盖 '+pct(a?.wholeValidCoverage)+' / '+pct(b?.wholeValidCoverage)+wetText+
      ' · 证据区覆盖 '+pct(a?.supportedCoverage)+' / '+pct(b?.supportedCoverage)+
      '\n长度均值 '+(a?.meanLengthM??0).toFixed(1)+' / '+(b?.meanLengthM??0).toFixed(1)+'m'+
      ' · 中位 '+(a?.medianLengthM??0).toFixed(1)+' / '+(b?.medianLengthM??0).toFixed(1)+'m'+
      ' · <50m '+(a?.under50m??0)+' / '+(b?.under50m??0)+
      '\n种子 '+(a?.candidateSeeds??0)+' / '+(b?.candidateSeeds??0)+
      ' · 积分成功 '+(a?.integrationSucceeded??0)+' / '+(b?.integrationSucceeded??0)+
      ' · 长度淘汰 '+(a?.lengthRejected??0)+' / '+(b?.lengthRejected??0)+
      '\n曲率停止 '+(a?.curvatureStops??0)+' / '+(b?.curvatureStops??0)+
      ' · 置信/插值停止 '+(a?.confidenceStops??0)+' / '+(b?.confidenceStops??0)+
      ' · 间距停止 '+(a?.spacingStops??0)+' / '+(b?.spacingStops??0)+
      ' · 种子间距淘汰 '+(a?.seedSpacingRejected??0)+' / '+(b?.seedSpacingRejected??0)+
      '\n骨架 '+r.validSkeletonCells+
      ' 格 → 种子 '+r.seedCount+' → 积分成功 '+r.integrationSucceeded+'（'+r.integratedPieces+' 段）'+
      ' → 长度淘汰 '+r.lengthRejected+' → 最终线束 '+r.finalBundles+
      (r.reason?' · '+(reasons[r.reason]||r.reason):'')+' · DEM 50m（曲线为插值显示）');
  }
  function buildLines(packet,unpacked){
    renderGeo=gridRenderGeometry(packet.grid);
    geometryDiagnostics=packet.diagnostics;
    const generated=unpacked.lines;
    // Visual metadata only. Geometry coordinates and computed tensor rank
    // are forwarded unchanged; colours are NOT a physical scale.
    baseLines=generated.map((line,index)=>{
      const wet=clamp(Number(line.wetSupport||0),0,1);
      const material=baseTensorMaterial({
        branch:line.branch,rank:line.rank,wetSupport:wet
      });
      return {...line,index,family:'base',wet,
        coordinates:line.path.map(toGeo),
        color:material.color,visualOpacity:material.opacity,
        glowFactor:material.glowFactor};
    });
    lines=baseLines;
    wetLines=lines.filter(line=>line.wetSupport>.035).map((line,index)=>({...line,index}));
    features=lines.map(line=>({type:'Feature',properties:{
      color:line.color,analysisColor:line.color,
      width:settings.mode==='presentation'?
        Math.max(.75,settings.width*(line.branch==='primary'?.78:.68)):
        Math.max(line.branch==='primary'?.85:.65,
          settings.width*(line.branch==='primary'?.7:.5)*(1+.50*line.wet)),
      opacity:settings.mode==='presentation'?.94:line.visualOpacity,
      glowFactor:line.glowFactor,
      family:'base',branch:line.branch,relativeGuidance:line.rank,
      wetSupport:line.wet,lengthM:line.lengthM,
      growthWave:traceGrowthWave(line.index,line.rank),
      revealOrder:line.index/Math.max(1,lines.length)
    },geometry:{type:'LineString',coordinates:line.coordinates}}));
    prepareParticlePaths();
  }
  function buildRibbons(packet,unpacked){
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    ribbons=unpacked.ribbons.map((line,index)=>{
      const material=ribbonTensorMaterial(line);
      return {...line,index,coordinates:line.path.map(toGeo),
        color:material.color,
        width:Math.max(.42,settings.width*(line.hierarchy==='trunk'?.52:.37)),
        opacity:material.opacity,glowFactor:material.glowFactor};
    });
    hydroCorePaths=unpacked.skeleton;
    ribbonFeatures=ribbons.map(line=>({type:'Feature',properties:{
      color:line.color,analysisColor:line.color,width:line.width,opacity:line.opacity,
      glowFactor:line.glowFactor,
      hierarchy:line.hierarchy,lengthM:line.lengthM,relativeGuidance:line.rank,
      hydrologyReference:true,
      revealOrder:line.index/Math.max(1,ribbons.length)
    },geometry:{type:'LineString',coordinates:line.coordinates}}));
    prepareParticlePaths();
    geometryStatus();
  }
  function pumpGeometry(){
    if(geometryBusy||!geometryPending||disposed||!enabled)return;
    if(!geometryWorker){
      try{
        geometryWorker=new Worker(new URL('./hydro_tensor_geometry_worker.js?v=3.27.0-site-wool',import.meta.url),{type:'module'});
        const active=geometryWorker;
        active.onmessage=({data})=>{
          if(disposed||geometryWorker!==active)return;
          geometryBusy=false;geometryActiveId=0;
          if(data.type==='geometry-error'&&data.id===geometryDesired){
            status('当前方向积分失败，继续保留已显示的有效流线：'+data.message);
          }else if(data.type==='geometry-result'&&data.id===geometryDesired&&enabled){
            const packet=data.packet,unpacked=unpackTensorGeometryPacket(packet);
            // A Worker may legitimately fail to integrate long lines from
            // some local tensor evidence: never erase all usable curves.
            if(unpacked.lines?.length||unpacked.ribbons?.length){
              geometrySnapshot={grid:packet.grid,scenario:packet.scenario,
                parameters:packet.parameters};
              buildLines(packet,unpacked);buildRibbons(packet,unpacked);
              gapRevision++;syncGapDiagnostic();
              provisionalLineCount=0;previewBaseSettings=null;
              lastRenderedYear=packet.scenario?.year??2026;
              // Keep the already-running reveal tween across year packets.
              // Never snap all visible geometry to the final fraction.
              restart({preserveGrowth:true});geometryStatus();
              // A full, matching geometry packet is the ONLY trigger that
              // advances automatic hydrology-to-tensor year staging.
              onGeometryReady?.({year:packet.scenario?.year,
                token:packet.scenario?.token??null,
                rainfallCase:packet.scenario?.rainfallCase??null,
                lineCount:unpacked.lines.length,
                ribbonCount:unpacked.ribbons.length});
            }else{
              geometryDiagnostics=packet.diagnostics;
              status('长流线积分结果为空；保留方向预览，检查置信度及积分终止原因');
            }
          }
          pumpGeometry();
        };
        active.onerror=event=>{
          if(disposed||geometryWorker!==active)return;
          geometryBusy=false;geometryActiveId=0;
          active.terminate();geometryWorker=null;
          status('流线 Worker 失败，保留可见方向预览：'+(event.message||'请检查数据'));
          pumpGeometry();
        };
      }catch(error){status('流线 Worker 未启动：'+error.message);return}
    }
    const job=geometryPending;geometryPending=null;geometryBusy=true;
    geometryActiveId=job.id;geometryStartedAt=performance.now();
    geometryWorker.postMessage(job);
  }
  function queueGeometry(){
    if(!result||result.requestId!==requestId||!enabled||disposed)return;
    const {cols,rows,cellX,cellY,grid,scenario,fields,demNativeResolutionM}=result;
    geometryPending={type:'build-geometry',id:++geometryDesired,
      result:{cols,rows,cellX,cellY,grid,scenario,fields,demNativeResolutionM,
        siteMask:result.context?.inside,obstacleMask:result.context?.obstacle},
      options:{...settings,direction:'dual',...viewOptions()}};
    // Supersede a slow obsolete geometry job; keep its *displayed* data.
    // Latest accepted tensor should not wait behind dozens of stale jobs.
    if(geometryAbortTimer){clearTimeout(geometryAbortTimer);geometryAbortTimer=0}
    if(geometryBusy&&geometryWorker&&geometryActiveId!==geometryDesired){
      // A slow obsolete job must never block the newest year indefinitely.
      // Coalesce rapid slider changes; terminate only after input settles.
      geometryAbortTimer=setTimeout(()=>{
        geometryAbortTimer=0;
        if(disposed||!geometryBusy||!geometryPending||!geometryWorker||
           geometryActiveId===geometryDesired)return;
        geometryWorker.terminate();geometryWorker=null;geometryBusy=false;
        geometryActiveId=0;pumpGeometry();
      },180);
    }
    status(settings.mode==='presentation'?'根据当前地块水文张量更新平滑展示网格…':
      (scenario?.year??2026)+' 年 · 更新真实双方向流线，保留当前画面…');
    pumpGeometry();
  }
  // Static parcel geometry is camera-independent. MapLibre reprojects existing
  // GeoJSON on drag/rotate/pitch/zoom; there is no geometry Worker on moveend.
  function uploadGeometryOnce(){
    if(!enabled)return;
    const fieldSource=src();
    if(fieldSource&&
       (uploadedField!==features||uploadedDirection!==settings.direction)){
      // Never slice individual LineString coordinate arrays per frame.
      const visible=settings.direction==='dual'?features:
        features.filter(f=>f.properties.branch===settings.direction);
      fieldSource.setData({type:'FeatureCollection',features:visible});
      uploadedField=features;uploadedDirection=settings.direction;
    }
    const ribbonData=ribbonSource();
    if(ribbonData&&uploadedRibbon!==ribbonFeatures){
      ribbonData.setData({type:'FeatureCollection',features:ribbonFeatures});
      uploadedRibbon=ribbonFeatures;
    }
  }
  function revealOpacity(fraction){
    // No moving GeoJSON coordinates. Animate gradient paint on stable sources.
    // Static mesh remains faint; travelling blue/purple traces carry the image.
    const fractionClamped=clamp(fraction,0,1);
    ensureTraceLayers();
    const paintKey=settings.opacity+'|'+settings.glow+'|'+settings.mode;
    if(paintKey!==lastStaticPaintKey){
      if(map.getLayer(lineLayerId))
        map.setPaintProperty(lineLayerId,'line-opacity',
          ['*',(settings.mode==='presentation'?.43:.13)*settings.opacity,['get','opacity']]);
      if(map.getLayer(glowLayerId))
        map.setPaintProperty(glowLayerId,'line-opacity',0);
      for(const [id,glow] of [[ribbonLayerId,false],[ribbonGlowLayerId,true]]){
        if(!id||!map.getLayer(id))continue;
        map.setPaintProperty(id,'line-opacity',['*',
          settings.opacity*(glow?settings.glow*.80:.96),
          ['get',glow?'glowFactor':'opacity']]);
      }
      lastStaticPaintKey=paintKey;
    }
    for(const group of traceGroups){
      const progress=traceGrowthProgress(fractionClamped,group.branch,group.wave);
      for(const glow of [true,false]){
        const id=glow?group.glowId:group.coreId;
        if(!map.getLayer(id))continue;
        const last=lastTraceHeads.get(id);
        if(last===undefined||Math.abs(last-progress)>.0015){
          map.setPaintProperty(id,'line-gradient',
            traceGradient(progress,group.branch,glow));
          lastTraceHeads.set(id,progress);
        }
        const opacity=settings.opacity*(glow?settings.glow*.66:
          group.branch==='primary'?.92:.86);
        if(map.getPaintProperty(id,'line-opacity')!==opacity)
          map.setPaintProperty(id,'line-opacity',opacity);
      }
    }
    const ribbonProgress=traceGrowthProgress(fractionClamped,'ribbon',0);
    for(const [id,glow] of [[ribbonLayerId,false],[ribbonGlowLayerId,true]]){
      if(!id||!map.getLayer(id))continue;
      const old=lastTraceHeads.get(id);
      if(old===undefined||Math.abs(old-ribbonProgress)>.0015){
        map.setPaintProperty(id,'line-gradient',
          traceGradient(ribbonProgress,'ribbon',glow));
        lastTraceHeads.set(id,ribbonProgress);
      }
    }
  }
  function applyStyle(){
    ensureTraceLayers();
    const present=settings.mode==='presentation';
    for(const group of traceGroups){
      const visible=enabled&&!renderSuppressed&&settings.showFilaments&&
        (settings.direction==='dual'||settings.direction===group.branch);
      for(const id of [group.glowId,group.coreId]){
        if(map.getLayer(id))map.setLayoutProperty(id,'visibility',
          visible&&(id!==group.glowId||settings.glow>0)?'visible':'none');
      }
    }
    if(map.getLayer(headHaloLayerId))
      map.setLayoutProperty(headHaloLayerId,'visibility',
        enabled&&!renderSuppressed&&settings.glow>0?'visible':'none');
    for(const [id,show] of [[lineLayerId,settings.showFilaments],
      [glowLayerId,settings.showFilaments&&settings.glow>0],
      [ribbonLayerId,settings.showRibbon],
      [ribbonGlowLayerId,settings.showRibbon&&settings.glow>0]]){
      if(id&&map.getLayer(id))map.setLayoutProperty(id,'visibility',
        enabled&&!renderSuppressed&&show?'visible':'none');
    }
    if(map.getLayer(lineLayerId)){
      map.setPaintProperty(lineLayerId,'line-color',
        present?['get','color']:['get','analysisColor']);
      map.setPaintProperty(lineLayerId,'line-width',['get','width']);
    }
    if(map.getLayer(glowLayerId)){
      map.setPaintProperty(glowLayerId,'line-color',['get','color']);
      map.setPaintProperty(glowLayerId,'line-width',
        ['*',['get','width'],1.9+settings.glow*.65]);
      map.setPaintProperty(glowLayerId,'line-blur',.42+settings.glow*.65);
    }
    if(ribbonLayerId&&map.getLayer(ribbonLayerId)){
      map.setPaintProperty(ribbonLayerId,'line-color',
        present?['get','color']:['get','analysisColor']);
      map.setPaintProperty(ribbonLayerId,'line-width',
        ['*',['get','width'],1+settings.trunkEmphasis/110]);
    }
    if(ribbonGlowLayerId&&map.getLayer(ribbonGlowLayerId)){
      map.setPaintProperty(ribbonGlowLayerId,'line-color',['get','color']);
      map.setPaintProperty(ribbonGlowLayerId,'line-width',
        ['*',['get','width'],2.65+settings.glow*1.45]);
      map.setPaintProperty(ribbonGlowLayerId,'line-blur',1.15+settings.glow*.70);
    }
    if(map.getLayer(particleLayerId)){
      map.setLayoutProperty(particleLayerId,'visibility',enabled&&!renderSuppressed?'visible':'none');
      map.setPaintProperty(particleLayerId,'circle-opacity',
        ['*',settings.opacity*.70,['coalesce',['get','opacity'],1]]);
      map.setPaintProperty(particleLayerId,'circle-blur',.18);
    }
    revealOpacity(yearGrowth);
  }
  function drawLines(fraction=1){
    // An OSM/MapLibre source update is costly for thousands of lines. Do it
    // ONLY when a new full geometry packet arrives or direction changes.
    uploadGeometryOnce();
    revealOpacity(fraction);
    onProgress?.({year:timelineYear,fraction:clamp(fraction,0,1),
      geometryYear:geometrySnapshot?.scenario?.year??null,
      waitingForGeometry:geometryBusy||Boolean(geometryPending)||
        Boolean(controlsGeometryTimer)||Boolean(requestTimer)||Boolean(geometryTimer)});
  }
  function drawParticles(elapsed,progress){
    if(!dots())return;
    if(!enabled||renderSuppressed||settings.mode!=='presentation'){
      dots().setData(empty());return;
    }
    const particles=[],count=Math.min(110,Math.round(24+settings.density));
    // The same spatially balanced path pool is reused after growth finishes.
    // Constant phase offsets stagger each head; positions follow arc length
    // instead of vertex index, so short segments do not produce speed spikes.
    for(let i=0;i<count;i++){
      if(!particlePaths.length)break;
      const line=particlePaths[Math.min(particlePaths.length-1,
        Math.floor((i+.5)*particlePaths.length/count))];
      const main=line.branch==='ribbon';
      if(main&&!settings.showRibbon)continue;
      if(!main&&(!settings.showFilaments||
        settings.direction!=='dual'&&settings.direction!==line.branch))continue;
      const u=(particleClockSeconds*(.06+.09*line.rank)+
        i*.61803398875)%1;
      const coords=line.coordinates;
      const pos=u*(coords.length-1);
      // Sample by verified physical arc length; do not alter source curve.
      const point=headCoordinate(line,u);
      const particleMaterial=particleTensorMaterial({index:i,main,rank:line.rank});
      particles.push({type:'Feature',properties:{
        color:particleMaterial.color,radius:Math.min(1.20,particleMaterial.radius),
        opacity:.68+.15*Math.sin(particleClockSeconds*1.1+i*2.3999632)
      },geometry:{type:'Point',coordinates:point}});
    }
    dots().setData({type:'FeatureCollection',
      features:balanceParticleDraw(particles)});
  }
  function stop(){if(animation)cancelAnimationFrame(animation);animation=0}
  function startContinuousPlayback({durationMs=64000}={}){
    if(!enabled||disposed)return false; // UI defers start until computed geometry exists.
    const now=performance.now();
    continuousPlayback={clockAt:now,positionMs:0,rate:playbackRate,
      paused:false,durationMs:clamp(Number(durationMs)||64000,8000,240000)};
    replayGrowthActive=false;
    particleClockSeconds=0;particleClockAt=now;
    timelineYear=2026;growthFrom=0;growthTo=1;growthChangeAt=now;
    yearGrowth=0;renderedFraction=-1;
    stop();animationOrigin=now;lastAnimationDraw=0;
    drawLines(0);drawGrowthHeads(0,true);
    animation=requestAnimationFrame(tick);
    return true;
  }
  function stopContinuousPlayback(){
    continuousPlayback=null;particleClockAt=null;
    stop();
    dots()?.setData(empty());headsActive=false;
  }
  function seekContinuousPlayback(year,{resume=false}={}){
    if(disposed||!enabled)return false;
    // A manual slider seek is a PRESENTATION-ONLY operation: no solver runs,
    // geometry reconstruction, worker requests or rainfall-frame queries.
    const targetYear=clamp(Number(year)||2026,2026,2100);
    const progress=clamp((targetYear-2026)/74,0,1);
    const now=performance.now();
    let clock=continuousPlayback;
    if(!clock){
      clock={clockAt:now,positionMs:0,rate:playbackRate,paused:true,
        durationMs:64000};
      continuousPlayback=clock;
    }
    stop();
    clock.positionMs=progress*clock.durationMs;
    clock.clockAt=now;
    clock.rate=playbackRate;
    clock.done=progress>=1;
    clock.paused=!resume||clock.done;
    timelineYear=targetYear;
    yearGrowth=progress;growthFrom=progress;growthTo=progress;
    growthChangeAt=now;renderedFraction=-1;
    replayGrowthActive=false;
    // Match path-tracing particles to the selected time rather than keeping
    // the old location from before seeking backwards.
    particleClockSeconds=clock.positionMs/1000;
    particleClockAt=clock.paused?null:now;
    drawLines(progress);
    renderedFraction=progress;
    drawGrowthHeads(progress,progress>.001&&progress<1);
    if(!clock.paused){lastAnimationDraw=0;animation=requestAnimationFrame(tick)}
    return true;
  }
  function pauseContinuousPlayback(){
    const playback=continuousPlayback;
    if(!playback||playback.done||playback.paused)return false;
    const now=performance.now();
    advancePlaybackClock(playback,now);
    if(particleClockAt!==null)advanceParticleClock(now);
    particleClockAt=null;
    playback.paused=true;
    stop();
    // Freeze the existing particle-head source in place, like pausing a film.
    // Clearing it would make all heads disappear at the pause moment.
    return true;
  }
  function resumeContinuousPlayback(){
    const playback=continuousPlayback;
    if(!enabled||!playback||!playback.paused||playback.done)return false;
    playback.clockAt=performance.now();
    particleClockAt=playback.clockAt;
    playback.paused=false;
    lastAnimationDraw=0;
    if(!animation)animation=requestAnimationFrame(tick);
    return true;
  }
  function tick(time){
    if(!enabled||continuousPlayback?.paused){stop();return}
    animation=requestAnimationFrame(tick);
    advanceParticleClock(time);
    // 30-40 Hz GPU gradient updates. The elapsed-clock itself stays linear
    // even if an individual animation frame takes longer to draw.
    if(time-lastAnimationDraw<26)return;
    lastAnimationDraw=time;
    const elapsed=Math.max(0,(time-animationOrigin)/1000);
    let transition;
    const auto=continuousPlayback;
    if(auto){
      advancePlaybackClock(auto,time);
      transition=clamp(auto.positionMs/auto.durationMs,0,1);
      yearGrowth=transition; // LINEAR years, no smoothstep/decade jumps.
      timelineYear=2026+74*transition;
      if(transition>=1){
        // Keep the guard alive until the whole solver sequence ends. A slow
        // 2095/2100 Worker result must NEVER snap a finished 2100 display
        // back to an earlier keyframe.
        auto.done=true;
        growthTo=1;growthFrom=1;
      }
    }else{
      const duration=replayGrowthActive?
        Math.max(2500,5900/playbackRate):
        Math.max(220,360/settings.growth);
      transition=clamp((time-growthChangeAt)/duration,0,1);
      const eased=transition*transition*(3-2*transition);
      yearGrowth=growthFrom+(growthTo-growthFrom)*eased;
    }
    if(Math.abs(yearGrowth-renderedFraction)>.0015||
       (transition>=1&&renderedFraction!==yearGrowth)){
      drawLines(yearGrowth);renderedFraction=yearGrowth;
    }
    if(transition<1)drawGrowthHeads(yearGrowth,true);
    else if(settings.mode==='presentation'&&settings.speed>0)
      drawParticles(elapsed,yearGrowth);
    else drawGrowthHeads(yearGrowth,false);
    if(transition>=1&&(!continuousPlayback||continuousPlayback.done)){
      replayGrowthActive=false;
      if(settings.mode!=='presentation'||settings.speed<=0)stop();
    }
  }
  function restart({preserveGrowth=false}={}){
    stop();animationOrigin=performance.now();
    lastAnimationDraw=0;renderedFraction=-1;applyStyle();
    if(!enabled)return;
    if(preserveGrowth||continuousPlayback){
      // Worker refreshes AND analysis/presentation mode changes must preserve
      // the currently visible year, including during a paused session.
      growthFrom=yearGrowth;growthChangeAt=performance.now();
    }else{
      yearGrowth=growthTo;growthFrom=growthTo;growthChangeAt=performance.now();
    }
    drawLines(yearGrowth);renderedFraction=yearGrowth;
    drawGrowthHeads(yearGrowth,Boolean(continuousPlayback&&!continuousPlayback.paused&&!continuousPlayback.done)||
      (preserveGrowth&&Math.abs(growthTo-yearGrowth)>.0005));
    if((continuousPlayback&&!continuousPlayback.done&&!continuousPlayback.paused)||settings.mode==='presentation'&&
       !continuousPlayback?.paused||
       (preserveGrowth&&Math.abs(growthTo-yearGrowth)>.0005))
      animation=requestAnimationFrame(tick);
    else if(!continuousPlayback?.paused)dots()?.setData(empty());
  }
  function setTimelineYear(year,{instant=false}={}){
    if(disposed)return;
    // Solvers still report nine authoritative years; automatic rendering
    // has its OWN continuous clock and must not jump to solver keyframes.
    if(continuousPlayback&&!instant)return;
    continuousPlayback=null;
    const next=clamp(Number(year)||2026,2026,2100);
    if(next===timelineYear&&!instant)return;
    timelineYear=next;replayGrowthActive=false;
    const target=revealForYear(next);
    if(instant||!enabled||!geometrySnapshot){
      growthTo=target;growthFrom=target;yearGrowth=target;
      if(enabled)restart();
      return;
    }
    // Reveal current geometry immediately; the authoritative year recomputes.
    growthFrom=yearGrowth;growthTo=target;growthChangeAt=performance.now();
    if(!animation)animation=requestAnimationFrame(tick);
  }
  function replayGrowth(){
    if(!enabled||!geometrySnapshot||disposed)return;
    stopContinuousPlayback();
    // Playback reveals accepted trajectories; it does not rerun the hydrology.
    replayGrowthActive=true;
    growthFrom=0;yearGrowth=0;growthTo=revealForYear(timelineYear);
    growthChangeAt=performance.now();
    drawLines(0);renderedFraction=0;
    drawGrowthHeads(0,true);
    if(!animation)animation=requestAnimationFrame(tick);
  }
  function configure(patch){
    if(disposed)return;
    if(Object.prototype.hasOwnProperty.call(patch,'wetnessWeight')&&
       !Object.prototype.hasOwnProperty.call(patch,'avoidance'))
      patch={...patch,avoidance:patch.wetnessWeight};
    const next={...settings,...patch};
    for(const key of ['terrainWeight','drainageWeight','avoidance','smoothness',
      'crossStrength','density','length','ribbonConcentration','ribbonWidth',
      'trunkEmphasis','curvatureSmoothing'])
      next[key]=clamp(Number(next[key]),0,100);
    next.showRibbon=Boolean(next.showRibbon);
    next.showFilaments=Boolean(next.showFilaments);
    next.width=clamp(Number(next.width),.5,3.5);
    next.opacity=clamp(Number(next.opacity),.1,1);
    next.glow=clamp(Number(next.glow),0,1);
    // Internal legacy speed remains accepted for imported settings, but the
    // removed slider no longer controls timeline or travelling particles.
    next.speed=clamp(Number(next.speed),0,3);
    next.growth=clamp(Number(next.growth),.5,3);
    next.mode=next.mode==='presentation'?'presentation':'analysis';
    next.direction=['primary','secondary','dual'].includes(next.direction)?
      next.direction:'dual';
    const solverChanged=['terrainWeight','drainageWeight','avoidance',
      'smoothness','crossStrength'].some(k=>settings[k]!==next[k]);
    const geometryChanged=['density','length','width',
      'ribbonConcentration','ribbonWidth','trunkEmphasis','curvatureSmoothing',
      ].some(k=>settings[k]!==next[k]);
    const visibilityChanged=['direction','showRibbon','showFilaments'].some(k=>settings[k]!==next[k]);
    const modeChanged=next.mode!==settings.mode;
    settings=next;
    applyStyle();
    if(solverChanged){
      if(controlsGeometryTimer){clearTimeout(controlsGeometryTimer);controlsGeometryTimer=0}
      queueSolve();
      status(timelineYear+' 年 · 正在按新地形／汇水／积水权重重算方向…');
    }else if(geometryChanged&&result){
      drawLines(yearGrowth);renderedFraction=yearGrowth; // paint-only geometry preview
      if(controlsGeometryTimer)clearTimeout(controlsGeometryTimer);
      controlsGeometryTimer=setTimeout(()=>{
        controlsGeometryTimer=0;
        if(enabled&&result&&!disposed)queueGeometry();
      },240);
      status('参数预览中 · '+timelineYear+' 年流线重算中…');
    }else if(modeChanged&&result){
      queueGeometry();restart();
    }else if(visibilityChanged)restart();
  }
  function setField(data,spatialContext,meta={}){
    if(disposed||!data)return;
    const n=data.cols*data.rows;
    if(n<=0||n>70000)return;
    const grid=meta.grid||spatialContext?.grid;
    const oldContext=context,oldDepth=depth,oldScenario=scenario,oldGrid=context?.grid,oldThreshold=drainageThresholdKm2;
    if(!validHydroGrid(grid,data.cols,data.rows)){
      status('缺少原始洪水网格；不混用估算网格');return;
    }
    const flowCandidate={
      cols:data.cols,rows:data.rows,grid,
      vx:new Int8Array(data.vx),vy:new Int8Array(data.vy),
      intensity:new Uint8Array(data.intensity)
    };
    if([flowCandidate.vx,flowCandidate.vy,flowCandidate.intensity].some(a=>!isNumericArray(a,n)))return;
    if(context&&!sameHydroGrid(context.grid,grid)){
      clear(); // A new parcel must never display the previous parcel geometry.
      context=null;result=null;depth=null;
    }
    flow=flowCandidate;
    if(spatialContext?.cols===data.cols&&spatialContext?.rows===data.rows){
      const next={
        terrain:new Float32Array(spatialContext.terrain),
        accumulation:new Uint16Array(spatialContext.accumulation),
        inside:new Uint8Array(spatialContext.inside),
        obstacle:new Uint8Array(spatialContext.obstacle)
      };
      if(Object.values(next).every(a=>a.length===n)&&sameHydroGrid(spatialContext.grid,grid))
        context={...next,grid:{...grid},drainageAvailable:spatialContext.drainageAvailable};
    }
    if(meta.depthMm){
      const d=new Uint16Array(meta.depthMm);
      if(d.length!==n){status('水深与原始洪水网格不匹配');return;}
      depth=d;
    }else depth=null;
    drainageThresholdKm2=Number(meta.drainageThresholdKm2??1);
    scenario={year:Number(meta.year)||2026,kind:meta.kind||'design-envelope',
      token:meta.token??null,rainfallCase:meta.rainPreset??null};
    // Repeated visibility refreshes publish identical native frames. They
    // must not continually invalidate the slower geometry worker.
    const sameContext=oldContext&&context&&sameHydroGrid(oldGrid,grid)&&
      ['terrain','accumulation','inside','obstacle'].every(k=>sameArray(oldContext[k],context[k]));
    if(sameContext&&sameArray(oldDepth,depth)&&oldThreshold===drainageThresholdKm2&&
      oldScenario.year===scenario.year&&oldScenario.kind===scenario.kind&&
      oldScenario.token===scenario.token&&oldScenario.rainfallCase===scenario.rainfallCase)return;
    if(enabled)queueSolve(meta.force===true);
  }
  // Presentation-only suppression for STEP05. Unlike setEnabled(false),
  // this does not cancel physical workers, invalidate cached scenarios,
  // restart continuous playback, or clear tensor geometry.
  function setRenderSuppressed(value){
    const next=Boolean(value);
    if(renderSuppressed===next)return;
    renderSuppressed=next;
    syncGapDiagnostic();
    if(map.getLayer(lineLayerId))applyStyle();
  }
  function setEnabled(on){
    const requested=Boolean(on)&&!disposed;
    if(enabled===requested){
      syncGapDiagnostic();
      // Repeated visibility refresh must not reset the year's animation
      // or constantly rebuild the same tensor ribbons.
      applyStyle();return;
    }
    enabled=requested;
    syncGapDiagnostic();
    const state=enabled?'visible':'none';
    for(const id of [lineLayerId,glowLayerId,ribbonLayerId,ribbonGlowLayerId,
      ...traceGroups.flatMap(g=>[g.coreId,g.glowId]),headHaloLayerId,particleLayerId]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',state);
    }
    if(!enabled){
      // Strict OFF: no Worker may publish tensor geometry over the flood view.
      requestId++;geometryDesired++;geometryPending=null;
      if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
      if(controlsGeometryTimer){clearTimeout(controlsGeometryTimer);controlsGeometryTimer=0}
      if(geometryTimer){clearTimeout(geometryTimer);geometryTimer=0}
      if(geometryAbortTimer){clearTimeout(geometryAbortTimer);geometryAbortTimer=0}
      worker?.terminate();worker=null;tensorBusy=false;tensorActiveRequest=0;
      geometryWorker?.terminate();geometryWorker=null;geometryBusy=false;geometryActiveId=0;
      stop();src()?.setData(empty());ribbonSource()?.setData(empty());
      dots()?.setData(empty());headsActive=false;lastTraceHeads.clear();lastStaticPaintKey='';
      continuousPlayback=null;particleClockAt=null;invalidateUploaded();return;
    }
    // A layer toggle is a visibility change, not a reason to throw away the
    // previously displayed provisional or completed geometry.
    if(features.length||ribbonFeatures.length)restart();
    else if(result)installDirectionalPreview(result);
    if(flow&&context)queueSolve(true);
    else if(result)queueGeometry();
    applyStyle();
  }
  function clear(){
    if(geometryAbortTimer){clearTimeout(geometryAbortTimer);geometryAbortTimer=0}
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    if(controlsGeometryTimer){clearTimeout(controlsGeometryTimer);controlsGeometryTimer=0}
    requestId++;result=null;flow=null;context=null;depth=null;geometryDiagnostics=null;geometrySnapshot=null;
    gapRevision++;lastGapRevision=-1;gapSummary=null;
    gapSource()?.setData(empty());onGapDiagnostic?.(null);
    scenarioSnapshots.clear();
    geometryDesired++;geometryPending=null;
    lines=[];baseLines=[];wetLines=[];features=[];particlePaths=[];
    headsActive=false;lastTraceHeads.clear();lastStaticPaintKey='';
    provisionalLineCount=0;previewBaseSettings=null;
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    replayGrowthActive=false;continuousPlayback=null;
    particleClockSeconds=0;particleClockAt=null;
    lastRenderedYear=2026;yearGrowth=revealForYear(timelineYear);growthFrom=yearGrowth;growthTo=yearGrowth;
    stop();src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());invalidateUploaded();
    status('等待 DEM / 汇水 / 雨水计算数据');
  }
  function exportStructuredData(){
    if(!result)return null;
    const f=result.fields,c=result.context;
    const out={
      source:'OS Terrain 50 DEM, DEM-derived contributing area, staged 2026–2100 flood depth guidance under buildings; surface runoff uses solid walls',
      tensorSemantics:'hydrological orientation axes (principal/orthogonal), NOT future road lines or true m/s velocity',
      scenarioYear:result.scenario?.year??2026,
      stage:{...result.scenario},crs:'EPSG:4326',localBasis:'east/south in local ground metres',
      grid:{...result.grid},diagnostics:result.diagnostics,
      drainageDirectionMethod:result.drainageDirectionMethod,
      drainageThresholdKm2:result.drainageThresholdKm2,
      boundsLngLat:[
        fromMerc(result.grid.left,result.grid.top),
        fromMerc(result.grid.left+result.cols*result.grid.cellProjectedM,result.grid.top),
        fromMerc(result.grid.left+result.cols*result.grid.cellProjectedM,result.grid.top-result.rows*result.grid.cellProjectedM),
        fromMerc(result.grid.left,result.grid.top-result.rows*result.grid.cellProjectedM)
      ],cols:result.cols,rows:result.rows,
      cellX:result.cellX,cellY:result.cellY,
      demNativeResolutionM:result.demNativeResolutionM,
      terrainGradientSupportM:result.terrainGradientSupportM,
      terrainSamplingNote:'Simulation cells finer than 50m do not imply independent higher-resolution DEM data',
      designNotMeasuredVelocity:true,
      parameters:{...result.parameters},planningDiagnostics:result.planningDiagnostics||null
    };
    for(const [name,array] of Object.entries(f))out[name]=new array.constructor(array);
    if(c)for(const name of ['terrain','accumulation','inside','obstacle'])
      out[name]=new c[name].constructor(c[name]);
    if(result.depth)out.depthMm=new Uint16Array(result.depth);
    // Do not return road polylines as validated street designs.
    out.terrainBaseIsYearInvariant=true;
    out.displayUsesUnifiedComputedEigenfield=true;
    out.displayCountIndependentOfYear=true;
    out.annualWetDirectionDataIsDynamic=true;
    out.hydrologyRibbonVisualOnly=true;
    out.hydrologyRibbonCount=ribbons.length;
    out.geometryDiagnostics=geometryDiagnostics?{...structuredClone(geometryDiagnostics),
      sourceYear:geometrySnapshot?.scenario?.year,
      pending:geometryBusy||Boolean(geometryPending)||Boolean(requestTimer)||result.requestId!==requestId}:null;
    out.requestedScenario={...scenario};out.tensorPending=Boolean(requestTimer)||result.requestId!==requestId;
    out.nextStages=['Wool Algorithm','Road Network','Urban Parcel Subdivision'];
    return out;
  }
  function dispose(){
    disposed=true;continuousPlayback=null;stop();
    if(geometryAbortTimer)clearTimeout(geometryAbortTimer);
    if(controlsGeometryTimer)clearTimeout(controlsGeometryTimer);
    if(requestTimer)clearTimeout(requestTimer);
    if(geometryTimer)clearTimeout(geometryTimer);
    geometryWorker?.terminate();geometryWorker=null;geometryPending=null;
    worker?.terminate();worker=null;tensorBusy=false;tensorActiveRequest=0;
    src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());particlePaths=[];headsActive=false;
    lastTraceHeads.clear();lastStaticPaintKey='';invalidateUploaded();
  }
  // Lightweight readiness probe; never serialise large tensor arrays for polling.
  // Timeline display reaching 2100 is NOT proof of a completed tensor solve.
  function getSiteSnapshotReadiness(){
    const peak=scenarioSnapshots.get(2100)||
      (result?.scenario?.year===2100?result:null);
    const n=(peak?.cols||0)*(peak?.rows||0);
    const complete=Boolean(n>=16&&peak?.scenario?.year===2100&&
      peak?.scenario?.kind==='rainfall-risk-scenario'&&
      peak?.depth?.length===n&&peak?.fields?.primaryX?.length===n&&
      peak?.fields?.primaryY?.length===n&&peak?.fields?.validMask?.length===n);
    return {ready:complete,year:peak?.scenario?.year??null,
      token:peak?.scenario?.token??null,
      rainfallCase:peak?.scenario?.rainfallCase??null,
      kind:peak?.scenario?.kind??null};
  }
  function exportSiteSnapshot(){
    if(!result)return null;
    const keys=['primaryX','primaryY','confidence','anisotropy','validMask','drainageMask','trunkMask',
      'drainageRank','drainageAreaKm2','drainageConfidence','rainfallInfluence'];
    const encode=a=>a?{type:a.constructor.name,values:Array.from(a,v=>Number.isFinite(v)?v:null)}:null;
    const save=r=>({grid:{...r.grid},scenario:{...r.scenario},cols:r.cols,rows:r.rows,
      cellX:r.cellX,cellY:r.cellY,demNativeResolutionM:r.demNativeResolutionM,parameters:r.parameters,
      fields:Object.fromEntries(keys.filter(k=>r.fields[k]).map(k=>[k,encode(r.fields[k])])),
      input:Object.fromEntries(['terrain','accumulation','inside','obstacle'].map(k=>[k,encode(r.context?.[k])])),
      depthMm:encode(r.depth)});
    const camera={};
    for(const [key,method] of [['center','getCenter'],['zoom','getZoom'],['bearing','getBearing'],['pitch','getPitch']]){
      const value=map[method]?.();camera[key]=value?.toArray?.()??value??null;
    }
    const canvas=map.getCanvas?.();camera.viewport=canvas?{width:canvas.clientWidth,height:canvas.clientHeight}:null;
    const layerState=id=>{
      if(!id||!map.getLayer?.(id))return {id,exists:false};
      const layer=map.getLayer(id);
      return {id,exists:true,minzoom:layer.minzoom,maxzoom:layer.maxzoom,
        visibility:map.getLayoutProperty?.(id,'visibility'),filter:map.getFilter?.(id),
        width:map.getPaintProperty?.(id,'line-width'),opacity:map.getPaintProperty?.(id,'line-opacity')};
    };
    return {schema:'london-tensor-site-v1',version:'3.27.0-site-wool',
      savedAt:new Date().toISOString(),camera,config:{...settings},viewOptions:viewOptions(),
      current:save(result),scenarios:[...scenarioSnapshots.values()].map(save),
      planningDiagnostics:result.planningDiagnostics||null,
      requestedScenario:{...scenario},
      renderState:{layers:[lineLayerId,ribbonLayerId].map(layerState),
        generatedLines:features.length,displayedLines:settings.showFilaments?
          features.filter(f=>settings.direction==='dual'||f.properties.branch===settings.direction).length:0,
        generatedRibbons:ribbonFeatures.length,displayedRibbons:settings.showRibbon?ribbonFeatures.length:0,
        staticFraction:renderedFraction,timelineYear,
        yearRevealIsVisualOnly:true,geometryYear:geometrySnapshot?.scenario?.year??null,
        provisionalLineCount},
      geometry:geometrySnapshot?{scenario:geometrySnapshot.scenario,parameters:geometrySnapshot.parameters,
        diagnostics:geometryDiagnostics,field:features,ribbons:ribbonFeatures}:null,
      pending:{tensor:Boolean(requestTimer)||result.requestId!==requestId,geometry:geometryBusy||Boolean(geometryPending)},
      acceptance:'NOT verified in the user-selected parcel; source data export, not a visual acceptance report'};
  }
  return {configure,setTimelineYear,replayGrowth,setGapDiagnosticEnabled,syncGapDiagnostic,
    setPlanningFeatures,
    startContinuousPlayback,
    stopContinuousPlayback,seekContinuousPlayback,pauseContinuousPlayback,resumeContinuousPlayback,
    setPlaybackRate,getPlaybackState,setField,setEnabled,setRenderSuppressed,clear,dispose,exportStructuredData,
    exportSiteSnapshot,getSiteSnapshotReadiness,
    exportDiagnostics:(stride=4)=>tensorDiagnosticGeoJSON(result,stride),
    exportGeometry:()=>geometrySnapshot?{grid:{...geometrySnapshot.grid},scenario:{...geometrySnapshot.scenario},
      parameters:{...geometrySnapshot.parameters},pending:geometryBusy||Boolean(geometryPending)||Boolean(requestTimer)||result?.requestId!==requestId,
      diagnostics:structuredClone(geometryDiagnostics),
      field:{type:'FeatureCollection',features:structuredClone(features)},
      ribbons:{type:'FeatureCollection',features:structuredClone(ribbonFeatures)},
      skeleton:{type:'FeatureCollection',features:hydroCorePaths.map(chain=>({type:'Feature',
        properties:{rank:chain.rank,lengthM:chain.lengthM,notD8:true},
        geometry:{type:'LineString',coordinates:chain.path.map(toGeo)}}))}}:null,
    getConfig:()=>({...settings})};
}

