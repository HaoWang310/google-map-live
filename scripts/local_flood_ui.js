import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.17.1';

const SEL_SOURCE='local-flood-selection-source';
const SEL_FILL='local-flood-selection-fill';
const SEL_LINE='local-flood-selection-line';
const SEL_POINTS='local-flood-selection-points';
const WATER_SOURCE='local-flood-water-source';
const WATER_LAYER='local-flood-water-layer';
const IMPACT_SOURCE='local-flood-impact-source';
const IMPACT_LAYER='local-flood-impact-layer';
const R=6378137;

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function mercator(lng,lat){
  const lon=lng*Math.PI/180;
  const phi=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return [R*lon,R*Math.log(Math.tan(Math.PI/4+phi/2))];
}

function ringAreaM2(ring){
  let area=0;
  const pts=ring.map(([lng,lat])=>mercator(lng,lat));
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    area+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1];
  }
  return Math.abs(area)/2;
}

function bboxLngLat(ring){
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const [lng,lat] of ring){
    if(lng<west)west=lng;if(lng>east)east=lng;if(lat<south)south=lat;if(lat>north)north=lat;
  }
  return {west,east,south,north};
}

function geometryBBox(geometry){
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  const visit=coords=>{
    if(typeof coords?.[0]==='number'){
      const [lng,lat]=coords;
      if(lng<west)west=lng;if(lng>east)east=lng;if(lat<south)south=lat;if(lat>north)north=lat;
      return;
    }
    for(const c of coords||[])visit(c);
  };
  visit(geometry?.coordinates);
  return {west,east,south,north};
}

function boxesIntersect(a,b){
  return !(a.east<b.west||a.west>b.east||a.north<b.south||a.south>b.north);
}

function featureKey(feature){
  if(feature.id!==undefined&&feature.id!==null)return 'id:'+feature.id;
  const b=geometryBBox(feature.geometry);
  const h=Number(feature.properties?.render_height)||0;
  return [b.west,b.south,b.east,b.north,h].map(v=>Number(v).toFixed(6)).join('|');
}

function onceIdle(map,timeout=2200){
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);map.off('idle',finish);resolve();};
    const timer=setTimeout(finish,timeout);
    map.on('idle',finish);
  });
}

export function createLocalFloodUI({
  map,maplibregl,assetUrl,demBounds,demWidth,demHeight,
  ensureCityBuildings,setCityView,getFirstSymbolLayerId,cityBuildingsLayerId
}){
  let drawing=false;
  let vertices=[];
  let polygon=null;
  let prepared=false;
  let selectedBuildings=[];
  let buildingById=new Map();
  let canvas=null;
  let canvasContext=null;
  let simulator=null;
  let setupInfo=null;

  const status=(message,error=false)=>{
    $('localFloodStatus').textContent=message;
    $('localFloodStatus').className='layerStatus'+(error?' error':'');
  };

  function ensureSelectionLayers(){
    if(!map.getSource(SEL_SOURCE)){
      map.addSource(SEL_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    }
    if(!map.getLayer(SEL_FILL)){
      map.addLayer({
        id:SEL_FILL,type:'fill',source:SEL_SOURCE,
        filter:['==',['geometry-type'],'Polygon'],
        paint:{'fill-color':'#60a5fa','fill-opacity':0.08}
      });
    }
    if(!map.getLayer(SEL_LINE)){
      map.addLayer({
        id:SEL_LINE,type:'line',source:SEL_SOURCE,
        filter:['in',['geometry-type'],['literal',['LineString','Polygon']]],
        paint:{'line-color':'#60a5fa','line-width':2.2,'line-dasharray':[2,1]}
      });
    }
    if(!map.getLayer(SEL_POINTS)){
      map.addLayer({
        id:SEL_POINTS,type:'circle',source:SEL_SOURCE,
        filter:['==',['geometry-type'],'Point'],
        paint:{'circle-radius':4,'circle-color':'#ffffff','circle-stroke-color':'#2563eb','circle-stroke-width':2}
      });
    }
  }

  function updateSelection(){
    ensureSelectionLayers();
    const features=[];
    if(vertices.length>=3){
      const ring=[...vertices,vertices[0]];
      features.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}});
    }else if(vertices.length>=2){
      features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:vertices}});
    }
    for(const point of vertices){
      features.push({type:'Feature',properties:{},geometry:{type:'Point',coordinates:point}});
    }
    map.getSource(SEL_SOURCE)?.setData({type:'FeatureCollection',features});
  }

  function setButtons(){
    $('localFloodFinish').disabled=!drawing||vertices.length<3;
    $('localFloodRun').disabled=!prepared;
    $('localFloodPause').disabled=!prepared;
    $('localFloodReset').disabled=!prepared;
  }

  function removeWaterLayers(){
    if(map.getLayer(IMPACT_LAYER))map.removeLayer(IMPACT_LAYER);
    if(map.getSource(IMPACT_SOURCE))map.removeSource(IMPACT_SOURCE);
    if(map.getLayer(WATER_LAYER))map.removeLayer(WATER_LAYER);
    if(map.getSource(WATER_SOURCE))map.removeSource(WATER_SOURCE);
    if(canvas){canvas.remove();canvas=null;canvasContext=null;}
  }

  function clearSimulation(keepSelection=false){
    simulator?.pause();
    prepared=false;setupInfo=null;selectedBuildings=[];buildingById.clear();
    removeWaterLayers();
    if(!keepSelection){
      drawing=false;vertices=[];polygon=null;
      map.getSource(SEL_SOURCE)?.setData({type:'FeatureCollection',features:[]});
    }
    $('localFloodStats').textContent='尚未运行';
    setButtons();
  }

  function startDrawing(){
    clearSimulation(false);
    drawing=true;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor='crosshair';
    status('圈选模式：在地图上逐点点击边界；至少 3 个点后点击“完成范围”或按 Enter。');
    setButtons();
  }

  async function finishDrawing(){
    if(!drawing||vertices.length<3)return;
    drawing=false;
    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor='';
    const ring=[...vertices,vertices[0]];
    polygon=[ring];
    updateSelection();
    setButtons();
    await prepareSimulation();
  }

  function normaliseBuilding(feature,id){
    const props=feature.properties||{};
    const height=Math.max(2,Number(props.render_height)||Number(props.height)||5);
    const base=Math.max(0,Number(props.render_min_height)||Number(props.min_height)||0);
    return {
      id,
      geometry:feature.geometry,
      feature:{
        type:'Feature',
        properties:{_simId:id,simHeight:height,simBase:base},
        geometry:feature.geometry
      }
    };
  }

  function queryBuildings(bounds){
    ensureCityBuildings();
    const style=map.getStyle();
    const buildingLayer=(style?.layers||[]).find(layer=>layer['source-layer']==='building');
    const source=buildingLayer?.source;
    if(!source)return [];

    let raw=[];
    try{raw=map.querySourceFeatures(source,{sourceLayer:'building'})||[];}
    catch(error){console.warn('Building query failed',error);return [];}

    const seen=new Set(),out=[];
    for(const feature of raw){
      if(!feature.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))continue;
      if(!boxesIntersect(bounds,geometryBBox(feature.geometry)))continue;
      const key=featureKey(feature);
      if(seen.has(key))continue;
      seen.add(key);
      out.push(feature);
    }
    return out;
  }

  function ensureSimulator(){
    if(simulator)return simulator;
    simulator=createLocalFloodSimulator({
      demUrl:new URL(assetUrl('assets/drainage_area/dem50_log16.webp'),location.href).href,
      demBounds,
      demWidth,
      demHeight,
      demEncoding:{minimum:-100,step:0.1},
      onFrame:handleFrame,
      onStatus:data=>{
        if(data.state==='running')status('模拟运行中：雨水沿 50 m 地形势能流动，OSM 建筑作为不可穿透障碍。');
        else if(data.state==='paused')status('模拟已暂停。');
        else if(data.state==='complete')status('模拟完成。可调整降雨参数后“重置水体”再运行。');
      },
      onError:error=>status(error.message,true)
    });
    return simulator;
  }

  function ensureWaterLayer(info){
    removeWaterLayers();
    canvas=document.createElement('canvas');
    canvas.id='localFloodCanvas';
    canvas.width=info.cols;canvas.height=info.rows;
    canvas.style.cssText='position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none';
    document.body.appendChild(canvas);
    canvasContext=canvas.getContext('2d');

    map.addSource(WATER_SOURCE,{
      type:'canvas',
      canvas:canvas.id,
      animate:true,
      coordinates:info.boundsLngLat
    });
    map.addLayer({
      id:WATER_LAYER,type:'raster',source:WATER_SOURCE,
      paint:{'raster-opacity':0.86,'raster-resampling':'linear','raster-fade-duration':0}
    },map.getLayer(cityBuildingsLayerId)?cityBuildingsLayerId:getFirstSymbolLayerId());

    map.addSource(IMPACT_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({
      id:IMPACT_LAYER,type:'fill-extrusion',source:IMPACT_SOURCE,
      paint:{
        'fill-extrusion-color':'#ff5a36',
        'fill-extrusion-height':['get','simHeight'],
        'fill-extrusion-base':['get','simBase'],
        'fill-extrusion-opacity':0.9
      }
    },getFirstSymbolLayerId());
  }

  async function prepareSimulation(){
    if(!polygon)return;
    const ring=polygon[0];
    const bounds=bboxLngLat(ring);
    const area=ringAreaM2(ring);
    if(area<5000){status('圈选范围太小，请至少圈选约 5,000 m²。',true);return;}
    if(area>60_000_000){status('圈选范围过大，请控制在约 60 km² 内。',true);return;}

    status('正在准备模拟：放大选区并读取当前 OSM 建筑轮廓…');
    map.fitBounds([[bounds.west,bounds.south],[bounds.east,bounds.north]],{
      padding:55,maxZoom:16.2,duration:500
    });
    await onceIdle(map);
    selectedBuildings=queryBuildings(bounds);

    buildingById.clear();
    const buildings=selectedBuildings.map((feature,id)=>{
      const item=normaliseBuilding(feature,id);
      buildingById.set(id,item.feature);
      return {id,geometry:item.geometry};
    });

    try{
      const info=await ensureSimulator().setup({polygon,buildings});
      setupInfo=info;
      prepared=true;
      ensureWaterLayer(info);
      setCityView(true);
      $('localFloodGridInfo').textContent=
        info.cellSizeM+' m 网格 · '+info.buildingCount+' 栋建筑';
      status(
        '范围已就绪：'+(area/1e6).toFixed(2)+' km² · 模拟网格 '+info.cols+'×'+info.rows+
        '（'+info.cellSizeM+' m）· OSM 建筑 '+info.buildingCount+'。'
      );
      setButtons();
    }catch(error){
      prepared=false;setButtons();
      status(error.message,true);
    }
  }

  function handleFrame(data){
    if(!canvas||!canvasContext)return;
    const pixels=new Uint8ClampedArray(data.pixels);
    if(canvas.width!==data.width||canvas.height!==data.height){
      canvas.width=data.width;canvas.height=data.height;
    }
    canvasContext.putImageData(new ImageData(pixels,data.width,data.height),0,0);
    map.triggerRepaint();

    const features=[];
    for(const id of data.impactedIds||[]){
      const feature=buildingById.get(id);
      if(feature)features.push(feature);
    }
    map.getSource(IMPACT_SOURCE)?.setData({type:'FeatureCollection',features});

    const s=data.stats;
    $('localFloodStats').textContent=
      't '+s.timeMin.toFixed(1)+' min · 最大水深 '+s.maxDepthM.toFixed(2)+' m · '+
      '积水 '+(s.wetAreaM2/10000).toFixed(2)+' ha · 影响建筑 '+s.impactedCount;
  }

  function currentParams(){
    return {
      rainfall:Number($('localFloodRain').value),
      infiltration:Number($('localFloodInfil').value),
      duration:Number($('localFloodDuration').value),
      openBoundary:true
    };
  }

  function updateParamLabels(){
    $('localFloodRainValue').textContent=$('localFloodRain').value+' mm/h';
    $('localFloodInfilValue').textContent=$('localFloodInfil').value+' mm/h';
    $('localFloodDurationValue').textContent=$('localFloodDuration').value+' min';
    simulator?.setParams(currentParams());
  }

  map.on('click',event=>{
    if(!drawing)return;
    vertices.push([event.lngLat.lng,event.lngLat.lat]);
    updateSelection();setButtons();
  });

  map.on('dblclick',event=>{
    if(!drawing)return;
    event.originalEvent?.preventDefault?.();
    if(vertices.length>=3)finishDrawing();
  });

  const keydown=event=>{
    const tag=event.target?.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
    if(!drawing)return;
    if(event.key==='Enter'){event.preventDefault();finishDrawing();}
    if(event.key==='Escape'){
      event.preventDefault();drawing=false;vertices=[];polygon=null;updateSelection();
      map.doubleClickZoom.enable();map.getCanvas().style.cursor='';
      status('圈选已取消。');setButtons();
    }
  };
  document.addEventListener('keydown',keydown);

  $('localFloodDraw').addEventListener('click',startDrawing);
  $('localFloodFinish').addEventListener('click',finishDrawing);
  $('localFloodClear').addEventListener('click',()=>{
    clearSimulation(false);
    status('已清除局部洪涝模拟。');
  });
  $('localFloodRun').addEventListener('click',()=>{
    if(!prepared)return;
    setCityView(true);
    ensureSimulator().start(currentParams());
  });
  $('localFloodPause').addEventListener('click',()=>simulator?.pause());
  $('localFloodReset').addEventListener('click',()=>{
    simulator?.reset();
    map.getSource(IMPACT_SOURCE)?.setData({type:'FeatureCollection',features:[]});
  });
  for(const id of ['localFloodRain','localFloodInfil','localFloodDuration']){
    $(id).addEventListener('input',updateParamLabels);
  }

  ensureSelectionLayers();
  updateParamLabels();
  setButtons();
  status('先点击“圈选区域”，在地图中画出局部模拟范围。');

  return {
    clear:()=>clearSimulation(false),
    destroy(){
      clearSimulation(false);
      simulator?.destroy();simulator=null;
      document.removeEventListener('keydown',keydown);
    }
  };
}
