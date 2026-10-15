// Optional capture for an already-open v3.22.49 tab. No refresh, uploads,
// network requests, solver writes, or changes to the selected parcel.
const years=new Map();
const fieldKeys=['primaryX','primaryY','confidence','anisotropy','validMask','drainageMask','trunkMask',
  'drainageRank','drainageAreaKm2','drainageConfidence','rainfallInfluence'];
const encode=a=>a?{type:a.constructor.name,values:Array.from(a,v=>Number.isFinite(v)?v:null)}:null;
function capture(){
  const native=window.getLondonHydroTensorSiteSnapshot?.();
  if(native)return native;
  const data=window.getLondonHydroTensorFieldData?.();
  if(!data)throw new Error('请启用张量场并等待计算完成，再导出。');
  const geometry=window.getLondonHydroTensorGeometryData?.();
  const current={grid:data.grid,scenario:data.stage,cols:data.cols,rows:data.rows,
    cellX:data.cellX,cellY:data.cellY,demNativeResolutionM:data.demNativeResolutionM,parameters:data.parameters,
    fields:Object.fromEntries(fieldKeys.filter(k=>data[k]).map(k=>[k,encode(data[k])])),
    input:Object.fromEntries(['terrain','accumulation','inside','obstacle'].map(k=>[k,encode(data[k])])),
    depthMm:encode(data.depthMm)};
  if([2026,2100].includes(current.scenario.year))years.set(current.scenario.year,current);
  const canvas=document.querySelector('#local-flood-focus-viewer canvas.maplibregl-canvas');
  return {schema:'london-tensor-site-v1',version:'3.22.49-existing-tab-capture',
    savedAt:new Date().toISOString(),current,scenarios:[...years.values()],geometry,
    viewOptions:geometry?.parameters?{metersPerPixel:geometry.parameters.metersPerPixel,viewRect:geometry.parameters.viewRect}:null,
    camera:{viewport:canvas?{width:canvas.clientWidth,height:canvas.clientHeight}:null,
      note:'Legacy API has no exact camera or vector selection export. Native inside/obstacle arrays and renderer view options are preserved, without inventing polygon vertices or bearing.'},
    acceptance:'NOT visually verified; captured from the user-selected live parcel'};
}
let button=document.getElementById('tensor-existing-tab-export');
if(!button){
  button=document.createElement('button');button.id='tensor-existing-tab-export';
  button.textContent='导出当前场地诊断（保留原选区）';button.type='button';
  button.style.cssText='margin:8px 0;padding:8px;color:#fff;background:#263a4b;border:1px solid #7191a9;border-radius:6px;cursor:pointer';
  const status=document.getElementById('siteHudVectorStatus');
  if(!status)throw new Error('请先进入原圈选场地的张量场界面。');
  status.after(button);
}
button.onclick=()=>{
  try{
    const snapshot=capture(),blob=new Blob([JSON.stringify(snapshot)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='LondonMap_Tensor_Existing_Site_'+snapshot.current.scenario.year+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    button.textContent='已导出 · 已记录 '+(snapshot.scenarios.map(s=>s.scenario.year).join(' / ')||snapshot.current.scenario.year)+' 年';
  }catch(error){button.textContent=error.message}
};
