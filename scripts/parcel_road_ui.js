/* STEP 05 independent Parcel Generator presentation/controller.
   No STEP 01–04 changes or fabricated tensor data. */
const PARAMETERS=[
 ['woolStrength','羊毛拉力',88,0,100],
 ['tensorAlignment','张量贴合度',78,0,100],
 ['floodAvoidance','洪涝避让',58,0,100],
 ['roadDensity','路网密度',88,5,100],
 ['branchingStrength','分叉强度',78,0,100],
 ['bundleStrength','线束聚合强度',85,0,100],
 ['reconnectionStrength','重连强度',86,0,100],
 ['curvatureSmoothing','曲率平滑度',90,0,100],
 ['agriculturalContinuity','农业连续性',65,0,100]
];
const empty=()=>({type:'FeatureCollection',features:[]});
const statusText=(node,txt,bad=false)=>{if(node){
 node.textContent=txt;node.style.color=bad?'#ffb1a8':'#c2e4e8';}};
function saveFile(name,value,mime){
 const blob=new Blob([JSON.stringify(value,null,2)],{type:mime}),
  url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function geoJSON(output){
 return {type:'FeatureCollection',
  name:'London_2100_STEP05_Road_Network',
  metadata:{step:5,source:output.provenance,statistics:output.diagnostics,
   roadTopologyGraph:output.roadTopologyGraph,
   buildableMask:output.buildableMask,parameters:output.parameters,
   note:'Topology is a GeoJSON foreign member; STEP 06 should load full package for planar graph'},
  features:[
   ...output.siteBoundary.features,
   ...output.roadCenterlines.features.map(f=>({
    ...f,properties:{...f.properties,layer:'road_centerline'}})),
   ...output.roadPolygons.features.map(f=>({
    ...f,properties:{...f.properties,layer:'road_polygon'}})),
   ...output.reservedFloodEcologicalCorridors.features.map(f=>({
    ...f,properties:{...f.properties,layer:'reserved_flood_corridor'}})),
   ...output.accessPublicNodes.features.map(f=>({
    ...f,properties:{...f.properties,layer:'access_candidate'}})),
   ...output.candidateNodes.features.map(f=>({
    ...f,properties:{...f.properties,layer:'land_use_candidate'}}))
  ]};
}
export function createParcelRoadUI({
 root,getMap,getRing,onStatus,onDone=()=>{},onReset=()=>{},
 boundarySource='pg-boundary',outlineLayer='pg-outline',autoHandoff=true,
 showImport=true
}){
 const el=id=>root?.querySelector('#'+id);
 let worker=null,serial=0,ready=false,result=null,active=false,pending=false;
 let loadedSource=null,autoGenerateOnReady=false,regenerateTimer=null,rerunAfterDone=false;
 function inform(msg,bad=false){statusText(el('pg-road-status'),msg,bad);
   onStatus?.(msg,bad);}
 const html=()=>`
 <div class="pg-label">STEP 05 · Wool 融合路网 · 仅最终结果</div>
 <p class="pg-note">${autoHandoff?'接收当前 London Map 已计算的真实张量与水深。':'打开「结合 Wool 算法」后，自动读取 STEP 04 的2100年数据，生成 Wool 融合的最终路网。STEP 04 张量线、中间纤维和原有地图均不在本步显示。'}</p>
 <div class="pg-section"><div class="pg-label">设计显示模式 · 本轮优先视觉效果</div>
 <label class="pg-option" style="display:flex;align-items:center;gap:8px">
 <span>模式</span><select id="pg-road-visualMode" style="flex:1;min-width:0">
 <option value="presentation" selected>展示模式 · Wool 有机围合路网</option>
 <option value="analysis">分析模式 · 水文约束道路</option>
 </select></label>
 <div class="pg-note" id="pg-road-mode-note" style="color:#a6deef">
 根据当前地块张量与积水生成二维羊毛图案。展示模式整理形态；分析模式检查水文碰撞约束。</div></div>
 <div class="pg-section"><div class="pg-label">生成 / 优化 · 张量生长与 Wool 路网</div>
 <div class="pg-road-actions">
 <button id="pg-road-generate" disabled style="display:none" aria-hidden="true" tabindex="-1">隐藏的旧骨架生成控制</button>
 <button id="pg-road-wool" disabled>重新生成 Wool 最终路网</button>
 <button id="pg-road-reset">重置路网</button>
 </div>
 <div class="pg-road-progress"><div id="pg-road-progressbar"></div></div>
 <div class="pg-status" id="pg-road-status">等候当前选区真实2100年张量与水深结果。</div>
 <div class="pg-status" id="pg-road-quality" style="white-space:pre-line;font-size:10px">只显示 Wool 结合后的主干路、次干路与内部细密路网，不显示中间纤维。</div>
 </div>
 <div class="pg-note" id="pg-road-source">等待同一地块真实张量/水深数据。</div>
 ${showImport?`<label class="pg-option" style="display:block">备用：导入真实场地诊断 JSON
  <input type="file" accept=".json,application/json" id="pg-road-import" style="width:100%;font-size:11px;margin:6px 0">
 </label>`:''}
 <div class="pg-section"><div class="pg-label">羊毛 / 洪涝 / 城市控制 · 参数</div>
 ${PARAMETERS.map(([k,label,v,min,max])=>`
  <label class="pg-road-param"><span>${label} <output id="pg-road-val-${k}">${v}</output></span>
   <input type="range" id="pg-road-${k}" min="${min}" max="${max}" step="1" value="${v}"></label>`).join('')}
 <label class="pg-road-param"><span>普通道路水深阈值（米）</span>
  <input id="pg-road-floodLimitM" type="number" min=".03" max=".6" step=".01" value=".12" style="width:68px"></label></div>
 <div class="pg-section"><div class="pg-label">显示 / 道路层级</div>
 ${[['main','主道路'],['secondary','次道路'],
  ['local','局部支路'],['reserved','洪涝 / 生态保留带'],
  ['footprints','道路占地范围']].map(([k,label])=>
  `<label class="pg-option"><input type="checkbox" id="pg-road-show-${k}"
     ${['main','secondary','local'].includes(k)?'checked':''}> ${label}</label>`).join('')}
 </div>
 <div class="pg-section"><div class="pg-label">进入第六步 · 地块分割</div>
 <div class="pg-road-actions">
 <button id="pg-road-export" disabled>↓ 导出 GeoJSON</button>
 <button id="pg-road-package" disabled>↓ 导出完整拓扑 JSON</button></div>
 <p class="pg-note">STEP 05 输出真实计算得到的道路中心线、分级、路面条带、多边形场地边界、洪涝保留区和交叉节点图。STEP 06 的地块切分/功能配色尚未执行。</p></div>`;
 function ensureWorker(){
  if(worker)return;
  worker=new Worker(new URL('./parcel_road_worker.js?v=3.28.0-tensor-wool-linked',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data?.id!==serial)return;
   if(data.type==='progress'){
    el('pg-road-progressbar').style.width=Math.round(data.progress*100)+'%';
    inform(data.message);
   }else if(data.type==='ready'){
    ready=true;pending=false;
    el('pg-road-generate').disabled=false;
    el('pg-road-wool').disabled=true;
    inform('真实数据通过校验：'+data.diagnostics.cells+' 个张量格网；'+
      '有效格 '+data.diagnostics.validCells+'；计算年 2100。');
    el('pg-road-source').textContent='✓ 已自动读取当前场地的真实张量、水深与边界';
    if(autoGenerateOnReady)generate('optimise');
   }else if(data.type==='done'){
    pending=false;result=data.result;
    const q=el('pg-road-quality'),stat=result.diagnostics;
    if(q)q.textContent=(stat.visualMode==='presentation'?
      '【展示模式】同源平滑张量 → 真实 Wool 优化 → 最终道路（概念设计）\n':
      '【分析模式】张量积分 → Wool 生长 → A* 补连\nWool 新生次路 '+
        (stat.wool?.grownSecondary||0)+' 条 · 新生支路 '+
        (stat.wool?.grownLocal||0)+' 条 · A* 补连 '+
        (stat.astarRepairs||0)+' 条\n')+
      '张量平滑平均角差 '+(stat.presentationTensor?.meanAngleErrorDeg||0).toFixed(1)+'°'+
      '\n主路 '+stat.mainKm+' km · 次路 '+stat.secondaryKm+
      ' km · 支路 '+stat.localKm+' km' +
      '\n安全格网道路覆盖率 '+stat.rasterCorridorCoveragePct+'% · 独立连通块 '+
      stat.components+' · 闭环秩 '+stat.cycleRank+
      '\n候选街区 '+stat.candidateBlocks+' 个 · 面积中位数 '+
      stat.medianBlockAreaM2+' m²' +
      (stat.qualityFlags?.length?'\n需要复核：'+stat.qualityFlags.join('、'):'');
    for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
      el(id).disabled=false;
    el('pg-road-progressbar').style.width='100%';
    inform((result.diagnostics.visualMode==='presentation'?'Wool 最终有机路网已生成（展示概念）· ':'Wool 最终分析路网已生成 · ')+result.diagnostics.roadCount+' 条道路，'+
      result.diagnostics.lengthKm+' km，'+result.diagnostics.junctions+
      ' 个路口 · '+(data.result.mode==='optimise'?'Wool 优化':'初始道路骨架'));
    updateMap();
    onDone(result);
    if(rerunAfterDone){rerunAfterDone=false;generate('optimise');}
   }else if(data.type==='error'){
    pending=false;
    for(const id of ['pg-road-generate','pg-road-wool'])el(id).disabled=!ready;
    el('pg-road-source').textContent=ready?
      '⚠ 数据已通过校验，但路网几何计算失败；请查看错误与参数。':
      '⚠ 当前场地张量／洪涝数据校验失败，请检查 STEP 04。';
    rerunAfterDone=false;inform('STEP 05 失败：'+data.message,true);
   }else if(data.type==='cleared'){
    result=null;pending=false;updateMap();
   }
  };
  worker.onerror=e=>{pending=false;inform('STEP 05 道路 Worker 出错：'+e.message,true);};
 }
 const names={reserved:'pg-road-reserved',footprints:'pg-road-footprints',local:'pg-road-local',bundles:'pg-road-bundles',secondary:'pg-road-secondary',main:'pg-road-main'};
 function layers(){
  const map=getMap();if(!map||!map.isStyleLoaded()||!map.getSource(boundarySource))return false;
  if(!map.getLayer('pg-road-backdrop'))map.addLayer({
   id:'pg-road-backdrop',type:'fill',source:boundarySource,
   layout:{visibility:'none'},paint:{'fill-color':'#08090a','fill-opacity':1}},outlineLayer);
  for(const [kind,id] of Object.entries(names)){
   if(!map.getSource(id))map.addSource(id,{type:'geojson',data:empty()});
   if(!map.getLayer(id))map.addLayer({
    id,type:kind==='reserved'||kind==='footprints'?'fill':'line',source:id,
    layout:{visibility:'none',...(kind==='reserved'||kind==='footprints'?{}:
      {'line-join':'round','line-cap':'round'})},
    paint:kind==='reserved'?{'fill-color':'#163146','fill-opacity':.22}:
     kind==='footprints'?{'fill-color':'#c7d0d8','fill-opacity':.14}:
     {'line-color':kind==='main'?'#ffffff':kind==='secondary'?'#e8edf1':'#aab3bf',
      'line-width':kind==='main'?2.6:kind==='secondary'?1.1:kind==='bundles'?.48:.45,
      'line-opacity':kind==='main'?1:kind==='secondary'?.88:kind==='bundles'?.5:.62}
   },outlineLayer);
  }
  return true;
 }
 function updateMap(){
  const map=getMap();if(!layers())return;
  // Always render the FINAL, relaxed and topology-tested centreline network.
  // Pre-Wool rounded collectors are only an optional decorative preview, not roads.
  const selection={main:result?.mainRoads,secondary:result?.secondaryRoads,
   local:result?.localRoads,bundles:result?.displayBundles,reserved:result?.reservedFloodEcologicalCorridors,
   footprints:result?.roadPolygons};
  for(const [kind,id] of Object.entries(names)){
   map.getSource(id).setData(selection[kind]||empty());
   const check=el('pg-road-show-'+(kind==='bundles'?'main':kind));
   map.setLayoutProperty(id,'visibility',active&&result&&check?.checked?'visible':'none');
  }
  // No intermediate road skeleton or background tensor geometry is ever
  // presented as a STEP05 result. Only computed Wool network layers render.
  map.setLayoutProperty('pg-road-backdrop','visibility',
    active&&Boolean(result)?'visible':'none');
  if(map.getLayer('pg-slope'))map.setLayoutProperty('pg-slope','visibility','none');
 }
 function params(){
  const settings=Object.fromEntries(PARAMETERS.map(([k])=>
   [k,Number(el('pg-road-'+k).value)]));
  settings.floodLimitM=Number(el('pg-road-floodLimitM').value);
  settings.visualMode=el('pg-road-visualMode')?.value||'analysis';
  return settings;
 }
 function generate(mode){
  if(!ready||pending)return;
  pending=true;result=null;updateMap();
  el('pg-road-progressbar').style.width='1%';
  el('pg-road-generate').disabled=true;el('pg-road-wool').disabled=true;
  el('pg-road-export').disabled=true;el('pg-road-package').disabled=true;
  inform(params().visualMode==='presentation'?'正在生成连续柔性主次道路与围合地块（展示示意）…':
    mode==='optimise'?'按张量、洪涝和 Wool 弹性重新优化路网…':
    '沿真实张量主次方向生成初始道路纤维…');
  ensureWorker();worker.postMessage({type:mode,id:++serial,params:params()});
 }
 function acceptSnapshot(parsed,label){
  if(!root)return;
  ready=false;result=null;pending=false;updateMap();
  ensureWorker();
  inform('正在核对 '+label+' 的2100年张量、洪涝结果与场地配准…');
  worker.postMessage({type:'source',id:++serial,snapshot:parsed,ring:getRing()});
  loadedSource=label;
 }
 async function importSource(file){
  if(!file)return;
  if(file.size>75*1024*1024){inform('JSON 文件超过 75MB，请缩小场地。',true);return}
  try{acceptSnapshot(JSON.parse(await file.text()),file.name);}
  catch(e){inform('场地 JSON 读取失败：'+e.message,true)}
 }
 function scheduleRegenerate(){
  if(!ready||!active)return;
  if(regenerateTimer!==null)clearTimeout(regenerateTimer);
  regenerateTimer=setTimeout(()=>{
   regenerateTimer=null;
   if(pending){rerunAfterDone=true;return}
   generate('optimise');
  },450);
 }
 function mount(target){
  target.innerHTML=html();
  for(const [k] of PARAMETERS){
   const slider=el('pg-road-'+k),out=el('pg-road-val-'+k);
   slider.oninput=()=>{out.textContent=slider.value;};
   slider.onchange=()=>scheduleRegenerate();
  }
  if(el('pg-road-import'))el('pg-road-import').onchange=e=>importSource(e.target.files?.[0]);
  el('pg-road-floodLimitM').onchange=()=>scheduleRegenerate();
  el('pg-road-visualMode').onchange=()=>{
    const present=el('pg-road-visualMode').value==='presentation';
    el('pg-road-mode-note').textContent=present?
      '展示模式：只显示最终 Wool 形态，包括柔性主干路、片区汇合和密集细分地块；概念设计不代表工程安全验证。':
      '分析模式：从真实水文张量出发，使用洪涝禁行、Wool 生长和 A* 安全修复。';
    scheduleRegenerate();
  };
  el('pg-road-generate').onclick=()=>generate('generate');
  el('pg-road-wool').onclick=()=>generate('optimise');
  el('pg-road-reset').onclick=()=>{
   result=null;pending=false;rerunAfterDone=false;
   if(regenerateTimer!==null)clearTimeout(regenerateTimer);
   regenerateTimer=null;
   if(el('pg-road-quality'))el('pg-road-quality').textContent='尚未生成路网。';
   onReset();
   if(worker){worker.terminate();worker=null;}
   ready=false;
   el('pg-road-progressbar').style.width='0';
   for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
    el(id).disabled=true;
   updateMap();
   inform('道路已重置。需由 STEP 04 提供同一地块真实张量数据。');
   el('pg-road-source').textContent='等待真实场地数据';
  };
  for(const kind of Object.keys(names))
   if(el('pg-road-show-'+kind))el('pg-road-show-'+kind).onchange=updateMap;
  el('pg-road-export').onclick=()=>result&&saveFile('London_2100_STEP05_RoadNetwork.geojson',
   geoJSON(result),'application/geo+json');
  el('pg-road-package').onclick=()=>result&&saveFile('London_2100_STEP05_Topology.json',
   result,'application/json');
  // Automatic same-tab handoff after closing the flood/tensor selection
  // workspace. The worker rejects stale or mismatched parcel snapshots.
  if(autoHandoff){
   const previous=window.__londonParcelTensorHandoff;
   if(previous)acceptSnapshot(previous,'London Map 当前会话张量/洪涝计算结果');
  }
 }
 function setActive(value){
  active=Boolean(value);
  updateMap();
  if(active){
   const readyMessage=result?'路网已生成，可拖动地图或查看各道路层级。':
     ready?'已收到真实场地数据，点击「重新生成 Wool 最终路网」。':
     '先完成 2100 年洪涝与张量计算，或从左侧导入真实场地诊断 JSON。';
   inform(readyMessage);
  }
 }
 function generateInitial(){generate('generate')}
 function setAutoGenerate(value){autoGenerateOnReady=Boolean(value);}
 function resetRoads(){
  el('pg-road-reset')?.click();
 }
 function loadSnapshot(snapshot,label='Hydro Lab 实时计算的张量与洪涝结果'){
  acceptSnapshot(snapshot,label);
 }
 function loadResult(precomputed){
  if(!precomputed||precomputed.schema!=='london-road-step05-v1')
   throw Error('STEP 05 道路成果格式不正确');
  result=precomputed;ready=true;pending=false;
  for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package']){
   const control=el(id);if(control)control.disabled=false;
  }
  inform('已载入 Hydro Lab 生成的 STEP 05 道路网络 · '+(result.diagnostics?.roadCount||0)+' 条');
  updateMap();
 }
 function dispose(){if(regenerateTimer!==null)clearTimeout(regenerateTimer);
  serial++;worker?.terminate();worker=null;active=false;ready=false;result=null;}
 return {mount,setActive,setAutoGenerate,attachMap:updateMap,generateInitial,loadSnapshot,loadResult,resetRoads,dispose,
  get isReady(){return ready},get result(){return result}};
}

