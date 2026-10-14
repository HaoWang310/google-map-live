import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.21.81';
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
  setCityBuildingFloodSelection,setCityIsolateMode,
  getFocusAnalysisSettings,getFocusReferenceTile
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
  let isolateViewer=null;
  let isolateViewerElement=null;
  let focusWaterBounds=null;
  let focusSiteSerial=0;
  let focusAppliedThreshold=null;
  let focusThresholdTimer=null;
  let siteRainData=null,siteRainRequest=0,rainfallMode='manual',manualFourHourMm=null;
  let lastHydroFrame=null,hydroState='ready';
  const siteHydroHistory=[];
  let siteFacilities=[];
  let nextFacilityId=1;
  let spongeTool='navigate';
  let hydroDisplay={depth:true,flow:true,collision:true};
  let lastFlowUpdateAt=0;

  const status=(message,error=false)=>{
    $('localFloodStatus').textContent=message;
    $('localFloodStatus').className='layerStatus'+(error?' error':'');
    const notice=isolateViewerElement?.querySelector('#siteHudNotice');
    if(notice){
      notice.textContent=message;
      notice.style.color=error?'#ffaaaa':'#9ccbd8';
    }
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



  // The focus map owns an independent canvas and only two GeoJSON sources.
  // Unlike hiding OpenFreeMap style layers, there are no city tiles to leak.
  const FOCUS_SITE='focus-site-source';
  const FOCUS_BUILDINGS='focus-building-source';
  const FOCUS_ROADS='focus-roads-source';
  const FOCUS_GREEN='focus-green-source';
  const FOCUS_WATER='focus-water-source';
  const FOCUS_2D='focus-building-fill';
  const FOCUS_3D='focus-building-extrusion';
  const FOCUS_EA_SOURCE='focus-ea-risk-source';
  const FOCUS_DRAINAGE_SOURCE='focus-drainage-network-source';
  const FOCUS_EA_LAYER='focus-ea-risk-context';
  const FOCUS_DRAINAGE_LAYER='focus-drainage-context';
  const FOCUS_RAIN_SOURCE='focus-dynamic-rain-source';
  const FOCUS_RAIN_LAYER='focus-dynamic-rain-layer';
  const FOCUS_SPONGE_SOURCE='focus-sponge-source';
  const FOCUS_SPONGE_FILL='focus-sponge-fill';
  const FOCUS_SPONGE_LINE='focus-sponge-line';
  const FOCUS_FLOW_SOURCE='focus-flow-source';
  const FOCUS_FLOW_LAYER='focus-flow-arrows';


  const focusReferenceTileSize=512;
  const HALF_WORLD=Math.PI*6378137;
  const focusEmptyTile=async()=>{
    const blank=new OffscreenCanvas(focusReferenceTileSize,focusReferenceTileSize);
    return (await (await blank.convertToBlob({type:'image/png'})).arrayBuffer());
  };

  function siteTileBounds(z,x,y){
    const side=2*HALF_WORLD/2**z;
    return {
      west:-HALF_WORLD+x*side,
      east:-HALF_WORLD+(x+1)*side,
      north:HALF_WORLD-y*side,
      south:HALF_WORLD-(y+1)*side
    };
  }

  function maskSiteContextTile(sourceData,z,x,y,siteRing){
    // Returned overlay pixels are constrained to geographic polygon coordinates,
    // rather than a camera-dependent CSS clip (which previously broke 3D views).
    return (async()=>{
      const image=await createImageBitmap(new Blob([sourceData],{type:'image/png'}));
      try{
        const output=new OffscreenCanvas(focusReferenceTileSize,focusReferenceTileSize);
        const ctx=output.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(image,0,0,focusReferenceTileSize,focusReferenceTileSize);
        const data=ctx.getImageData(0,0,focusReferenceTileSize,focusReferenceTileSize);
        const bounds=siteTileBounds(z,x,y);
        const siteBox=bboxLngLat(siteRing);
        const x0=mercator(siteBox.west,siteBox.south)[0];
        const x1=mercator(siteBox.east,siteBox.north)[0];
        const y0=mercator(siteBox.west,siteBox.south)[1];
        const y1=mercator(siteBox.east,siteBox.north)[1];
        const w=focusReferenceTileSize,h=focusReferenceTileSize;
        if(bounds.east<=x0||bounds.west>=x1||bounds.north<=y0||bounds.south>=y1){
          data.data.fill(0);
        }else{
          const c0=clamp(Math.floor((x0-bounds.west)/(bounds.east-bounds.west)*w)-1,0,w);
          const c1=clamp(Math.ceil((x1-bounds.west)/(bounds.east-bounds.west)*w)+1,0,w);
          const r0=clamp(Math.floor((bounds.north-y1)/(bounds.north-bounds.south)*h)-1,0,h);
          const r1=clamp(Math.ceil((bounds.north-y0)/(bounds.north-bounds.south)*h)+1,0,h);
          for(let row=0;row<h;row++){
            const yy=bounds.north-(row+.5)*(bounds.north-bounds.south)/h;
            const lat=(2*Math.atan(Math.exp(yy/6378137))-Math.PI/2)*180/Math.PI;
            for(let col=0;col<w;col++){
              const p=(row*w+col)*4;
              if(data.data[p+3]===0)continue;
              if(row<r0||row>=r1||col<c0||col>=c1){
                data.data[p+3]=0;continue;
              }
              const xx=bounds.west+(col+.5)*(bounds.east-bounds.west)/w;
              const lng=xx/6378137*180/Math.PI;
              if(!pointInRingLngLat([lng,lat],siteRing))data.data[p+3]=0;
            }
          }
        }
        ctx.putImageData(data,0,0);
        return (await (await output.convertToBlob({type:'image/png'})).arrayBuffer());
      }finally{image.close();}
    })();
  }

  // Both datasets are already loaded by the app through verified protocols.
  // We reuse the same official EA risk and single authoritative drainage raster,
  // then mask them to the parcel before MapLibre receives the tile.
  maplibregl.addProtocol('site-context',async(request,controller)=>{
    const m=/^site-context:\/\/(ea|drainage)\/(\d+)\/([0-9.]+)\/(\d+)\/(\d+)\/(\d+)$/
      .exec(request.url);
    if(!m)throw new Error('Invalid isolated site context URL');
    const [,type,serial,thresholdText,zText,xText,yText]=m;
    const z=Number(zText),x=Number(xText),y=Number(yText);
    if(Number(serial)!==focusSiteSerial||!isolatedSelection||!polygon?.[0]){
      return {data:await focusEmptyTile()};
    }
    const ring=polygon[0].map(p=>[p[0],p[1]]);
    const bbox=siteTileBounds(z,x,y);
    const polygonBBox=bboxLngLat(ring);
    const sw=mercator(polygonBBox.west,polygonBBox.south);
    const ne=mercator(polygonBBox.east,polygonBBox.north);
    if(bbox.east<sw[0]||bbox.west>ne[0]||bbox.north<sw[1]||bbox.south>ne[1]){
      return {data:await focusEmptyTile()};
    }
    const url=type==='ea'
      ?'ea-flood://tiles/'+z+'/'+x+'/'+y
      :'drainage-network://tiles/'+thresholdText+'/'+z+'/'+x+'/'+y;
    try{
      const raw=await getFocusReferenceTile(type,{...request,url},controller);
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      const result=await maskSiteContextTile(raw.data,z,x,y,ring);
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      setSiteHud(type==='ea'?'siteHudEAStatus':'siteHudDrainStatus',
        type==='ea'?'EA 官方风险瓦片已获取（空白不代表无风险）':
          '50 m DEM 汇水网络瓦片已获取（道路不是地下管网）');
      return {data:result,cacheControl:'max-age=1800'};
    }catch(error){
      if(error?.name!=='AbortError'){
        setSiteHud(type==='ea'?'siteHudEAStatus':'siteHudDrainStatus',
          (type==='ea'?'EA 风险':'汇水网络')+'数据不可用：'+(error?.message||error));
      }
      throw error;
    }
  });

  function focusContextSettings(){
    const ctx=getFocusAnalysisSettings?.()||{};
    return {
      ea:ctx.ea!==false,
      drainage:ctx.drainage!==false,
      threshold:clamp(Number(ctx.threshold)||0,0,50).toFixed(3)
    };
  }

  function focusContextUrl(type,threshold){
    return 'site-context://'+type+'/'+focusSiteSerial+'/'+threshold+'/{z}/{x}/{y}';
  }

  function updateFocusAnalysisLayers(){
    const viewer=isolateViewer;
    if(!viewer||!viewer.getLayer(FOCUS_EA_LAYER))return;
    const ctx=focusContextSettings();
    for(const [id,on] of [[FOCUS_EA_LAYER,ctx.ea],[FOCUS_DRAINAGE_LAYER,ctx.drainage]]){
      if(viewer.getLayoutProperty(id,'visibility')!==(on?'visible':'none')){
        viewer.setLayoutProperty(id,'visibility',on?'visible':'none');
      }
    }
    if(ctx.threshold!==focusAppliedThreshold){
      focusAppliedThreshold=ctx.threshold;
      viewer.getSource(FOCUS_DRAINAGE_SOURCE)?.setTiles([
        focusContextUrl('drainage',ctx.threshold)
      ]);
    }
  }

  function scheduleFocusContextRefresh(){
    if(!isolatedSelection)return;
    if(focusThresholdTimer)clearTimeout(focusThresholdTimer);
    focusThresholdTimer=setTimeout(()=>{
      focusThresholdTimer=null;
      updateFocusAnalysisLayers();
    },130);
  }

  // OSM buildings can be represented by overlapping tile fragments. If a
  // flooded fragment is red, orange geometry MUST NOT occupy that same 2D
  // footprint: overlapping fill-extrusions otherwise z-fight and create orange
  // streaks on red facades and roofs during camera rotation.
  let visualSelectedBuildingCache=null;

  function selectedBuildingVisuals(){
    if(visualSelectedBuildingCache)return visualSelectedBuildingCache;
    const features=[...sceneFeatures.values()].filter(feature=>
      feature?.properties?.selected===true
    );
    const red=features.filter(feature=>feature.properties.impacted===true);
    if(!red.length){
      visualSelectedBuildingCache=features;
      return features;
    }
    const origin=mercator(polygon[0][0][0],polygon[0][0][1]);
    const redGeometries=red.map(feature=>({
      box:geometryBBox(feature.geometry),
      clip:geometryToLocalClipInput(feature.geometry,origin)
    })).filter(item=>item.clip?.length);
    const priority=[];
    for(const feature of features){
      if(feature.properties.impacted===true){
        priority.push(feature);
        continue;
      }
      const bbox=geometryBBox(feature.geometry);
      const covering=redGeometries.filter(redItem=>
        boxesIntersect(bbox,redItem.box)
      );
      if(!covering.length){
        priority.push(feature);
        continue;
      }
      try{
        const source=geometryToLocalClipInput(feature.geometry,origin);
        if(!source?.length)continue;
        const freeArea=polygonClipping.difference(
          source,...covering.map(item=>item.clip)
        );
        const remaining=clipOutputToGeometry(freeArea,origin);
        if(remaining)priority.push({...feature,geometry:remaining});
      }catch(error){
        // Rendering a partially suppressed orange feature is worse than not
        // rendering it; flooded red buildings retain visible priority.
        console.warn('Red building priority geometry failed; hide overlapping orange fragment',error);
      }
    }
    visualSelectedBuildingCache=priority;
    return priority;
  }

  function focusBuildingData(){
    return {
      type:'FeatureCollection',
      features:hideSelectedBuildings?[]:selectedBuildingVisuals()
    };
  }

  function updateFocusBuildings(){
    isolateViewer?.getSource(FOCUS_BUILDINGS)?.setData(focusBuildingData());
  }


  function clipRoadToSite(geometry,siteRing){
    const lines=geometry?.type==='LineString'
      ?[geometry.coordinates]
      :geometry?.type==='MultiLineString'
        ?geometry.coordinates:[];
    const outputs=[];
    const sides=closeRing(siteRing);
    const EPS=1e-9;
    for(const line of lines){
      if(!Array.isArray(line)||line.length<2)continue;
      for(let i=1;i<line.length;i++){
        const p=line[i-1],q=line[i];
        if(!Array.isArray(p)||!Array.isArray(q))continue;
        const dx=q[0]-p[0],dy=q[1]-p[1];
        if(Math.abs(dx)+Math.abs(dy)<1e-12)continue;
        const ts=[0,1];
        for(let j=1;j<sides.length;j++){
          const a=sides[j-1],b=sides[j];
          const ex=b[0]-a[0],ey=b[1]-a[1];
          const cross=dx*ey-dy*ex;
          if(Math.abs(cross)<1e-14)continue;
          const apx=a[0]-p[0],apy=a[1]-p[1];
          const t=(apx*ey-apy*ex)/cross;
          const u=(apx*dy-apy*dx)/cross;
          if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS)ts.push(t);
        }
        ts.sort((a,b)=>a-b);
        for(let j=1;j<ts.length;j++){
          const t0=ts[j-1],t1=ts[j];
          if(t1-t0<EPS)continue;
          const mid=(t0+t1)/2;
          if(!pointInRingLngLat([p[0]+dx*mid,p[1]+dy*mid],sides))continue;
          outputs.push([
            [p[0]+dx*t0,p[1]+dy*t0],
            [p[0]+dx*t1,p[1]+dy*t1]
          ]);
        }
      }
    }
    return outputs;
  }


  // Widths below are design-scale estimates in ground metres where OSM does not
  // provide a measured "width" tag. A MapLibre line-width is in screen pixels
  // and stays physically incorrect when zooming or tilting the 3D view.
  function focusRoadWidthMetres(p,cls){
    const raw=String(p.width??p.est_width??'').trim().toLowerCase();
    const matched=raw.match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|')?$/);
    if(matched){
      const value=Number(matched[1])*(matched[2]==='ft'||matched[2]==='feet'||matched[2]==="'"?0.3048:1);
      if(value>=1&&value<=45)return value;
    }
    const lanes=Number(p.lanes);
    if(Number.isFinite(lanes)&&lanes>=1&&lanes<=10 &&
       !/footway|pedestrian|steps|path|cycleway/.test(cls)){
      return Math.min(36,Math.max(3.8,lanes*3.1+1.0));
    }
    if(/steps/.test(cls))return 1.6;
    if(/footway|path|pedestrian|bridleway/.test(cls))return 2.6;
    if(/cycleway/.test(cls))return 3;
    if(/motorway/.test(cls))return 22;
    if(/trunk/.test(cls))return 14;
    if(/primary/.test(cls))return 11;
    if(/secondary/.test(cls))return 9;
    if(/tertiary/.test(cls))return 7.5;
    if(/residential|unclassified/.test(cls))return 6;
    if(/service|track/.test(cls))return 4.5;
    if(/living_street/.test(cls))return 5;
    return 6;
  }

  function focusRoadCapsule(a,b,widthMetres){
    const p=mercator(a[0],a[1]),q=mercator(b[0],b[1]);
    const dx=q[0]-p[0],dy=q[1]-p[1];
    if(Math.hypot(dx,dy)<0.01)return null;

    // Web Mercator is conformal but its metre values are enlarged by sec(lat).
    // Correct the width so, e.g., an 8 m street stays 8 m at London latitude.
    const midLat=(a[1]+b[1])*0.5*Math.PI/180;
    const metresPerProjectedMetre=Math.max(0.15,Math.cos(midLat));
    const radius=widthMetres/(2*metresPerProjectedMetre);
    const heading=Math.atan2(dy,dx);
    const segments=6;
    const ring=[];
    for(let k=0;k<=segments;k++){
      const angle=heading-Math.PI/2+Math.PI*k/segments;
      ring.push(unmercator(q[0]+radius*Math.cos(angle),q[1]+radius*Math.sin(angle)));
    }
    for(let k=0;k<=segments;k++){
      const angle=heading+Math.PI/2+Math.PI*k/segments;
      ring.push(unmercator(p[0]+radius*Math.cos(angle),p[1]+radius*Math.sin(angle)));
    }
    ring.push(ring[0]);
    return {type:'Polygon',coordinates:[ring]};
  }

  function clipFocusRoadSurface(geometry,ring){
    const origin=mercator(ring[0][0],ring[0][1]);
    const subject=geometryToLocalClipInput(geometry,origin);
    const target=selectionToLocalClipInput(ring,origin);
    if(!subject?.length||!target?.length)return null;
    try{
      return clipOutputToGeometry(polygonClipping.intersection(subject,target),origin);
    }catch(error){
      console.warn('Focus road clipping failed',error);
      return null;
    }
  }

  function collectFocusMapDetails(){
    const siteRing=polygon?.[0]||[];
    const selectionBox=bboxLngLat(siteRing);
    // Include roads whose centreline is just OUTSIDE the boundary while their
    // real-width carriageway still intersects the parcel.
    const latMid=(selectionBox.south+selectionBox.north)/2*Math.PI/180;
    const roadPaddingM=40;
    const roadSelectionBox={
      west:selectionBox.west-roadPaddingM/(111320*Math.max(0.15,Math.cos(latMid))),
      east:selectionBox.east+roadPaddingM/(111320*Math.max(0.15,Math.cos(latMid))),
      south:selectionBox.south-roadPaddingM/111320,
      north:selectionBox.north+roadPaddingM/111320
    };
    const roads=[],greens=[],waters=[];
    const seen=new Set();
    const primarySource=map.getLayer(cityBuildingsLayerId)?.source;
    const descriptors=new Map();

    // Use the same real OpenFreeMap vector tiles as the original 3D buildings.
    // Source-layer names follow the OpenMapTiles schema. Querying already loaded
    // tiles avoids a second external data service or invented land-use geometry.
    for(const layerName of ['transportation','landuse','landcover','park','water']){
      if(primarySource)descriptors.set(primarySource+'|'+layerName,{
        source:primarySource,layerName
      });
    }
    // Additional style sources may provide features missing from the dedicated
    // building tile source. Deduplication keeps geometry from appearing twice.
    for(const layer of map.getStyle()?.layers||[]){
      const layerName=String(layer['source-layer']||'');
      if(!['transportation','landuse','landcover','park','water'].includes(layerName))continue;
      if(!layer.source)continue;
      const key=layer.source+'|'+layerName;
      if(!descriptors.has(key))descriptors.set(key,{source:layer.source,layerName});
    }

    for(const {source,layerName} of descriptors.values()){
      let items=[];
      try{items=map.querySourceFeatures(source,{sourceLayer:layerName})||[];}
      catch(error){continue;}
      const maxItems=layerName==='transportation'?9000:3000;
      for(const feature of items.slice(0,maxItems)){
        if(!feature?.geometry)continue;
        if(!boxesIntersect(
          layerName==='transportation'?roadSelectionBox:selectionBox,
          geometryBBox(feature.geometry)
        ))continue;
        const p=feature.properties||{};
        const cls=String(p.class||p.subclass||p.type||'').toLowerCase();
        const kind=feature.geometry.type;
        const dedupe=layerName+'|'+geometryIdentity(feature);
        if(seen.has(dedupe))continue;
        seen.add(dedupe);

        if(layerName==='transportation'&&
          (kind==='LineString'||kind==='MultiLineString')){
          if(/rail|subway|tram|ferry|aerialway|construction/i.test(cls))continue;
          const pedestrian=/footway|pedestrian|steps|path|cycleway|bridleway/i.test(cls);
          const major=/motorway|trunk|primary|secondary/i.test(cls);
          const kind=pedestrian?'pedestrian':major?'major':'street';
          const width=focusRoadWidthMetres(p,cls);
          // Build ground footprints in metres before clipping. Pixel-width
          // centerlines are not a scaled representation of carriageway area.
          const lines=kind&&feature.geometry.type==='LineString'
            ?[feature.geometry.coordinates]:feature.geometry.coordinates;
          for(const line of lines){
            if(!Array.isArray(line)||line.length<2)continue;
            for(let i=1;i<line.length;i++){
              if(roads.length>=8000)break;
              const a=line[i-1],b=line[i];
              // Casing is +0.8 m total width; both polygons are geo-clipped
              // to the red site, including roads along an outside boundary.
              for(const [part,roadWidth] of [
                ['casing',width+0.8],['surface',width]
              ]){
                const corridor=focusRoadCapsule(a,b,roadWidth);
                if(!corridor)continue;
                if(!boxesIntersect(selectionBox,geometryBBox(corridor)))continue;
                const inside=clipFocusRoadSurface(corridor,siteRing);
                if(!inside)continue;
                roads.push({
                  type:'Feature',
                  properties:{class:cls,kind,part,widthMetres:width},
                  geometry:inside
                });
              }
            }
            if(roads.length>=8000)break;
          }
        }else if(
          (kind==='Polygon'||kind==='MultiPolygon')&&
          ['landuse','landcover','park','water'].includes(layerName)
        ){
          const isWater=layerName==='water';
          const isGreen=layerName==='park'||
            (layerName==='landcover'&&/grass|wood|forest|scrub|wetland|farmland|orchard/i.test(cls))||
            (layerName==='landuse'&&/park|grass|forest|garden|cemetery|recreation|pitch|playground|village_green|meadow|allotment|farmland/i.test(cls));
          if(!isWater&&!isGreen)continue;
          const output=isWater?waters:greens;
          if(output.length>=2500)continue;
          const inside=splitBuildingBySelection(feature.geometry,siteRing).inside;
          if(!inside)continue;
          output.push({
            type:'Feature',
            properties:{class:cls},
            geometry:inside
          });
        }
      }
    }
    const collection=features=>({type:'FeatureCollection',features});
    return {
      roads:collection(roads),
      greens:collection(greens),
      waters:collection(waters)
    };
  }


  const SPONGE_DESIGN_OPTIONS={
    navigate:{label:'导航 / 旋转',radiusM:0,color:'#5cbbc5'},
    rainGarden:{label:'雨水花园',radiusM:12,color:'#3da99f'},
    wetland:{label:'人工湿地',radiusM:28,color:'#65baaa'},
    agriculture:{label:'农业滞洪',radiusM:42,color:'#a6b665'},
    floodPark:{label:'蓄洪公园',radiusM:35,color:'#469dcf'},
    permeable:{label:'透水铺装',radiusM:16,color:'#b8bd98'},
    erase:{label:'擦除干预',radiusM:0,color:'#d76a7a'}
  };
  const spongeCollection=features=>({type:'FeatureCollection',features});

  function siteSpongeFeature(item){
    const [cx,cy]=mercator(item.lng,item.lat);
    const projected=item.radiusM/Math.max(.15,Math.cos(item.lat*Math.PI/180));
    const ring=[];
    for(let i=0;i<32;i++){
      const angle=Math.PI*2*i/32;
      ring.push(unmercator(cx+Math.cos(angle)*projected,cy+Math.sin(angle)*projected));
    }
    ring.push(ring[0]);
    // Clip the visual footprint to the exact georeferenced study parcel.
    const clipped=splitBuildingBySelection({type:'Polygon',coordinates:[ring]},polygon[0]).inside;
    if(!clipped)return null;
    return {type:'Feature',geometry:clipped,properties:{
      id:item.id,type:item.type,color:SPONGE_DESIGN_OPTIONS[item.type].color
    }};
  }
  function redrawSpongeSite(){
    const source=isolateViewer?.getSource(FOCUS_SPONGE_SOURCE);
    if(source){
      source.setData(spongeCollection(siteFacilities.map(siteSpongeFeature).filter(Boolean)));
    }
    setSiteHud('siteHudSpongeCount',siteFacilities.length+' 处已布置');
    const el=siteHud('siteHudSpongeHint');
    if(el)el.textContent=spongeTool==='navigate'?
      '导航模式：左键移动视角，右键旋转；点击设施模式后在地块内放置。':
      spongeTool==='erase'?'擦除模式：单击场地内已有设施即可删除。':
        '正在布置'+SPONGE_DESIGN_OPTIONS[spongeTool].label+
        ' · 半径 '+SPONGE_DESIGN_OPTIONS[spongeTool].radiusM+' m（初始设计假设）';
  }
  function isBuildingGroundPoint(point){
    for(const feat of sceneFeatures.values()){
      if(!feat?.properties?.selected)continue;
      const g=feat.geometry;
      if(!g)continue;
      const polys=g.type==='Polygon'?[g.coordinates]:
        g.type==='MultiPolygon'?g.coordinates:[];
      for(const rings of polys){
        if(!rings?.length||!pointInRingLngLat(point,rings[0]))continue;
        if(!rings.slice(1).some(hole=>pointInRingLngLat(point,hole)))return true;
      }
    }
    return false;
  }
  function resetRunAfterSpongeChange(){
    // Changing facilities mid-run would merge two different scenarios.
    // Reset time/water first, then send revised facility assumptions.
    simulator?.pause();
    simulator?.reset();
    simulator?.setParams(currentParams());
    hydroState='reset';lastHydroFrame=null;
    siteHydroHistory.length=0;
    updateSiteHydroDashboard();
    redrawSpongeSite();
  }
  function switchSpongeTool(type){
    if(!SPONGE_DESIGN_OPTIONS[type])return;
    spongeTool=type;
    for(const btn of isolateViewerElement?.querySelectorAll('[data-sponge-tool]')||[]){
      const on=btn.dataset.spongeTool===type;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-pressed',on?'true':'false');
    }
    const cv=isolateViewer?.getCanvas();
    if(cv)cv.style.cursor=type==='navigate'?'grab':type==='erase'?'not-allowed':'crosshair';
    redrawSpongeSite();
  }
  function onSpongeMapClick(event){
    if(!isolatedSelection||!SPONGE_DESIGN_OPTIONS[spongeTool]||
      spongeTool==='navigate')return;
    const p=[event.lngLat.lng,event.lngLat.lat];
    if(!pointInRingLngLat(p,polygon[0])){
      setSiteHud('siteHudSpongeHint','操作必须位于红色地块边界内。');
      return;
    }
    if(spongeTool==='erase'){
      const [mx,my]=mercator(p[0],p[1]);
      let closest=null,min=Infinity;
      for(const item of siteFacilities){
        const [x,y]=mercator(item.lng,item.lat);
        const distance=Math.hypot(x-mx,y-my)*Math.cos(item.lat*Math.PI/180);
        if(distance<item.radiusM+8&&distance<min){closest=item;min=distance;}
      }
      if(!closest){setSiteHud('siteHudSpongeHint','附近未找到可删除的设施。');return;}
      siteFacilities=siteFacilities.filter(v=>v.id!==closest.id);
    }else{
      if(isBuildingGroundPoint(p)){
        setSiteHud('siteHudSpongeHint','此处为真实建筑占地，请选择建筑外的空地。');
        return;
      }
      const option=SPONGE_DESIGN_OPTIONS[spongeTool];
      if(siteFacilities.length>=100){
        setSiteHud('siteHudSpongeHint','场地最多允许布置 100 处设施。');
        return;
      }
      siteFacilities.push({
        id:nextFacilityId++,type:spongeTool,
        lng:p[0],lat:p[1],radiusM:option.radiusM
      });
    }
    resetRunAfterSpongeChange();
  }
  function updateHydroLayerVisibility(){
    const viewer=isolateViewer;
    if(!viewer)return;
    if(viewer.getLayer(FOCUS_RAIN_LAYER)){
      const display=hydroDisplay.depth?'visible':'none';
      if(viewer.getLayoutProperty(FOCUS_RAIN_LAYER,'visibility')!==display)
        viewer.setLayoutProperty(FOCUS_RAIN_LAYER,'visibility',display);
    }
    if(viewer.getLayer(FOCUS_FLOW_LAYER)){
      const desired=hydroDisplay.flow?'visible':'none';
      if(viewer.getLayoutProperty(FOCUS_FLOW_LAYER,'visibility')!==desired){
        viewer.setLayoutProperty(FOCUS_FLOW_LAYER,'visibility',desired);
      }
    }
    for(const id of [FOCUS_2D,FOCUS_3D]){
      if(viewer.getLayer(id))viewer.setPaintProperty(id,
        id===FOCUS_3D?'fill-extrusion-color':'fill-color',
        hydroDisplay.collision?buildingColourExpression():'#ff9f1a');
    }
    simulator?.setParams(currentParams());
  }

  function focusStyle(details){
    const analysis=focusContextSettings();
    const parcel={
      type:'FeatureCollection',
      features:[{
        type:'Feature',properties:{},
        geometry:{type:'Polygon',coordinates:[closeRing(polygon[0])]}
      }]
    };
    return {
      version:8,
      sources:{
        [FOCUS_SITE]:{type:'geojson',data:parcel},
        [FOCUS_BUILDINGS]:{type:'geojson',data:focusBuildingData()},
        [FOCUS_GREEN]:{type:'geojson',data:details.greens},
        [FOCUS_WATER]:{type:'geojson',data:details.waters},
        [FOCUS_ROADS]:{type:'geojson',data:details.roads},
        [FOCUS_SPONGE_SOURCE]:{type:'geojson',data:spongeCollection(
          siteFacilities.map(siteSpongeFeature).filter(Boolean)
        )},
        [FOCUS_FLOW_SOURCE]:{type:'geojson',data:spongeCollection([])},
        [FOCUS_EA_SOURCE]:{
          type:'raster',tiles:[focusContextUrl('ea',analysis.threshold)],
          tileSize:512,minzoom:13,maxzoom:17
        },
        [FOCUS_DRAINAGE_SOURCE]:{
          type:'raster',tiles:[focusContextUrl('drainage',analysis.threshold)],
          tileSize:512,minzoom:8,maxzoom:18
        },
        ...(canvas&&focusWaterBounds?{
          [FOCUS_RAIN_SOURCE]:{
            type:'canvas',canvas:canvas.id,animate:true,
            coordinates:focusWaterBounds
          }
        }:{})
      },
      layers:[
        {id:'focus-background',type:'background',
          paint:{'background-color':'#f4f2ed'}},
        {id:'focus-parcel-ground',type:'fill',source:FOCUS_SITE,
          paint:{'fill-color':'#e8e7e2','fill-opacity':1}},
        {id:'focus-green-ground',type:'fill',source:FOCUS_GREEN,
          paint:{'fill-color':'#bfd9b1','fill-opacity':0.95}},
        {id:'focus-water-ground',type:'fill',source:FOCUS_WATER,
          paint:{'fill-color':'#a8d5ec','fill-opacity':0.95}},
        {id:FOCUS_EA_LAYER,type:'raster',source:FOCUS_EA_SOURCE,
          layout:{visibility:'none'},
          paint:{'raster-opacity':0.30,'raster-resampling':'nearest','raster-fade-duration':0}},
        {id:FOCUS_DRAINAGE_LAYER,type:'raster',source:FOCUS_DRAINAGE_SOURCE,
          layout:{visibility:'none'},
          paint:{'raster-opacity':0.52,'raster-resampling':'linear','raster-fade-duration':0}},
        {id:'focus-road-casing',type:'fill',source:FOCUS_ROADS,
          filter:['==',['get','part'],'casing'],
          paint:{
            'fill-color':'#c4c2bd',
            'fill-opacity':0.92
          }},
        {id:'focus-road-surface',type:'fill',source:FOCUS_ROADS,
          filter:['==',['get','part'],'surface'],
          paint:{
            'fill-color':['match',['get','kind'],
              'major','#f8f5f0','pedestrian','#e8e2d1','#ffffff'],
            'fill-opacity':1
          }},
        {id:FOCUS_FLOW_LAYER,type:'line',source:FOCUS_FLOW_SOURCE,
          layout:{visibility:'visible'},
          paint:{'line-color':'#f1fdff','line-width':1.5,'line-opacity':0.92}},
        {id:FOCUS_SPONGE_FILL,type:'fill',source:FOCUS_SPONGE_SOURCE,
          paint:{'fill-color':['get','color'],'fill-opacity':0.78}},
        {id:FOCUS_SPONGE_LINE,type:'line',source:FOCUS_SPONGE_SOURCE,
          paint:{'line-color':'#175967','line-width':1.5}},
        ...(canvas&&focusWaterBounds?[{
          id:FOCUS_RAIN_LAYER,type:'raster',source:FOCUS_RAIN_SOURCE,
          paint:{'raster-opacity':0.94,'raster-resampling':'linear','raster-fade-duration':0}
        }]:[]),
        // The dashed red boundary is a ground-level graphic, not an overlay
        // painted across roofs/walls. Extruded buildings must draw after it
        // for physically correct occlusion from every camera bearing.
        {id:'focus-parcel-border',type:'line',source:FOCUS_SITE,
          paint:{'line-color':'#ef4444','line-width':2.6,'line-dasharray':[2,1]}},
        {id:FOCUS_2D,type:'fill',source:FOCUS_BUILDINGS,
          layout:{visibility:'none'},
          paint:{'fill-color':buildingColourExpression(),'fill-opacity':1}},
        {id:FOCUS_3D,type:'fill-extrusion',source:FOCUS_BUILDINGS,
          layout:{visibility:'visible'},
          paint:{
            'fill-extrusion-color':buildingColourExpression(),
            'fill-extrusion-height':['get','simHeight'],
            'fill-extrusion-base':['get','simBase'],
            'fill-extrusion-opacity':1,
            'fill-extrusion-vertical-gradient':false
          }}
      ]
    };
  }

  function setFocusPitchMode(){
    const viewer=isolateViewer;
    if(!viewer)return;
    const is3D=viewer.getPitch()>.5;
    for(const [id,v] of [
      [FOCUS_2D,is3D?'none':'visible'],
      [FOCUS_3D,is3D?'visible':'none']
    ]){
      if(viewer.getLayer(id)&&viewer.getLayoutProperty(id,'visibility')!==v){
        viewer.setLayoutProperty(id,'visibility',v);
      }
    }
  }

  function destroyFocusViewer(){
    if(focusThresholdTimer)clearTimeout(focusThresholdTimer);
    focusThresholdTimer=null;
    const viewer=isolateViewer;
    isolateViewer=null;
    if(viewer){
      try{viewer.remove();}catch(error){
        console.warn('Isolated viewer removal failed',error);
      }
    }
    isolateViewerElement?.remove();
    isolateViewerElement=null;
  }


  // All elements belong to the independent site map, never the city selection panel.
  const siteHud=id=>isolateViewerElement?.querySelector('#'+id);
  function setSiteHud(id,value){
    const el=siteHud(id);if(el)el.textContent=String(value);
  }
  function copyHudControl(target,value,event='input'){
    const el=$(target);if(!el)return;
    if(el.type==='checkbox')el.checked=Boolean(value);
    else el.value=String(value);
    el.dispatchEvent(new Event(event,{bubbles:true}));
  }
  function simulationClock(m){
    m=Math.max(0,Math.round(m||0));
    return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  }
  function setSiteRainMode(){
    const names={
      manual:'情景：手动输入降雨强度',
      'ea-observed':'情景：EA 实测雨量站 4h 回放',
      'feh-manual':'情景：手动 FEH 4h 设计量（均匀时程假设）'
    };
    setSiteHud('siteHudRainMode',names[rainfallMode]||names.manual);
    if(siteHud('siteHudUseEA'))siteHud('siteHudUseEA').disabled=
      !(siteRainData?.complete&&siteRainData?.recent);
  }
  function syncSiteControls(){
    const ids=[
      ['siteHudRain','localFloodRain'],
      ['siteHudInfil','localFloodInfil'],
      ['siteHudDuration','localFloodDuration']
    ];
    for(const [a,b] of ids)if(siteHud(a)&&$(b))siteHud(a).value=$(b).value;
    for(const [a,b] of [
      ['siteHudEA','localFloodFocusEA'],
      ['siteHudDrainage','localFloodFocusDrainage'],
      ['siteHudGuide','localFloodDrainageGuide']
    ])if(siteHud(a)&&$(b))siteHud(a).checked=$(b).checked;
    if(siteHud('siteHudThreshold'))siteHud('siteHudThreshold').value=
      Number($('networkThreshold')?.value||1).toFixed(3);
    setSiteHud('siteHudRainValue',$('localFloodRain')?.value+' mm/h');
    if(siteHud('siteHudManualRain')&&rainfallMode==='manual'){
      siteHud('siteHudManualRain').value=$('localFloodRain').value;
    }
    setSiteHud('siteHudInfilValue',$('localFloodInfil')?.value+' mm/h');
    setSiteHud('siteHudDurationValue',$('localFloodDuration')?.value+' min');
    setSiteHud('siteHudGrid',$('localFloodGridInfo')?.textContent||'');
    setSiteRainMode();
  }
  function updateSiteHydroDashboard(frame=lastHydroFrame){
    if(!isolatedSelection)return;
    const v=frame?.stats;
    if(v){
      setSiteHud('siteHudDepth',v.maxDepthM.toFixed(2)+' m');
      setSiteHud('siteHudArea',(v.wetAreaM2/1e4).toFixed(2)+' ha');
      setSiteHud('siteHudImpacted',v.impactedCount+' 栋');
      setSiteHud('siteHudVolume',Math.round(v.volumeM3).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudRetained',Math.round(v.retainedM3||0).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudExtraInfil',Math.round(v.spongeInfiltrationM3||0).toLocaleString('en-GB')+' m³');
    }
    const elapsed=v?.timeMin||0,duration=Number($('localFloodDuration')?.value)||60;
    setSiteHud('siteHudClock',simulationClock(elapsed)+' / '+simulationClock(duration));
    if(v&&Number.isFinite(v.currentRainMmH)){
      setSiteHud('siteHudLiveRain',v.currentRainMmH.toFixed(1)+' mm/h');
    }
    const progress=siteHud('siteHudProgress');
    if(progress)progress.style.width=Math.max(0,Math.min(100,elapsed/duration*100)).toFixed(1)+'%';
    setSiteHud('siteHudRunState',{
      ready:'准备就绪',running:'模拟运行中',paused:'已暂停',complete:'模拟完成',reset:'已重置'
    }[hydroState]||'等待模拟');
    if(siteHud('siteHudRun'))siteHud('siteHudRun').disabled=!prepared||hydroState==='running';
    if(siteHud('siteHudPause'))siteHud('siteHudPause').disabled=!prepared||hydroState!=='running';
    const chart=siteHud('siteHudChart');
    if(chart&&siteHydroHistory.length){
      chart.replaceChildren();
      const mx=Math.max(.02,...siteHydroHistory.map(r=>r[1]));
      for(const [t,depth] of siteHydroHistory){
        const bar=document.createElement('span');
        bar.style.height=Math.max(2,Math.round(depth/mx*48))+'px';
        bar.title=simulationClock(t)+' / '+depth.toFixed(2)+'m';
        chart.appendChild(bar);
      }
    }
  }

  async function rainfallJSON(url,timeout=11500){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(url,{
        signal:controller.signal,headers:{Accept:'application/json'},
        cache:'no-store'
      });
      if(!response.ok)throw new Error('EA HTTP '+response.status);
      return await response.json();
    }finally{clearTimeout(timer);}
  }
  function rainfallDistanceKm(a,b,c,d){
    const deg=Math.PI/180,R=6371;
    const h=Math.sin((c-a)*deg/2)**2+
      Math.cos(a*deg)*Math.cos(c*deg)*Math.sin((d-b)*deg/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function rainfallMeasureFromStation(st){
    const measures=Array.isArray(st.measures)?st.measures:
      (st.measures?[st.measures]:[]);
    const selected=measures.find(m=>{
      if(!m||typeof m==='string')return false;
      const param=String(m.parameter||m.parameterName||'').toLowerCase();
      return param.includes('rain')&&
        (!m.period||Number(m.period)===900)&&
        (!m.unitName||String(m.unitName).toLowerCase()==='mm');
    });
    return selected||null;
  }
  function rainMeasureUri(m){
    if(!m)return null;
    const value=String(m['@id']||m.id||m.uri||'');
    if(!value)return null;
    try{
      const path=new URL(value.replace(/^http:\/\//,'https://')).pathname;
      const name=path.split('/').filter(Boolean).pop().replace(/\.(json|html)$/,'');
      if(!name)return null;
      return 'https://environment.data.gov.uk/flood-monitoring/id/measures/'+encodeURIComponent(name);
    }catch{return null;}
  }
  function parseEa15MinuteSeries(items){
    // EA tipping-bucket readings are 15-minute accumulated totals, NOT mm/h.
    const records=(Array.isArray(items)?items:[]).map(row=>({
      t:new Date(row.dateTime||row.date||'').getTime(),
      v:row.value===null||row.value===undefined?NaN:Number(row.value)
    })).filter(row=>Number.isFinite(row.t)&&Number.isFinite(row.v)&&
      row.v>=0&&row.v<=250).sort((a,b)=>a.t-b.t);
    const unique=new Map();
    for(const row of records)unique.set(row.t,row.v);
    const ordered=[...unique].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));
    if(!ordered.length)return null;
    // Use the last 16 QUARTER-HOUR slots only if their spacing is genuinely
    // contiguous; do not hide missing observations by inventing interpolation.
    const recent=ordered.slice(-16);
    const complete=recent.length===16 &&
      recent.every((row,i)=>i===0||Math.abs(row.t-recent[i-1].t-900000)<=90000);
    const latest=ordered.at(-1).t;
    const ageHours=Math.max(0,(Date.now()-latest)/3600000);
    return {
      latestTime:new Date(latest).toISOString(),
      readingCount:recent.length,
      series15:complete?recent.map(row=>row.v):null,
      total4h:complete?recent.reduce((total,row)=>total+row.v,0):null,
      complete,recent:ageHours<=24,ageHours
    };
  }
  async function lookupSiteRainForSelection(){
    if(!isolatedSelection||!polygon?.[0])return;
    const request=++siteRainRequest;
    const b=bboxLngLat(polygon[0]);
    const lat=(b.south+b.north)/2,lon=(b.west+b.east)/2;
    setSiteHud('siteHudRainStation','正在以场地中心经纬度查找 EA 附近雨量站…');
    setSiteHud('siteHudRainTime','最近可用 4h 观测 · 官方 EA Rainfall API（Beta）');
    setSiteHud('siteHudRainTotal','— mm / 4h');
    siteRainData=null;
    if(rainfallMode==='ea-observed'){
      rainfallMode='manual';
      simulator?.pause();simulator?.reset();
      hydroState='reset';siteHydroHistory.length=0;
    }
    setSiteRainMode();
    const root='https://environment.data.gov.uk/flood-monitoring';
    try{
      let stations=[];
      for(const radius of [10,25,50]){
        const url=root+'/id/stations?parameter=rainfall&lat='+lat+
          '&long='+lon+'&dist='+radius+'&_view=full&_limit=160';
        const data=await rainfallJSON(url);
        if(request!==siteRainRequest||!isolatedSelection)return;
        if(Array.isArray(data.items)&&data.items.length){
          stations=data.items;break;
        }
      }
      if(!stations.length)throw new Error('场地 50 km 内没有可查询的雨量站');
      const candidates=stations.map(st=>{
        const a=Number(st.lat),b=Number(st.long);
        return {st,d:Number.isFinite(a)&&Number.isFinite(b)?
          rainfallDistanceKm(lat,lon,a,b):Infinity};
      }).filter(r=>Number.isFinite(r.d)).sort((a,b)=>a.d-b.d);
      let bestPartial=null,lastError=null;
      for(const {st,d} of candidates.slice(0,8)){
        if(request!==siteRainRequest||!isolatedSelection)return;
        try{
          // Station URI path is the API identifier; stationReference may be a
          // different telemetry-system reference at some sites.
          const ref=String(st['@id']||'').split('/').filter(Boolean).pop()||
            String(st.notation||st.stationReference||'').trim();
          if(!ref)continue;
          const measure=rainfallMeasureFromStation(st);
          // Query a known 15-minute mm rainfall measure, not all station
          // measurements (which can contain temperatures and other quantities).
          let measureUrl=rainMeasureUri(measure);
          if(!measureUrl){
            const data=await rainfallJSON(root+'/id/stations/'+
              encodeURIComponent(ref)+'/measures');
            const list=Array.isArray(data.items)?data.items:[];
            measureUrl=rainMeasureUri(rainfallMeasureFromStation({measures:list}));
          }
          if(!measureUrl)continue;
          const since=new Date(Date.now()-72*3600*1000).toISOString();
          const json=await rainfallJSON(measureUrl+'/readings?since='+
            encodeURIComponent(since)+'&_limit=1000&_sorted');
          const record=parseEa15MinuteSeries(json.items);
          if(!record)continue;
          const payload={
            ...record,stationRef:ref,distanceKm:d,
            name:String(st.label||st.name||ref),
            siteLat:lat,siteLon:lon,
            source:'Environment Agency rainfall real-time data API (Beta)'
          };
          if(!bestPartial)bestPartial=payload;
          if(payload.complete){
            bestPartial=payload;
            // Nearest reporting station with a complete four-hour window.
            break;
          }
        }catch(error){lastError=error;}
      }
      if(request!==siteRainRequest||!isolatedSelection)return;
      if(!bestPartial)throw lastError||new Error('附近雨量站没有有效 15 分钟雨量记录');
      siteRainData=bestPartial;
      setSiteHud('siteHudRainStation','测站 '+bestPartial.name+
        ' ('+bestPartial.stationRef+') · 距地块中心 '+bestPartial.distanceKm.toFixed(1)+' km');
      setSiteHud('siteHudRainTotal',bestPartial.complete?
        bestPartial.total4h.toFixed(1)+' mm / 4h':'4h 记录不完整');
      const stamp=new Date(bestPartial.latestTime).toLocaleString('en-GB',{
        year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'
      });
      setSiteHud('siteHudRainTime','数据截至 '+stamp+' · '+bestPartial.readingCount+
        ' 条 15min 记录'+(!bestPartial.complete?' · 有缺测，无法回放':
          !bestPartial.recent?' · 非最近 24h，禁用实时回放':' · 可以回放'));
      setSiteRainMode();
    }catch(error){
      if(request!==siteRainRequest||!isolatedSelection)return;
      setSiteHud('siteHudRainStation','EA 实测降雨不可用');
      setSiteHud('siteHudRainTime','官方查询失败：'+String(error?.message||error)+
        '。仍可手动测试；未使用虚构雨量。');
      setSiteRainMode();
    }
  }

  function mountSiteHydroDashboard(container){
    const shell=document.createElement('div');
    shell.className='site-hydro-ui';
    shell.innerHTML=[
      '<header class="site-hydro-header"><div class="site-hydro-brand">LONDON 2100 · HYDRO LAB',
      '<small>REAL SITE FLOOD ANALYSIS · OS TERRAIN 50</small></div>',
      '<span class="site-hydro-chip">EA RISK / DRAINAGE / RAINFALL</span>',
      '<button id="siteHudTop" class="site-hydro-btn" type="button" style="flex:0 0 58px">2D</button>',
      '<button id="siteHudIso" class="site-hydro-btn" type="button" style="flex:0 0 58px">3D</button>',
      '<button id="siteHudExit" class="site-hydro-close" type="button">✕ 返回城市地图 · Esc</button></header>',
      '<section class="site-hydro-side site-hydro-left">',
      '<div class="site-hydro-eyebrow">SCENARIO BUILDER</div>',
      '<div class="site-hydro-title">真实场地洪涝模拟</div>',
      '<div class="site-hydro-pill"><div id="siteHudLocation">查询地块坐标…</div><small id="siteHudGrid"></small></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">01 · 位置降雨数据</div>',
      '<div class="site-hydro-mini" id="siteHudRainStation">查找 EA 雨量站中…</div>',
      '<div class="site-hydro-value" id="siteHudRainTotal">— mm / 4h</div>',
      '<div class="site-hydro-mini" id="siteHudRainTime">等待测站时间和数据完整性</div>',
      '<div class="site-hydro-actions">',
      '<button type="button" class="site-hydro-btn" id="siteHudRefresh">重新查询 EA</button>',
      '<button type="button" class="site-hydro-btn primary" id="siteHudUseEA" disabled>使用实测回放</button></div>',
      '<div class="site-hydro-mini" style="margin-top:6px" id="siteHudRainMode">手动降雨强度情景</div>',
      '<div class="site-hydro-row"><span>FEH22 4h 设计量</span><input id="siteHudFeh" type="number" min="0.1" max="500" step="0.1" placeholder="mm" style="width:94px"></div>',
      '<div class="site-hydro-row"><span>手动情景雨强</span><input id="siteHudManualRain" type="number" min="0" max="150" step="5" value="50" style="width:84px"><small>mm/h</small></div>',
      '<div class="site-hydro-actions"><button type="button" id="siteHudUseFeh" class="site-hydro-btn">手动应用设计量</button>',
      '<button type="button" id="siteHudUseManual" class="site-hydro-btn">使用手动雨强</button></div>',
      '<div class="site-hydro-mini">EA 雨量为 15 分钟累计观测，测站上传可能延迟；非实时场地雨强。FEH22 需在 ',
      '<a href="https://fehweb.ceh.ac.uk/" target="_blank" rel="noopener noreferrer" style="color:#8ce5ea">FEH 官网 ↗</a>',
      ' 查询后填入；EA 数据为附近测站实测，不能视为场地实测。</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">基础数据 · 三因素联合分析</div>',
      '<label class="site-hydro-check"><input type="checkbox" id="siteHudEA" checked> EA 现状洪水风险等级（参考）</label>',
      '<label class="site-hydro-check"><input type="checkbox" id="siteHudDrainage" checked> DEM 推导排水网络（参考）</label>',
      '<label class="site-hydro-check"><input type="checkbox" id="siteHudGuide" checked> 汇水路径引导下坡流动</label>',
      '<div class="site-hydro-row">汇水阈值 <input id="siteHudThreshold" type="number" min="0" max="50" step="0.001" style="width:85px"> km²</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">02 · 海绵城市设计',
      '<span class="site-hydro-counter" id="siteHudSpongeCount">0 处已布置</span></div>',
      '<div class="site-hydro-mini" style="margin-bottom:8px">在地块内点击布置设施。设施位置取自真实经纬度，默认尺寸和入渗/滞蓄能力属于可比较的概念设计假设。</div>',
      '<div class="site-hydro-tool-grid">',
      '<button type="button" class="site-hydro-tool active" data-sponge-tool="navigate" aria-pressed="true">✥ 导航 / 旋转</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="rainGarden" aria-pressed="false"><i style="background:#3da99f"></i> 雨水花园</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="wetland" aria-pressed="false"><i style="background:#65baaa"></i> 人工湿地</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="agriculture" aria-pressed="false"><i style="background:#a6b665"></i> 农业滞洪</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="floodPark" aria-pressed="false"><i style="background:#469dcf"></i> 蓄洪公园</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="permeable" aria-pressed="false"><i style="background:#b8bd98"></i> 透水铺装</button>',
      '<button type="button" class="site-hydro-tool" data-sponge-tool="erase" aria-pressed="false">⌫ 擦除干预</button>',
      '<button type="button" class="site-hydro-tool" id="siteHudResetSponge">↺ 恢复默认</button>',
      '</div>',
      '<div class="site-hydro-mini" id="siteHudSpongeHint" style="margin-top:8px">选择一种设施，然后在场地上单击。</div>',
      '<div class="site-hydro-mini" style="margin-top:6px">下雨模拟以 50 m DEM 为底图计算。设施的局部额外入渗和可容纳水深采用概念参数，不应视为现场试验值。</div>',
      '</div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">03 · 显示</div>',
      '<label class="site-hydro-check"><input id="siteHudShowDepth" type="checkbox" checked> 水深</label>',
      '<label class="site-hydro-check"><input id="siteHudShowFlow" type="checkbox" checked> 水流向量场</label>',
      '<label class="site-hydro-check"><input id="siteHudShowCollision" type="checkbox" checked> 建筑碰撞效果</label>',
      '<div class="site-hydro-mini">水流箭头依据网格水位梯度计算方向；只是方向示意，不是经过校准的流速或二维水动力解。</div>',
      '</div></section>',
      '<aside class="site-hydro-side site-hydro-right">',
      '<div class="site-hydro-eyebrow">LIVE PERFORMANCE</div><div class="site-hydro-title">场地模拟结果</div>',
      '<div class="site-hydro-metric"><small>MAX DEPTH · 最大地表水深</small><b id="siteHudDepth">0.00 m</b></div>',
      '<div class="site-hydro-metric"><small>WET AREA · 积水面积 ≥ 0.02 m</small><b id="siteHudArea">0.00 ha</b></div>',
      '<div class="site-hydro-metric"><small>IMPACTED BUILDINGS · 受影响建筑</small><b id="siteHudImpacted">0 栋</b></div>',
      '<div class="site-hydro-metric"><small>SURFACE WATER · 地表积水体积</small><b id="siteHudVolume">0 m³</b></div>',
      '<div class="site-hydro-metric"><small>SPONGE STORAGE · 设施内滞蓄水量</small><b id="siteHudRetained">0 m³</b></div>',
      '<div class="site-hydro-metric"><small>ADDITIONAL INFILTRATION · 设施额外累计下渗</small><b id="siteHudExtraInfil">0 m³</b></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">LIVE RAINFALL · 当前计算雨强</div>',
      '<div class="site-hydro-value" id="siteHudLiveRain">— mm/h</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">MAX DEPTH · 水深变化</div>',
      '<div id="siteHudChart" class="site-hydro-chart"></div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">EA RISK · 官方长期概率分类</div>',
      '<div class="site-hydro-mini" style="line-height:1.9">',
      '<span style="color:#9cdeea">■</span> 极低 &lt;0.1% · ',
      '<span style="color:#f7d359">■</span> 低 0.1–&lt;1%<br>',
      '<span style="color:#f29d38">■</span> 中 1–&lt;3.3% · ',
      '<span style="color:#d73731">■</span> 高 ≥3.3%</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">MAP DATA STATUS</div>',
      '<div id="siteHudEAStatus" class="site-hydro-mini">EA 风险：等待瓦片</div>',
      '<div id="siteHudDrainStatus" class="site-hydro-mini">地形网络：等待瓦片</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">DATA PROVENANCE</div>',
      '<div class="site-hydro-mini">EA 风险等级 = 长期概率，不是水深；地形网络 = 汇水路径，不是地下管网；',
      '动态水深 = 输入降雨、地形和建筑障碍的概念模拟。此工具不能替代工程级洪水模型。</div></div></aside>',
      '<div class="site-hydro-zoom">独立地块 3D · 拖动平移 / 右键旋转 / 滚轮缩放</div>',
      '<footer class="site-hydro-footer">',
      '<button id="siteHudRun" class="site-hydro-btn primary" style="flex:0 0 85px" type="button">▶ 运行</button>',
      '<button id="siteHudPause" class="site-hydro-btn" style="flex:0 0 70px" type="button">Ⅱ 暂停</button>',
      '<button id="siteHudReset" class="site-hydro-btn" style="flex:0 0 75px" type="button">↺ 重置</button>',
      '<div class="site-hydro-timeline"><div style="display:flex;justify-content:space-between">',
      '<strong id="siteHudClock">00:00 / 01:00</strong><span id="siteHudRunState" class="site-hydro-mini">准备就绪</span>',
      '</div><div class="site-hydro-track"><div id="siteHudProgress" class="site-hydro-progress"></div></div>',
      '<div class="site-hydro-mini" id="siteHudNotice">计算时间轴 · 不支持回放拖动</div></div></footer>'
    ].join('');
    container.appendChild(shell);
    const bounds=bboxLngLat(polygon[0]);
    setSiteHud('siteHudLocation','Lat '+((bounds.south+bounds.north)/2).toFixed(5)+
      ' · Lon '+((bounds.west+bounds.east)/2).toFixed(5));
    syncSiteControls();
    updateSiteHydroDashboard();

    const resetForNewRain=()=>{
      if(simulator){simulator.pause();simulator.reset();}
      hydroState='reset';siteHydroHistory.length=0;lastHydroFrame=null;
      updateSiteHydroDashboard();
    };
    siteHud('siteHudExit').onclick=()=>exitSelectionIsolate();
    siteHud('siteHudTop').onclick=()=>isolateViewer?.easeTo({
      pitch:0,bearing:0,duration:450
    });
    siteHud('siteHudIso').onclick=()=>isolateViewer?.easeTo({
      pitch:52,bearing:isolateViewer?.getBearing()||-24,duration:500
    });
    siteHud('siteHudRefresh').onclick=lookupSiteRainForSelection;
    siteHud('siteHudUseManual').onclick=()=>{
      const proposed=Number(siteHud('siteHudManualRain').value);
      if(!Number.isFinite(proposed)||proposed<0||proposed>150){
        setSiteHud('siteHudRainTime','请设置 0–150 mm/h 的有效手动情景雨强。');return;
      }
      rainfallMode='manual';manualFourHourMm=null;
      copyHudControl('localFloodRain',Math.round(proposed/5)*5,'input');
      setSiteRainMode();
      resetForNewRain();
    };
    siteHud('siteHudUseEA').onclick=()=>{
      if(!siteRainData?.complete||!siteRainData?.recent)return;
      rainfallMode='ea-observed';manualFourHourMm=null;
      copyHudControl('localFloodDuration',240);
      resetForNewRain();syncSiteControls();updateSiteHydroDashboard();
    };
    siteHud('siteHudUseFeh').onclick=()=>{
      const mm=Number(siteHud('siteHudFeh').value);
      if(!Number.isFinite(mm)||mm<=0||mm>500){
        setSiteHud('siteHudRainTime','设计暴雨请输入 0–500 mm 的有效 4h 总量。');return;
      }
      rainfallMode='feh-manual';manualFourHourMm=mm;
      copyHudControl('localFloodDuration',240);
      resetForNewRain();syncSiteControls();updateSiteHydroDashboard();
      setSiteHud('siteHudRainTime','FEH22 手动输入情景：4h 总量，均匀分配至 15min（时程假设）。');
    };
    for(const [hudId,actual] of [
      ['siteHudEA','localFloodFocusEA'],['siteHudDrainage','localFloodFocusDrainage'],
      ['siteHudGuide','localFloodDrainageGuide']
    ])siteHud(hudId).onchange=e=>copyHudControl(actual,e.target.checked,'change');
    siteHud('siteHudThreshold').onchange=e=>{
      const n=Number(e.target.value);
      copyHudControl('networkThresholdInput',Math.max(0,Math.min(50,Number.isFinite(n)?n:1)).toFixed(3),'change');
      syncSiteControls();
    };
    // Five physical site-treatment tools; existing rainfall settings stay in
    // the simulator state but no longer occupy the independent design panel.
    for(const btn of container.querySelectorAll('[data-sponge-tool]')){
      btn.onclick=()=>switchSpongeTool(btn.dataset.spongeTool);
    }
    siteHud('siteHudResetSponge').onclick=()=>{
      siteFacilities=[];
      hydroDisplay={depth:true,flow:true,collision:true};
      for(const [id,flag] of [
        ['siteHudShowDepth','depth'],
        ['siteHudShowFlow','flow'],
        ['siteHudShowCollision','collision']
      ])siteHud(id).checked=hydroDisplay[flag];
      switchSpongeTool('navigate');
      resetRunAfterSpongeChange();
      updateHydroLayerVisibility();
    };
    for(const [id,flag] of [
      ['siteHudShowDepth','depth'],
      ['siteHudShowFlow','flow'],
      ['siteHudShowCollision','collision']
    ])siteHud(id).onchange=e=>{
      hydroDisplay[flag]=e.target.checked;
      updateHydroLayerVisibility();
    };
    siteHud('siteHudRun').onclick=()=>$('localFloodRun').click();
    siteHud('siteHudPause').onclick=()=>$('localFloodPause').click();
    siteHud('siteHudReset').onclick=()=>{
      $('localFloodReset').click();
      siteHydroHistory.length=0;hydroState='reset';updateSiteHydroDashboard();
    };
    redrawSpongeSite();
    lookupSiteRainForSelection();
  }

  function createFocusViewer(){
    destroyFocusViewer();
    const el=document.createElement('div');
    el.id='local-flood-focus-viewer';
    // Full-browser independent analysis workspace. The original geographic
    // map stays intact underneath and is restored instantly on Esc.
    el.style.cssText='position:fixed;inset:0;z-index:2147483000;'+
      'background:#f4f2ed;overflow:hidden;pointer-events:auto;';
    document.body.appendChild(el);
    isolateViewerElement=el;

    let viewer;
    try{
      const details=collectFocusMapDetails();
      viewer=new maplibregl.Map({
        container:el,style:focusStyle(details),
        center:map.getCenter().toArray(),zoom:map.getZoom(),
        pitch:0,bearing:0,antialias:true,attributionControl:false,
        maxPitch:70
      });
    }catch(error){
      el.remove();
      isolateViewerElement=null;
      throw error;
    }
    isolateViewer=viewer;
    mountSiteHydroDashboard(el);
    focusAppliedThreshold=focusContextSettings().threshold;
    lastFlowUpdateAt=0;
    switchSpongeTool('navigate');
    viewer.on('pitch',setFocusPitchMode);
    viewer.on('click',onSpongeMapClick);
    viewer.once('load',()=>{
      if(isolateViewer!==viewer||!isolatedSelection)return;
      // First fit the parcel from its local geometry, then start the optional
      // EA/WMS and drainage raster fetches. External references must not delay
      // the initial independent 3D camera or basic building display.
      setFocusPitchMode();
      updateFocusAnalysisLayers();
      const bounds=selectionBounds(polygon[0]);
      if(!bounds)return;
      viewer.fitBounds(bounds,{
        padding:{top:90,bottom:90,left:90,right:90},
        duration:0,maxZoom:18,pitch:0,bearing:0
      });
      const fittedZoom=viewer.getZoom();
      viewer.easeTo({
        center:viewer.getCenter(),
        zoom:Math.max(15.2,Math.min(18,fittedZoom-0.3)),
        pitch:42,bearing:isolateCamera?.bearing||0,duration:550
      });
    });
  }

  function enterSelectionIsolate(){
    if(isolatedSelection||!prepared||selectionDirty||
      !polygon?.[0]||polygon[0].length<4)return false;
    isolateCamera={
      center:map.getCenter().toArray(),zoom:map.getZoom(),
      pitch:map.getPitch(),bearing:map.getBearing()
    };
    isolatedSelection=true;
    rainfallMode='manual';manualFourHourMm=null;
    lastHydroFrame=null;siteHydroHistory.length=0;hydroState='ready';siteRainData=null;
    focusSiteSerial++;
    try{
      createFocusViewer();
    }catch(error){
      isolatedSelection=false;
      isolateCamera=null;
      status('独立视图创建失败：'+(error?.message||String(error)),true);
      return false;
    }
    hideAreaPopup();
    status('独立视图已包含地块水深模拟、EA 官方风险参考和地形汇水网络。点击“运行”开始动态积水，Esc 返回。');
    return true;
  }

  function exitSelectionIsolate(restoreCamera=true){
    if(!isolatedSelection)return false;
    isolatedSelection=false;
    siteRainRequest++;
    destroyFocusViewer();
    // The underlying map's style, layers, data and camera never changed.
    isolateCamera=null;
    status('已退出独立视图，可继续编辑选区。');
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
    for(const [id,visibility] of [
      [BUILDING_SCENE_3D,is3D?'visible':'none'],
      [BUILDING_SCENE_FILL,is3D?'none':'visible']
    ]){
      if(map.getLayer(id)&&map.getLayoutProperty(id,'visibility')!==visibility){
        map.setLayoutProperty(id,'visibility',visibility);
      }
    }
  }

  function publishBuildingScene(){
    ensureBuildingSceneLayers();

    // Preserve the original city map's building scene when focus is open.
    // The separate focus viewer has its own selected-only GeoJSON source.
    visualSelectedBuildingCache=null;
    const features=[
      ...[...sceneFeatures.values()].filter(feature=>
        feature?.properties?.selected!==true
      ),
      ...(hideSelectedBuildings?[]:selectedBuildingVisuals())
    ];

    map.getSource(BUILDING_SCENE_SOURCE)?.setData({
      type:'FeatureCollection',
      features
    });
    syncBuildingSceneView();
    if(isolatedSelection)updateFocusBuildings();
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
    focusWaterBounds=null;
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
    siteRainRequest++;siteRainData=null;
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
      drainageUrl:new URL(assetUrl('assets/drainage_area/area_log16.webp'),location.href).href,
      demBounds,
      demWidth,
      demHeight,
      demEncoding:{minimum:-100,step:0.1},
      onFrame:handleFrame,
      onStatus:data=>{
        hydroState=data.state;
        updateSiteHydroDashboard();
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
    focusWaterBounds=info.boundsLngLat;
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
      // A newly confirmed parcel is a fresh design scenario. Never reuse
      // interventions placed on an older selection or in a different location.
      siteFacilities=[];
      nextFacilityId=1;
      spongeTool='navigate';
      hydroDisplay={depth:true,flow:true,collision:true};
      ensureSimulator().setParams(currentParams());
      const info=await ensureSimulator().setup({polygon,buildings});
      prepared=true;
      ensureWaterLayer(info);
      publishBuildingScene();
      $('localFloodGridInfo').textContent=
        info.cellSizeM+' m 网格 · '+info.buildingCount+' 栋建筑 · '+
        (info.drainageAvailable?'汇水路径数据就绪':'地形独立计算（汇水数据不可用）');
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


  function updateFocusFlowVectors(data){
    if(!isolateViewer||!hydroDisplay.flow||!focusWaterBounds||
      !Array.isArray(data.vectors))return;
    const now=performance.now();
    if(now-lastFlowUpdateAt<350&&data.stats?.timeMin>0)return;
    lastFlowUpdateAt=now;
    const source=isolateViewer.getSource(FOCUS_FLOW_SOURCE);
    if(!source)return;
    const nw=mercator(focusWaterBounds[0][0],focusWaterBounds[0][1]);
    const ne=mercator(focusWaterBounds[1][0],focusWaterBounds[1][1]);
    const sw=mercator(focusWaterBounds[3][0],focusWaterBounds[3][1]);
    const cellX=(ne[0]-nw[0])/Math.max(1,data.width);
    const cellY=(nw[1]-sw[1])/Math.max(1,data.height);
    const size=Math.max(1,Math.min(Math.abs(cellX),Math.abs(cellY)));
    const arrowSize=1.8*size;
    const features=[];
    for(const vec of data.vectors.slice(0,180)){
      const [col,row,dx,dy]=vec;
      if(![col,row,dx,dy].every(Number.isFinite))continue;
      const x=nw[0]+(col+.5)*cellX;
      const y=nw[1]-(row+.5)*cellY;
      const mag=Math.hypot(dx,dy);
      if(mag<.02)continue;
      const nx=dx/mag,ny=-dy/mag;
      const tipX=x+nx*arrowSize,tipY=y+ny*arrowSize;
      const back=.42*arrowSize,side=.33*arrowSize;
      const lx=tipX-nx*back-ny*side,ly=tipY-ny*back+nx*side;
      const rx=tipX-nx*back+ny*side,ry=tipY-ny*back-nx*side;
      features.push({type:'Feature',properties:{},geometry:{
        type:'LineString',coordinates:[
          unmercator(x,y),unmercator(tipX,tipY),
          unmercator(lx,ly),unmercator(tipX,tipY),
          unmercator(rx,ry)
        ]
      }});
    }
    source.setData(spongeCollection(features));
  }

  function handleFrame(data){
    if(!canvas||!canvasContext)return;
    const pixels=new Uint8ClampedArray(data.pixels);
    if(canvas.width!==data.width||canvas.height!==data.height){
      canvas.width=data.width;canvas.height=data.height;
    }
    canvasContext.putImageData(new ImageData(pixels,data.width,data.height),0,0);
    map.triggerRepaint();
    // The independent 3D viewer shares this very same simulation canvas.
    // Water is painted before buildings so roofs/facades stay unobscured.
    isolateViewer?.triggerRepaint();
    updateFocusFlowVectors(data);

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
    lastHydroFrame=data;
    if(!siteHydroHistory.length||s.timeMin-siteHydroHistory[siteHydroHistory.length-1][0]>=2){
      siteHydroHistory.push([s.timeMin,s.maxDepthM]);
      if(siteHydroHistory.length>32)siteHydroHistory.shift();
    }
    updateSiteHydroDashboard(data);
    $('localFloodStats').textContent=
      't '+s.timeMin.toFixed(1)+' min · 最大水深 '+s.maxDepthM.toFixed(2)+' m · '+
      '积水 '+(s.wetAreaM2/10000).toFixed(2)+' ha · 影响建筑 '+s.impactedCount;
  }

  function currentParams(){
    return {
      rainfall:Number($('localFloodRain').value),
      interventions:siteFacilities.map(({id,type,lng,lat,radiusM})=>
        ({id,type,lng,lat,radiusM})),
      showFlow:hydroDisplay.flow,
      rainSeriesMm15:rainfallMode==='ea-observed'&&siteRainData?.complete&&siteRainData?.recent
        ?siteRainData.series15
        :rainfallMode==='feh-manual'&&Number.isFinite(manualFourHourMm)
          ?Array(16).fill(manualFourHourMm/16):null,
      infiltration:Number($('localFloodInfil').value),
      duration:Number($('localFloodDuration').value),
      openBoundary:true,
      drainageGuide:$('localFloodDrainageGuide')?.checked!==false,
      drainageThreshold:Number($('networkThreshold')?.value)||0
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

    // Prepared selection: double-click anywhere INSIDE the red polygon enters
    // isolated-site view immediately. This takes priority over edge/anchor editing,
    // because the primary post-generation interaction is "enter this site".
    const clickedLngLat=[event.lngLat.lng,event.lngLat.lat];
    const clickedInside=Boolean(
      prepared&&
      !selectionDirty&&
      polygon?.[0]&&
      pointInRingLngLat(clickedLngLat,polygon[0])
    );

    if(clickedInside){
      enterSelectionIsolate();
      return;
    }

    // Only when not entering the prepared site do we interpret double-click as
    // anchor/edge editing.
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

  // Focus view is independent; no city layer/mask updates on focus rotation.
  const syncSceneOnCamera=()=>syncBuildingSceneView();
  map.on('pitch',syncSceneOnCamera);

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
  for(const id of ['localFloodFocusEA','localFloodFocusDrainage','networkThreshold','networkThresholdInput']){
    $(id)?.addEventListener('change',()=>{
      scheduleFocusContextRefresh();
      simulator?.setParams(currentParams());
    });
  }
  $('localFloodDrainageGuide')?.addEventListener('change',()=>{
    simulator?.setParams(currentParams());
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
    setFocusView(is3D){
      if(!isolatedSelection||!isolateViewer)return false;
      isolateViewer.easeTo(is3D?{
        zoom:Math.max(isolateViewer.getZoom(),15.5),
        pitch:55,
        bearing:isolateViewer.getBearing()||-20,
        duration:700
      }:{
        pitch:0,bearing:0,duration:450
      });
      return true;
    },
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
      destroyFocusViewer();
      document.removeEventListener('keydown',keydown);
    }
  };
}
