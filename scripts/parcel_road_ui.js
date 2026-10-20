/* STEP 05 independent Parcel Generator presentation/controller.
   No STEP 01–04 changes or fabricated tensor data. */
const PARAMETERS=[
 ['woolStrength','Wool attraction',88,0,100],
 ['tensorAlignment','Tensor alignment',78,0,100],
 ['floodAvoidance','Flood avoidance',58,0,100],
 ['roadDensity','Road density',88,5,100],
 ['branchingStrength','Branching strength',78,0,100],
 ['bundleStrength','Fiber bundling strength',85,0,100],
 ['reconnectionStrength','Reconnection strength',86,0,100],
 ['curvatureSmoothing','Curvature smoothing',90,0,100],
 ['agriculturalContinuity','Agricultural continuity',65,0,100]
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
 <div class="pg-label">STEP 05 · Integrated Wool road network · final result only</div>
 <p class="pg-note">${autoHandoff?'Receive the computed tensor and water depth for the current London Map site.':'After enabling Wool integration, the computed STEP 04 data for 2100 is loaded automatically to generate the final Wool road network. STEP 04 tensor curves, intermediate fibers and the existing basemap are hidden in this step.'}</p>
 <div class="pg-section"><div class="pg-label">Design display mode · visual presentation first</div>
 <label class="pg-option" style="display:flex;align-items:center;gap:8px">
 <span>Mode</span><select id="pg-road-visualMode" style="flex:1;min-width:0">
 <option value="presentation" selected>Presentation · organic enclosed Wool network</option>
 <option value="analysis">Analysis · hydrology-constrained roads</option>
 </select></label>
 <div class="pg-note" id="pg-road-mode-note" style="color:#a6deef">
 Generate a 2D Wool pattern using the selected site's tensor and ponding data. Presentation refines morphology; Analysis checks hydrological safety constraints.</div></div>
 <div class="pg-section"><div class="pg-label">Generate / optimize · tensor growth and Wool roads</div>
 <div class="pg-road-actions">
 <button id="pg-road-generate" disabled style="display:none" aria-hidden="true" tabindex="-1">Hidden legacy skeleton-generation control</button>
 <button id="pg-road-wool" disabled>Regenerate final Wool network</button>
 <button id="pg-road-reset">Reset network</button>
 </div>
 <div class="pg-road-progress"><div id="pg-road-progressbar"></div></div>
 <div class="pg-status" id="pg-road-status">Waiting for 2100 tensor and depth results for this site.</div>
 <div class="pg-status" id="pg-road-quality" style="white-space:pre-line;font-size:10px">Display only final Wool main, secondary and local roads; hide intermediate fibers.</div>
 </div>
 <div class="pg-note" id="pg-road-source">Waiting for real tensor/depth data from the same site.</div>
 ${showImport?`<label class="pg-option" style="display:block">Fallback: import real-site diagnostic JSON
  <input type="file" accept=".json,application/json" id="pg-road-import" style="width:100%;font-size:11px;margin:6px 0">
 </label>`:''}
 <div class="pg-section"><div class="pg-label">Wool / flood / urban controls · parameters</div>
 ${PARAMETERS.map(([k,label,v,min,max])=>`
  <label class="pg-road-param"><span>${label} <output id="pg-road-val-${k}">${v}</output></span>
   <input type="range" id="pg-road-${k}" min="${min}" max="${max}" step="1" value="${v}"></label>`).join('')}
 <label class="pg-road-param"><span>Maximum water depth for regular roads (m)</span>
  <input id="pg-road-floodLimitM" type="number" min=".03" max=".6" step=".01" value=".12" style="width:68px"></label></div>
 <div class="pg-section"><div class="pg-label">Display / road hierarchy</div>
 ${[['main','Main roads'],['secondary','Secondary roads'],
  ['local','Local roads'],['reserved','Flood / ecological reserves'],
  ['footprints','Road footprints']].map(([k,label])=>
  `<label class="pg-option"><input type="checkbox" id="pg-road-show-${k}"
     ${['main','secondary','local'].includes(k)?'checked':''}> ${label}</label>`).join('')}
 </div>
 <div class="pg-section"><div class="pg-label">Go to STEP 06 · parcel subdivision</div>
 <div class="pg-road-actions">
 <button id="pg-road-export" disabled>↓ Export GeoJSON</button>
 <button id="pg-road-package" disabled>↓ Export complete topology JSON</button></div>
 <p class="pg-note">STEP 05 exports computed road centerlines, hierarchy, surface strips, site boundary, reserved flood areas and junction topology. STEP 06 parcel subdivision and functional zoning are not yet implemented.</p></div>`;
 function ensureWorker(){
  if(worker)return;
  worker=new Worker(new URL('./parcel_road_worker.js?v=3.29.4-english',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data?.id!==serial)return;
   if(data.type==='progress'){
    el('pg-road-progressbar').style.width=Math.round(data.progress*100)+'%';
    inform(data.message);
   }else if(data.type==='ready'){
    ready=true;pending=false;
    el('pg-road-generate').disabled=false;
    el('pg-road-wool').disabled=true;
    inform('Source data validated: '+data.diagnostics.cells+' tensor grid cells; '+
      'valid cells '+data.diagnostics.validCells+'; calculation year 2100.');
    el('pg-road-source').textContent='✓ Automatically loaded computed tensor, depth and boundary for the current site';
    if(autoGenerateOnReady)generate('optimise');
   }else if(data.type==='done'){
    pending=false;result=data.result;
    const q=el('pg-road-quality'),stat=result.diagnostics;
    if(q)q.textContent=(stat.visualMode==='presentation'?
      '[Presentation] Shared-source smoothed tensor → Wool optimization → final roads (concept design)\n':
      '[Analysis] Tensor integration → Wool growth → A* reconnection\nNew Wool secondary roads '+
        (stat.wool?.grownSecondary||0)+' · new local roads '+
        (stat.wool?.grownLocal||0)+' · A* repairs '+
        (stat.astarRepairs||0)+' roads\n')+
      'Mean tensor smoothing angular deviation '+(stat.presentationTensor?.meanAngleErrorDeg||0).toFixed(1)+'°'+
      '\nMain roads '+stat.mainKm+' km · secondary roads '+stat.secondaryKm+
      ' km · local roads '+stat.localKm+' km' +
      '\nSafe-grid road coverage '+stat.rasterCorridorCoveragePct+'% · connected components '+
      stat.components+' · cycle rank '+stat.cycleRank+
      '\nCandidate blocks '+stat.candidateBlocks+' · median area '+
      stat.medianBlockAreaM2+' m²' +
      (stat.qualityFlags?.length?'\nReview required: '+stat.qualityFlags.join(', '):'');
    for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
      el(id).disabled=false;
    el('pg-road-progressbar').style.width='100%';
    inform((result.diagnostics.visualMode==='presentation'?'Final organic Wool network generated (conceptual) · ':'Final analyzed Wool road network generated · ')+result.diagnostics.roadCount+' roads, '+
      result.diagnostics.lengthKm+' km，'+result.diagnostics.junctions+
      ' junctions · '+(data.result.mode==='optimise'?'Wool optimization':'Initial road skeleton'));
    updateMap();
    onDone(result);
    if(rerunAfterDone){rerunAfterDone=false;generate('optimise');}
   }else if(data.type==='error'){
    pending=false;
    for(const id of ['pg-road-generate','pg-road-wool'])el(id).disabled=!ready;
    el('pg-road-source').textContent=ready?
      '⚠ Data validated, but road geometry computation failed; inspect parameters and errors.':
      '⚠ Tensor/flood data validation failed for this site; check STEP 04.';
    rerunAfterDone=false;inform('STEP 05 failed: '+data.message,true);
   }else if(data.type==='cleared'){
    result=null;pending=false;updateMap();
   }
  };
  worker.onerror=e=>{pending=false;inform('STEP 05 road Worker error: '+e.message,true);};
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
  inform(params().visualMode==='presentation'?'Generating continuous elastic primary/secondary roads and enclosed blocks (concept preview)…':
    mode==='optimise'?'Re-optimizing the network using tensors, flooding and Wool elasticity…':
    'Growing initial road fibers along primary and secondary tensor directions…');
  ensureWorker();worker.postMessage({type:mode,id:++serial,params:params()});
 }
 function acceptSnapshot(parsed,label){
  if(!root)return;
  ready=false;result=null;pending=false;updateMap();
  ensureWorker();
  inform('Validating '+label+' 2100 tensor/flood results and site alignment…');
  worker.postMessage({type:'source',id:++serial,snapshot:parsed,ring:getRing()});
  loadedSource=label;
 }
 async function importSource(file){
  if(!file)return;
  if(file.size>75*1024*1024){inform('JSON exceeds 75 MB; reduce the site size.',true);return}
  try{acceptSnapshot(JSON.parse(await file.text()),file.name);}
  catch(e){inform('Failed to read site JSON: '+e.message,true)}
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
      'Presentation: only the final Wool geometry, including elastic main roads, district confluences and subdivided blocks. Concept design is not engineering certification.':
      'Analysis: start from computed hydrological tensors with flood exclusions, Wool growth and safe A* reconnection.';
    scheduleRegenerate();
  };
  el('pg-road-generate').onclick=()=>generate('generate');
  el('pg-road-wool').onclick=()=>generate('optimise');
  el('pg-road-reset').onclick=()=>{
   result=null;pending=false;rerunAfterDone=false;
   if(regenerateTimer!==null)clearTimeout(regenerateTimer);
   regenerateTimer=null;
   if(el('pg-road-quality'))el('pg-road-quality').textContent='No road network generated.';
   onReset();
   if(worker){worker.terminate();worker=null;}
   ready=false;
   el('pg-road-progressbar').style.width='0';
   for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package'])
    el(id).disabled=true;
   updateMap();
   inform('Road network reset. STEP 04 must provide tensor data for the same site.');
   el('pg-road-source').textContent='Waiting for real-site data';
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
   if(previous)acceptSnapshot(previous,'London Map current-session tensor/flood results');
  }
 }
 function setActive(value){
  active=Boolean(value);
  updateMap();
  if(active){
   const readyMessage=result?'Network generated. Pan the map or view different road classes.':
     ready?'已收到真实场地数据，点击「Regenerate final Wool network」。':
     'Complete 2100 flood/tensor calculations, or import real-site diagnostic JSON from the left.';
   inform(readyMessage);
  }
 }
 function generateInitial(){generate('generate')}
 function setAutoGenerate(value){autoGenerateOnReady=Boolean(value);}
 function resetRoads(){
  el('pg-road-reset')?.click();
 }
 function loadSnapshot(snapshot,label='Hydro Lab computed tensor and flood results'){
  acceptSnapshot(snapshot,label);
 }
 function loadResult(precomputed){
  if(!precomputed||precomputed.schema!=='london-road-step05-v1')
   throw Error('Invalid STEP 05 road-output schema');
  result=precomputed;ready=true;pending=false;
  for(const id of ['pg-road-generate','pg-road-wool','pg-road-export','pg-road-package']){
   const control=el(id);if(control)control.disabled=false;
  }
  inform('Loaded STEP 05 road network generated by Hydro Lab · '+(result.diagnostics?.roadCount||0)+' roads');
  updateMap();
 }
 function dispose(){if(regenerateTimer!==null)clearTimeout(regenerateTimer);
  serial++;worker?.terminate();worker=null;active=false;ready=false;result=null;}
 return {mount,setActive,setAutoGenerate,attachMap:updateMap,generateInitial,loadSnapshot,loadResult,resetRoads,dispose,
  get isReady(){return ready},get result(){return result}};
}

