/* v3.22.39-hydro-tensor · Tensor-field drawing on native solver cells.
   Separate worker computes the design tensor. Rendering interpolates its
   eigenvectors only for display; never invents finer DEM observations.
   Animation particle speeds denote only visual travel along LINE fields. */
export function createHydroTensorRenderer(args){
  const {map,sourceId,particleSourceId,glowLayerId,lineLayerId,particleLayerId,getBounds,onStatus}=args;
  const empty=()=>({type:'FeatureCollection',features:[]});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const presets={
    terrainWeight:35,drainageWeight:45,avoidance:70,
    smoothness:60,crossStrength:60,
    density:55,length:65,width:1.4,opacity:.85,glow:.5,
    speed:1,growth:1,mode:'analysis',direction:'dual'
  };
  let settings={...presets},enabled=false,disposed=false;
  let context=null,flow=null,scenario={year:2026,kind:'design-envelope'};
  let depth=null,result=null,worker=null;
  let workerGeneration=0,requestId=0,requestTimer=0,lastSubmitted=0;
  let pendingFrame=null,lines=[],features=[],animation=0,animationOrigin=0;
  let lastAnimationDraw=0,renderedFraction=0,reported='';
  const R=6378137;
  const toMerc=([lng,lat])=>[R*lng*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/180/2))];
  const fromMerc=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const src=()=>map.getSource(sourceId),dots=()=>map.getSource(particleSourceId);
  const status=t=>{if(t!==reported){reported=t;onStatus?.(t)}};
  const isNumericArray=(v,n)=>v?.length===n;
  function workerStart(){
    if(worker)return true;
    try{
      worker=new Worker(new URL('./hydro_tensor_worker.js?v=3.22.39-hydro-tensor-dem50',import.meta.url),{type:'module'});
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
          const Type=key==='validMask'?Uint8Array:Float32Array;
          fields[key]=new Type(buffer);
          if(fields[key].length!==n)return;
        }
        result={...data,fields};
        lastSubmitted=performance.now();
        buildLines();drawLines(1);applyStyle();
        if(settings.mode==='presentation')restart();
        status('Tensor '+scenario.year+' · '+lines.length+
          ' 条道路方向引导线 · DEM '+data.demNativeResolutionM+
          ' m / 计算网格 '+data.cellX.toFixed(1)+' m · 非水速');
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
      const axisStrength=f.confidence[k];
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
    const step=.55;
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
    const stride=clamp(Math.round(16-settings.density*.13),3,15);
    const totalMax=Math.min(300,Math.round(35+settings.density*2.1));
    const newLines=[];
    for(const branch of branches){
      const seeds=[];
      for(let y=1;y<rows-1;y+=stride)for(let x=1;x<cols-1;x+=stride){
        let choice=-1,best=-1;
        for(let oy=0;oy<Math.max(1,stride*.5);oy+=1)for(let ox=0;ox<Math.max(1,stride*.5);ox+=1){
          const cx=Math.min(cols-2,x+ox),cy=Math.min(rows-2,y+oy),k=cy*cols+cx;
          const score=f.suitability[k]*(branch==='secondary'?f.crossSuitability[k]:1)*
            (.35+.65*f.confidence[k])*
            (.80+.20*Math.sqrt(f.drainageRank[k]));
          if(score>best&&score>.06){best=score;choice=k}
        }
        if(choice>=0)seeds.push({x:choice%cols+.5,y:Math.floor(choice/cols)+.5,score:best,id:choice});
      }
      seeds.sort((a,b)=>b.score-a.score||a.id-b.id);
      const occupied=new Uint8Array(cols*rows);
      for(const seed of seeds){
        if(newLines.length>=totalMax)break;
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
        rank=clamp(.55*rank/points.length+.45*Math.sqrt(acc/points.length),0,1);
        newLines.push({branch,coordinates,distances,total,rank,
          color:branch==='secondary'?'#91a9de':color(rank),index:newLines.length});
        for(let j=0;j<points.length;j+=2){
          const p=points[j],idx=Math.floor(p.y)*cols+Math.floor(p.x);
          if(idx>=0&&idx<occupied.length)occupied[idx]=1;
        }
      }
    }
    lines=newLines;
    const fc=[];
    for(const line of lines){
      for(let j=0;j<line.coordinates.length-1;j+=5){
        const section=line.coordinates.slice(j,Math.min(line.coordinates.length,j+6));
        fc.push({type:'Feature',properties:{
          color:line.color,analysisColor:line.branch==='primary'?'#b1beca':'#75849d',
          width:settings.width*(line.branch==='primary'?1.1:.8)*(.7+1.1*line.rank),
          opacity:line.branch==='primary'?1:.68,
          branch:line.branch,relativeGuidance:line.rank
        },geometry:{type:'LineString',coordinates:section}});
      }
    }
    features=fc;
  }
  function applyStyle(){
    const present=settings.mode==='presentation';
    if(map.getLayer(lineLayerId)){
      map.setPaintProperty(lineLayerId,'line-color',present?['get','color']:['get','analysisColor']);
      map.setPaintProperty(lineLayerId,'line-width',['get','width']);
      map.setPaintProperty(lineLayerId,'line-opacity',['*',settings.opacity*(present?1:.83),['get','opacity']]);
    }
    if(map.getLayer(glowLayerId)){
      map.setPaintProperty(glowLayerId,'line-color',['get','color']);
      map.setPaintProperty(glowLayerId,'line-width',['*',['get','width'],1.5+settings.glow*4]);
      map.setPaintProperty(glowLayerId,'line-opacity',['*',
        present?settings.glow*settings.opacity*.35:0,['get','opacity']]);
      map.setPaintProperty(glowLayerId,'line-blur',1+settings.glow*3);
    }
    if(map.getLayer(particleLayerId)){
      map.setLayoutProperty(particleLayerId,'visibility',
        enabled&&present?'visible':'none');
      map.setPaintProperty(particleLayerId,'circle-opacity',settings.opacity*.82);
    }
  }
  function drawLines(frac){
    if(!src())return;
    const n=Math.floor(features.length*clamp(frac,0,1));
    src().setData({type:'FeatureCollection',features:n===features.length?features:features.slice(0,n)});
  }
  function drawParticles(elapsed,frac){
    if(!dots())return;
    if(!enabled||settings.mode!=='presentation'){dots().setData(empty());return}
    const count=Math.min(125,Math.round(24+settings.density*.9));
    const particles=[];
    for(let i=0;i<count&&lines.length;i++){
      const line=lines[(i*37)%lines.length];
      if(line.index>=lines.length*frac||line.total<.01)continue;
      const speed=(.065+.08*line.rank)*settings.speed;
      const t=((elapsed*speed+i*.61803398875)%1)*line.total;
      let l=0,r=line.distances.length-1;
      while(l+1<r){const m=(l+r)>>1;if(line.distances[m]<t)l=m;else r=m}
      const u=(t-line.distances[l])/Math.max(.00001,line.distances[r]-line.distances[l]);
      const a=line.coordinates[l],b=line.coordinates[r];
      particles.push({type:'Feature',properties:{color:line.color,radius:.85+line.rank*1.25},
        geometry:{type:'Point',coordinates:[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]}});
    }
    dots().setData({type:'FeatureCollection',features:particles});
  }
  function stop(){if(animation)cancelAnimationFrame(animation);animation=0}
  function tick(time){
    if(!enabled||settings.mode!=='presentation'){stop();return}
    animation=requestAnimationFrame(tick);
    if(time-lastAnimationDraw<50)return;
    lastAnimationDraw=time;
    const elapsed=Math.max(0,(time-animationOrigin)/1000);
    const fraction=clamp(elapsed*settings.growth/2.8,0,1);
    if(fraction<1||renderedFraction<1){drawLines(fraction);renderedFraction=fraction}
    drawParticles(elapsed,fraction);
  }
  function restart(){
    stop();renderedFraction=0;animationOrigin=performance.now();
    lastAnimationDraw=0;applyStyle();
    if(!enabled)return;
    if(settings.mode==='presentation')animation=requestAnimationFrame(tick);
    else{drawLines(1);dots()?.setData(empty())}
  }
  function configure(patch){
    if(disposed)return;
    const next={...settings,...patch};
    for(const key of ['terrainWeight','drainageWeight','avoidance','smoothness',
      'crossStrength','density','length'])next[key]=clamp(Number(next[key]),0,100);
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
    const geometryChanged=['density','length','direction','width'].some(k=>settings[k]!==next[k]);
    const modeChanged=next.mode!==settings.mode;
    settings=next;
    if(solverChanged)queueSolve();
    else if(geometryChanged&&result){buildLines();restart()}
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
    enabled=Boolean(on)&&!disposed;
    const state=enabled?'visible':'none';
    for(const id of [lineLayerId,glowLayerId]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',state);
    }
    if(!enabled){
      stop();src()?.setData(empty());dots()?.setData(empty());
      return;
    }
    if(result){buildLines();restart()}
    else if(flow&&context)queueSolve(true);
    applyStyle();
  }
  function clear(){
    if(requestTimer){clearTimeout(requestTimer);requestTimer=0}
    requestId++;result=null;flow=null;context=null;depth=null;lines=[];features=[];
    stop();src()?.setData(empty());dots()?.setData(empty());
    status('等待 DEM / 汇水 / 雨水计算数据');
  }
  function exportStructuredData(){
    if(!result)return null;
    const f=result.fields,c=context;
    const out={
      source:'OS Terrain 50 DEM + derived drainage + modeled flood constraint',
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
    out.nextStages=['Wool Algorithm','Road Network','Urban Parcel Subdivision'];
    return out;
  }
  function dispose(){
    disposed=true;stop();
    if(requestTimer)clearTimeout(requestTimer);
    worker?.terminate();worker=null;
    src()?.setData(empty());dots()?.setData(empty());
  }
  return {configure,setField,setEnabled,clear,dispose,exportStructuredData,
    getConfig:()=>({...settings})};
}
