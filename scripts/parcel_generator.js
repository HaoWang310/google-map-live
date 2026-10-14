
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
function bngAudit(ring,proj4){
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
@media(max-width:950px){.pg-left{width:240px}.pg-right{width:220px}}
@media(max-width:680px){.pg-left{width:43vw;left:4px;padding:8px}
 .pg-right{width:38vw;right:4px;padding:8px}.pg-panel{top:72px;bottom:115px}
 .pg-bottom{left:4px;right:4px;flex-wrap:wrap}.pg-stat b{font-size:15px}
 .pg-badge{display:none}}
`;
const PIPELINE=[
 ['Site Data','真实地理数据'],['Hydrology + Agriculture','水文及农业需求'],
 ['Spatial Constraints','综合空间约束'],['Tensor Field','五类方向张量'],
 ['Wool Road Generator','路径优化与拓扑'],['Parcel Subdivision','真实几何地块分割'],
 ['Performance','性能与反馈']
];
const SOURCES=[
 ['OS Terrain 50','真实高程来源，使用本地预处理栅格'],
 ['DEM slope','从高程数值梯度推导，非官方实测坡度'],
 ['Drainage accumulation','地形推导的汇水数据，非真实地下管网'],
 ['EA flood risk','官方长期概率分类，尚未接入道路约束计算'],
 ['OpenStreetMap','公开底图背景，尚未完成全站道路拓扑获取'],
 ['Soils and crop yields','未接入：不可生成所谓真实农业适宜性']
];
export function createParcelGenerator({maplibregl,assetUrl,demBounds,demWidth,demHeight}){
 let root=null,viewer=null,worker=null,current=0,ring=null,bng=null,terrain=null;
 const byId=id=>get(root,'#'+id);
 function status(message,error=false){
  const el=byId('pg-status');if(el){el.textContent=message;el.classList.toggle('error',error);}
 }
 function exit(){
  current++;
  worker?.terminate();worker=null;
  viewer?.remove();viewer=null;
  root?.remove();root=null;ring=null;bng=null;terrain=null;
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
  }
  if(terrain){
   setValue('pg-elev',terrain.minElevationM+'–'+terrain.maxElevationM+' m');
   setValue('pg-slope',terrain.meanSlopeDeg===null?'无效样本':terrain.meanSlopeDeg+'°');
   setValue('pg-coverage',terrain.coveragePercent+'%');
   setValue('pg-drainage',terrain.drainageAvailable?
      terrain.drainageCellsAbove1km2+' 栅格（≥1 km²）':'缺少数据');
   const cb=byId('pg-slope-toggle');if(cb)cb.disabled=!terrain.derivedPoints.length;
  }
 }
 function exportSite(){
  if(!ring||!bng)return;
  const result={type:'FeatureCollection',
   properties:{phase:'STEP 01',computationCRS:'EPSG:27700',
   areaM2:bng.areaM2,perimeterM:bng.perimeterM,terrainStats:terrain,
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
   status('正在核算真实坐标 EPSG:27700 …');
   const module=await import('https://cdn.jsdelivr.net/npm/proj4@2.13.0/+esm');
   if(current!==id)return;
   const proj4=module.default||module;
   proj4.defs('EPSG:27700',CRS27700);
   bng=bngAudit(ring,proj4);
   if(bng.areaM2<50||!Number.isFinite(bng.areaM2))throw Error('地块无效或面积过小');
   update();
   status('地块面积已核算。正在读取真实高程和汇水数据…');
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
     status('STEP 01 完成：真实地块面积、高程、坡度和汇水背景已校核。'+
      '\n土壤与完整交通网络尚未接入；不会以随机路网代替你的设计规则。');
    }
   };
   worker.onerror=e=>status('地形 Worker 运行失败：'+e.message,true);
   worker.postMessage({id,polygon:ring,
     demUrl:new URL(assetUrl('assets/drainage_area/dem50_log16.webp'),location.href).href,
     areaUrl:new URL(assetUrl('assets/drainage_area/area_log16.webp'),location.href).href,
     config:{bounds:demBounds,width:demWidth,height:demHeight}});
  }catch(error){if(id===current)status('无法完成 STEP 01：'+(error.message||error),true);}
 }
 function open({polygon}){
  exit();
  if(!polygon?.[0]||polygon[0].length<4)throw Error('请先闭合红框地块');
  ring=closeRing(polygon[0]);
  if(ring.some(p=>!p.every(Number.isFinite)))throw Error('所选地块地理坐标无效');
  root=document.createElement('div');root.className='pg';
  const style=document.createElement('style');style.textContent=STYLE;root.append(style);
  const steps=PIPELINE.map((p,i)=>'<button type="button" class="pg-step '+(i===0?'on':'')+
    '" '+(i?'disabled':'')+'><strong>'+String(i+1).padStart(2,'0')+'</strong>　'+
    p[0]+' <small>'+p[1]+'</small> '+(i?'· 待实现':'· 当前阶段')+'</button>').join('');
  root.insertAdjacentHTML('beforeend',
   '<div class="pg-map" id="pg-map"></div>'+
   '<header class="pg-top"><div class="pg-brand">LONDON 2100 · PARCEL GENERATOR'+
   '<small>HYDRO — AGRI — TENSOR — WOOL / SITE PLANNING</small></div>'+
   '<span class="pg-badge">STEP 01 / 07 · REAL DATA</span>'+
   '<button type="button" class="pg-exit" id="pg-exit">✕ 返回 London Map (Esc)</button></header>'+
   '<nav class="pg-panel pg-left"><div class="pg-label">GENERATION PIPELINE</div>'+steps+
   '<div class="pg-section"><div class="pg-label">STEP 01 · SITE AUDIT</div>'+
   '<p class="pg-note">使用已圈选的真实多边形；不生成虚构地块、道路或农业适宜性评分。</p>'+
   '<div class="pg-stat"><small>场地面积 · EPSG:27700</small><b id="pg-area">核算中…</b></div>'+
   '<div class="pg-line">边界周长 <strong id="pg-perimeter">—</strong></div>'+
   '<p class="pg-note" id="pg-projection">正在转换英国国家格网坐标…</p>'+
   '<div class="pg-section"><div class="pg-label">DATA STATUS</div>'+
   '<div class="pg-status" id="pg-status">等待数据检查…</div></div></div></nav>'+
   '<aside class="pg-panel pg-right"><div class="pg-label">OS TERRAIN 50</div>'+
   '<div class="pg-stat"><small>真实高程范围</small><b id="pg-elev">—</b></div>'+
   '<div class="pg-stat"><small>DEM 推导平均坡度</small><b id="pg-slope">—</b></div>'+
   '<div class="pg-line">有效覆盖率 <strong id="pg-coverage">—</strong></div>'+
   '<div class="pg-line">汇水 ≥1km² <strong id="pg-drainage">—</strong></div>'+
   '<div class="pg-section"><div class="pg-label">图层</div>'+
   '<label class="pg-option"><input type="checkbox" id="pg-slope-toggle" disabled>'+
   'DEM 坡度采样显示</label></div>'+
   '<div class="pg-section"><div class="pg-label">DATA PROVENANCE</div>'+
   '<table class="pg-sources">'+SOURCES.map(v=>
      '<tr><td>'+v[0]+'</td><td>'+v[1]+'</td></tr>').join('')+'</table>'+
   '<p class="pg-note">坐标计算为 EPSG:27700。当前采用 OSGB36 Helmert 近似，未加载 OSTN15 校正格网，不能用于测绘级定界。</p></div></aside>'+
   '<div class="pg-subtitle">红色范围 = 当前真实场地 · OSM 道路与绿地仅作基础地图参照</div>'+
   '<footer class="pg-bottom"><button type="button" id="pg-export">导出 STEP01 GeoJSON</button>'+
   '<button disabled title="尚未有张量场、道路约束和 Wool 求解器">Generate Road Network</button>'+
   '<button disabled title="尚未建立有效路网与保护边界">Generate Parcels</button>'+
   '<button disabled>Compare Scenarios</button>'+
   '<span class="pg-note">阶段开发：首先检查数据，再生成具有可追溯依据的道路及地块。</span></footer>');
  document.body.append(root);
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
  }catch(e){status('底图创建失败：'+e.message,true);}
  audit();
 }
 return {open,close:exit,get isOpen(){return Boolean(root);}};
}
