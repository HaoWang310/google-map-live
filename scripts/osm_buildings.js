import osmToGeoJSONModule from 'https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm';
import * as polygonClippingModule from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const osmToGeoJSON =
  typeof osmToGeoJSONModule === 'function'
    ? osmToGeoJSONModule
    : osmToGeoJSONModule?.default;

const polygonClipping=polygonClippingModule.default||polygonClippingModule;
const R=6378137;

const DEFAULT_ENDPOINTS=[
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function closeRing(ring){
  if(!Array.isArray(ring)||!ring.length)return ring||[];
  const first=ring[0],last=ring[ring.length-1];
  if(first[0]===last[0]&&first[1]===last[1])return ring;
  return [...ring,[first[0],first[1]]];
}

function normalisePolygonGeometry(geometry){
  if(!geometry)return null;

  if(geometry.type==='Polygon'){
    const coordinates=(geometry.coordinates||[])
      .filter(ring=>Array.isArray(ring)&&ring.length>=3)
      .map(closeRing);
    return coordinates.length?{type:'Polygon',coordinates}:null;
  }

  if(geometry.type==='MultiPolygon'){
    const coordinates=(geometry.coordinates||[])
      .map(poly=>(poly||[])
        .filter(ring=>Array.isArray(ring)&&ring.length>=3)
        .map(closeRing))
      .filter(poly=>poly.length);
    return coordinates.length?{type:'MultiPolygon',coordinates}:null;
  }

  return null;
}

function geometryToMultiPolygon(geometry){
  const g=normalisePolygonGeometry(geometry);
  if(!g)return [];
  return g.type==='Polygon'?[g.coordinates]:g.coordinates;
}

function multiPolygonToGeometry(multi){
  if(!Array.isArray(multi)||!multi.length)return null;
  const cleaned=multi
    .filter(poly=>Array.isArray(poly)&&poly.length)
    .map(poly=>poly.map(closeRing));
  if(!cleaned.length)return null;
  return cleaned.length===1
    ?{type:'Polygon',coordinates:cleaned[0]}
    :{type:'MultiPolygon',coordinates:cleaned};
}

function geometryBBox(geometry){
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  const visit=coords=>{
    if(typeof coords?.[0]==='number'){
      const lng=Number(coords[0]),lat=Number(coords[1]);
      if(!Number.isFinite(lng)||!Number.isFinite(lat))return;
      west=Math.min(west,lng);east=Math.max(east,lng);
      south=Math.min(south,lat);north=Math.max(north,lat);
      return;
    }
    for(const child of coords||[])visit(child);
  };
  visit(geometry?.coordinates);
  return {west,east,south,north};
}

function boxesIntersect(a,b){
  return !(a.east<b.west||a.west>b.east||a.north<b.south||a.south>b.north);
}

function bboxContains(outer,inner){
  return outer.west<=inner.west&&outer.east>=inner.east&&
         outer.south<=inner.south&&outer.north>=inner.north;
}

function ringBounds(ring){
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const point of ring||[]){
    if(!Array.isArray(point)||point.length<2)continue;
    const lng=Number(point[0]),lat=Number(point[1]);
    if(!Number.isFinite(lng)||!Number.isFinite(lat))continue;
    west=Math.min(west,lng);east=Math.max(east,lng);
    south=Math.min(south,lat);north=Math.max(north,lat);
  }
  return {west,east,south,north};
}

function expandBounds(bounds,metres=35){
  const midLat=(bounds.south+bounds.north)/2;
  const latPad=metres/111320;
  const lngPad=metres/(111320*Math.max(0.2,Math.cos(midLat*Math.PI/180)));
  return {
    west:bounds.west-lngPad,
    east:bounds.east+lngPad,
    south:bounds.south-latPad,
    north:bounds.north+latPad
  };
}

function mercator(lng,lat){
  const lon=lng*Math.PI/180;
  const phi=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return [R*lon,R*Math.log(Math.tan(Math.PI/4+phi/2))];
}

function ringAreaM2(ring){
  const pts=closeRing(ring||[]).map(([lng,lat])=>mercator(lng,lat));
  if(pts.length<4)return 0;
  let area=0;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    area+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1];
  }
  return Math.abs(area)/2;
}

function geometryAreaM2(geometry){
  const polygons=geometryToMultiPolygon(geometry);
  let total=0;
  for(const polygon of polygons){
    if(!polygon?.length)continue;
    total+=ringAreaM2(polygon[0]);
    for(let i=1;i<polygon.length;i++)total-=ringAreaM2(polygon[i]);
  }
  return Math.max(0,total);
}

function parseLength(value){
  if(value===null||value===undefined||value==='')return NaN;
  if(typeof value==='number')return Number.isFinite(value)?value:NaN;

  const text=String(value).trim().toLowerCase();
  const number=parseFloat(text.replace(',','.'));
  if(!Number.isFinite(number))return NaN;

  if(/ft|feet|foot/.test(text))return number*0.3048;
  return number;
}

function parseLevels(value){
  if(value===null||value===undefined||value==='')return NaN;
  const number=parseFloat(String(value).replace(',','.'));
  return Number.isFinite(number)?number:NaN;
}

function buildingHeight(tags){
  const explicit=parseLength(tags.height);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;

  const levels=parseLevels(tags['building:levels']);
  if(Number.isFinite(levels)&&levels>0)return Math.max(2.4,levels*3);

  return 5;
}

function buildingBase(tags){
  const explicit=parseLength(tags.min_height);
  if(Number.isFinite(explicit)&&explicit>=0)return explicit;

  const levels=parseLevels(tags['building:min_level']);
  if(Number.isFinite(levels)&&levels>=0)return levels*3;

  return 0;
}

function featureTags(feature){
  return feature?.properties?.tags||feature?.properties||{};
}

function osmIdentity(feature,index=0){
  const raw=feature?.id??feature?.properties?.id??feature?.properties?.['@id'];
  if(raw!==undefined&&raw!==null&&String(raw)!=='')return String(raw);
  return 'geometry/'+index;
}

function normaliseFeature(feature,index=0){
  const geometry=normalisePolygonGeometry(feature?.geometry);
  if(!geometry)return null;

  const tags=featureTags(feature);
  const uid=osmIdentity(feature,index);
  const isPart=
    tags['building:part']!==undefined&&
    tags['building:part']!==null&&
    String(tags['building:part']).toLowerCase()!=='no';

  const isBuilding=
    tags.building!==undefined&&
    tags.building!==null&&
    String(tags.building).toLowerCase()!=='no';

  if(!isPart&&!isBuilding)return null;

  return {
    type:'Feature',
    id:uid,
    properties:{
      ...tags,
      uid,
      osmId:uid,
      isBuildingPart:isPart,
      isBuildingOutline:isBuilding&&!isPart,
      render_height:buildingHeight(tags),
      render_min_height:buildingBase(tags)
    },
    geometry
  };
}

function intersectsGeometry(a,b){
  if(!a||!b)return false;
  if(!boxesIntersect(geometryBBox(a),geometryBBox(b)))return false;
  try{
    const hit=polygonClipping.intersection(
      geometryToMultiPolygon(a),
      geometryToMultiPolygon(b)
    );
    return Array.isArray(hit)&&hit.length>0;
  }catch(error){
    return false;
  }
}

function differenceGeometry(subject,clips){
  if(!subject)return null;
  const subjectMulti=geometryToMultiPolygon(subject);
  if(!subjectMulti.length)return null;

  const clipMultis=(clips||[])
    .map(geometryToMultiPolygon)
    .filter(multi=>multi.length);

  if(!clipMultis.length)return normalisePolygonGeometry(subject);

  try{
    const result=polygonClipping.difference(subjectMulti,...clipMultis);
    return multiPolygonToGeometry(result);
  }catch(error){
    console.warn('OSM building outline/part difference failed',error);
    return normalisePolygonGeometry(subject);
  }
}

function decomposeBuildings(features){
  const outlines=[];
  const parts=[];

  for(const feature of features){
    if(feature.properties?.isBuildingPart)parts.push(feature);
    else outlines.push(feature);
  }

  const partsUsed=new Set();
  const result=[];

  for(const outline of outlines){
    const outlineBounds=geometryBBox(outline.geometry);
    const relatedParts=[];

    for(const part of parts){
      if(!boxesIntersect(outlineBounds,geometryBBox(part.geometry)))continue;
      if(!intersectsGeometry(outline.geometry,part.geometry))continue;
      relatedParts.push(part);
      partsUsed.add(part.properties.uid);
    }

    if(!relatedParts.length){
      result.push(outline);
      continue;
    }

    for(const part of relatedParts)result.push(part);

    const remainder=differenceGeometry(
      outline.geometry,
      relatedParts.map(part=>part.geometry)
    );

    if(remainder&&geometryAreaM2(remainder)>0.5){
      result.push({
        type:'Feature',
        id:outline.properties.uid+'/remainder',
        properties:{
          ...outline.properties,
          uid:outline.properties.uid+'/remainder',
          osmId:outline.properties.osmId,
          sourceKind:'building-remainder'
        },
        geometry:remainder
      });
    }
  }

  for(const part of parts){
    if(!partsUsed.has(part.properties.uid))result.push(part);
  }

  return result;
}

function dedupeFeatures(features){
  const byUid=new Map();

  for(const feature of features){
    const uid=feature?.properties?.uid;
    if(!uid)continue;

    const existing=byUid.get(uid);
    if(!existing){
      byUid.set(uid,feature);
      continue;
    }

    // Keep the larger geometry if the converter produced duplicate forms of one OSM element.
    if(geometryAreaM2(feature.geometry)>geometryAreaM2(existing.geometry)){
      byUid.set(uid,feature);
    }
  }

  return [...byUid.values()];
}

function buildQuery(bounds){
  const bbox=[
    bounds.south.toFixed(7),
    bounds.west.toFixed(7),
    bounds.north.toFixed(7),
    bounds.east.toFixed(7)
  ].join(',');

  return `[out:json][timeout:30];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["building:part"](${bbox});
  relation["building:part"](${bbox});
);
out geom qt;`;
}

async function fetchOverpass(endpoint,query,signal){
  const response=await fetch(endpoint,{
    method:'POST',
    mode:'cors',
    credentials:'omit',
    cache:'no-store',
    headers:{
      'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept':'application/json'
    },
    body:'data='+encodeURIComponent(query),
    signal
  });

  if(!response.ok){
    throw new Error('Overpass '+response.status+' '+response.statusText);
  }

  const data=await response.json();
  if(!data||!Array.isArray(data.elements)){
    throw new Error('Overpass 返回的数据格式无效');
  }
  return data;
}

function filterToBounds(features,bounds){
  return features.filter(feature=>boxesIntersect(geometryBBox(feature.geometry),bounds));
}

export function createOSMBuildingLoader({
  endpoints=DEFAULT_ENDPOINTS,
  timeoutMs=32000,
  marginM=40
}={}){
  let activeController=null;
  const cache=[];
  const CACHE_LIMIT=8;

  function cancel(){
    activeController?.abort();
    activeController=null;
  }

  function clearCache(){
    cache.length=0;
  }

  async function load(selectionRing){
    const rawBounds=ringBounds(selectionRing);
    if(
      !Number.isFinite(rawBounds.west)||!Number.isFinite(rawBounds.east)||
      !Number.isFinite(rawBounds.south)||!Number.isFinite(rawBounds.north)
    ){
      throw new Error('红框坐标无效，无法读取详细 OSM 建筑。');
    }

    const bounds=expandBounds(rawBounds,marginM);

    const cached=cache
      .slice()
      .reverse()
      .find(entry=>bboxContains(entry.bounds,bounds));

    if(cached){
      const features=filterToBounds(cached.features,bounds);
      return {
        features,
        source:'cache',
        endpoint:cached.endpoint,
        diagnostics:{
          rawElements:cached.rawElements,
          polygonFeatures:features.length,
          cacheHit:true
        }
      };
    }

    cancel();
    activeController=new AbortController();
    const timeout=setTimeout(()=>activeController?.abort(),timeoutMs);
    const query=buildQuery(bounds);

    let lastError=null;

    try{
      for(const endpoint of endpoints){
        try{
          const data=await fetchOverpass(endpoint,query,activeController.signal);

          if(typeof osmToGeoJSON!=='function'){
            throw new Error('OSM GeoJSON 转换器未加载');
          }

          const converted=osmToGeoJSON(data,{flatProperties:false});
          const normalised=(converted?.features||[])
            .map(normaliseFeature)
            .filter(Boolean);

          const decomposed=dedupeFeatures(decomposeBuildings(dedupeFeatures(normalised)));

          cache.push({
            bounds,
            features:decomposed,
            endpoint,
            rawElements:data.elements.length
          });
          while(cache.length>CACHE_LIMIT)cache.shift();

          return {
            features:filterToBounds(decomposed,bounds),
            source:'overpass',
            endpoint,
            diagnostics:{
              rawElements:data.elements.length,
              polygonFeatures:decomposed.length,
              cacheHit:false
            }
          };
        }catch(error){
          if(error?.name==='AbortError')throw error;
          lastError=error;
          console.warn('Detailed OSM building endpoint failed',endpoint,error);
        }
      }
    }finally{
      clearTimeout(timeout);
      activeController=null;
    }

    throw lastError||new Error('详细 OSM 建筑加载失败');
  }

  return {load,cancel,clearCache};
}
