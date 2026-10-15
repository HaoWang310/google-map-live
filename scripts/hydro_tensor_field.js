/* v3.22.45-hydro-tensor-dynamic · Hydrological 2x2 tensor field, not a road proposal.
   The original DEM and flood solver remain unchanged. Visualization is
   gradually revealed over the 2026–2100 design-scenario timeline;
   particles illustrate eigenfield axes and do not represent measured speed. */
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
  let depth=null,result=null,worker=null;
  let workerGeneration=0,requestId=0,requestTimer=0,lastSubmitted=0;
  let pendingFrame=null,lines=[],features=[],animation=0,animationOrigin=0;
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
      worker=new Worker(new URL('./hydro_tensor_worker.js?v=3.22.45-hydro-tensor-dynamic',import.meta.url),{type:'module'});
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
          const Type=key==='validMask'||key==='trunkMask'?Uint8Array:Float32Array;
          fields[key]=new Type(buffer);
          if(fields[key].length!==n)return;
        }
        result={...data,fields};
        lastSubmitted=performance.now();
        buildLines();buildRibbons();applyStyle();
        const newTarget=clamp(.20+.80*(scenario.year-2026)/74,.20,1);
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
        lastRenderedYear=scenario.year;
        if(settings.mode==='presentation'){
          if(!animation)restart();
          else drawLines(yearGrowth);
        }else{
          drawLines(newTarget);
          dots()?.setData(empty());
        }
        status(scenario.year+' 年 · 水文张量场 '+lines.length+
          ' 条主次方向线 / '+ribbons.length+' 条汇水线束 · DEM '+
          data.demNativeResolutionM+' m · 相对强度（非水速）');
      };
      return true;
    }catch(error){
      status('张量 Worker 未启动：'+error.message);
      return false;
    }
  }
  function queueSolve(immediate=false){
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    if(!enabled||!flow||!context||disposed)return;
    requestTimer=setTimeout(()=>{
      requestTimer=0;if(!enabled||!flow||!context||disposed||!workerStart())return;
      const n=flow.cols*flow.rows;
      if(!n||n>70000)return;
      const ll=getBounds();
      if(!ll){status('尚未获得场地真实地理范围');return}
      const nw=toMerc(ll[0]),ne=toMerc(ll[1]),sw=toMerc(ll[3]);
      const request={
        type:'solve',requestId:++requestId,cols:flow.cols,rows:flow.rows,
        cellX:Math.abs((ne[0]-nw[0])/flow.cols),
        cellY:Math.abs((nw[1]-sw[1])/flow.rows),
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
  function validAt(x,y,branch='primary'){
    if(!result)return false;
    const {cols,rows,fields:f}=result,ix=Math.floor(x),iy=Math.floor(y);
    if(ix<0||iy<0||ix>=cols||iy>=rows)return false;
    const i=iy*cols+ix;
    return f.validMask[i]&&f.suitability[i]>=.27&&f.confidence[i]>=.08&&
      (branch!=='secondary'||f.crossSuitability[i]>=.10);
  }
  function sample(x,y,branch,previous){
    if(!validAt(x,y,branch))return null;
    const {cols,rows,fields:f}=result;
    const cx=x-.5,cy=y-.5,x0=Math.floor(cx),y0=Math.floor(cy);
    const tx=cx-x0,ty=cy-y0;
    let sumX=0,sumY=0,count=0,strength=0,acc=0,suit=0;
    for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
      const u=x0+ox,v=y0+oy;
      if(u<0||v<0||u>=cols||v>=rows)continue;
      const k=v*cols+u;
      if(!f.validMask[k]||f.suitability[k]<.20||
        (branch==='secondary'&&f.crossSuitability[k]<.10))continue;
      const w=(ox?tx:1-tx)*(oy?ty:1-ty);
      if(!(w>0))continue;
      let dx=f.primaryX[k],dy=f.primaryY[k];
      if(branch==='secondary'){const a=dx;dx=-dy;dy=a}
      // A line FIELD has no inherent positive direction: select the locally
      // continuous eigenvector sign relative to the last integration step.
      if(previous&&dx*previous.x+dy*previous.y<0){dx=-dx;dy=-dy}
      const axisStrength=f.hydroIntensity[k];
      sumX+=dx*w;sumY+=dy*w;count+=w;
      strength+=axisStrength*w;acc+=f.drainageRank[k]*w;
      suit+=f.suitability[k]*w;
    }
    const magnitude=Math.hypot(sumX,sumY);
    if(magnitude<.09||count<.15)return null;
    return {x:sumX/magnitude,y:sumY/magnitude,
      strength:clamp(strength/count,0,1),
      catchment:clamp(acc/count,0,1),
      suitable:clamp(suit/count,0,1)};
  }
  function integrate(sx,sy,branch,sign,max){
    let x=sx,y=sy,previous=null;
    const points=[];
    const step=.55-.18*(settings.curvatureSmoothing/100);
    for(let i=0;i<max;i++){
      const a=sample(x,y,branch,previous);
      if(!a)break;
      const ax=a.x*sign,ay=a.y*sign;
      const mid=sample(x+ax*step*.5,y+ay*step*.5,branch,a);
      if(!mid)break;
      const nx=x+mid.x*sign*step,ny=y+mid.y*sign*step;
      if(!validAt(nx,ny,branch)||!validAt((x+nx)/2,(y+ny)/2,branch))break;
      if(Math.floor(x)!==Math.floor(nx)&&Math.floor(y)!==Math.floor(ny)){
        if(!validAt(nx,y,branch)||!validAt(x,ny,branch))break;
      }
      points.push({x,y,rank:a.strength,catchment:a.catchment,suit:a.suitable});
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
    const bounds=getBounds();
    if(!bounds)return;
    const nw=toMerc(bounds[0]),ne=toMerc(bounds[1]),sw=toMerc(bounds[3]);
    renderGeo={nw,dx:(ne[0]-nw[0])/result.cols,
      dy:(nw[1]-sw[1])/result.rows};
    const {cols,rows,fields:f}=result,branches=settings.direction==='dual'?
      ['primary','secondary']:[settings.direction];
    const stride=clamp(Math.round(12-settings.density*.09),3,12);
    const totalMax=Math.min(520,Math.round(70+settings.density*4.1));
    // Guarantee both primary and secondary tensor eigen-directions retain
    // independent drawing budgets in Dual mode.
    const maxPerBranch=Math.ceil(totalMax/branches.length);
    const newLines=[];
    for(const branch of branches){
      let branchCount=0;
      const seeds=[];
      for(let y=1;y<rows-1;y+=stride)for(let x=1;x<cols-1;x+=stride){
        let choice=-1,best=-1;
        for(let oy=0;oy<Math.max(1,stride*.5);oy+=1)for(let ox=0;ox<Math.max(1,stride*.5);ox+=1){
          const cx=Math.min(cols-2,x+ox),cy=Math.min(rows-2,y+oy),k=cy*cols+cx;
          const score=f.suitability[k]*(branch==='secondary'?f.crossSuitability[k]:1)*
            (.28+.72*f.confidence[k])*
            (.50+.50*f.hydroIntensity[k]);
          if(score>best&&score>.06){best=score;choice=k}
        }
        if(choice>=0)seeds.push({x:choice%cols+.5,y:Math.floor(choice/cols)+.5,score:best,id:choice});
      }
      seeds.sort((a,b)=>b.score-a.score||a.id-b.id);
      const occupied=new Uint8Array(cols*rows);
      for(const seed of seeds){
        if(branchCount>=maxPerBranch)break;
        if(occupied[seed.id]||!validAt(seed.x,seed.y,branch))continue;
        const maxSteps=Math.round((16+settings.length*1.2)*(0.7+seed.score*.7));
        const backward=integrate(seed.x,seed.y,branch,-1,Math.round(maxSteps*.48));
        const forward=integrate(seed.x,seed.y,branch,1,Math.round(maxSteps*.52));
        const points=backward.reverse().slice(0,-1).concat(forward);
        if(points.length<8)continue;
        let overlaps=0;
        for(let i=0;i<points.length;i+=4){
          const p=points[i],key=Math.floor(p.y)*cols+Math.floor(p.x);
          if(occupied[key])overlaps++;
        }
        if(overlaps>Math.max(2,points.length/15))continue;
        const coordinates=points.map(toGeo),distances=[0];let total=0,rank=0,acc=0;
        for(let j=0;j<points.length;j++){
          rank+=points[j].rank;acc+=points[j].catchment;
          if(j>0)total+=Math.hypot(points[j].x-points[j-1].x,points[j].y-points[j-1].y);
          if(j>0)distances.push(total);
        }
        rank=clamp(.77*rank/points.length+
          .23*Math.sqrt(acc/points.length),0,1);
        newLines.push({branch,coordinates,distances,total,rank,
          color:branch==='secondary'?'#91a9de':color(rank),index:newLines.length});
        branchCount++;
        for(let j=0;j<points.length;j+=2){
          const p=points[j],idx=Math.floor(p.y)*cols+Math.floor(p.x);
          if(idx>=0&&idx<occupied.length)occupied[idx]=1;
        }
      }
    }
    lines=newLines;
    // One continuous LineString per tensor trajectory; no 5-point seams.
    features=lines.map(line=>({type:'Feature',properties:{
      color:line.color,analysisColor:line.branch==='primary'?'#a6b7c6':'#71869e',
      width:settings.width*(line.branch==='primary'?1:.72)*(.55+.95*line.rank),
      opacity:(line.branch==='primary'?.86:.44)*
        (.30+.70*line.rank),
      branch:line.branch,relativeGuidance:line.rank
    },geometry:{type:'LineString',coordinates:line.coordinates}}));
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
    let ax=0,ay=0,rank=0,sum=0;
    for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
      const xx=x0+dx,yy=y0+dy;
      if(xx<0||yy<0||xx>=cols||yy>=rows)continue;
      id=yy*cols+xx;
      if(!f.validMask[id]||f.corridorDistance[id]<0||
        f.corridorDistance[id]>distanceLimit)continue;
      const weight=(dx?tx:1-tx)*(dy?ty:1-ty);
      if(weight<=0)continue;
      let vx=f.corridorAxisX[id],vy=f.corridorAxisY[id];
      if(previous&&vx*previous.x+vy*previous.y<0){vx=-vx;vy=-vy}
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
          ['get','opacity']]);
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
    const reveal=items=>{
      if(f>=1)return items;
      const count=Math.max(1,Math.ceil(items.length*f));
      return items.slice(0,count).map(feature=>{
        const coords=feature.geometry.coordinates;
        const length=Math.max(2,Math.floor(1+(coords.length-1)*f));
        return {...feature,geometry:{type:'LineString',
          coordinates:coords.slice(0,length)}};
      }).filter(feature=>feature.geometry.coordinates.length>=2);
    };
    src()?.setData({type:'FeatureCollection',
      features:settings.showFilaments?reveal(features):[]});
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
      const available=main?ribbons:lines;
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
    const flowCandidate={
      cols:data.cols,rows:data.rows,
      vx:new Int8Array(data.vx),vy:new Int8Array(data.vy),
      intensity:new Uint8Array(data.intensity)
    };
    if([flowCandidate.vx,flowCandidate.vy,flowCandidate.intensity].some(a=>!isNumericArray(a,n)))return;
    flow=flowCandidate;
    if(spatialContext?.cols===data.cols&&spatialContext?.rows===data.rows){
      const next={
        terrain:new Float32Array(spatialContext.terrain),
        accumulation:new Uint16Array(spatialContext.accumulation),
        inside:new Uint8Array(spatialContext.inside),
        obstacle:new Uint8Array(spatialContext.obstacle)
      };
      if(Object.values(next).every(a=>a.length===n))context=next;
    }
    if(meta.depthMm){
      const d=new Uint16Array(meta.depthMm);
      depth=d.length===n?d:null;
    }else depth=null;
    scenario={year:Number(meta.year)||2026,kind:meta.kind||'design-envelope'};
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
    else if(flow&&context)queueSolve(true);
    applyStyle();
  }
  function clear(){
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    requestId++;result=null;flow=null;context=null;depth=null;
    lines=[];features=[];ribbons=[];ribbonFeatures=[];hydroCorePaths=[];
    lastRenderedYear=2026;yearGrowth=.20;growthFrom=.20;growthTo=.20;
    stop();src()?.setData(empty());ribbonSource()?.setData(empty());
    dots()?.setData(empty());
    status('等待 DEM / 汇水 / 雨水计算数据');
  }
  function exportStructuredData(){
    if(!result)return null;
    const f=result.fields,c=context;
    const out={
      source:'OS Terrain 50 DEM, DEM-derived contributing area, modeled 2026–2100 depth/hydraulic-head direction and building barriers',
      tensorSemantics:'hydrological orientation axes (principal/orthogonal), NOT future road lines or true m/s velocity',
      scenarioYear:lastRenderedYear,
      stage:{...scenario},crs:'EPSG:4326',localBasis:'native flood-solver grid',
      boundsLngLat:getBounds(),cols:result.cols,rows:result.rows,
      cellX:result.cellX,cellY:result.cellY,
      demNativeResolutionM:result.demNativeResolutionM,
      terrainGradientSupportM:result.terrainGradientSupportM,
      terrainSamplingNote:'Simulation cells finer than 50m do not imply independent higher-resolution DEM data',
      designNotMeasuredVelocity:true,
      parameters:{...settings}
    };
    for(const [name,array] of Object.entries(f))out[name]=new array.constructor(array);
    if(c)for(const [name,array] of Object.entries(c))out[name]=new array.constructor(array);
    if(depth)out.depthMm=new Uint16Array(depth);
    // Do not return road polylines as validated street designs.
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
    getConfig:()=>({...settings})};
}
