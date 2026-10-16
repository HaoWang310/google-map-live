
/* Parcel Generator — Stage 01. No road / parcel solution is claimed yet. */
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
 if(ring.length<4||ring.length>1000)throw Error('Site boundary needs 3–999 valid vertices');
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
  if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-9)throw Error('Site boundary has overlapping vertices or zero-length edges');
  for(let j=i+1;j<edges;j++){
   if(j===i+1||(i===0&&j===edges-1))continue;
   if(crosses(a,b,ring[j],ring[j+1]))throw Error('Site boundary intersects itself; return to the map and edit the control points');
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
.pg-map{position:absolute;inset:0}
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
@media(max-width:950px){.pg-left{width:240px}.pg-right{width:220px}}
@media(max-width:680px){.pg-left{width:43vw;left:4px;padding:8px}
 .pg-right{width:38vw;right:4px;padding:8px}.pg-panel{top:72px;bottom:115px}
 .pg-bottom{left:4px;right:4px;flex-wrap:wrap}.pg-stat b{font-size:15px}
 .pg-badge{display:none}}
`;
const PIPELINE=[
 ['Site Data','Real geographic data'],['Hydrology + Agriculture','Hydrology and farming demand'],
 ['Spatial Constraints','Combined spatial constraints'],['Tensor Field','Five direction tensor types'],
 ['Wool Road Generator','Path optimisation and topology'],['Parcel Subdivision','Real-geometry parcel division'],
 ['Performance','Performance and feedback']
];
const SOURCES=[
 ['OS Terrain 50','Real elevation source, using a locally preprocessed raster'],
 ['DEM slope','Derived from the elevation gradient, not an official measured slope'],
 ['Drainage accumulation','Terrain-derived catchment data, not real underground drains'],
 ['EA flood risk','Official long-term probability classes; not yet linked to road constraint calculation'],
 ['OpenStreetMap','Public basemap background; full road topology not yet fetched'],
 ['Soils and crop yields','Not connected: real farming suitability cannot be generated']
];
export function createParcelGenerator({maplibregl,assetUrl,demBounds,demWidth,demHeight}){
 let root=null,viewer=null,worker=null,current=0,ring=null,bng=null,terrain=null,demand=null;
 const byId=id=>get(root,'#'+id);
 function status(message,error=false){
  const el=byId('pg-status');if(el){el.textContent=message;el.classList.toggle('error',error);}
 }
 function exit(){
  current++;
  worker?.terminate();worker=null;
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
   setValue('pg-slope',terrain.meanSlopeDeg===null?'Invalid samples':terrain.meanSlopeDeg+'°');
   setValue('pg-coverage',terrain.coveragePercent+'%');
   setValue('pg-drainage',terrain.drainageAvailable?
      terrain.drainageCellsAbove1km2+' cells (≥1 km²)':'Data missing');
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
    'Needs population, annual consumption per person and annual crop yield per area from the user.':
    bng&&demand.requiredAreaM2>bng.areaM2?
    'Warning: the farmland this assumption needs is larger than the current site.':
    'Open-field farming demand estimate only; soil, sunlight and irrigation are not yet included.');
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
  viewer.fitBounds([[Math.min(...lng),Math.min(...lat)],[Math.max(...lng),Math.max(...lat)]],{
    padding:{top:100,bottom:90,left:330,right:290},maxZoom:17.5,duration:0
  });
 }
 async function audit(){
  const id=++current;
  try{
   status('Calculating real coordinates EPSG:27700 …');
   const module=await import('https://cdn.jsdelivr.net/npm/proj4@2.13.0/+esm');
   if(current!==id)return;
   const proj4=module.default||module;
   proj4.defs('EPSG:27700',CRS27700);
   bng=bngAudit(ring,proj4);
   if(bng.areaM2<50||!Number.isFinite(bng.areaM2))throw Error('Site invalid or too small');
   update();
   status('Site area calculated. Reading real elevation and catchment data…');
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
     status('STEP 01 complete: real site area, elevation, slope and catchment context checked.'+
      '\nSoil and the full transport network are not connected yet; a random road network will not replace your design rules.');
    }
   };
   worker.onerror=e=>status('Terrain Worker failed:'+e.message,true);
   worker.postMessage({id,polygon:ring,
     demUrl:new URL(assetUrl('assets/drainage_area/dem50_log16.webp'),location.href).href,
     areaUrl:new URL(assetUrl('assets/drainage_area/area_log16.webp'),location.href).href,
     config:{bounds:demBounds,width:demWidth,height:demHeight}});
  }catch(error){if(id===current)status('Could not finish STEP 01:'+(error.message||error),true);}
 }
 function open({polygon}){
  exit();
  if(!polygon?.[0]||polygon[0].length<4)throw Error('Close the red site outline first');
  ring=closeRing(polygon[0]);
  if(ring.some(p=>!p.every(Number.isFinite)))throw Error('Selected site has invalid coordinates');
  validateSimpleBoundary(ring);
  root=document.createElement('div');root.className='pg';
  const style=document.createElement('style');style.textContent=STYLE;root.append(style);
  const steps=PIPELINE.map((p,i)=>'<button type="button" class="pg-step '+(i===0?'on':'')+
    '" '+(i?'disabled':'')+'><strong>'+String(i+1).padStart(2,'0')+'</strong> '+
    p[0]+' <small>'+p[1]+'</small> '+(i?'· to do':'· current stage')+'</button>').join('');
  root.insertAdjacentHTML('beforeend',
   '<div class="pg-map" id="pg-map"></div>'+
   '<header class="pg-top"><div class="pg-brand">LONDON 2100 · PARCEL GENERATOR'+
   '<small>HYDRO — AGRI — TENSOR — WOOL / SITE PLANNING</small></div>'+
   '<span class="pg-badge">STEP 01 / 07 · REAL DATA</span>'+
   '<button type="button" class="pg-exit" id="pg-exit">✕ Back to London Map (Esc)</button></header>'+
   '<nav class="pg-panel pg-left"><div class="pg-label">GENERATION PIPELINE</div>'+steps+
   '<div class="pg-section"><div class="pg-label">STEP 01 · SITE AUDIT</div>'+
   '<p class="pg-note">Uses the real selected polygon; no made-up parcels, roads or farming suitability scores.</p>'+
   '<div class="pg-stat"><small>Site area · EPSG:27700</small><b id="pg-area">Calculating…</b></div>'+
   '<div class="pg-line">Boundary perimeter <strong id="pg-perimeter">—</strong></div>'+
   '<p class="pg-note" id="pg-projection">Converting to British National Grid coordinates…</p>'+
   '<div class="pg-section"><div class="pg-label">DATA STATUS</div>'+
   '<div class="pg-status" id="pg-status">Waiting for data check…</div></div></div></nav>'+
   '<aside class="pg-panel pg-right"><div class="pg-label">OS TERRAIN 50</div>'+
   '<div class="pg-stat"><small>Real elevation range</small><b id="pg-elev">—</b></div>'+
   '<div class="pg-stat"><small>DEM-derived mean slope</small><b id="pg-slope">—</b></div>'+
   '<div class="pg-line">Valid coverage <strong id="pg-coverage">—</strong></div>'+
   '<div class="pg-line">Catchment ≥1km² <strong id="pg-drainage">—</strong></div>'+
   '<div class="pg-section"><div class="pg-label">Layers</div>'+
   '<label class="pg-option"><input type="checkbox" id="pg-slope-toggle" disabled>'+
   'DEM slope sample display</label></div>'+
   '<div class="pg-section"><div class="pg-label">STEP 02 · AGRICULTURAL DEMAND (SCENARIO)</div>'+
   '<p class="pg-note">Farming demand inputs: without real soil and crop yield data the user states the assumptions; this is not a suitability analysis.</p>'+
   '<label class="pg-field">Planned population served<input id="pg-pop" type="number" min="1" step="1" placeholder="people"></label>'+
   '<label class="pg-field">Target food self-sufficiency<input id="pg-self" type="number" min="0" max="100" step="1" value="40">%</label>'+
   '<label class="pg-field">Annual food demand per person<input id="pg-food" type="number" min="0.1" step="1" placeholder="kg/person"></label>'+
   '<label class="pg-field">Annual edible yield<input id="pg-yield" type="number" min="0.01" step="0.1" placeholder="tonnes/ha"></label>'+
   '<div class="pg-stat"><small>Open-field farming demand (user assumption)</small><b id="pg-agri-area">Enter all parameters first</b></div>'+
   '<div class="pg-line">Share of current site <strong id="pg-agri-share">—</strong></div>'+
   '<p class="pg-note" id="pg-agri-warning">Waiting for valid parameters.</p></div>'+
   '<div class="pg-section"><div class="pg-label">DATA PROVENANCE</div>'+
   '<table class="pg-sources">'+SOURCES.map(v=>
      '<tr><td>'+v[0]+'</td><td>'+v[1]+'</td></tr>').join('')+'</table>'+
   '<p class="pg-note">Coordinates calculated in EPSG:27700 using the OSGB36 Helmert approximation without the OSTN15 correction grid; not for survey-grade boundaries.</p></div></aside>'+
   '<div class="pg-subtitle">Red outline = current real site · OSM roads and green space are basemap reference only</div>'+
   '<footer class="pg-bottom"><button type="button" id="pg-export">Export STEP01 GeoJSON</button>'+
   '<button disabled title="No tensor field, road constraints or Wool solver yet">Generate Road Network</button>'+
   '<button disabled title="No valid road network or protection boundary yet">Generate Parcels</button>'+
   '<button disabled>Compare Scenarios</button>'+
   '<span class="pg-note">Staged development: check the data first, then generate roads and parcels with traceable reasoning.</span></footer>');
  document.body.append(root);
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
     center:ring[0],zoom:15,pitch:0,antialias:true});
   viewer.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
   viewer.once('load',addLayers);
  }catch(e){status('Basemap failed to create:'+e.message,true);}
  audit();
 }
 return {open,close:exit,get isOpen(){return Boolean(root);}};
}
