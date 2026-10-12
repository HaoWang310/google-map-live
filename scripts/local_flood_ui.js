import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.20.6';
import * as polygonClippingModule from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
const polygonClipping=polygonClippingModule.default||polygonClippingModule;

const SEL_SOURCE='local-flood-selection-source';
const SEL_FILL='local-flood-selection-fill';
const SEL_LINE='local-flood-selection-line';
const SEL_POINTS='local-flood-selection-points';
const SEL_DISTANCE='local-flood-selection-distance';
const WATER_SOURCE='local-flood-water-source';
const WATER_LAYER='local-flood-water-layer';
const BUILDING_SCENE_SOURCE='local-flood-building-scene-source';
const BUILDING_SCENE_FILL='local-flood-building-scene-fill';
const BUILDING_SCENE_3D='local-flood-building-scene-3d';
const R=6378137;

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function mercator(lng,lat){
  const lon=lng*Math.PI/180;
  const phi=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return [R*lon,R*Math.log(Math.tan(Math.PI/4+phi/2))];
}

function geodesicDistanceM(a,b){
  const earthRadius=6371008.8;
  const lat1=a[1]*Math.PI/180;
  const lat2=b[1]*Math.PI/180;
  const dLat=(b[1]-a[1])*Math.PI/180;
  const dLng=(b[0]-a[0])*Math.PI/180;
  const h=
    Math.sin(dLat/2)*Math.sin(dLat/2)+
    Math.cos(lat1)*Math.cos(lat2)*
    Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*earthRadius*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}

function edgeMidpoint(a,b){
  const [ax,ay]=mercator(a[0],a[1]);
  const [bx,by]=mercator(b[0],b[1]);
  return unmercator((ax+bx)/2,(ay+by)/2);
}

function formatEdgeDistance(metres){
  if(metres>=1000)return (metres/1000).toFixed(metres>=10000?1:2)+' km';
  if(metres>=100)return Math.round(metres)+' m';
  return metres.toFixed(1)+' m';
}

function unmercator(x,y){
  const lng=x/R*180/Math.PI;
  const lat=(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI;
  return [lng,lat];
}

function closeRing(ring){
  if(!ring?.length)return ring||[];
  const first=ring[0],last=ring[ring.length-1];
  if(first[0]===last[0]&&first[1]===last[1])return ring;
  return [...ring,first];
}

function geometryToLocalClipInput(geometry,origin){
  const toXY=([lng,lat])=>{
    const [x,y]=mercator(lng,lat);
    return [x-origin[0],y-origin[1]];
  };
  const mapPolygon=polygon=>(polygon||[]).map(ring=>closeRing(ring).map(toXY));
  if(geometry?.type==='Polygon')return mapPolygon(geometry.coordinates);
  if(geometry?.type==='MultiPolygon')return (geometry.coordinates||[]).map(mapPolygon);
  return [];
}

function selectionToLocalClipInput(selectionRing,origin){
  return [closeRing(selectionRing).map(([lng,lat])=>{
    const [x,y]=mercator(lng,lat);
    return [x-origin[0],y-origin[1]];
  })];
}

function clipOutputToGeometry(multiPolygon,origin){
  if(!Array.isArray(multiPolygon)||!multiPolygon.length)return null;
  const toLngLat=([x,y])=>unmercator(x+origin[0],y+origin[1]);
  const polygons=multiPolygon
    .filter(poly=>Array.isArray(poly)&&poly.length)
    .map(poly=>poly.map(ring=>closeRing(ring.map(toLngLat))));
  if(!polygons.length)return null;
  return polygons.length===1
    ?{type:'Polygon',coordinates:polygons[0]}
    :{type:'MultiPolygon',coordinates:polygons};
}

function splitBuildingBySelection(geometry,selectionRing){
  if(!geometry||!selectionRing?.length)return {inside:null,outside:geometry};
  const origin=mercator(selectionRing[0][0],selectionRing[0][1]);
  const subject=geometryToLocalClipInput(geometry,origin);
  const clip=selectionToLocalClipInput(selectionRing,origin);
  if(!subject?.length||!clip?.length)return {inside:null,outside:geometry};

  try{
    const insideRaw=polygonClipping.intersection(subject,clip);
    const outsideRaw=polygonClipping.difference(subject,clip);
    return {
      inside:clipOutputToGeometry(insideRaw,origin),
      outside:clipOutputToGeometry(outsideRaw,origin)
    };
  }catch(error){
    console.warn('Building polygon clip failed',error);
    return {inside:null,outside:geometry};
  }
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

function pointInRingLngLat(point,ring){
  const [x,y]=point;
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    const hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}

function orientation(a,b,c){
  const value=(b[1]-a[1])*(c[0]-b[0])-(b[0]-a[0])*(c[1]-b[1]);
  if(Math.abs(value)<1e-12)return 0;
  return value>0?1:2;
}

function onSegment(a,b,c){
  return b[0]<=Math.max(a[0],c[0])+1e-12&&b[0]>=Math.min(a[0],c[0])-1e-12&&
         b[1]<=Math.max(a[1],c[1])+1e-12&&b[1]>=Math.min(a[1],c[1])-1e-12;
}

function segmentsIntersect(a,b,c,d){
  const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
  if(o1!==o2&&o3!==o4)return true;
  if(o1===0&&onSegment(a,c,b))return true;
  if(o2===0&&onSegment(a,d,b))return true;
  if(o3===0&&onSegment(c,a,d))return true;
  if(o4===0&&onSegment(c,b,d))return true;
  return false;
}

function ringEdgesIntersect(a,b){
  for(let i=1;i<a.length;i++){
    for(let j=1;j<b.length;j++){
      if(segmentsIntersect(a[i-1],a[i],b[j-1],b[j]))return true;
    }
  }
  return false;
}

function geometryWithinSelection(geometry,selectionRing){
  const polygons=geometry?.type==='Polygon'
    ?[geometry.coordinates]
    :geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  if(!polygons.length)return false;
  for(const polygon of polygons){
    const outer=polygon?.[0];
    if(!outer?.length)return false;
    const points=outer.length>1&&
      outer[0][0]===outer[outer.length-1][0]&&outer[0][1]===outer[outer.length-1][1]
      ?outer.slice(0,-1):outer;
    if(!points.every(point=>pointInRingLngLat(point,selectionRing)))return false;
    if(ringEdgesIntersect(outer,selectionRing))return false;
  }
  return true;
}

function featureKey(feature){
  const b=geometryBBox(feature.geometry);
  const h=Number(feature.properties?.render_height)||Number(feature.properties?.height)||0;
  return [b.west,b.south,b.east,b.north,h]
    .map(v=>Number(v).toFixed(6)).join('|');
}

function geometryPolygons(geometry){
  if(!geometry)return [];
  if(geometry.type==='Polygon')return [geometry.coordinates];
  if(geometry.type==='MultiPolygon')return geometry.coordinates;
  return [];
}

function mergeBuildingFragments(id,fragments){
  const polygons=[];
  let maxHeight=5;
  let minBase=0;
  let firstProps={};
  const seenGeometry=new Set();

  for(const feature of fragments){
    firstProps=feature.properties||firstProps;
    maxHeight=Math.max(
      maxHeight,
      Number(feature.properties?.render_height)||Number(feature.properties?.height)||5
    );
    minBase=Math.min(
      minBase,
      Number(feature.properties?.render_min_height)||Number(feature.properties?.min_height)||0
    );

    const gKey=featureKey(feature);
    if(seenGeometry.has(gKey))continue;
    seenGeometry.add(gKey);
    for(const polygon of geometryPolygons(feature.geometry))polygons.push(polygon);
  }

  if(!polygons.length)return null;
  return {
    type:'Feature',
    id,
    properties:{
      ...firstProps,
      render_height:maxHeight,
      render_min_height:minBase
    },
    geometry:polygons.length===1
      ?{type:'Polygon',coordinates:polygons[0]}
      :{type:'MultiPolygon',coordinates:polygons}
  };
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
  ensureCityBuildings,setCityView,getFirstSymbolLayerId,cityBuildingsLayerId,
  setCityBuildingFloodSelection
}){
  let drawing=false;
  let editingSelection=false;
  let selectionDirty=false;
  let isPreparingSelection=false;
  let dragVertexIndex=-1;
  let dragPanWasEnabled=true;
  let vertices=[];
  let polygon=null;
  let prepared=false;
  let selectedBuildings=[];
  let buildingById=new Map();
  let impactedStateIds=new Set();
  let buildingSourceId=null;
  let buildingSourceLayer='building';
  let sceneFeatures=new Map();
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
        paint:{'fill-color':'#ef4444','fill-opacity':0.035}
      });
    }
    if(!map.getLayer(SEL_LINE)){
      map.addLayer({
        id:SEL_LINE,type:'line',source:SEL_SOURCE,
        filter:['in',['geometry-type'],['literal',['LineString','Polygon']]],
        paint:{'line-color':'#ef4444','line-width':2.6,'line-dasharray':[2,1]}
      });
    }
    if(!map.getLayer(SEL_POINTS)){
      map.addLayer({
        id:SEL_POINTS,type:'circle',source:SEL_SOURCE,
        filter:['all',
          ['==',['geometry-type'],'Point'],
          ['has','vertexIndex']
        ],
        paint:{
          'circle-radius':7,
          'circle-color':'#ffffff',
          'circle-stroke-color':'#ef4444',
          'circle-stroke-width':3
        }
      });
    }
    if(!map.getLayer(SEL_DISTANCE)){
      map.addLayer({
        id:SEL_DISTANCE,
        type:'symbol',
        source:SEL_SOURCE,
        filter:['all',
          ['==',['geometry-type'],'Point'],
          ['has','distanceLabel']
        ],
        layout:{
          'text-field':['get','distanceLabel'],
          'text-size':13,
          'text-font':['Noto Sans Regular'],
          'text-allow-overlap':false,
          'text-ignore-placement':false,
          'text-anchor':'center'
        },
        paint:{
          'text-color':'#b91c1c',
          'text-halo-color':'#ffffff',
          'text-halo-width':2,
          'text-halo-blur':0.5
        }
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
    vertices.forEach((point,index)=>{
      features.push({
        type:'Feature',
        properties:{vertexIndex:index},
        geometry:{type:'Point',coordinates:point}
      });
    });

    const edgeCount=vertices.length>=3?vertices.length:Math.max(0,vertices.length-1);
    for(let i=0;i<edgeCount;i++){
      const j=(i+1)%vertices.length;
      const a=vertices[i],b=vertices[j];
      const metres=geodesicDistanceM(a,b);
      features.push({
        type:'Feature',
        properties:{
          edgeIndex:i,
          distanceM:metres,
          distanceLabel:formatEdgeDistance(metres)
        },
        geometry:{
          type:'Point',
          coordinates:edgeMidpoint(a,b)
        }
      });
    }

    map.getSource(SEL_SOURCE)?.setData({type:'FeatureCollection',features});
  }

  function setButtons(){
    $('localFloodFinish').disabled=!drawing||vertices.length<3||isPreparingSelection;
    const simulationLocked=!prepared||selectionDirty||isPreparingSelection;
    $('localFloodRun').disabled=simulationLocked;
    $('localFloodPause').disabled=simulationLocked;
    $('localFloodReset').disabled=simulationLocked;
  }

  function syncEditablePolygon(){
    if(vertices.length<3){
      polygon=null;
      updateSelection();
      return;
    }
    polygon=[[...vertices,vertices[0]]];
    updateSelection();
  }

  function buildingColourExpression(){
    return [
      'case',
      ['boolean',['get','impacted'],false],'#ff3b30',
      ['boolean',['get','selected'],false],'#ff9f1a',
      '#c6ced5'
    ];
  }

  function ensureBuildingSceneLayers(){
    if(!map.getSource(BUILDING_SCENE_SOURCE)){
      map.addSource(BUILDING_SCENE_SOURCE,{
        type:'geojson',data:{type:'FeatureCollection',features:[]}
      });
    }
    if(!map.getLayer(BUILDING_SCENE_FILL)){
      map.addLayer({
        id:BUILDING_SCENE_FILL,type:'fill',source:BUILDING_SCENE_SOURCE,minzoom:14,
        layout:{visibility:map.getPitch()>.5?'none':'visible'},
        paint:{'fill-color':buildingColourExpression(),'fill-opacity':1}
      },getFirstSymbolLayerId());
    }
    if(!map.getLayer(BUILDING_SCENE_3D)){
      map.addLayer({
        id:BUILDING_SCENE_3D,type:'fill-extrusion',source:BUILDING_SCENE_SOURCE,minzoom:14,
        layout:{visibility:map.getPitch()>.5?'visible':'none'},
        paint:{
          'fill-extrusion-color':buildingColourExpression(),
          'fill-extrusion-height':['get','simHeight'],
          'fill-extrusion-base':['get','simBase'],
          'fill-extrusion-opacity':1,
          'fill-extrusion-vertical-gradient':false
        }
      },getFirstSymbolLayerId());
    }
  }

  function syncBuildingSceneView(){
    const is3D=map.getPitch()>.5;
    if(map.getLayer(BUILDING_SCENE_3D)){
      map.setLayoutProperty(BUILDING_SCENE_3D,'visibility',is3D?'visible':'none');
    }
    if(map.getLayer(BUILDING_SCENE_FILL)){
      map.setLayoutProperty(BUILDING_SCENE_FILL,'visibility',is3D?'none':'visible');
    }
  }

  function publishBuildingScene(){
    ensureBuildingSceneLayers();
    map.getSource(BUILDING_SCENE_SOURCE)?.setData({
      type:'FeatureCollection',features:[...sceneFeatures.values()]
    });
    syncBuildingSceneView();
  }

  function removeBuildingScene(){
    if(map.getLayer(BUILDING_SCENE_3D))map.removeLayer(BUILDING_SCENE_3D);
    if(map.getLayer(BUILDING_SCENE_FILL))map.removeLayer(BUILDING_SCENE_FILL);
    if(map.getSource(BUILDING_SCENE_SOURCE))map.removeSource(BUILDING_SCENE_SOURCE);
    sceneFeatures.clear();
  }

  function clearSelectedBuildingStates(){
    impactedStateIds.clear();
    buildingById.clear();
    buildingSourceId=null;
    buildingSourceLayer='building';
    removeBuildingScene();
    setCityBuildingFloodSelection?.({active:false});
  }

  function removeWaterLayers(){
    if(map.getLayer(WATER_LAYER))map.removeLayer(WATER_LAYER);
    if(map.getSource(WATER_SOURCE))map.removeSource(WATER_SOURCE);
    if(canvas){canvas.remove();canvas=null;canvasContext=null;}
  }

  function clearSimulation(keepSelection=false){
    simulator?.pause();
    prepared=false;setupInfo=null;selectedBuildings=[];
    clearSelectedBuildingStates();
    removeWaterLayers();
    if(!keepSelection){
      drawing=false;
      editingSelection=false;
      selectionDirty=false;
      isPreparingSelection=false;
      dragVertexIndex=-1;
      vertices=[];
      polygon=null;
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor='';
      if(dragPanWasEnabled&&!map.dragPan.isEnabled())map.dragPan.enable();
      map.getSource(SEL_SOURCE)?.setData({type:'FeatureCollection',features:[]});
    }
    $('localFloodStats').textContent='尚未运行';
    setButtons();
  }

  function startDrawing(){
    clearSimulation(false);
    drawing=true;
    editingSelection=false;
    selectionDirty=false;
    isPreparingSelection=false;
    dragVertexIndex=-1;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor='crosshair';
    status('圈选模式：逐点点击红色边界；至少 3 个点后点击“确定范围”或双击。');
    setButtons();
  }

  function finishDrawing(){
    if(!drawing||vertices.length<3)return;
    drawing=false;
    editingSelection=true;
    selectionDirty=true;
    dragVertexIndex=-1;
    map.doubleClickZoom.disable();
    dragPanWasEnabled=map.dragPan.isEnabled();
    map.getCanvas().style.cursor='';

    syncEditablePolygon();
    setButtons();
    status('范围已确定：边线上显示实际距离；拖动锚点修改，双击边线加点，双击现有点删除；按 Enter 生成。');
  }

  async function confirmEditedSelection(){
    if(!editingSelection||vertices.length<3||isPreparingSelection)return;

    dragVertexIndex=-1;
    syncEditablePolygon();
    simulator?.pause();
    isPreparingSelection=true;
    setButtons();
    map.getCanvas().style.cursor='';
    status(
      prepared
        ?'正在按修改后的红色范围重新生成建筑与洪涝网格…'
        :'边界已确认，正在按最终红色框生成范围内建筑…'
    );

    const success=await prepareSimulation();

    isPreparingSelection=false;
    if(success){
      // Deliberately stay in edit mode after generation. Anchors remain live so the
      // user can expand/shrink the parcel and press Enter again to regenerate.
      editingSelection=true;
      selectionDirty=false;
      status(
        '范围已生成：可拖动锚点、双击边线加点、双击现有点删除；空白处可移动视窗，按 Enter 重新生成。'
      );
    }else{
      editingSelection=true;
      selectionDirty=true;
    }
    setButtons();
    return success;
  }

  function normaliseBuilding(feature,id,sceneKey){
    return {
      id,
      sceneKey,
      geometry:feature.geometry
    };
  }

  function queryBuildings(bounds,selectionRing){
    ensureCityBuildings();
    const cityLayer=map.getLayer(cityBuildingsLayerId);
    const source=cityLayer?.source;
    const sourceLayer=cityLayer?.['source-layer']||'building';
    if(!source)return {selected:[],sceneCount:0,source:null,sourceLayer};

    const raw=[];
    const seen=new Set();
    const addFeature=feature=>{
      if(!feature?.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))return;
      if(feature.properties?.hide_3d===true)return;
      const key=featureKey(feature);
      if(seen.has(key))return;
      seen.add(key);
      raw.push({feature,key});
    };

    try{
      for(const feature of map.queryRenderedFeatures({layers:[cityBuildingsLayerId]})||[]){
        addFeature(feature);
      }
    }catch(error){
      console.warn('Rendered building query failed',error);
    }

    if(!raw.length){
      try{
        for(const feature of map.querySourceFeatures(source,{sourceLayer})||[]){
          addFeature(feature);
        }
      }catch(error){
        console.warn('Source building query failed',error);
      }
    }

    sceneFeatures.clear();
    const selected=[];

    for(const {feature,key} of raw){
      const p=feature.properties||{};
      const height=Math.max(2,Number(p.render_height)||Number(p.height)||5);
      const base=Math.max(0,Number(p.render_min_height)||Number(p.min_height)||0);

      const mayIntersect=boxesIntersect(bounds,geometryBBox(feature.geometry));
      const split=mayIntersect
        ?splitBuildingBySelection(feature.geometry,selectionRing)
        :{inside:null,outside:feature.geometry};

      if(split.outside){
        sceneFeatures.set(key+'|outside',{
          type:'Feature',
          properties:{
            simHeight:height,
            simBase:base,
            selected:false,
            impacted:false
          },
          geometry:split.outside
        });
      }

      if(split.inside){
        const insideKey=key+'|inside';
        const insideScene={
          type:'Feature',
          properties:{
            simHeight:height,
            simBase:base,
            selected:true,
            impacted:false
          },
          geometry:split.inside
        };
        sceneFeatures.set(insideKey,insideScene);
        selected.push({feature:insideScene,key:insideKey});
      }
    }

    return {selected,sceneCount:sceneFeatures.size,source,sourceLayer};
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
    },map.getLayer(BUILDING_SCENE_3D)?BUILDING_SCENE_3D:getFirstSymbolLayerId());
  }

  async function prepareSimulation(){
    if(!polygon)return false;
    const ring=polygon[0];
    const bounds=bboxLngLat(ring);
    const area=ringAreaM2(ring);
    if(area<5000){status('圈选范围太小，请至少圈选约 5,000 m²。',true);return false;}
    if(area>60_000_000){status('圈选范围过大，请控制在约 60 km² 内。',true);return false;}

    status('正在准备模拟：放大选区并读取当前 OSM 建筑轮廓…');
    prepared=false;
    setButtons();
    map.fitBounds([[bounds.west,bounds.south],[bounds.east,bounds.north]],{
      padding:55,maxZoom:16.2,duration:500
    });
    setCityView(true);
    await onceIdle(map,3200);

    clearSelectedBuildingStates();
    const queried=queryBuildings(bounds,ring);
    buildingSourceId=queried.source;
    buildingSourceLayer=queried.sourceLayer;
    selectedBuildings=queried.selected.map(item=>item.feature);

    const buildings=queried.selected.map((item,id)=>{
      const entry=normaliseBuilding(item.feature,id,item.key);
      buildingById.set(id,entry);
      return {id,geometry:entry.geometry};
    });

    if(!queried.sceneCount){
      status('没有读取到 OSM 建筑。请等待地图瓦片加载完成后重新圈选。',true);
      return false;
    }

    publishBuildingScene();
    // Hide native OSM building geometry only after the split replacement scene is ready.
    // Every building is clipped at the red polygon: grey outside, orange inside.
    setCityBuildingFloodSelection?.({active:true});

    try{
      const info=await ensureSimulator().setup({polygon,buildings});
      setupInfo=info;
      prepared=true;
      ensureWaterLayer(info);
      $('localFloodGridInfo').textContent=
        info.cellSizeM+' m 网格 · '+info.buildingCount+' 栋建筑';
      $('localFloodStats').textContent=
        '范围 '+(area/1e6).toFixed(2)+' km² · '+info.cellSizeM+' m 网格 · 圈内建筑 '+info.buildingCount+' 栋';
      setButtons();
      return true;
    }catch(error){
      prepared=false;
      setButtons();
      status(error.message,true);
      return false;
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

    const nextImpacted=new Set(data.impactedIds||[]);
    let buildingColourChanged=false;

    for(const id of impactedStateIds){
      if(nextImpacted.has(id))continue;
      const entry=buildingById.get(id);
      const scene=entry&&sceneFeatures.get(entry.sceneKey);
      if(scene?.properties.impacted){
        scene.properties.impacted=false;
        buildingColourChanged=true;
      }
    }

    for(const id of nextImpacted){
      const entry=buildingById.get(id);
      const scene=entry&&sceneFeatures.get(entry.sceneKey);
      if(scene&&!scene.properties.impacted){
        scene.properties.impacted=true;
        buildingColourChanged=true;
      }
    }

    impactedStateIds=nextImpacted;
    if(buildingColourChanged)publishBuildingScene();

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
    updateSelection();
    setButtons();
  });

  map.on('dblclick',event=>{
    event.originalEvent?.preventDefault?.();

    if(drawing){
      if(vertices.length>=3)finishDrawing();
      return;
    }

    if(!editingSelection||isPreparingSelection)return;

    // 1) Double-click an existing anchor -> delete it.
    const anchorIndex=findAnchorAtPoint(event.point);
    if(anchorIndex!==null){
      if(vertices.length<=3){
        status('多边形至少需要 3 个锚点，当前锚点不能继续删除。',true);
        return;
      }

      vertices.splice(anchorIndex,1);
      simulator?.pause();
      selectionDirty=true;
      syncEditablePolygon();
      setButtons();
      status(
        prepared
          ?'已删除锚点 '+(anchorIndex+1)+'。可继续编辑，按 Enter 按新范围重新生成建筑。'
          :'已删除锚点 '+(anchorIndex+1)+'。可继续编辑，按 Enter 生成建筑。'
      );
      return;
    }

    // 2) Double-click close to an existing red edge -> insert a new anchor on that edge.
    const edge=nearestEdgeAtPoint(event.point);
    if(!edge)return;

    const lngLat=map.unproject([edge.x,edge.y]);
    vertices.splice(edge.insertIndex,0,[lngLat.lng,lngLat.lat]);
    simulator?.pause();
    selectionDirty=true;
    syncEditablePolygon();
    setButtons();
    status(
      prepared
        ?'已在红色边线上增加锚点。可拖动新锚点调整范围，按 Enter 重新生成建筑。'
        :'已在红色边线上增加锚点。可拖动新锚点调整范围，按 Enter 生成建筑。'
    );
  });

  const findAnchorAtPoint=point=>{
    if(!editingSelection||!vertices.length)return null;

    // Do not depend on the tiny rendered circle hit area. Compare directly against
    // every anchor's projected screen position and use a generous 22 px grab radius.
    let bestIndex=null;
    let bestDistance=22;
    for(let i=0;i<vertices.length;i++){
      const projected=map.project(vertices[i]);
      const distance=Math.hypot(projected.x-point.x,projected.y-point.y);
      if(distance<=bestDistance){
        bestDistance=distance;
        bestIndex=i;
      }
    }
    return bestIndex;
  };

  const nearestEdgeAtPoint=point=>{
    if(!editingSelection||vertices.length<2)return null;

    let best=null;
    const maxDistance=16;

    for(let i=0;i<vertices.length;i++){
      const j=(i+1)%vertices.length;
      const a=map.project(vertices[i]);
      const b=map.project(vertices[j]);
      const dx=b.x-a.x,dy=b.y-a.y;
      const len2=dx*dx+dy*dy;
      if(len2<1e-9)continue;

      const t=clamp(
        ((point.x-a.x)*dx+(point.y-a.y)*dy)/len2,
        0,1
      );
      const x=a.x+t*dx;
      const y=a.y+t*dy;
      const distance=Math.hypot(point.x-x,point.y-y);

      if(distance<=maxDistance&&(!best||distance<best.distance)){
        best={
          distance,
          x,y,
          segmentIndex:i,
          insertIndex:i+1
        };
      }
    }
    return best;
  };

  const canvasContainer=map.getCanvasContainer();

  const pointFromMouseEvent=event=>{
    const rect=canvasContainer.getBoundingClientRect();
    return {
      x:event.clientX-rect.left,
      y:event.clientY-rect.top
    };
  };

  const onAnchorMouseDownCapture=event=>{
    if(!editingSelection||event.button!==0)return;
    const point=pointFromMouseEvent(event);
    const index=findAnchorAtPoint(point);
    if(index===null)return; // Not an anchor: let MapLibre pan/rotate normally.

    // Capture only anchor drags before MapLibre's dragPan handler sees the event.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    dragVertexIndex=index;
    dragPanWasEnabled=map.dragPan.isEnabled();
    if(dragPanWasEnabled)map.dragPan.disable();

    simulator?.pause();
    selectionDirty=true;
    setButtons();
    map.getCanvas().style.cursor='grabbing';
    status(
      prepared
        ?'正在调整锚点 '+(index+1)+'；拖动实时修改红色范围。松开后仍可拖动地图空白处移动视窗，按 Enter 重新生成。'
        :'正在调整锚点 '+(index+1)+'；拖动实时修改红色范围。松开后可移动视窗，按 Enter 生成建筑。'
    );
  };

  const onAnchorMouseMoveWindow=event=>{
    if(dragVertexIndex<0||!editingSelection)return;
    event.preventDefault();

    const point=pointFromMouseEvent(event);
    const lngLat=map.unproject([point.x,point.y]);
    vertices[dragVertexIndex]=[lngLat.lng,lngLat.lat];
    selectionDirty=true;
    syncEditablePolygon();
    setButtons();
  };

  const onAnchorMouseUpWindow=()=>{
    if(dragVertexIndex<0)return;

    dragVertexIndex=-1;
    if(dragPanWasEnabled&&!map.dragPan.isEnabled())map.dragPan.enable();
    map.getCanvas().style.cursor='';

    status(
      prepared
        ?'边界已修改：可继续拖动锚点，或拖动地图空白处移动视窗；按 Enter 按新范围重新生成建筑。'
        :'边界已更新：可继续拖动锚点或移动视窗；按 Enter 生成最终范围内建筑。'
    );
  };

  const onMapMouseMove=event=>{
    if(!editingSelection||dragVertexIndex>=0)return;
    const index=findAnchorAtPoint(event.point);
    if(index!==null){
      map.getCanvas().style.cursor='grab';
      return;
    }
    const edge=nearestEdgeAtPoint(event.point);
    map.getCanvas().style.cursor=edge?'crosshair':'';
  };

  canvasContainer.addEventListener('mousedown',onAnchorMouseDownCapture,true);
  window.addEventListener('mousemove',onAnchorMouseMoveWindow,{passive:false});
  window.addEventListener('mouseup',onAnchorMouseUpWindow);
  map.on('mousemove',onMapMouseMove);

  const syncSceneOnPitch=()=>syncBuildingSceneView();
  map.on('pitch',syncSceneOnPitch);

  const cancelSelectionEdit=()=>{
    drawing=false;
    editingSelection=false;
    dragVertexIndex=-1;
    vertices=[];
    polygon=null;
    updateSelection();
    map.doubleClickZoom.enable();
    if(!map.dragPan.isEnabled())map.dragPan.enable();
    map.getCanvas().style.cursor='';
    status('圈选已取消。');
    setButtons();
  };

  const keydown=event=>{
    const tag=event.target?.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;

    if(event.key==='Enter'){
      if(drawing&&vertices.length>=3){
        event.preventDefault();
        finishDrawing();
        return;
      }
      if(editingSelection){
        event.preventDefault();
        confirmEditedSelection();
        return;
      }
    }

    if(event.key==='Escape'&&(drawing||editingSelection)&&!prepared){
      event.preventDefault();
      cancelSelectionEdit();
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
    impactedStateIds.clear();
    let changed=false;
    for(const feature of sceneFeatures.values()){
      if(feature.properties.impacted){
        feature.properties.impacted=false;
        changed=true;
      }
    }
    if(changed)publishBuildingScene();
  });
  for(const id of ['localFloodRain','localFloodInfil','localFloodDuration']){
    $(id).addEventListener('input',updateParamLabels);
  }

  ensureSelectionLayers();
  updateParamLabels();
  setButtons();
  status('圈选后边线显示实际距离；可拖动锚点、双击加/删点、空白处移动视窗；Enter 生成或重新生成。');

  return {
    clear:()=>clearSimulation(false),
    destroy(){
      clearSimulation(false);
      simulator?.destroy();simulator=null;
      canvasContainer.removeEventListener('mousedown',onAnchorMouseDownCapture,true);
      window.removeEventListener('mousemove',onAnchorMouseMoveWindow);
      window.removeEventListener('mouseup',onAnchorMouseUpWindow);
      map.off('mousemove',onMapMouseMove);
      map.off('pitch',syncSceneOnPitch);
      document.removeEventListener('keydown',keydown);
    }
  };
}
