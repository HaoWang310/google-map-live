/* STEP 05 independent Parcel Generator presentation/controller.
   No STEP 01–04 changes or fabricated tensor data. */
const PARAMETERS=[
 ['woolStrength','Wool Strength',70,0,100],
 ['tensorAlignment','Tensor Alignment',75,0,100],
 ['floodAvoidance','Flood Avoidance',85,0,100],
 ['roadDensity','Road Density',55,5,100],
 ['branchingStrength','Branching Strength',60,0,100],
 ['bundleStrength','Bundle Strength',60,0,100],
 ['reconnectionStrength','Reconnection Strength',60,0,100],
 ['curvatureSmoothing','Curvature Smoothing',75,0,100],
 ['agriculturalContinuity','Agricultural Continuity',75,0,100]
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
    ...f,properties:{...f.properties,layer:'reserved_flood_corridor'}}))
  ]};
}
export function createParcelRoadUI({root,getMap,getRing,onStatus}){
 const el=id=>root?.querySelector('#'+id);
 let worker=null,serial=0,ready=false,result=null,active=false,pending=false;
 let loadedSource=null;
 function inform(msg,bad=false){statusText(el('pg-road-status'),msg,bad);
   onStatus?.(msg,bad);}
 const html=()=>`
 <div class="pg-label">STEP 05 · Generate and Optimise the Road Network</div>
 <p class="pg-note">必须导入同一红色场地从 London Map 导出的 2100 年真实张量/洪涝诊断 JSON；不会生成随机道路。</p>
 <label class="pg-option" style="display:block">导入真实张量＋洪涝场地
  <input type="file" accept=".json,application/json" id="pg-road-import" style="width:100%;font-size:11px;margin:6px 0">
 </label>
 <div class="pg-note" id="pg-road-source">尚未导入真实场地。STEP 05 不会使用虚构数据。</div>
 <div class="pg-section"><div class="pg-label">WOOL / FLOOD / URBAN CONTROL</div>
 ${PARAMETERS.map(([k,label,v,min,max])=>`
  <label class="pg-road-param"><span>${label} <output id="pg-road-val-${k}">${v}</output></span>
   <input type="range" id="pg-road-${k}" min="${min}" max="${max}" step="5" value="${v}"></label>`).join('')}
 <label class="pg-road-param"><span>普通道路水深阈值（米）</span>
  <input id="pg-road-floodLimitM" type="number" min=".03" max=".6" step=".01" value=".15" style="width:68px"></label></div>
 <div class="pg-section"><div class="pg-label">GENERATE / OPTIMISE</div>
 <div class="pg-road-actions">
 <button id="pg-road-generate" disabled>① Generate Road Network</button>
 <button id="pg-road-wool" disabled>② Optimise Wool</button>
 <button id="pg-road-reset">Reset</button>
 </div>
 <div class="pg-road-progress"><div id="pg-road-progressbar"></div></div>
 <div class="pg-status" id="pg-road-status">等待真实张量与水深数据。</div>
 </div>
 <div class="pg-section"><div class="pg-label">VISIBILITY / HIERARCHY</div>
 ${[['main','Main Roads (主道路)'],['secondary','Secondary Roads (次道路)'],
  ['local','Local Roads (支路)'],['reserved','Flood / ecological reserves'],
  ['footprints','Road Footprints']].map(([k,label])=>
  `<label class="pg-option"><input type="checkbox" id="pg-road-show-${k}"
     ${k!=='footprints'?'checked':''}> ${label}</label>`).join('')}
 </div>
 <div class="pg-section"><div class="pg-label">STEP 06 HANDOFF</div>
 <div class="pg-road-actions">
 <button id="pg-road-export" disabled>↓ Export GeoJSON</button>
 <button id="pg-road-package" disabled>↓ Full topology JSON</button></div>
 <p class="pg-note">STEP 05 输出真实计算得到的道路中心线、分级、路面条带、多边形场地边界、洪涝保留区和交叉节点图。STEP 06 的地块切分/功能配色尚未执行。</p></div>`;
 function ensureWorker(){
  if(worker)return;
  worker=new Worker(new URL('./parcel_road_worker.js',import.meta.url),{type:'module'});
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
    el('pg-road-source').textContent='✓ 已读取真实 DEM/水文张量、水深与场地边界';
   }else if(data.type==='done'){
    pending=false;result=data.result;
    for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
      el(id).disabled=false;
    el('pg-road-progressbar').style.width='100%';
    inform('生成完成 · '+result.diagnostics.roadCount+' 条道路，'+
      result.diagnostics.lengthKm+' km，'+result.diagnostics.junctions+
      ' 个路口 · '+(data.result.mode==='optimise'?'Wool 优化':'初始道路骨架'));
    updateMap();
   }else if(data.type==='error'){
    pending=false;
    for(const id of ['pg-road-generate','pg-road-wool'])el(id).disabled=!ready;
    inform('STEP 05 失败：'+data.message,true);
   }else if(data.type==='cleared'){
    result=null;pending=false;updateMap();
   }
  };
  worker.onerror=e=>{pending=false;inform('STEP 05 道路 Worker 出错：'+e.message,true);};
 }
 const names={main:'pg-road-main',secondary:'pg-road-secondary',
  local:'pg-road-local',reserved:'pg-road-reserved',footprints:'pg-road-footprints'};
 function layers(){
  const map=getMap();if(!map||!map.isStyleLoaded()||!map.getSource('pg-boundary'))return false;
  if(!map.getLayer('pg-road-backdrop'))map.addLayer({
   id:'pg-road-backdrop',type:'fill',source:'pg-boundary',
   layout:{visibility:'none'},paint:{'fill-color':'#08090a','fill-opacity':1}},'pg-outline');
  for(const [kind,id] of Object.entries(names)){
   if(!map.getSource(id))map.addSource(id,{type:'geojson',data:empty()});
   if(!map.getLayer(id))map.addLayer({
    id,type:kind==='reserved'||kind==='footprints'?'fill':'line',source:id,
    layout:{visibility:'none',...(kind==='reserved'||kind==='footprints'?{}:
      {'line-join':'round','line-cap':'round'})},
    paint:kind==='reserved'?{'fill-color':'#28516c','fill-opacity':.5}:
     kind==='footprints'?{'fill-color':'#c7d0d8','fill-opacity':.14}:
     {'line-color':kind==='main'?'#ffffff':kind==='secondary'?'#eeeeee':'#a8b1bd',
      'line-width':kind==='main'?5.5:kind==='secondary'?2.75:1.0,
      'line-opacity':kind==='main'?1:.9}
   },'pg-outline');
  }
  return true;
 }
 function updateMap(){
  const map=getMap();if(!layers())return;
  const selection={main:result?.mainRoads,secondary:result?.secondaryRoads,
   local:result?.localRoads,reserved:result?.reservedFloodEcologicalCorridors,
   footprints:result?.roadPolygons};
  for(const [kind,id] of Object.entries(names)){
   map.getSource(id).setData(selection[kind]||empty());
   const check=el('pg-road-show-'+kind);
   map.setLayoutProperty(id,'visibility',active&&result&&check?.checked?'visible':'none');
  }
  map.setLayoutProperty('pg-road-backdrop','visibility',active?'visible':'none');
  if(map.getLayer('pg-slope'))map.setLayoutProperty('pg-slope','visibility','none');
 }
 function params(){
  const settings=Object.fromEntries(PARAMETERS.map(([k])=>
   [k,Number(el('pg-road-'+k).value)]));
  settings.floodLimitM=Number(el('pg-road-floodLimitM').value);
  return settings;
 }
 function generate(mode){
  if(!ready||pending)return;
  pending=true;result=null;updateMap();
  el('pg-road-progressbar').style.width='1%';
  el('pg-road-generate').disabled=true;el('pg-road-wool').disabled=true;
  el('pg-road-export').disabled=true;el('pg-road-package').disabled=true;
  inform(mode==='optimise'?'按张量、洪涝和 Wool 弹性重新优化路网…':
    '建立真实数据约束及初始分级道路骨架…');
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
 function mount(target){
  target.innerHTML=html();
  for(const [k] of PARAMETERS){
   const slider=el('pg-road-'+k),out=el('pg-road-val-'+k);
   slider.oninput=()=>{out.textContent=slider.value;};
  }
  el('pg-road-import').onchange=e=>importSource(e.target.files?.[0]);
  el('pg-road-generate').onclick=()=>generate('generate');
  el('pg-road-wool').onclick=()=>generate('optimise');
  el('pg-road-reset').onclick=()=>{
   result=null;pending=false;
   if(worker){worker.terminate();worker=null;}
   ready=false;
   el('pg-road-progressbar').style.width='0';
   for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
    el(id).disabled=true;
   updateMap();
   inform('道路已重置。重新导入真实张量场后可再次生成。');
   el('pg-road-source').textContent='尚未导入真实场地';
  };
  for(const kind of Object.keys(names))
   el('pg-road-show-'+kind).onchange=updateMap;
  el('pg-road-export').onclick=()=>result&&saveFile('London_2100_STEP05_RoadNetwork.geojson',
   geoJSON(result),'application/geo+json');
  el('pg-road-package').onclick=()=>result&&saveFile('London_2100_STEP05_Topology.json',
   result,'application/json');
  // Automatic same-tab handoff after closing the flood/tensor selection
  // workspace. The worker rejects stale or mismatched parcel snapshots.
  const previous=window.__londonParcelTensorHandoff;
  if(previous){
   acceptSnapshot(previous,'London Map 当前会话张量/洪涝计算结果');
  }
 }
 function setActive(value){active=Boolean(value);updateMap()}
 function dispose(){serial++;worker?.terminate();worker=null;active=false;ready=false;result=null;}
 return {mount,setActive,attachMap:updateMap,dispose,get result(){return result}};
}
