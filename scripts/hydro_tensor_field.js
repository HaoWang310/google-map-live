import {sameHydroGrid,validHydroGrid,gridRenderGeometry,tensorDiagnosticGeoJSON} from './hydro_tensor_grid.js?v=3.22.48-tensor-continuity';
/* v3.22.48-tensor-continuity · One computed eigenfield in dry and wet states.
   All-year geometry samples the same symmetric tensor eigenaxes. Source
   DEM and flood transport are unchanged; existing line/particle styles are
   retained and are not evidence of measured water velocity. */
export function createHydroTensorRenderer(args){
  const {map,sourceId,particleSourceId,glowLayerId,lineLayerId,particleLayerId,
    ribbonSourceId,ribbonLayerId,ribbonGlowLayerId,getBounds,onStatus}=args;
  const empty=()=>({type:'FeatureCollection',features:[]});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const presets={
    terrainWeight:35,drainageWeight:45,avoidance:70,
    smoothness:60,crossStrength:60,
    density:55,length:65,width:1.4,opacity:.85,glow:.5,
    speed:1,growth:1,mode:'presentation',direction:'dual',
    showRibbon:true,showFilaments:true,ribbonConcentration:68,
    ribbonWidth:42,trunkEmphasis:75,curvatureSmoothing:65
  };
  let settings={...presets},enabled=false,disposed=false;
  let context=null,flow=null,scenario={year:2026,kind:'design-envelope'};
  let depth=null,result=null,worker=null,submitted=null;
  let drainageThresholdKm2=1;
  let workerGeneration=0,requestId=0,requestTimer=0,lastSubmitted=0;
  let pendingFrame=null,lines=[],baseLines=[],wetLines=[],features=[],animation=0,animationOrigin=0;
  let ribbons=[],ribbonFeatures=[],hydroCorePaths=[];
  let lastAnimationDraw=0,renderedFraction=0,reported='';
  let yearGrowth=0.22,growthFrom=0.22,growthTo=0.22,growthChangeAt=0;
  let lastRenderedYear=2026;
  const R=6378137;
  const toMerc=([lng,lat])=>[R*lng*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/180/2))];
  const fromMerc=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const src=()=>map.getSource(sourceId),dots=()=>map.getSource(particleSourceId);
  const ribbonSource=()=>ribbonSourceId?map.getSource(ribbonSourceId):null;
  const status=t=>{if(t!==reported){reported=t;onStatus?.(t)}};
  const isNumericArray=(v,n)=>v?.length===n;
  function workerStart(){
    if(worker)return true;
    try{
      worker=new Worker(new URL('./hydro_tensor_worker.js?v=3.22.48-tensor-continuity',import.meta.url),{type:'module'});
      const current=worker;
      worker.onerror=e=>{
        if(disposed||worker!==current)return;
        status('张量计算 Worker 失败：'+(e.message||'检查浏览器控制台'));
      };
      worker.onmessage=({data})=>{
        if(disposed||worker!==current||!enabled||!data||data.requestId!==requestId)return;
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
        lastSubmitted=performance.now();
        buildLines();buildRibbons();applyStyle();
        const newTarget=1; // Full computed field in every year, including dry 2026.
        const now=performance.now();
        if(!animation||settings.mode!=='presentation'){
          yearGrowth=newTarget;
          growthFrom=newTarget;
        }else{
          // Preserve current reveal during year changes; never restart at 0.
          growthFrom=yearGrowth;
        }
        growthTo=newTarget;
        growthChangeAt=now;
        lastRenderedYear=data.scenario.year;
        if(settings.mode==='presentation'){
          if(!animation)restart();
          else drawLines(yearGrowth);
        }else{
          drawLines(newTarget);
          dots()?.setData(empty());
        }
        status(data.scenario.year+' 年 · 综合张量 '+baseLines.length+
          ' 条（全年常显） · 积水改变局部方向 · 汇水线束 '+ribbons.length+
          ' 条 · DEM '+data.demNativeResolutionM+' m · 非实测水速');
      };
      return true;
    }catch(error){
      status('张量 Worker 未启动：'+error.message);
      return false;
    }
  }
  function queueSolve(immediate=false){
    requestId++; // Invalidate an in-flight result as soon as inputs change.
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    if(!enabled||!flow||!context||disposed)return;
    requestTimer=setTimeout(()=>{
      requestTimer=0;if(!enabled||!flow||!context||disposed||!workerStart())return;
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
      worker.postMessage(request);
    },immediate?0:Math.max(100,310-(performance.now()-lastSubmitted)));
  }
  function validAt(x,y,branch='primary',family='wet'){
    if(!result)return false;
    const {cols,rows,fields:f}=result,ix=Math.floor(x),iy=Math.floor(y);
    if(ix<0||iy<0||ix>=cols||iy>=rows)return false;
    const i=iy*cols+ix;
    if(!f.validMask[i])return false;
    return f.confidence[i]>=.075&&f.anisotropy[i]>.02&&
      Math.hypot(f.primaryX[i],f.primaryY[i])>.5;
  }
  function sample(x,y,branch,previous,family='wet'){
    if(!validAt(x,y,branch,family))return null;
    const {cols,rows,fields:f}=result;
    const cx=x-.5,cy=y-.5,x0=Math.floor(cx),y0=Math.floor(cy);
    const tx=cx-x0,ty=cy-y0;
    let sumX=0,sumY=0,count=0,strength=0,acc=0,suit=0,water=0,reference=previous;
    for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
      const u=x0+ox,v=y0+oy;
      if(u<0||v<0||u>=cols||v>=rows)continue;
      const k=v*cols+u;
      const supported=f.confidence[k]>=.075&&f.anisotropy[k]>.02&&
        Math.hypot(f.primaryX[k],f.primaryY[k])>.5;
      if(!f.validMask[k]||!supported)continue;
      const weight=(ox?tx:1-tx)*(oy?ty:1-ty);
      if(!(weight>0))continue;
      let ax=f.primaryX[k],ay=f.primaryY[k];
      if(branch==='secondary'){const a=ax;ax=-ay;ay=a}
      if(!reference)reference={x:ax,y:ay};
      if(ax*reference.x+ay*reference.y<0){ax=-ax;ay=-ay}
      const intensity=f.hydroIntensity[k];
      sumX+=ax*weight;sumY+=ay*weight;count+=weight;
      strength+=intensity*weight;acc+=f.drainageRank[k]*weight;
      suit+=f.confidence[k]*weight;water+=f.rainfallInfluence[k]*weight;
    }
    const mag=Math.hypot(sumX,sumY);
    if(mag<.10||count<.16)return null;
    return {x:sumX/mag,y:sumY/mag,
      strength:clamp(strength/count,0,1),
      catchment:clamp(acc/count,0,1),suitable:clamp(suit/count,0,1),water:water/count};
  }
  function integrate(sx,sy,branch,sign,max,family='wet'){
    let x=sx,y=sy,previous=null;
    const points=[],step=.55-.18*(settings.curvatureSmoothing/100);
    for(let i=0;i<max;i++){
      const a=sample(x,y,branch,previous,family);
      if(!a)break;
      const ax=a.x*sign,ay=a.y*sign;
      const mid=sample(x+ax*step*.5,y+ay*step*.5,branch,a,family);
      if(!mid)break;
      const nx=x+mid.x*sign*step,ny=y+mid.y*sign*step;
      if(!validAt(nx,ny,branch,family)||
         !validAt((x+nx)*.5,(y+ny)*.5,branch,family))break;
      if(Math.floor(x)!==Math.floor(nx)&&Math.floor(y)!==Math.floor(ny)&&
         (!validAt(nx,y,branch,family)||!validAt(x,ny,branch,family)))break;
      points.push({x,y,rank:a.strength,catchment:a.catchment,
        suit:a.suitable,water:a.water});
      previous=a;x=nx;y=ny;
    }
    return points;
  }
  let renderGeo=null;
  function toGeo(p){
    if(!renderGeo)return [0,0];
    return fromMerc(renderGeo.nw[0]+p.x*renderGeo.dx,
      renderGeo.nw[1]-p.y*renderGeo.dy);
  }
  const color=value=>{
    const t=clamp(value,0,1);
    const stops=[[.0,[59,207,239]],[.45,[39,133,243]],[.75,[61,92,234]],[1,[128,97,242]]];
    let a=stops[0],b=stops.at(-1);
    for(let i=1;i<stops.length;i++){if(t<=stops[i][0]){a=stops[i-1];b=stops[i];break}}
    const q=(t-a[0])/Math.max(.00001,b[0]-a[0]);
    return '#'+a[1].map((v,i)=>Math.round(v+(b[1][i]-v)*q).toString(16).padStart(2,'0')).join('');
  };
  function buildLines(){
    if(!result)return;
    renderGeo=gridRenderGeometry(result.grid);
    const {cols,rows,fields:f}=result;
    const branches=settings.direction==='dual'?
      ['primary','secondary']:[settings.direction];
    const cap=Math.min(460,Math.round(100+settings.density*3.2));
    const baseCap=cap;
    baseLines=[];wetLines=[];
    for(const family of ['base']){
      const total=baseCap;
      const perBranch=Math.ceil(total/branches.length);
      for(const branch of branches){
        const occupied=new Uint8Array(cols*rows),seeds=[];
        // Stratified seeding covers the site instead of sorting all points
        // toward the brightest/flooded cells. All candidates remain rooted
        // in actual topographic or modeled wet-direction evidence.
        const stride=clamp(Math.round(Math.sqrt(cols*rows/
          Math.max(35,perBranch*3.3))),2,14);
        for(let y=1;y<rows-1;y+=stride)for(let x=1;x<cols-1;x+=stride){
          let best=-1,bestScore=.02;
          for(let oy=0;oy<stride&&y+oy<rows-1;oy++)for(let ox=0;ox<stride&&x+ox<cols-1;ox++){
            const id=(y+oy)*cols+x+ox;
            if(!f.validMask[id])continue;
            const score=f.confidence[id]*(.48+.52*f.hydroIntensity[id]);
            if(score>bestScore&&f.confidence[id]>=.075&&f.anisotropy[id]>.02){
              best=id;bestScore=score;
            }
          }
          if(best>=0)seeds.push({id:best,score:bestScore,
            x:best%cols+.5,y:Math.floor(best/cols)+.5});
        }
        // Uniformly spaced candidate traversal; no wetness-ranked prefix
        // that would erase low-lying background regions from the screen.
        const sampleCount=Math.min(seeds.length,perBranch*3);
        const output=[];
        for(let k=0;k<sampleCount&&output.length<perBranch;k++){
          const candidate=seeds[Math.min(seeds.length-1,
            Math.floor((k+.5)*seeds.length/sampleCount))];
          if(occupied[candidate.id]||
             !validAt(candidate.x,candidate.y,branch,family))continue;
          const budget=Math.round((26+settings.length*.95)*
            (.70+.50*candidate.score));
          const backwards=integrate(candidate.x,candidate.y,branch,-1,
            Math.round(budget*.48),family);
          const forwards=integrate(candidate.x,candidate.y,branch,1,
            Math.round(budget*.52),family);
          const points=backwards.reverse().slice(0,-1).concat(forwards);
          if(points.length<7)continue;
          let overlap=0,checked=0;
          for(let i=0;i<points.length;i+=4){
            const p=points[i],key=Math.floor(p.y)*cols+Math.floor(p.x);
            if(occupied[key])overlap++;
            checked++;
          }
          if(overlap>Math.max(3,checked*.48))continue;
          let rank=0,catchment=0;
          for(const p of points){rank+=p.rank;catchment+=p.catchment}
          rank=clamp(.80*rank/points.length+
            .20*Math.sqrt(catchment/points.length),0,1);
          const item={family,branch,index:output.length,
            wetSupport:points.reduce((sum,p)=>sum+p.water,0)/points.length,
            coordinates:points.map(toGeo),rank,
            color:family==='base'?
              (branch==='primary'?'#5fa5c9':'#8993c5'):
              (branch==='primary'?color(rank):'#a396f5')};
          output.push(item);
          for(let i=0;i<points.length;i+=3){
            const p=points[i],key=Math.floor(p.y)*cols+Math.floor(p.x);
            if(key>=0&&key<occupied.length)occupied[key]=1;
          }
        }
        if(family==='base')baseLines.push(...output);
        else wetLines.push(...output);
      }
    }
    // Existing particles may follow the wet subset of this SAME eigenfield;
    // there is no second static direction layer overlaid on the computed one.
    lines=baseLines;
    wetLines=baseLines.filter(line=>line.wetSupport>.035).map((line,index)=>({...line,index}));
    features=lines.map(line=>{
      const background=line.family==='base';
      return {type:'Feature',
        properties:{
          color:line.color,
          analysisColor:background?
            (line.branch==='primary'?'#6b98ad':'#767f9b'):
            (line.branch==='primary'?'#9dd9f2':'#bbb0f1'),
          width:background?
            Math.max(.68,settings.width*(line.branch==='primary'?.72:.53)):
            settings.width*(line.branch==='primary'?1.15:.90)*
              (.74+.80*line.rank),
          opacity:background?
            (line.branch==='primary'?.77:.50):
            (line.branch==='primary'?.95:.65)*(.55+.45*line.rank),
          glowFactor:background?0:1,
          family:line.family,branch:line.branch,
          relativeGuidance:line.rank
        },
        geometry:{type:'LineString',coordinates:line.coordinates}
      };
    });
  }

  // Compute visualization-only hydrological ribbons from upstream
  // contributing-area corridors. Do NOT export ribbons as road geometry.
  function hydroAt(x,y,previous,distanceLimit){
    if(!result)return null;
    const {cols,rows,fields:f}=result;
    const ix=Math.floor(x),iy=Math.floor(y);
    if(ix<0||iy<0||ix>=cols||iy>=rows)return null;
    let id=iy*cols+ix;
    if(!f.validMask[id]||f.corridorDistance[id]<0||
      f.corridorDistance[id]>distanceLimit)return null;
    // Bilinear interpolation in the original solver grid (display only).
    const ox=x-.5,oy=y-.5,x0=Math.floor(ox),y0=Math.floor(oy);
    const tx=ox-x0,ty=oy-y0;
    let ax=0,ay=0,rank=0,sum=0,reference=previous;
    for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
      const xx=x0+dx,yy=y0+dy;
      if(xx<0||yy<0||xx>=cols||yy>=rows)continue;
      id=yy*cols+xx;
      if(!f.validMask[id]||f.corridorDistance[id]<0||
        f.corridorDistance[id]>distanceLimit)continue;
      const weight=(dx?tx:1-tx)*(dy?ty:1-ty);
      if(weight<=0)continue;
      let vx=f.corridorAxisX[id],vy=f.corridorAxisY[id];
      if(!reference&&Math.hypot(vx,vy)>.5)reference={x:vx,y:vy};
      if(reference&&vx*reference.x+vy*reference.y<0){vx=-vx;vy=-vy}
      ax+=vx*weight;ay+=vy*weight;
      rank+=f.corridorRank[id]*weight;sum+=weight;
    }
    const mag=Math.hypot(ax,ay);
    return sum>.14&&mag>.12?{x:ax/mag,y:ay/mag,rank:rank/sum}:null;
  }
  function hydroTrace(x,y,sign,steps,maxDistance){
    let last=null;const path=[];
    for(let k=0;k<steps;k++){
      const a=hydroAt(x,y,last,maxDistance);if(!a)break;
      const step=.44;
      const mid=hydroAt(x+sign*a.x*step*.5,
        y+sign*a.y*step*.5,a,maxDistance);
      if(!mid)break;
      const nx=x+mid.x*sign*step,ny=y+mid.y*sign*step;
      if(!hydroAt(nx,ny,a,maxDistance)||
        !hydroAt((x+nx)*.5,(y+ny)*.5,a,maxDistance))break;
      if(Math.floor(x)!==Math.floor(nx)&&Math.floor(y)!==Math.floor(ny)&&
        (!hydroAt(nx,y,a,maxDistance)||
         !hydroAt(x,ny,a,maxDistance)))break;
      path.push({x,y,rank:a.rank});x=nx;y=ny;last=a;
    }
    return path;
  }
  function buildRibbons(){
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    if(!result?.fields?.trunkMask||!renderGeo)return;
    const {cols,rows,fields:f}=result;
    const seeds=[];
    for(let y=1;y<rows-1;y+=2)for(let x=1;x<cols-1;x+=2){
      let picked=-1,strength=0;
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){
        const id=(y+j)*cols+x+i;
        if(f.trunkMask[id]!==1)continue;
        if(f.corridorRank[id]>strength){strength=f.corridorRank[id];picked=id}
      }
      if(picked>=0)seeds.push({id:picked,score:strength,
        x:picked%cols+.5,y:Math.floor(picked/cols)+.5});
    }
    seeds.sort((a,b)=>b.score-a.score||a.id-b.id);
    const cellSize=Math.min(result.cellX,result.cellY);
    const maxDistance=cellSize*(1+settings.ribbonWidth/100*4);
    const occupied=new Uint8Array(cols*rows);
    for(const seed of seeds){
      if(hydroCorePaths.length>=14)break;
      if(occupied[seed.id])continue;
      const budget=Math.round(110+settings.length*1.7);
      const backward=hydroTrace(seed.x,seed.y,-1,
        Math.floor(budget*.45),maxDistance);
      const forward=hydroTrace(seed.x,seed.y,1,
        Math.floor(budget*.55),maxDistance);
      const path=backward.reverse().slice(0,-1).concat(forward);
      if(path.length<14)continue;
      let overlap=0;
      for(let i=0;i<path.length;i+=6){
        const p=path[i],id=Math.floor(p.y)*cols+Math.floor(p.x);
        if(occupied[id])overlap++;
      }
      if(overlap>Math.max(3,path.length/18))continue;
      hydroCorePaths.push({path,rank:seed.score});
      for(let i=0;i<path.length;i+=2){
        const p=path[i],id=Math.floor(p.y)*cols+Math.floor(p.x);
        if(id>=0&&id<occupied.length)occupied[id]=1;
      }
    }
    const strands=Math.min(19,5+Math.round(settings.ribbonConcentration*.14));
    const widthCells=.3+settings.ribbonWidth/100*2.8;
    for(const core of hydroCorePaths){
      for(let k=0;k<strands;k++){
        const offset=(k-(strands-1)/2)/Math.max(1,(strands-1)/2)*widthCells;
        const chunks=[];let points=[];
        const flush=()=>{if(points.length>=7)chunks.push(points);points=[]};
        for(let j=1;j<core.path.length-1;j++){
          const p=core.path[j],a=core.path[j-1],b=core.path[j+1];
          const dx=b.x-a.x,dy=b.y-a.y,mag=Math.hypot(dx,dy);
          if(mag<.001){flush();continue}
          const x=p.x-dy/mag*offset,y=p.y+dx/mag*offset;
          const ix=Math.floor(x),iy=Math.floor(y);
          if(ix<0||iy<0||ix>=cols||iy>=rows){flush();continue}
          const id=iy*cols+ix;
          if(!f.validMask[id]||f.corridorDistance[id]<0||
            f.corridorDistance[id]>maxDistance+cellSize){flush();continue}
          points.push(toGeo({x,y}));
        }
        flush();
        for(const coords of chunks){
          const balance=1-Math.abs(offset)/(widthCells+.001);
          // Frame-dependent catchment intensity changes ribbon brightness
          // as modeled flood conditions evolve (not added water volume).
          const coreIndex=Math.max(0,Math.min(cols*rows-1,
            Math.floor(core.path[Math.floor(core.path.length/2)].y)*cols+
            Math.floor(core.path[Math.floor(core.path.length/2)].x)));
          const wetness=f.rainfallInfluence[coreIndex]||0;
          const rank=clamp(.54*core.rank+.24*balance+.22*wetness,0,1);
          ribbons.push({index:ribbons.length,coordinates:coords,
            rank,color:color(rank),
            width:settings.width*(.28+.50*balance),
            opacity:(.16+.67*balance)*(.30+.70*(f.rainfallInfluence[coreIndex]||0)),
            isHydrologicalReference:true});
          if(ribbons.length>=280)break;
        }
        if(ribbons.length>=280)break;
      }
      if(ribbons.length>=280)break;
    }
    ribbonFeatures=ribbons.map(line=>({
      type:'Feature',properties:{
        color:line.color,analysisColor:'#518bab',
        width:line.width,opacity:line.opacity,
        relativeGuidance:line.rank,hydrologyReference:true},
      geometry:{type:'LineString',coordinates:line.coordinates}
    }));
  }
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
        ['*',settings.opacity*(present?.9:.73),['get','opacity']]);
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
        ['*',present?settings.glow*settings.opacity*.43:.05,
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
    const f=clamp(fraction,0,1);
    // Year-based spatial growth: show more seeded tensor trajectories AND
    // longer portions of each path as the accepted scenario year advances.
    // Geometry itself is still derived from the current year DEM + water.
    // The DEM base persists at full length at EVERY year. Only the
    // modeled-wetness layer grows, in density and integrated path length.
    const reveal=items=>{
      if(f>=1)return items;
      const count=Math.ceil(items.length*f);
      return items.slice(0,count).map(feature=>{
        const coords=feature.geometry.coordinates;
        const length=Math.max(2,Math.floor(1+(coords.length-1)*f));
        return {...feature,geometry:{type:'LineString',
          coordinates:coords.slice(0,length)}};
      }).filter(feature=>feature.geometry.coordinates.length>=2);
    };
    const background=features.filter(feature=>feature.properties.family==='base');
    const modeled=features.filter(feature=>feature.properties.family==='wet');
    src()?.setData({type:'FeatureCollection',
      features:settings.showFilaments?
        background.concat(reveal(modeled)):[]});
    ribbonSource()?.setData({type:'FeatureCollection',
      features:settings.showRibbon?reveal(ribbonFeatures):[]});
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
    if(!enabled||settings.mode!=='presentation'){stop();return}
    animation=requestAnimationFrame(tick);
    if(time-lastAnimationDraw<65)return;
    lastAnimationDraw=time;
    const elapsed=Math.max(0,(time-animationOrigin)/1000);
    const transition=clamp((time-growthChangeAt)/
      Math.max(110,420/settings.growth),0,1);
    const eased=transition*transition*(3-2*transition);
    yearGrowth=growthFrom+(growthTo-growthFrom)*eased;
    if(Math.abs(yearGrowth-renderedFraction)>.009||transition>=1&&renderedFraction!==yearGrowth){
      drawLines(yearGrowth);renderedFraction=yearGrowth;
    }
    drawParticles(elapsed,yearGrowth);
  }
  function restart(){
    stop();animationOrigin=performance.now();
    lastAnimationDraw=0;renderedFraction=-1;applyStyle();
    if(!enabled)return;
    if(settings.mode==='presentation'){
      yearGrowth=growthTo;growthFrom=yearGrowth;
      growthChangeAt=performance.now();
      drawLines(yearGrowth);
      renderedFraction=yearGrowth;
      animation=requestAnimationFrame(tick);
    }else{
      yearGrowth=growthTo;drawLines(yearGrowth);
      renderedFraction=yearGrowth;dots()?.setData(empty());
    }
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
    const geometryChanged=['density','length','direction','width',
      'ribbonConcentration','ribbonWidth','trunkEmphasis','curvatureSmoothing',
      'showRibbon','showFilaments'].some(k=>settings[k]!==next[k]);
    const modeChanged=next.mode!==settings.mode;
    settings=next;
    if(solverChanged)queueSolve();
    else if(geometryChanged&&result){buildLines();buildRibbons();restart()}
    else if(modeChanged)restart();
    else applyStyle();
  }
  function setField(data,spatialContext,meta={}){
    if(disposed||!data)return;
    const n=data.cols*data.rows;
    if(n<=0||n>70000)return;
    const grid=meta.grid||spatialContext?.grid;
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
    if(result){buildLines();buildRibbons();restart()}
    if(flow&&context)queueSolve(true);
    applyStyle();
  }
  function clear(){
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    requestId++;result=null;flow=null;context=null;depth=null;
    lines=[];baseLines=[];wetLines=[];features=[];
    ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    lastRenderedYear=2026;yearGrowth=.20;growthFrom=.20;growthTo=.20;
    stop();src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());
    status('等待 DEM / 汇水 / 雨水计算数据');
  }
  function exportStructuredData(){
    if(!result)return null;
    const f=result.fields,c=result.context;
    const out={
      source:'OS Terrain 50 DEM, DEM-derived contributing area, modeled 2026–2100 depth/hydraulic-head direction and building barriers',
      tensorSemantics:'hydrological orientation axes (principal/orthogonal), NOT future road lines or true m/s velocity',
      scenarioYear:lastRenderedYear,
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
    out.nextStages=['Wool Algorithm','Road Network','Urban Parcel Subdivision'];
    return out;
  }
  function dispose(){
    disposed=true;stop();
    if(requestTimer)clearTimeout(requestTimer);
    worker?.terminate();worker=null;
    src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());
  }
  return {configure,setField,setEnabled,clear,dispose,exportStructuredData,
    exportDiagnostics:(stride=4)=>tensorDiagnosticGeoJSON(result,stride),
    getConfig:()=>({...settings})};
}
