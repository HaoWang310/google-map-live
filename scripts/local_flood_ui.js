import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.21.14';
import * as polygonClippingModule from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
const polygonClipping=polygonClippingModule.default||polygonClippingModule;

const SEL_SOURCE='local-flood-selection-source';
const SEL_FILL='local-flood-selection-fill';
const SEL_LINE='local-flood-selection-line';
const SEL_POINTS='local-flood-selection-points';
const SEL_DISTANCE='local-flood-selection-distance';
const ISOLATE_SOURCE='local-flood-isolate-source';
const ISOLATE_MASK='local-flood-isolate-mask';
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

function geodesicRingAreaM2(ring){
  if(!ring?.length||ring.length<3)return 0;
  const earthRadius=6371008.8;
  const pts=closeRing(ring);
  let sum=0;
  for(let i=0;i<pts.length-1;i++){
    const lon1=pts[i][0]*Math.PI/180;
    const lon2=pts[i+1][0]*Math.PI/180;
    const lat1=pts[i][1]*Math.PI/180;
    const lat2=pts[i+1][1]*Math.PI/180;
    let dLon=lon2-lon1;
    if(dLon>Math.PI)dLon-=2*Math.PI;
    if(dLon<-Math.PI)dLon+=2*Math.PI;
    sum+=dLon*(2+Math.sin(lat1)+Math.sin(lat2));
  }
  return Math.abs(sum)*earthRadius*earthRadius/2;
}

function formatAreaHtml(areaM2){
  const km2=areaM2/1e6;
  return '<strong>区域面积</strong><br>'+
    km2.toFixed(4)+' km²<br>'+
    Math.round(areaM2).toLocaleString()+' m²';
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


function hide3DFlag(value){
  return value===true||value===1||value==='1'||String(value).toLowerCase()==='true';
}


function featureKey(feature){
  const b=geometryBBox(feature.geometry);
  const h=Number(feature.properties?.render_height)||Number(feature.properties?.height)||0;
  return [b.west,b.south,b.east,b.north,h]
    .map(v=>Number(v).toFixed(6)).join('|');
}

function geometryIdentity(feature){
  /*
   * Never use vector-tile feature id as the extraction/grouping key.
   * OpenMapTiles ids may repeat between tiles and one logical OSM object may also
   * arrive as several tile-clipped fragments. Exact geometry identity safely
   * deduplicates source/rendered copies without merging unrelated buildings.
   */
  try{
    return featureKey(feature)+'|'+JSON.stringify(feature.geometry?.coordinates||[]);
  }catch(error){
    return featureKey(feature);
  }
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
  let buildingById=new Map();
  let sceneFeatures=new Map();
  let canvas=null;
  let canvasContext=null;
  let simulator=null;
  let areaHoverTimer=null;
  let areaHoverInside=false;
  let areaHoverLngLat=null;
  let areaPopup=null;
  let hideSelectedBuildings=false;
  let isolatedSelection=false;
  let isolateCamera=null;
  let isolateLayerVisibility=new Map();
  let isolateSceneFilters=new Map();

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

  function ensureIsolateLayer(){
    if(!map.getSource(ISOLATE_SOURCE)){
      map.addSource(ISOLATE_SOURCE,{
        type:'geojson',
        data:{type:'FeatureCollection',features:[]}
      });
    }
    if(!map.getLayer(ISOLATE_MASK)){
      map.addLayer({
        id:ISOLATE_MASK,
        type:'fill',
        source:ISOLATE_SOURCE,
        paint:{
          'fill-color':'#f4f2ed',
          'fill-opacity':1
        }
      });
    }
  }

  function isolateMaskGeoJson(ring){
    const closed=closeRing(ring);
    if(closed.length<4){
      return {type:'FeatureCollection',features:[]};
    }

    // Build the mask locally around the site instead of using a near-world-size
    // polygon. A global outer ring becomes unstable in a pitched 3D camera and can
    // triangulate into the large white wedge seen in the previous isolate view.
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const [lng,lat] of closed){
      const [x,y]=mercator(lng,lat);
      minX=Math.min(minX,x); maxX=Math.max(maxX,x);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    }

    const width=Math.max(1,maxX-minX);
    const height=Math.max(1,maxY-minY);
    const pad=Math.max(12000,Math.max(width,height)*60);

    const outer=[
      unmercator(minX-pad,minY-pad),
      unmercator(maxX+pad,minY-pad),
      unmercator(maxX+pad,maxY+pad),
      unmercator(minX-pad,maxY+pad),
      unmercator(minX-pad,minY-pad)
    ];

    // Turf/GeoJSON hole winding: outer and inner rings use opposite directions.
    const hole=closed.slice().reverse();

    return {
      type:'FeatureCollection',
      features:[{
        type:'Feature',
        properties:{},
        geometry:{
          type:'Polygon',
          coordinates:[outer,hole]
        }
      }]
    };
  }

  function setSelectionEditVisibility(visible){
    const value=visible?'visible':'none';
    for(const id of [SEL_POINTS,SEL_DISTANCE]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',value);
    }
  }

  function selectionBounds(ring){
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
    for(const p of ring||[]){
      if(!Array.isArray(p)||p.length<2)continue;
      west=Math.min(west,Number(p[0]));
      east=Math.max(east,Number(p[0]));
      south=Math.min(south,Number(p[1]));
      north=Math.max(north,Number(p[1]));
    }
    if(!Number.isFinite(west))return null;
    return [[west,south],[east,north]];
  }

  function enterIsolateLayerMode(){
    isolateLayerVisibility=new Map();
    isolateSceneFilters=new Map();

    const keepIds=new Set([
      SEL_FILL,
      SEL_LINE,
      BUILDING_SCENE_FILL,
      BUILDING_SCENE_3D,
      WATER_LAYER
    ]);

    const style=map.getStyle?.();
    for(const layer of style?.layers||[]){
      if(!layer?.id)continue;

      const currentVisibility=map.getLayoutProperty(layer.id,'visibility');
      isolateLayerVisibility.set(
        layer.id,
        currentVisibility===undefined?null:currentVisibility
      );

      // Keep only the neutral map background plus the local selected-site layers.
      // This avoids using a giant 3D polygon mask, which was physically occluding
      // the scene and leaving skyline artefacts outside the site.
      const keep=layer.type==='background'||keepIds.has(layer.id);
      if(!keep){
        map.setLayoutProperty(layer.id,'visibility','none');
      }
    }

    // In isolated view, do not keep grey outside fragments from buildings that
    // cross the red boundary. Only the clipped inside/site fragment is visible.
    for(const id of [BUILDING_SCENE_FILL,BUILDING_SCENE_3D]){
      if(!map.getLayer(id))continue;
      const oldFilter=map.getFilter(id);
      isolateSceneFilters.set(id,oldFilter===undefined?null:oldFilter);
      map.setFilter(id,[
        '==',
        ['boolean',['get','selected'],false],
        true
      ]);
      map.setLayoutProperty(
        id,
        'visibility',
        id===BUILDING_SCENE_3D?'visible':'none'
      );
    }

    // The polygon fill is only a subtle site tint; the red line remains the main edge.
    if(map.getLayer(SEL_FILL))map.setLayoutProperty(SEL_FILL,'visibility','visible');
    if(map.getLayer(SEL_LINE))map.setLayoutProperty(SEL_LINE,'visibility','visible');
  }

  function exitIsolateLayerMode(){
    for(const [id,visibility] of isolateLayerVisibility){
      if(!map.getLayer(id))continue;
      if(visibility===null){
        // "visible" is the style default when visibility was not explicitly set.
        map.setLayoutProperty(id,'visibility','visible');
      }else{
        map.setLayoutProperty(id,'visibility',visibility);
      }
    }

    for(const [id,filter] of isolateSceneFilters){
      if(!map.getLayer(id))continue;
      if(filter===null){
        map.setFilter(id,null);
      }else{
        map.setFilter(id,filter);
      }
    }

    isolateLayerVisibility.clear();
    isolateSceneFilters.clear();
  }

  function enterSelectionIsolate(){
    if(
      isolatedSelection||
      !prepared||
      selectionDirty||
      !polygon?.[0]||
      polygon[0].length<4
    )return false;

    ensureIsolateLayer();

    isolateCamera={
      center:map.getCenter().toArray(),
      zoom:map.getZoom(),
      pitch:map.getPitch(),
      bearing:map.getBearing()
    };

    // Do not use the old outside polygon mask in 3D. It behaves like a real
    // horizontal surface and can occlude the isolated site at pitched camera angles.
    map.getSource(ISOLATE_SOURCE)?.setData({
      type:'FeatureCollection',
      features:[]
    });
    if(map.getLayer(ISOLATE_MASK)){
      map.setLayoutProperty(ISOLATE_MASK,'visibility','none');
    }

    enterIsolateLayerMode();

    // Keep the red boundary, but hide editing handles / edge dimensions in focus mode.
    setSelectionEditVisibility(false);
    hideAreaPopup();
    isolatedSelection=true;

    const bounds=selectionBounds(polygon[0]);
    if(bounds){
      // First fit the site in a stable plan view. Fitting while keeping the previous
      // steep 3D pitch made a 150–250 m site collapse into a tiny wedge on screen.
      map.fitBounds(bounds,{
        padding:{top:90,bottom:90,left:90,right:90},
        duration:0,
        maxZoom:18,
        pitch:0,
        bearing:0
      });

      // Then restore a readable architectural 3D angle without changing the fitted
      // centre/zoom, so the selected site occupies the viewport.
      const fittedCenter=map.getCenter().toArray();
      const fittedZoom=map.getZoom();
      map.easeTo({
        center:fittedCenter,
        zoom:Math.max(15.5,Math.min(18,fittedZoom-0.15)),
        pitch:48,
        bearing:isolateCamera?.bearing||0,
        duration:650
      });
    }

    status('已进入选区独立视图：仅保留红线范围与范围内建筑，周边地图图层全部隐藏；按 Esc 返回完整地图。');
    return true;
  }

  function exitSelectionIsolate(restoreCamera=true){
    if(!isolatedSelection)return false;

    isolatedSelection=false;
    if(map.getLayer(ISOLATE_MASK)){
      map.setLayoutProperty(ISOLATE_MASK,'visibility','none');
    }
    map.getSource(ISOLATE_SOURCE)?.setData({
      type:'FeatureCollection',
      features:[]
    });

    exitIsolateLayerMode();
    setSelectionEditVisibility(true);

    if(restoreCamera&&isolateCamera){
      map.easeTo({
        center:isolateCamera.center,
        zoom:isolateCamera.zoom,
        pitch:isolateCamera.pitch,
        bearing:isolateCamera.bearing,
        duration:500
      });
    }
    isolateCamera=null;
    status('已退出选区独立视图，可继续编辑红色范围。');
    return true;
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

    const hideToggle=$('localFloodHideSelectedBuildings');
    if(hideToggle){
      hideToggle.disabled=!prepared||isPreparingSelection;
    }
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
        id:BUILDING_SCENE_FILL,type:'fill',source:BUILDING_SCENE_SOURCE,minzoom:12,
        layout:{visibility:map.getPitch()>.5?'none':'visible'},
        paint:{'fill-color':buildingColourExpression(),'fill-opacity':1}
      },getFirstSymbolLayerId());
    }
    if(!map.getLayer(BUILDING_SCENE_3D)){
      map.addLayer({
        id:BUILDING_SCENE_3D,type:'fill-extrusion',source:BUILDING_SCENE_SOURCE,minzoom:12,
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

    const features=[...sceneFeatures.values()].filter(feature=>{
      // Visual-only site isolation mode:
      // selected=true is the red-polygon interior fragment.
      // selected=false is the exterior fragment of a boundary-crossing building.
      // Keeping selected=false preserves everything outside the red polygon while
      // removing only the building geometry that lies inside it.
      return !hideSelectedBuildings||feature.properties?.selected!==true;
    });

    map.getSource(BUILDING_SCENE_SOURCE)?.setData({
      type:'FeatureCollection',
      features
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
    buildingById.clear();
    removeBuildingScene();
    setCityBuildingFloodSelection?.({active:false});
  }

  function removeWaterLayers(){
    if(map.getLayer(WATER_LAYER))map.removeLayer(WATER_LAYER);
    if(map.getSource(WATER_SOURCE))map.removeSource(WATER_SOURCE);
    if(canvas){canvas.remove();canvas=null;canvasContext=null;}
  }

  function clearSimulation(keepSelection=false){
    hideAreaPopup();
    if(isolatedSelection)exitSelectionIsolate(false);
    if(!keepSelection){
      hideSelectedBuildings=false;
      const hideToggle=$('localFloodHideSelectedBuildings');
      if(hideToggle)hideToggle.checked=false;
    }
    simulator?.pause();
    prepared=false;
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
    hideSelectedBuildings=false;
    const hideToggle=$('localFloodHideSelectedBuildings');
    if(hideToggle)hideToggle.checked=false;
    drawing=true;
    editingSelection=false;
    selectionDirty=false;
    isPreparingSelection=false;
    dragVertexIndex=-1;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor='crosshair';
    status('圈选模式：逐点点击红色边界；至少 3 个点后按 Enter、双击或点击“确定范围”，先生成橙色建筑。');
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
    if(!editingSelection||vertices.length<3||isPreparingSelection)return false;

    dragVertexIndex=-1;
    syncEditablePolygon();
    simulator?.pause();

    // Required interaction order:
    // edit polygon -> Enter -> ALWAYS show regenerated orange buildings first.
    // The user may then choose "隐藏选区内建筑" afterwards.
    hideSelectedBuildings=false;
    const hideToggle=$('localFloodHideSelectedBuildings');
    if(hideToggle)hideToggle.checked=false;

    isPreparingSelection=true;
    setButtons();
    map.getCanvas().style.cursor='';
    status(
      prepared
        ?'正在按修改后的红色范围重新生成橙色建筑与洪涝网格…'
        :'边界已确认，正在生成红色范围内的橙色建筑…'
    );

    let success=false;
    try{
      success=Boolean(await prepareSimulation());

      if(success){
        editingSelection=true;
        selectionDirty=false;
        status(
          hideSelectedBuildings
            ?'范围已生成；当前“隐藏选区内建筑”已开启。关闭开关即可恢复橙色建筑。'
            :'范围已生成：框内建筑已显示为橙色。可继续移动/修改红框后按 Enter 重新生成；需要时再勾选“隐藏选区内建筑”。'
        );
      }else{
        editingSelection=true;
        selectionDirty=true;
      }
    }catch(error){
      console.error('Local flood selection generation failed',error);
      editingSelection=true;
      selectionDirty=true;
      status(
        '生成失败：'+(error?.message||String(error))+'。红框已保留，可直接按 Enter 重试。',
        true
      );
    }finally{
      isPreparingSelection=false;
      setButtons();
    }

    return success;
  }

  async function finishAndConfirmSelection(){
    if(drawing){
      if(vertices.length<3)return false;
      finishDrawing();
    }
    if(!editingSelection)return false;
    return confirmEditedSelection();
  }

  function normaliseBuilding(feature,id,sceneKey){
    return {id,sceneKey,geometry:feature.geometry};
  }

  function queryBuildings(bounds,selectionRing){
    ensureCityBuildings();

    const cityLayer=map.getLayer(cityBuildingsLayerId);
    const source=cityLayer?.source||null;
    const sourceLayer=cityLayer?.['source-layer']||'building';

    if(!source){
      return {
        selected:[],
        sceneCount:0,
        visibleCount:0,
        diagnostics:{sourceFeatureCount:0,renderedFeatureCount:0,groupCount:0,clippedCount:0}
      };
    }

    /*
     * IMPORTANT: use ONE authoritative vector source only, and DO NOT group by
     * OpenMapTiles feature id.
     *
     * The same id can be reused by different vector tiles, while one OSM building or
     * multipolygon can also be clipped into several tile fragments. Grouping by id was
     * the source of "one site selection changes another building elsewhere".
     *
     * We now deduplicate only identical geometry. Tile fragments remain independent
     * and are clipped spatially against the red polygon. This is deliberately robust
     * to grouped/multipolygon OSM building records.
     */
    const groups=new Map();
    let sourceFeatureCount=0;
    let renderedFeatureCount=0;

    const addFeature=feature=>{
      if(!feature?.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))return;
      if(hide3DFlag(feature.properties?.hide_3d))return;
      if(!boxesIntersect(bounds,geometryBBox(feature.geometry)))return;

      const geometryId='geom:'+geometryIdentity(feature);

      if(!groups.has(geometryId))groups.set(geometryId,[]);
      groups.get(geometryId).push(feature);
    };

    try{
      const features=map.querySourceFeatures(source,{sourceLayer})||[];
      sourceFeatureCount=features.length;
      for(const feature of features)addFeature(feature);
    }catch(error){
      console.warn('Dedicated building source query failed',error);
    }

    // Same-source rendered fallback only. It cannot introduce a second building dataset.
    if(map.getLayer(cityBuildingsLayerId)){
      try{
        const projected=selectionRing.map(point=>map.project(point));
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for(const p of projected){
          minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
          maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
        }
        const queryBox=[
          [Math.floor(minX)-12,Math.floor(minY)-12],
          [Math.ceil(maxX)+12,Math.ceil(maxY)+12]
        ];
        const rendered=map.queryRenderedFeatures(
          queryBox,
          {layers:[cityBuildingsLayerId]}
        )||[];
        renderedFeatureCount=rendered.length;
        for(const feature of rendered)addFeature(feature);
      }catch(error){
        console.warn('Dedicated rendered building query failed',error);
      }
    }

    sceneFeatures.clear();
    const selected=[];
    let clippedCount=0;

    for(const [groupId,fragments] of groups){
      const merged=mergeBuildingFragments(groupId,fragments);
      if(!merged)continue;

      const split=splitBuildingBySelection(merged.geometry,selectionRing);
      if(!split.inside)continue;

      clippedCount++;
      const p=merged.properties||{};
      const height=Math.max(2,Number(p.render_height)||Number(p.height)||5);
      const base=Math.max(0,Number(p.render_min_height)||Number(p.min_height)||0);

      const key='building-'+String(groupId);
      const boundaryCrossing=Boolean(split.outside);

      /*
       * Every geometry fragment that intersects the red polygon is handled locally.
       * Fully-inside geometry becomes orange/red. Boundary-crossing geometry is split
       * into grey-outside + orange/red-inside. The streamed native geometry beneath
       * the site is suppressed spatially by index.html, never by feature id.
       */
      if(boundaryCrossing){
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

      // Every selected/intersecting building gets a local clipped INSIDE
      // fragment. This is essential for OpenMapTiles features that are grouped,
      // fragmented by tile boundaries, or not reliably classified by "within".
      sceneFeatures.set(insideKey,insideScene);

      selected.push({
        feature:insideScene,
        key:insideKey,
        boundaryCrossing
      });
    }

    return {
      selected,
      sceneCount:sceneFeatures.size,
      visibleCount:groups.size,
      diagnostics:{
        sourceFeatureCount,
        renderedFeatureCount,
        groupCount:groups.size,
        clippedCount
      }
    };
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

    status('正在准备模拟：完整加载红色范围内的 OSM 建筑轮廓…');
    prepared=false;
    setButtons();

    const keepCenter=map.getCenter();
    const keepZoom=map.getZoom();
    const keepPitch=map.getPitch();
    const keepBearing=map.getBearing();

    // Snapshot the current camera BEFORE changing it. In the user's workflow the grey
    // buildings are usually already visible here, so this immediately gives us a
    // reliable rendered fallback.
    clearSelectedBuildingStates();
    let queried=queryBuildings(bounds,ring);

    // Then load the whole red polygon once from above to collect every building that
    // lies inside the selection, including ones hidden behind taller foreground blocks.
    map.fitBounds([[bounds.west,bounds.south],[bounds.east,bounds.north]],{
      padding:55,
      maxZoom:16.2,
      duration:300,
      pitch:0,
      bearing:0
    });
    await onceIdle(map,5200);

    let topDown=queryBuildings(bounds,ring);

    // Prefer whichever pass actually found more clipped buildings.
    if((topDown.selected?.length||0)>(queried.selected?.length||0)){
      queried=topDown;
    }

    // Short automatic retries: do not make the user redraw the polygon.
    if(!queried.selected?.length){
      for(const delay of [200,400,800]){
        await new Promise(resolve=>setTimeout(resolve,delay));
        const retry=queryBuildings(bounds,ring);
        if((retry.selected?.length||0)>(queried.selected?.length||0)){
          queried=retry;
        }
        if(queried.selected?.length)break;
      }
    }

    if(!queried.selected?.length){
      const d=queried.diagnostics||{};
      map.jumpTo({
        center:keepCenter,
        zoom:keepZoom,
        pitch:keepPitch,
        bearing:keepBearing
      });
      status(
        '已读取建筑数据，但没有生成橙色建筑（source '+(d.sourceFeatureCount||0)+
        ' · rendered '+(d.renderedFeatureCount||0)+
        ' · groups '+(d.groupCount||0)+
        ' · clipped '+(d.clippedCount||0)+
        '）。红框已保留，可直接按 Enter 重试。',
        true
      );
      return false;
    }

    const buildings=queried.selected.map((item,id)=>{
      const entry=normaliseBuilding(item.feature,id,item.key);
      buildingById.set(id,entry);
      return {id,geometry:entry.geometry};
    });

    publishBuildingScene();
    setCityBuildingFloodSelection?.({
      active:true,
      selectionRing:ring.map(point=>[point[0],point[1]])
    });

    // Restore the complete user camera after extraction.
    map.jumpTo({
      center:keepCenter,
      zoom:keepZoom,
      pitch:keepPitch,
      bearing:keepBearing
    });
    syncBuildingSceneView();
    map.triggerRepaint();

    try{
      const info=await ensureSimulator().setup({polygon,buildings});
      prepared=true;
      ensureWaterLayer(info);
      publishBuildingScene();
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

    /*
     * Red must fully replace orange for an impacted building.
     *
     * The simulator reports internal ids created from the current local scene.
     * Colour only the exact clipped scene geometry associated with those ids.
     * No OpenMapTiles/vector-tile feature-state mapping is involved.
     */
    const impactedSceneKeys=new Set();

    for(const id of nextImpacted){
      const entry=buildingById.get(id);
      if(entry?.sceneKey)impactedSceneKeys.add(entry.sceneKey);
    }

    let buildingColourChanged=false;

    for(const [sceneKey,scene] of sceneFeatures){
      if(!scene?.properties?.selected)continue;

      const shouldBeImpacted=impactedSceneKeys.has(sceneKey);

      if(Boolean(scene.properties.impacted)!==shouldBeImpacted){
        scene.properties.impacted=shouldBeImpacted;
        buildingColourChanged=true;
      }
    }


    if(buildingColourChanged){
      publishBuildingScene();
    }

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
      if(vertices.length>=3)finishAndConfirmSelection();
      return;
    }

    if(!editingSelection||isPreparingSelection)return;

    hideAreaPopup();

    // Double-click inside a prepared, unchanged selection (away from anchors/edges)
    // enters a site-only focus view. Existing anchor/edge editing keeps priority.
    const clickedLngLat=[event.lngLat.lng,event.lngLat.lat];
    const clickedInside=Boolean(
      prepared&&
      !selectionDirty&&
      polygon?.[0]&&
      pointInRingLngLat(clickedLngLat,polygon[0])
    );

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
    if(!edge){
      if(clickedInside)enterSelectionIsolate();
      return;
    }

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

  const hideAreaPopup=()=>{
    clearTimeout(areaHoverTimer);
    areaHoverTimer=null;
    areaHoverInside=false;
    areaHoverLngLat=null;
    if(areaPopup){
      areaPopup.remove();
      areaPopup=null;
    }
  };

  const scheduleAreaPopup=lngLat=>{
    if(!polygon?.[0]||vertices.length<3)return;
    areaHoverLngLat=[lngLat.lng,lngLat.lat];

    if(areaHoverInside||areaHoverTimer)return;

    areaHoverInside=true;
    areaHoverTimer=setTimeout(()=>{
      areaHoverTimer=null;
      if(!areaHoverInside||!polygon?.[0]||!areaHoverLngLat)return;

      const areaM2=geodesicRingAreaM2(polygon[0]);
      if(!(areaM2>0))return;

      areaPopup?.remove();
      areaPopup=new maplibregl.Popup({
        closeButton:false,
        closeOnClick:false,
        className:'local-flood-area-popup',
        offset:14,
        maxWidth:'220px'
      })
        .setLngLat(areaHoverLngLat)
        .setHTML(formatAreaHtml(areaM2))
        .addTo(map);
    },2000);
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

    hideAreaPopup();
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
    if(dragVertexIndex>=0){
      hideAreaPopup();
      return;
    }

    // Area tooltip: staying anywhere inside the red polygon for >= 2 seconds
    // shows the current real ground area. Leaving the polygon cancels/hides it.
    const ring=polygon?.[0];
    const insideArea=Boolean(
      ring?.length>=4 &&
      pointInRingLngLat([event.lngLat.lng,event.lngLat.lat],ring)
    );

    if(insideArea){
      scheduleAreaPopup(event.lngLat);
    }else{
      hideAreaPopup();
    }

    if(!editingSelection)return;

    const index=findAnchorAtPoint(event.point);
    if(index!==null){
      map.getCanvas().style.cursor='grab';
      return;
    }
    const edge=nearestEdgeAtPoint(event.point);
    map.getCanvas().style.cursor=edge?'crosshair':'';
  };

  const onCanvasMouseLeave=()=>hideAreaPopup();

  canvasContainer.addEventListener('mousedown',onAnchorMouseDownCapture,true);
  canvasContainer.addEventListener('mouseleave',onCanvasMouseLeave);
  window.addEventListener('mousemove',onAnchorMouseMoveWindow,{passive:false});
  window.addEventListener('mouseup',onAnchorMouseUpWindow);
  map.on('mousemove',onMapMouseMove);

  const syncSceneOnCamera=()=>{
    syncBuildingSceneView();
    map.triggerRepaint();
  };

  // Selected replacement geometry stays completely static after Enter.
  // Camera movement only reasserts visibility/repaint; it NEVER re-queries, clears,
  // recolours or rebuilds the selected orange/grey clipped geometry.
  map.on('pitch',syncSceneOnCamera);
  map.on('rotate',syncSceneOnCamera);
  map.on('moveend',syncSceneOnCamera);

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
      if((drawing&&vertices.length>=3)||editingSelection){
        event.preventDefault();
        finishAndConfirmSelection();
        return;
      }
    }

    if(event.key==='Escape'&&isolatedSelection){
      event.preventDefault();
      exitSelectionIsolate(true);
      return;
    }

    if(event.key==='Escape'&&(drawing||editingSelection)&&!prepared){
      event.preventDefault();
      cancelSelectionEdit();
    }
  };
  document.addEventListener('keydown',keydown);

  $('localFloodDraw').addEventListener('click',startDrawing);
  $('localFloodFinish').addEventListener('click',()=>finishAndConfirmSelection());
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

  $('localFloodHideSelectedBuildings')?.addEventListener('change',event=>{
    hideSelectedBuildings=Boolean(event.target.checked);
    publishBuildingScene();

    status(
      hideSelectedBuildings
        ?'已隐藏当前红色范围内的全部建筑；跨边界建筑仅保留红框外灰色部分，周边建筑不受影响。'
        :'已恢复当前红色范围内建筑并显示为橙色。'
    );
  });

  ensureSelectionLayers();
  updateParamLabels();
  setButtons();
  status('圈选后边线显示实际距离；生成区域后双击红框内部可进入选区独立视图，Esc 返回；仍可拖动锚点、双击边线加点/锚点删点。');

  return {
    clear:()=>clearSimulation(false),
    destroy(){
      clearSimulation(false);
      simulator?.destroy();simulator=null;
      hideAreaPopup();
      if(map.getLayer(ISOLATE_MASK))map.removeLayer(ISOLATE_MASK);
      if(map.getSource(ISOLATE_SOURCE))map.removeSource(ISOLATE_SOURCE);
      canvasContainer.removeEventListener('mousedown',onAnchorMouseDownCapture,true);
      canvasContainer.removeEventListener('mouseleave',onCanvasMouseLeave);
      window.removeEventListener('mousemove',onAnchorMouseMoveWindow);
      window.removeEventListener('mouseup',onAnchorMouseUpWindow);
      map.off('mousemove',onMapMouseMove);
      map.off('pitch',syncSceneOnCamera);
      map.off('rotate',syncSceneOnCamera);
      map.off('moveend',syncSceneOnCamera);
      document.removeEventListener('keydown',keydown);
    }
  };
}
