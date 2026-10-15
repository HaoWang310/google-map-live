import {unpackTensorGeometryPacket} from './hydro_tensor_geometry.js?v=3.22.54-rainfall-responsive-tensor';
import {sameHydroGrid,validHydroGrid,gridRenderGeometry,tensorDiagnosticGeoJSON} from './hydro_tensor_grid.js?v=3.22.49-tensor-streamlines';
/* v3.22.50-tensor-site-fix · One computed eigenfield in dry and wet states.
   All-year geometry samples the same symmetric tensor eigenaxes. Source
   DEM and flood transport are unchanged; existing line/particle styles are
   retained and are not evidence of measured water velocity. */
export function createHydroTensorRenderer(args){
  const {map,sourceId,particleSourceId,glowLayerId,lineLayerId,particleLayerId,
    ribbonSourceId,ribbonLayerId,ribbonGlowLayerId,getBounds,onStatus,onProgress}=args;
  const empty=()=>({type:'FeatureCollection',features:[]});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const presets={
    terrainWeight:35,drainageWeight:45,avoidance:70,
    smoothness:60,crossStrength:60,
    density:55,length:65,width:1.4,opacity:.85,glow:0,
    speed:0,growth:1,mode:'analysis',direction:'dual',
    showRibbon:true,showFilaments:true,ribbonConcentration:68,
    ribbonWidth:42,trunkEmphasis:75,curvatureSmoothing:65
  };
  let settings={...presets},enabled=false,disposed=false;
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
  // The year controls an explicit *visual line reveal*, not invented hydraulic data.
  let timelineYear=2026;
  const revealForYear=y=>{const t=clamp((y-2026)/74,0,1);return .08+.92*t*t*(3-2*t)};
  let yearGrowth=revealForYear(timelineYear),growthFrom=yearGrowth,growthTo=yearGrowth,growthChangeAt=0;
  let lastRenderedYear=2026,replayGrowthActive=false;
  const R=6378137;
  const toMerc=([lng,lat])=>[R*lng*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/180/2))];
  const fromMerc=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const src=()=>map.getSource(sourceId),dots=()=>map.getSource(particleSourceId);
  const ribbonSource=()=>ribbonSourceId?map.getSource(ribbonSourceId):null;
  const status=t=>{if(t!==reported){reported=t;onStatus?.(t)}};
  const isNumericArray=(v,n)=>v?.length===n;
  const sameArray=(a,b)=>a===b||Boolean(a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])));
  function workerStart(){
    if(worker)return true;
    try{
      worker=new Worker(new URL('./hydro_tensor_worker.js?v=3.22.54-rainfall-responsive-tensor',import.meta.url),{type:'module'});
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
        result={...data,fields,context:submitted.context,depth:submitted.depth,parameters:submitted.parameters};
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
      submitted={context,depth,scenario:{...scenario},parameters:{...settings}};
      const request={
        type:'solve',requestId:++requestId,cols:flow.cols,rows:flow.rows,
        grid,scenario:{...scenario},depthAvailable:Boolean(depth),drainageThresholdKm2,
        cellX:grid.cellProjectedM*grid.groundScale,
        cellY:grid.cellProjectedM*grid.groundScale,
        terrain:context.terrain,accumulation:context.accumulation,
        inside:context.inside,obstacle:context.obstacle,
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
    const g=result.grid;
    let metersPerPixel=(2*Math.PI*R*g.groundScale)/(512*2**(map.getZoom?.()??15));
    let viewRect=[0,0,result.cols,result.rows];
    try{
      if(map.project){
        const a=map.project(fromMerc(g.left,g.top)),b=map.project(fromMerc(g.left+g.cellProjectedM,g.top));
        const pixels=Math.hypot(b.x-a.x,b.y-a.y);
        if(pixels>.001)metersPerPixel=result.cellX/pixels;
      }
      const bounds=map.getBounds?.();
      if(bounds){
        const nw=toMerc([bounds.getWest(),bounds.getNorth()]),se=toMerc([bounds.getEast(),bounds.getSouth()]);
        const pad=12;
        viewRect=[(nw[0]-g.left)/g.cellProjectedM-pad,(g.top-nw[1])/g.cellProjectedM-pad,
          (se[0]-g.left)/g.cellProjectedM+pad,(g.top-se[1])/g.cellProjectedM+pad];
      }
    }catch{/* An unloaded viewport uses the complete known source grid. */}
    return {metersPerPixel,viewRect};
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
        candidates.push({type:'Feature',properties:{
          color:branch==='primary'?'#68cce3':'#8c91be',
          analysisColor:branch==='primary'?'#68cce3':'#8c91be',
          width:branch==='primary'?1.05:.75,opacity:branch==='primary'?.85:.60,
          glowFactor:0,family:'base',branch,preview:true
        },geometry:{type:'LineString',coordinates:path.map(toCoordinate)}});
      }
    }
    if(!candidates.length)return false;
    features=candidates;provisionalLineCount=candidates.length;
    previewBaseSettings={...settings};
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
    // Colour/weight are locally computed from the integrated curve's wet
    // support. This is depth-driven display, not a class label or invented axis.
    const tint=(dry,wet,t)=>{
      const a=dry.match(/[a-f0-9]{2}/ig).map(h=>parseInt(h,16));
      const b=wet.match(/[a-f0-9]{2}/ig).map(h=>parseInt(h,16));
      return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('');
    };
    baseLines=generated.map((line,index)=>{
      const wet=clamp(Number(line.wetSupport||0),0,1);
      const primary=line.branch==='primary';
      return {...line,index,family:'base',wet,
        coordinates:line.path.map(toGeo),
        color:tint(primary?'#618a9b':'#686f8e',primary?'#4fe4ef':'#a2c4ff',wet)};
    });
    lines=baseLines;
    wetLines=lines.filter(line=>line.wetSupport>.035).map((line,index)=>({...line,index}));
    features=lines.map(line=>({type:'Feature',properties:{
      color:line.color,analysisColor:line.color,
      width:Math.max(line.branch==='primary'?.85:.65,
        settings.width*(line.branch==='primary'?.7:.5)*(1+.50*line.wet)),
      opacity:line.branch==='primary'?(.66+.30*line.wet):(.48+.34*line.wet),glowFactor:0,
      family:'base',branch:line.branch,relativeGuidance:line.rank,
      wetSupport:line.wet,lengthM:line.lengthM
    },geometry:{type:'LineString',coordinates:line.coordinates}}));
  }
  function buildRibbons(packet,unpacked){
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    ribbons=unpacked.ribbons.map((line,index)=>({...line,index,
      coordinates:line.path.map(toGeo),color:line.hierarchy==='trunk'?'#8ce7f5':'#54b5dd',
      width:Math.max(.42,settings.width*(line.hierarchy==='trunk'?.52:.37)),opacity:.82}));
    hydroCorePaths=unpacked.skeleton;
    ribbonFeatures=ribbons.map(line=>({type:'Feature',properties:{
      color:line.color,analysisColor:line.color,width:line.width,opacity:line.opacity,
      hierarchy:line.hierarchy,lengthM:line.lengthM,relativeGuidance:line.rank,hydrologyReference:true
    },geometry:{type:'LineString',coordinates:line.coordinates}}));
    geometryStatus();
  }
  function pumpGeometry(){
    if(geometryBusy||!geometryPending||disposed||!enabled)return;
    if(!geometryWorker){
      try{
        geometryWorker=new Worker(new URL('./hydro_tensor_geometry_worker.js?v=3.22.54-rainfall-responsive-tensor',import.meta.url),{type:'module'});
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
              provisionalLineCount=0;previewBaseSettings=null;
              lastRenderedYear=packet.scenario?.year??2026;
              // Preserve selected-year reveal even if geometry finishes late.
              yearGrowth=growthTo;growthFrom=growthTo;
              restart();geometryStatus();
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
    status((scenario?.year??2026)+' 年 · 更新真实双方向流线，保留当前画面…');
    pumpGeometry();
  }
  const onViewportChanged=()=>{
    if(!enabled||!result||disposed)return;
    const view=viewOptions(),key=JSON.stringify([Math.round(Math.log2(view.metersPerPixel)*4),...view.viewRect.map(v=>Math.round(v/8))]);
    if(key===lastViewKey)return;lastViewKey=key;
    if(geometryTimer)clearTimeout(geometryTimer);
    geometryTimer=setTimeout(()=>{geometryTimer=0;if(enabled&&result&&!disposed)queueGeometry()},100);
  };
  map.on?.('moveend',onViewportChanged);
  map.on?.('resize',onViewportChanged);
  function applyStyle(){
    const present=settings.mode==='presentation';
    for(const [id,show] of [[lineLayerId,settings.showFilaments],
      [glowLayerId,settings.showFilaments],
      [ribbonLayerId,settings.showRibbon],
      [ribbonGlowLayerId,settings.showRibbon]]){
      if(id&&map.getLayer(id))map.setLayoutProperty(id,'visibility',
        enabled&&show?'visible':'none');
    }
    if(map.getLayer(lineLayerId)){
      map.setPaintProperty(lineLayerId,'line-color',
        present?['get','color']:['get','analysisColor']);
      map.setPaintProperty(lineLayerId,'line-width',['get','width']);
      map.setPaintProperty(lineLayerId,'line-opacity',
        ['*',settings.opacity*(present?.9:1),['get','opacity']]);
    }
    if(map.getLayer(glowLayerId)){
      map.setPaintProperty(glowLayerId,'line-color',['get','color']);
      map.setPaintProperty(glowLayerId,'line-width',
        ['*',['get','width'],1.5+settings.glow*4]);
      map.setPaintProperty(glowLayerId,'line-opacity',
        ['*',present?settings.glow*settings.opacity*.27:0,
          ['get','opacity'],['get','glowFactor']]);
      map.setPaintProperty(glowLayerId,'line-blur',1+settings.glow*3);
    }
    if(ribbonLayerId&&map.getLayer(ribbonLayerId)){
      map.setPaintProperty(ribbonLayerId,'line-color',
        present?['get','color']:['get','analysisColor']);
      map.setPaintProperty(ribbonLayerId,'line-width',
        ['*',['get','width'],1+settings.trunkEmphasis/110]);
      map.setPaintProperty(ribbonLayerId,'line-opacity',
        ['*',settings.opacity*(present?.96:.5),['get','opacity']]);
    }
    if(ribbonGlowLayerId&&map.getLayer(ribbonGlowLayerId)){
      map.setPaintProperty(ribbonGlowLayerId,'line-color',['get','color']);
      map.setPaintProperty(ribbonGlowLayerId,'line-width',
        ['*',['get','width'],2+settings.glow*5+
          settings.trunkEmphasis/55]);
      map.setPaintProperty(ribbonGlowLayerId,'line-opacity',
        ['*',present?settings.glow*settings.opacity*.43:0,
          ['get','opacity']]);
      map.setPaintProperty(ribbonGlowLayerId,'line-blur',1.4+settings.glow*4);
    }
    if(map.getLayer(particleLayerId)){
      map.setLayoutProperty(particleLayerId,'visibility',
        enabled&&present?'visible':'none');
      map.setPaintProperty(particleLayerId,'circle-opacity',settings.opacity*.85);
    }
  }
  function drawLines(fraction=1){
    const f=clamp(fraction,0,1),prior=geometrySnapshot?.parameters||previewBaseSettings||settings;
    // Supported immediate preview: filter/shorten existing computed geometry.
    // Adding new lines or extending them requires the geometry Worker.
    const densityRatio=clamp((settings.density+10)/(Number(prior.density??settings.density)+10),.05,1);
    const lengthRatio=clamp((settings.length+15)/(Number(prior.length??settings.length)+15),.08,1);
    const accepts=feature=>settings.direction==='dual'||feature.properties.branch===settings.direction;
    const reveal=items=>{
      if(!items.length||f<=0)return [];
      const count=Math.max(1,Math.ceil(items.length*f*densityRatio));
      return items.slice(0,count).map(feature=>{
        const coords=feature.geometry.coordinates;
        if(coords.length<2)return null;
        const ratio=clamp(f*lengthRatio,0,1);
        if(ratio>=.999)return feature;
        return {...feature,geometry:{type:'LineString',
          coordinates:coords.slice(0,Math.max(2,Math.floor(1+(coords.length-1)*ratio)))}};
      }).filter(Boolean);
    };
    src()?.setData({type:'FeatureCollection',
      features:settings.showFilaments?reveal(features.filter(accepts)):[]});
    ribbonSource()?.setData({type:'FeatureCollection',
      features:settings.showRibbon?reveal(ribbonFeatures):[]});
    onProgress?.({year:timelineYear,fraction:f,geometryYear:geometrySnapshot?.scenario?.year??null,
      waitingForGeometry:geometryBusy||Boolean(geometryPending)||Boolean(controlsGeometryTimer)||
        Boolean(requestTimer)||Boolean(geometryTimer)});
  }
  function drawParticles(elapsed,progress){
    if(!dots())return;
    if(!enabled||settings.mode!=='presentation'){
      dots().setData(empty());return
    }
    const particles=[],count=Math.min(145,Math.round(30+settings.density));
    for(let i=0;i<count;i++){
      const main=settings.showRibbon&&ribbons.length&&i%3===0;
      const available=main?ribbons:wetLines;
      if(!available.length||(!main&&!settings.showFilaments))continue;
      const line=available[(i*37)%available.length];
      if(line.index>=available.length*progress)continue;
      const coords=line.coordinates;
      if(coords.length<2)continue;
      // Time is purely a display timeline; no true metres-per-second claim.
      const u=(elapsed*settings.speed*(.06+.09*line.rank)+
        i*.61803398875)%1;
      const pos=u*(coords.length-1),j=Math.min(coords.length-2,Math.floor(pos));
      const alpha=pos-j,a=coords[j],b=coords[j+1];
      particles.push({type:'Feature',properties:{
        color:line.color,radius:main?1.35+line.rank:.85+line.rank
      },geometry:{type:'Point',coordinates:[
        a[0]+(b[0]-a[0])*alpha,a[1]+(b[1]-a[1])*alpha]}});
    }
    dots().setData({type:'FeatureCollection',features:particles});
  }
  function stop(){if(animation)cancelAnimationFrame(animation);animation=0}
  function tick(time){
    if(!enabled){stop();return}
    animation=requestAnimationFrame(tick);
    if(time-lastAnimationDraw<55)return;
    lastAnimationDraw=time;
    const elapsed=Math.max(0,(time-animationOrigin)/1000);
    const duration=replayGrowthActive?Math.max(850,4300/Math.max(.5,settings.speed||1)):
      Math.max(140,290/settings.growth);
    const transition=clamp((time-growthChangeAt)/duration,0,1);
    const eased=transition*transition*(3-2*transition);
    yearGrowth=growthFrom+(growthTo-growthFrom)*eased;
    if(Math.abs(yearGrowth-renderedFraction)>.006||
       (transition>=1&&renderedFraction!==yearGrowth)){
      drawLines(yearGrowth);renderedFraction=yearGrowth;
    }
    if(transition>=1)replayGrowthActive=false;
    if(settings.mode==='presentation')drawParticles(elapsed,yearGrowth);
    else if(transition>=1)stop();
  }
  function restart(){
    stop();animationOrigin=performance.now();
    lastAnimationDraw=0;renderedFraction=-1;applyStyle();
    if(!enabled)return;
    yearGrowth=growthTo;growthFrom=growthTo;growthChangeAt=performance.now();
    drawLines(yearGrowth);renderedFraction=yearGrowth;
    if(settings.mode==='presentation')animation=requestAnimationFrame(tick);
    else dots()?.setData(empty());
  }
  function setTimelineYear(year,{instant=false}={}){
    if(disposed)return;
    const next=clamp(Math.round(Number(year)||2026),2026,2100);
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
    // Playback reveals accepted trajectories; it does not rerun the hydrology.
    replayGrowthActive=true;
    growthFrom=0;yearGrowth=0;growthTo=revealForYear(timelineYear);
    growthChangeAt=performance.now();
    drawLines(0);renderedFraction=0;
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
      drawLines(yearGrowth);renderedFraction=yearGrowth; // immediate geometry preview
      if(controlsGeometryTimer)clearTimeout(controlsGeometryTimer);
      controlsGeometryTimer=setTimeout(()=>{
        controlsGeometryTimer=0;
        if(enabled&&result&&!disposed)queueGeometry();
      },140);
      status('参数预览中 · '+timelineYear+' 年流线重算中…');
    }else if(modeChanged||visibilityChanged)restart();
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
    scenario={year:Number(meta.year)||2026,kind:meta.kind||'design-envelope',token:meta.token??null};
    // Repeated visibility refreshes publish identical native frames. They
    // must not continually invalidate the slower geometry worker.
    const sameContext=oldContext&&context&&sameHydroGrid(oldGrid,grid)&&
      ['terrain','accumulation','inside','obstacle'].every(k=>sameArray(oldContext[k],context[k]));
    if(sameContext&&sameArray(oldDepth,depth)&&oldThreshold===drainageThresholdKm2&&
      oldScenario.year===scenario.year&&oldScenario.kind===scenario.kind&&oldScenario.token===scenario.token)return;
    if(enabled)queueSolve(meta.force===true);
  }
  function setEnabled(on){
    const requested=Boolean(on)&&!disposed;
    if(enabled===requested){
      // Repeated visibility refresh must not reset the year's animation
      // or constantly rebuild the same tensor ribbons.
      applyStyle();return;
    }
    enabled=requested;
    const state=enabled?'visible':'none';
    for(const id of [lineLayerId,glowLayerId,ribbonLayerId,ribbonGlowLayerId]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',state);
    }
    if(!enabled){
      stop();src()?.setData(empty());ribbonSource()?.setData(empty());
      dots()?.setData(empty());
      return;
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
    scenarioSnapshots.clear();
    geometryDesired++;geometryPending=null;
    lines=[];baseLines=[];wetLines=[];features=[];
    provisionalLineCount=0;previewBaseSettings=null;
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    replayGrowthActive=false;
    lastRenderedYear=2026;yearGrowth=revealForYear(timelineYear);growthFrom=yearGrowth;growthTo=yearGrowth;
    stop();src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());
    status('等待 DEM / 汇水 / 雨水计算数据');
  }
  function exportStructuredData(){
    if(!result)return null;
    const f=result.fields,c=result.context;
    const out={
      source:'OS Terrain 50 DEM, DEM-derived contributing area, modeled 2026–2100 depth/hydraulic-head direction; passable building bases',
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
      parameters:{...result.parameters}
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
    disposed=true;stop();
    if(geometryAbortTimer)clearTimeout(geometryAbortTimer);
    if(controlsGeometryTimer)clearTimeout(controlsGeometryTimer);
    if(requestTimer)clearTimeout(requestTimer);
    if(geometryTimer)clearTimeout(geometryTimer);
    map.off?.('moveend',onViewportChanged);map.off?.('resize',onViewportChanged);
    geometryWorker?.terminate();geometryWorker=null;geometryPending=null;
    worker?.terminate();worker=null;tensorBusy=false;tensorActiveRequest=0;
    src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());
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
    return {schema:'london-tensor-site-v1',version:'3.22.54-rainfall-responsive-tensor',
      savedAt:new Date().toISOString(),camera,config:{...settings},viewOptions:viewOptions(),
      current:save(result),scenarios:[...scenarioSnapshots.values()].map(save),
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
  return {configure,setTimelineYear,replayGrowth,setField,setEnabled,clear,dispose,exportStructuredData,
    exportSiteSnapshot,
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
