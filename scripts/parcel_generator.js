
/* Parcel Generator: STEP 01 audit preserved, independent STEP 05 road module. */
import {createParcelRoadUI} from './parcel_road_ui.js?v=3.29.4-english';
const CRS27700='+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs';
const get=(parent,id)=>parent?.querySelector(id);
const closeRing=points=>{
 const ring=points.map(p=>[Number(p[0]),Number(p[1])]);
 if(!ring.length)return ring;
 if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])ring.push([...ring[0]]);
 return ring;
};
function signedArea(points){
 let sum=0;for(let i=0;i<points.length-1;i++)sum+=
 points[i][0]*points[i+1][1]-points[i+1][0]*points[i][1];
 return sum/2;
}
function validateSimpleBoundary(ring){
 if(ring.length<4||ring.length>1000)throw Error('Site boundary requires 3–999 valid vertices');
 const EPS=1e-10;
 const orient=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 const on=(a,b,p)=>Math.min(a[0],b[0])-EPS<=p[0]&&p[0]<=Math.max(a[0],b[0])+EPS&&
  Math.min(a[1],b[1])-EPS<=p[1]&&p[1]<=Math.max(a[1],b[1])+EPS;
 const crosses=(a,b,c,d)=>{
  const x=orient(a,b,c),y=orient(a,b,d),z=orient(c,d,a),w=orient(c,d,b);
  if(x*y<0&&z*w<0)return true;
  return (Math.abs(x)<EPS&&on(a,b,c))||(Math.abs(y)<EPS&&on(a,b,d))||
    (Math.abs(z)<EPS&&on(c,d,a))||(Math.abs(w)<EPS&&on(c,d,b));
 };
 const edges=ring.length-1;
 for(let i=0;i<edges;i++){
  const a=ring[i],b=ring[i+1];
  if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-9)throw Error('Site boundary contains duplicate vertices or zero-length edges');
  for(let j=i+1;j<edges;j++){
   if(j===i+1||(i===0&&j===edges-1))continue;
   if(crosses(a,b,ring[j],ring[j+1]))throw Error('Site boundary self-intersects; return to the map to edit control points');
  }
 }
 if(Math.abs(signedArea(ring))<1e-10)throw Error('Selected site area is near zero or the boundary is degenerate');
}
function bngAudit(ring,proj4){
 validateSimpleBoundary(ring);
 const pts=ring.map(p=>proj4('EPSG:4326','EPSG:27700',p));
 let perimeterM=0;
 for(let i=0;i<pts.length-1;i++)perimeterM+=Math.hypot(
 pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);
 return {areaM2:Math.abs(signedArea(pts)),perimeterM,
  e0:Math.min(...pts.map(p=>p[0])),e1:Math.max(...pts.map(p=>p[0])),
  n0:Math.min(...pts.map(p=>p[1])),n1:Math.max(...pts.map(p=>p[1]))};
}
function clipMask(ring){
 const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
 const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys);
 const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
 const bbox=rect(w,s,e,n);
 const hole=signedArea(ring)*signedArea(bbox)>0?[...ring].reverse():ring;
 return {type:'FeatureCollection',features:[
 ...[rect(-179,-80,w,80),rect(e,-80,179,80),rect(w,-80,e,s),rect(w,n,e,80)]
 .filter(r=>Math.abs(signedArea(r))>1e-10).map(coordinates=>({
  type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coordinates]}})),
 {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[bbox,hole]}}
 ]};
}
const STYLE = `
.pg{position:fixed;inset:0;z-index:2147483200;background:#000;color:#e2f0f7;
 font:12px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
.pg *{box-sizing:border-box}
.pg-map{position:absolute;inset:0;z-index:0;touch-action:pan-x pan-y}
.pg-map canvas.maplibregl-canvas{cursor:grab}
.pg-map canvas.maplibregl-canvas:active{cursor:grabbing}
.pg-top,.pg-bottom,.pg-panel{position:absolute;background:#112232f2;
 border:1px solid #3d5a71;border-radius:11px;z-index:3}
.pg-top{top:10px;left:12px;right:12px;display:flex;align-items:center;gap:12px;padding:11px 14px}
.pg-bottom{bottom:10px;left:12px;right:12px;display:flex;align-items:center;gap:8px;padding:10px;min-height:60px}
.pg-panel{top:76px;bottom:82px;padding:14px;overflow:auto;scrollbar-width:thin}
.pg-left{left:12px;width:310px}.pg-right{right:12px;width:275px}
.pg h3{font-size:15px;margin:0 0 10px}.pg small{color:#8fb7c9;font-size:10px}
.pg-brand{font-size:14px;font-weight:800}.pg-brand small{display:block}
.pg-badge{color:#95dbe7;background:#19465a;border:1px solid #346d80;border-radius:30px;padding:4px 8px}
.pg button{padding:8px 11px;border:1px solid #48738a;border-radius:7px;background:#19556c;
 color:#e9fbff;cursor:pointer;font:inherit}
.pg button:disabled{opacity:.4;cursor:not-allowed}
.pg .pg-exit{margin-left:auto;background:#304a5d}
.pg-step{width:100%;text-align:left;margin:4px 0}
.pg-step.on{border-color:#63cfda;background:#1a7585}
.pg-section{border-top:1px solid #38566b;margin-top:14px;padding-top:12px}
.pg-label{color:#8bd4e2;font-weight:750;font-size:11px;letter-spacing:.04em}
.pg-note{color:#9abacc;font-size:10px;line-height:1.65}
.pg-stat{padding:10px;background:#1b3446;border:1px solid #31566b;border-radius:8px;margin:7px 0}
.pg-stat small{display:block}.pg-stat b{display:block;font-size:19px}
.pg-line{display:flex;justify-content:space-between;gap:8px;margin:7px 0}
.pg-status{white-space:pre-line;line-height:1.6;color:#bddce9}
.pg-status.error{color:#ffada7}
.pg-sources{width:100%;border-collapse:collapse;font-size:10px}
.pg-sources td{padding:7px 3px;border-bottom:1px solid #345163;vertical-align:top}
.pg-sources td:last-child{color:#a4c0cb}
.pg-subtitle{position:absolute;top:78px;left:50%;transform:translateX(-50%);
 z-index:3;pointer-events:none;background:#152f40d9;border:1px solid #48788b;
 border-radius:7px;padding:6px 10px;font-size:10px}
.pg-option{display:flex;gap:8px;align-items:center;margin:10px 0}
.pg-option input{accent-color:#45bdcc}
.pg-field{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}
.pg-field input{width:105px;min-width:0;padding:6px;color:#ebfaff;background:#1c3547;border:1px solid #51758a;border-radius:5px}
.pg-road-param{display:flex;flex-direction:column;gap:4px;margin:9px 0;color:#cae1e9;font-size:11px}
.pg-road-param>span{display:flex;justify-content:space-between}
.pg-road-param input[type=range]{width:100%;accent-color:#b6cfde}
.pg-road-param output{font-variant-numeric:tabular-nums;color:#fff}
.pg-road-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}
.pg-road-actions button{font-size:11px;padding:8px 5px}
.pg-road-progress{height:5px;background:#182e3c;border-radius:8px;overflow:hidden;margin:11px 0}
.pg-road-progress>div{height:100%;width:0;background:#dbeef7;transition:width .15s}
@media(max-width:950px){.pg-left{width:240px}.pg-right{width:220px}}
@media(max-width:680px){.pg-left{width:43vw;left:4px;padding:8px}
 .pg-right{width:38vw;right:4px;padding:8px}.pg-panel{top:72px;bottom:115px}
 .pg-bottom{left:4px;right:4px;flex-wrap:wrap}.pg-stat b{font-size:15px}
 .pg-badge{display:none}}
`;
const PIPELINE=[
 ['Site Data','Real geographic data'],['Hydrology + Agriculture','Hydrology and agriculture demand'],
 ['Spatial Constraints','Integrated spatial constraints'],['Tensor Field','Five tensor direction classes'],
 ['Wool Road Generator','Route optimization and topology'],['Parcel Subdivision','Real geometric parcel subdivision'],
 ['Performance','Performance and feedback']
];
const SOURCES=[
 ['OS Terrain 50','Real elevation source; locally preprocessed raster'],
 ['DEM slope','Derived from DEM gradients, not officially measured slope'],
 ['Drainage accumulation','Terrain-derived accumulation, not a real underground sewer network'],
 ['EA flood risk','Official long-term probability classes, not yet integrated into road constraints'],
 ['OpenStreetMap','Public basemap; full site-road topology extraction is not yet complete'],
 ['Soils and crop yields','Not connected; cannot claim real agricultural suitability']
];
export function createParcelGenerator({maplibregl,assetUrl,demBounds,demWidth,demHeight}){
 let root=null,viewer=null,worker=null,current=0,ring=null,bng=null,terrain=null,demand=null;
 let roadUI=null;
 const byId=id=>get(root,'#'+id);
 function status(message,error=false){
  const el=byId('pg-status');if(el){el.textContent=message;el.classList.toggle('error',error);}
 }
 function exit(){
  current++;
  worker?.terminate();worker=null;
  roadUI?.dispose();roadUI=null;
  viewer?.remove();viewer=null;
  root?.remove();root=null;ring=null;bng=null;terrain=null;demand=null;
  document.removeEventListener('keydown',key,true);
 }
 function key(e){
  if(e.key==='Escape'&&root&&!['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)){
   e.preventDefault();e.stopImmediatePropagation();exit();
  }
 }
 function setValue(id,val){const element=byId(id);if(element)element.textContent=String(val);}
 function update(){
  if(bng){
   setValue('pg-area',(bng.areaM2/1e6).toFixed(4)+' km²');
   setValue('pg-perimeter',Math.round(bng.perimeterM).toLocaleString()+' m');
   setValue('pg-projection',
     'E '+Math.round(bng.e0)+'–'+Math.round(bng.e1)+
     ' / N '+Math.round(bng.n0)+'–'+Math.round(bng.n1));
   updateDemand();
  }
  if(terrain){
   setValue('pg-elev',terrain.minElevationM+'–'+terrain.maxElevationM+' m');
   setValue('pg-slope',terrain.meanSlopeDeg===null?'Invalid sample':terrain.meanSlopeDeg+'°');
   setValue('pg-coverage',terrain.coveragePercent+'%');
   setValue('pg-drainage',terrain.drainageAvailable?
      terrain.drainageCellsAbove1km2+' raster cells (≥1 km²)':'Data unavailable');
   const cb=byId('pg-slope-toggle');if(cb)cb.disabled=!terrain.derivedPoints.length;
  }
 }

 function calcAgriculturalDemand(input){
  const p=Number(input.population),share=Number(input.share),consumption=Number(input.consumption),yieldHa=Number(input.yieldHa);
  if(!(p>0&&share>=0&&share<=100&&consumption>0&&yieldHa>0)||
     ![p,share,consumption,yieldHa].every(Number.isFinite))return null;
  const annualKg=p*consumption*share/100;
  const ha=annualKg/(yieldHa*1000);
  return {people:p,foodSelfSufficiencyPercent:share,
   annualConsumptionKgPerPerson:consumption,edibleYieldTonnesPerHaPerYear:yieldHa,
   requiredAreaHa:ha,requiredAreaM2:ha*10000,
   status:'Scenario estimate, user-entered assumptions; NOT measured local crop suitability'};
 }
 function updateDemand(){
  if(!root)return;
  demand=calcAgriculturalDemand({
   population:byId('pg-pop')?.value,share:byId('pg-self')?.value,
   consumption:byId('pg-food')?.value,yieldHa:byId('pg-yield')?.value
  });
  setValue('pg-agri-area',demand?
   demand.requiredAreaHa.toFixed(2)+' ha / '+(demand.requiredAreaM2/1e6).toFixed(4)+' km²':'Enter all parameters first');
  setValue('pg-agri-share',demand&&bng?
   (100*demand.requiredAreaM2/bng.areaM2).toFixed(1)+'%':'—');
  setValue('pg-agri-warning',!demand?
    'Population, annual food consumption per person and annual crop yield per hectare are required.':
    bng&&demand.requiredAreaM2>bng.areaM2?
    'Warning: agricultural area required by these assumptions exceeds the selected site.':
    'Outdoor agriculture demand estimate only; soils, solar exposure and irrigation have not been obtained.');
 }
 function exportSite(){
  if(!ring||!bng)return;
  const result={type:'FeatureCollection',
   properties:{phase:'STEP 01',computationCRS:'EPSG:27700',
   areaM2:bng.areaM2,perimeterM:bng.perimeterM,terrainStats:terrain,agriculturalScenario:demand,
   reliability:'OSGB36 Proj4 Helmert approximation without OSTN15 grid: not survey grade',
   missing:['soil','crop yields','complete OSM road topology','flood constraint model'],
   roadsGenerated:false,parcelsGenerated:false},
   features:[{type:'Feature',properties:{siteId:'SITE-001'},
    geometry:{type:'Polygon',coordinates:[ring]}}]};
  const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/geo+json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='London_Parcel_Generator_STEP01.geojson';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 function fitSite(){
  if(!viewer||!ring)return;
  const lng=ring.map(p=>p[0]),lat=ring.map(p=>p[1]);
  viewer.resize();
  viewer.fitBounds([[Math.min(...lng),Math.min(...lat)],
    [Math.max(...lng),Math.max(...lat)]],{
    padding:{top:100,bottom:95,left:335,right:295},maxZoom:18,duration:250
  });
 }
 function addLayers(){
  if(!viewer||!ring)return;
  const lng=ring.map(p=>p[0]),lat=ring.map(p=>p[1]);
  viewer.addSource('pg-mask',{type:'geojson',data:clipMask(ring)});
  viewer.addSource('pg-boundary',{type:'geojson',data:{
   type:'FeatureCollection',features:[{type:'Feature',properties:{},
   geometry:{type:'Polygon',coordinates:[ring]}}]}});
  viewer.addSource('pg-slopes',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  viewer.addLayer({id:'pg-exterior',type:'fill',source:'pg-mask',
   paint:{'fill-color':'#000000','fill-opacity':1}});
  viewer.addLayer({id:'pg-site-tint',type:'fill',source:'pg-boundary',
   paint:{'fill-color':'#5bbbd7','fill-opacity':0.05}});
  viewer.addLayer({id:'pg-slope',type:'circle',source:'pg-slopes',
   layout:{visibility:'none'},paint:{'circle-radius':4,
    'circle-color':['interpolate',['linear'],['coalesce',['get','slopeDeg'],0],
       0,'#81d4ac',5,'#e6c35b',15,'#da6c51'],'circle-opacity':.7}});
  viewer.addLayer({id:'pg-outline',type:'line',source:'pg-boundary',
   paint:{'line-color':'#ff5353','line-width':2.5,'line-dasharray':[2,1]}});
  fitSite();
 }
 async function audit(){
  const id=++current;
  try{
   status('Calculating real EPSG:27700 coordinates…');
   const module=await import('https://cdn.jsdelivr.net/npm/proj4@2.13.0/+esm');
   if(current!==id)return;
   const proj4=module.default||module;
   proj4.defs('EPSG:27700',CRS27700);
   bng=bngAudit(ring,proj4);
   if(bng.areaM2<50||!Number.isFinite(bng.areaM2))throw Error('Site is invalid or too small');
   update();
   status('Site area calculated; loading real DEM and catchment data…');
   worker=new Worker(new URL('./parcel_generator_worker.js',import.meta.url));
   worker.onmessage=e=>{
    if(!root||current!==id||e.data.id!==id)return;
    if(e.data.type==='progress')status(e.data.message);
    if(e.data.type==='error')status(e.data.message,true);
    if(e.data.type==='done'){
     terrain=e.data.result;update();
     if(viewer?.getSource('pg-slopes')){
       viewer.getSource('pg-slopes').setData({type:'FeatureCollection',
        features:terrain.derivedPoints.map(p=>({type:'Feature',
         properties:{slopeDeg:p.slopeDeg,elevationM:p.elevationM,
         upstreamKm2:p.upstreamKm2},
         geometry:{type:'Point',coordinates:p.coordinates}}))});
     }
     status('STEP 01 complete: site area, elevation, slope and catchment context checked.'+
      '\nSoils and complete transport networks are not connected; random roads will not substitute for your design rules.');
    }
   };
   worker.onerror=e=>status('Terrain Worker failed: '+e.message,true);
   worker.postMessage({id,polygon:ring,
     demUrl:new URL(assetUrl('assets/drainage_area/dem50_log16.webp'),location.href).href,
     areaUrl:new URL(assetUrl('assets/drainage_area/area_log16.webp'),location.href).href,
     config:{bounds:demBounds,width:demWidth,height:demHeight}});
  }catch(error){if(id===current)status('Unable to complete STEP 01: '+(error.message||error),true);}
 }
 function open({polygon,roadNetwork=null}){
  exit();
  const finalMode=roadNetwork?.schema==='london-road-step05-v1'&&
    Array.isArray(roadNetwork.roadTopologyGraph?.edges)&&
    roadNetwork.roadTopologyGraph.edges.length>0;
  if(!polygon?.[0]||polygon[0].length<4)throw Error('Close the red site boundary first');
  ring=closeRing(polygon[0]);
  if(ring.some(p=>!p.every(Number.isFinite)))throw Error('Selected site has invalid geographic coordinates');
  validateSimpleBoundary(ring);
  root=document.createElement('div');root.className='pg';
  const style=document.createElement('style');style.textContent=STYLE;root.append(style);
  const steps=PIPELINE.map((step,i)=>'<button type="button" id="pg-step-'+(i+1)+
    '" class="pg-step '+((finalMode?i===5:i===0)?'on':'')+'" '+
    ((i!==0&&!(finalMode&&i===5))?'disabled':'')+
    '><strong>'+String(i+1).padStart(2,'0')+'</strong>　'+
    (i===4?'Generate and Optimise the Road Network':step[0])+
    ' <small>'+step[1]+'</small> '+
    (i===4?(finalMode?'· Completed in Hydro Lab':'· Complete in Hydro Lab first'):
      i===5&&finalMode?'· Road data received':i?'· Not implemented':'· Basic site information')+
    '</button>').join('');
  root.insertAdjacentHTML('beforeend',
   '<div class="pg-map" id="pg-map"></div>'+
   '<header class="pg-top"><div class="pg-brand">LONDON 2100 · PARCEL GENERATOR'+
   '<small>HYDRO — AGRI — TENSOR — WOOL / SITE PLANNING</small></div>'+
   '<span class="pg-badge" id="pg-active-step">'+
     (finalMode?'STEP 06 / 07 · PARCEL HANDOFF':'STEP 01 / 07 · SITE DATA')+'</span>'+
   '<button type="button" class="pg-exit" id="pg-exit">✕ Return to London Map (Esc)</button></header>'+
   '<nav class="pg-panel pg-left"><div class="pg-label">GENERATION PIPELINE</div>'+steps+
   '<div class="pg-section" id="pg-site-audit-panel"><div class="pg-label">STEP 01 · SITE AUDIT</div>'+
   '<p class="pg-note">Uses the actual selected polygon; does not invent parcels, roads or agricultural suitability scores.</p>'+
   '<div class="pg-stat"><small>Site area · EPSG:27700</small><b id="pg-area">Calculating…</b></div>'+
   '<div class="pg-line">Boundary perimeter <strong id="pg-perimeter">—</strong></div>'+
   '<p class="pg-note" id="pg-projection">Converting British National Grid coordinates…</p>'+
   '<div class="pg-section"><div class="pg-label">DATA STATUS</div>'+
   '<div class="pg-status" id="pg-status">Waiting for data checks…</div></div></div>'+
   '<section class="pg-section" id="pg-road-panel" hidden></section>'+
   '<section class="pg-section" id="pg-final-panel" hidden>'+
   '<div class="pg-label">STEP 06 · PARCEL SUBDIVISION · Input checks</div>'+
   '<p class="pg-note">Received the STEP 05 network from Hydro Lab. This step currently displays and validates outputs; final parcel cutting is not implemented.</p>'+
   '<div class="pg-stat"><small>Generated road centerlines</small><b id="pg-final-roadcount">—</b></div>'+
   '<div class="pg-line">Total road length <strong id="pg-final-length">—</strong></div>'+
   '<div class="pg-line">Topology nodes / edges <strong id="pg-final-topology">—</strong></div>'+
   '<div class="pg-line">Road surface strips <strong id="pg-final-strips">—</strong></div>'+
   '<div class="pg-line">Flood reserves <strong id="pg-final-flood">—</strong></div>'+
   '<button type="button" id="pg-final-export">↓ Export full STEP 05 package</button>'+
   '<p class="pg-note">STEP 06 must union and clip road footprints, extract genuinely enclosed blocks and assign residential, agricultural and wetland uses. Road strips are not already-subdivided parcels.</p>'+
   '</section></nav>'+
   '<aside class="pg-panel pg-right"><div class="pg-label">OS TERRAIN 50</div>'+
   '<div class="pg-stat"><small>Real elevation range</small><b id="pg-elev">—</b></div>'+
   '<div class="pg-stat"><small>DEM-derived mean slope</small><b id="pg-slope">—</b></div>'+
   '<div class="pg-line">Valid coverage <strong id="pg-coverage">—</strong></div>'+
   '<div class="pg-line">Catchment ≥1 km² <strong id="pg-drainage">—</strong></div>'+
   '<div class="pg-section"><div class="pg-label">Layers</div>'+
   '<label class="pg-option"><input type="checkbox" id="pg-slope-toggle" disabled>'+
   'Show DEM slope samples</label></div>'+
   '<div class="pg-section"><div class="pg-label">STEP 02 · AGRICULTURAL DEMAND (SCENARIO)</div>'+
   '<p class="pg-note">Preliminary agricultural demand inputs: explicitly stated assumptions are required without soils and crop-yield data; this is not suitability analysis.</p>'+
   '<label class="pg-field">Planning population<input id="pg-pop" type="number" min="1" step="1" placeholder="people"></label>'+
   '<label class="pg-field">Target food self-sufficiency<input id="pg-self" type="number" min="0" max="100" step="1" value="40">%</label>'+
   '<label class="pg-field">Annual food demand per person<input id="pg-food" type="number" min="0.1" step="1" placeholder="kg/person"></label>'+
   '<label class="pg-field">Annual edible crop yield<input id="pg-yield" type="number" min="0.01" step="0.1" placeholder="tonnes/ha"></label>'+
   '<div class="pg-stat"><small>Outdoor agricultural demand (assumed)</small><b id="pg-agri-area">Enter all parameters first</b></div>'+
   '<div class="pg-line">Share of site <strong id="pg-agri-share">—</strong></div>'+
   '<p class="pg-note" id="pg-agri-warning">Waiting for valid parameters.</p></div>'+
   '<div class="pg-section"><div class="pg-label">DATA PROVENANCE</div>'+
   '<table class="pg-sources">'+SOURCES.map(v=>
      '<tr><td>'+v[0]+'</td><td>'+v[1]+'</td></tr>').join('')+'</table>'+
   '<p class="pg-note">Coordinates are calculated in EPSG:27700 using an approximate OSGB36 Helmert transform. OSTN15 corrections are not loaded; do not use for survey-grade boundary setting.</p></div></aside>'+
   '<div class="pg-subtitle">Red outline = current real site · OSM roads and green space are basemap references only</div>'+
   '<footer class="pg-bottom"><button type="button" id="pg-open-road" '+(finalMode?'hidden':'')+'>View STEP 05 instructions</button>'+
   '<button type="button" id="pg-generate-shortcut" '+(finalMode?'hidden':'')+
      ' title="STEP 05 moved to Hydro Lab; generate there">STEP 05: return to Hydro Lab</button>'+
   '<button type="button" id="pg-fit-site">◎ Recenter on site</button>'+
   '<button type="button" id="pg-export">Export STEP 01</button>'+
   '<button disabled title="STEP 06 not yet developed">Generate Parcels</button>'+
   '<span class="pg-note" id="pg-footer-hint">STEP 05 can import site tensors from the left panel; drag to pan and scroll to zoom.</span></footer>');
  document.body.append(root);
  roadUI=createParcelRoadUI({root,getMap:()=>viewer,getRing:()=>ring,
    // Never replace a completed STEP05 graph with an older session tensor.
    autoHandoff:!finalMode,
    onStatus:(message,bad)=>{
      const hint=byId('pg-footer-hint');
      if(hint)hint.textContent=message;
      if(bad)console.warn('[Parcel STEP05]',message);
    }});
  roadUI.mount(byId('pg-road-panel'));
  const selectStep=number=>{
    const roads=number===5;
    byId('pg-road-panel').hidden=!roads;
    byId('pg-site-audit-panel').hidden=number!==1;
    byId('pg-final-panel').hidden=number!==6;
    byId('pg-active-step').textContent=number===6?'STEP 06 / 07 · PARCEL HANDOFF':
      roads?'STEP 05 / 07 · ROAD NETWORK':'STEP 01 / 07 · REAL DATA';
    for(const i of [1,5,6])byId('pg-step-'+i).classList.toggle('on',i===number);
    roadUI.setActive(number===6&&finalMode);
    if(number===6){
      byId('pg-footer-hint').textContent='Complete STEP 05 network received. STEP 06 subdivision has not been run.';
    }else if(roads){
      byId('pg-footer-hint').textContent='STEP 05 is now in Hydro Lab. Complete it after the tensor field before opening this page.';
    }else byId('pg-footer-hint').textContent='STEP 01 · real-site data. Drag the map and scroll to zoom.';
    // Resizing after a panel switch keeps the independent MapLibre canvas interactive.
    requestAnimationFrame(()=>viewer?.resize());
  };
  byId('pg-step-1').onclick=()=>selectStep(1);
  // STEP 05 calculations are now exclusively in the Hydro Lab workspace.
  byId('pg-open-road').onclick=()=>status('Return to Hydro Lab and complete STEP 05 after the hydrological tensor field.');
  byId('pg-generate-shortcut').onclick=()=>status('Road generation has moved to Hydro Lab; return there.');
  byId('pg-fit-site').onclick=fitSite;
  if(finalMode){
    byId('pg-final-roadcount').textContent=String(roadNetwork.diagnostics?.roadCount??0)+' roads';
    byId('pg-final-length').textContent=String(roadNetwork.diagnostics?.lengthKm??0)+' km';
    byId('pg-final-topology').textContent=
      String(roadNetwork.roadTopologyGraph?.nodes?.length??0)+' / '+
      String(roadNetwork.roadTopologyGraph?.edges?.length??0);
    byId('pg-final-strips').textContent=String(roadNetwork.roadPolygons?.features?.length??0);
    byId('pg-final-flood').textContent=
      String(roadNetwork.reservedFloodEcologicalCorridors?.features?.length??0)+' raster fragments';
    byId('pg-final-export').onclick=()=>{
      const blob=new Blob([JSON.stringify(roadNetwork,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='London_2100_STEP05_for_STEP06.json';
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    };
    roadUI.loadResult(roadNetwork);
  }
  for(const id of ['pg-pop','pg-self','pg-food','pg-yield'])byId(id)?.addEventListener('input',updateDemand);
  updateDemand();
  byId('pg-exit').onclick=exit;
  byId('pg-export').onclick=exportSite;
  byId('pg-slope-toggle').onchange=e=>{
   if(viewer?.getLayer('pg-slope'))
    viewer.setLayoutProperty('pg-slope','visibility',e.target.checked?'visible':'none');
  };
  document.addEventListener('keydown',key,true);
  try{
   viewer=new maplibregl.Map({container:byId('pg-map'),
     style:'https://tiles.openfreemap.org/styles/liberty',
     center:ring[0],zoom:15,pitch:0,antialias:true,
     dragPan:true,scrollZoom:true,doubleClickZoom:true,dragRotate:true,
     keyboard:true,touchZoomRotate:true,cooperativeGestures:false});
   viewer.dragPan.enable();viewer.scrollZoom.enable();
   viewer.dragRotate.enable();viewer.doubleClickZoom.enable();
   viewer.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
   viewer.once('load',()=>{
     addLayers();roadUI?.attachMap();viewer.resize();
   });
   viewer.on('error',error=>{
     console.warn('Parcel MapLibre:',error?.error||error);
   });
  }catch(e){status('Failed to create basemap: '+e.message,true);}
  // STEP 05 belongs to Hydro Lab. After completion this viewer receives the
  // resulting graph as STEP 06 input, without silently regenerating any roads.
  selectStep(finalMode?6:1);
  audit();
 }
 return {open,close:exit,get isOpen(){return Boolean(root);}};
}

