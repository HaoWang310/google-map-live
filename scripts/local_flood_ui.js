import {sameHydroGrid} from './hydro_tensor_grid.js?v=3.22.49-tensor-streamlines';
import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.22.54-rainfall-responsive-tensor';
import {createHydroTensorRenderer} from './hydro_tensor_field.js?v=3.22.55-hydro-tensor-sequence';
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


// Volumetric water is a display-only custom MapLibre layer. Geometry is built
// exclusively from the flood solver's passable ground-depth field, never from
// arbitrary random flood shapes. Building impacts come from a separate footprint mask.

/**
 * Render-only water compositor. The simulation depths, wet-area statistics,
 * building collisions and reference data are NOT changed by this interpolation.
 * A hard solver-valid mask protects buildings and the study-area perimeter;
 * bilinear depth sampling and smooth alpha soften only the visible shoreline.
 */
// NATURAL_WATER_LIVE_20261015: visual-only continuous grey-blue water rendering.
function renderSoftWaterCanvas(context,frame,outWidth,outHeight,options={}){
  const avg=options.scenario==='average';
  // VISUAL v3.22.32-water: render 1 mm shallow wetness by default;
  // stats and the worker's rainfall quantity remain unchanged.
  const showShallow=options.showShallow!==false;
  const wetThreshold=showShallow?0.001:0.020;
  const contrast=null;
  const width=frame.width,height=frame.height;
  const depths=new Uint16Array(frame.depthMm);
  const valid=frame.validMask?new Uint8Array(frame.validMask):null;
  const contacts=frame.contactMask?new Uint8Array(frame.contactMask):null;
  if(depths.length!==width*height)return false;
  const image=context.createImageData(outWidth,outHeight);
  const dest=image.data;
  const palette=[
    // v3.22.33-apple-ui: user swatch, shallow light blue and deepest navy.
    [0.001,180,206,255],
    [0.030,132,177,254],
    [0.050,74,146,255],
    [0.150,34,113,255],
    [0.300,28,90,223],
    [0.600,21,69,183],
    [0.900,10,50,123],
    [1.200,4,28,75]
  ];
  const index=(x,y)=>Math.max(0,Math.min(height-1,y))*width+
    Math.max(0,Math.min(width-1,x));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,t)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};
  const clock=performance.now()/1000;
  for(let y=0;y<outHeight;y++){
    const v=(y+.5)*height/outHeight-.5;
    const y0=Math.floor(v),ty=v-y0;
    for(let x=0;x<outWidth;x++){
      const u=(x+.5)*width/outWidth-.5;
      const x0=Math.floor(u),tx=u-x0;
      const nearest=index(Math.round(u),Math.round(v));
      // Buildings and site perimeter retain the exact native solver mask.
      if(valid&&!valid[nearest])continue;
      const nearestIsWet=depths[nearest]>=wetThreshold*1000;
      const i00=index(x0,y0),i10=index(x0+1,y0);
      const i01=index(x0,y0+1),i11=index(x0+1,y0+1);
      const a=valid&&!valid[i00]?0:depths[i00]/1000;
      const b=valid&&!valid[i10]?0:depths[i10]/1000;
      const c=valid&&!valid[i01]?0:depths[i01]/1000;
      const d=valid&&!valid[i11]?0:depths[i11]/1000;
      const w00=(1-tx)*(1-ty),w10=tx*(1-ty),w01=(1-tx)*ty,w11=tx*ty;
      const wa=a>=wetThreshold?1:0,wb=b>=wetThreshold?1:0;
      const wc=c>=wetThreshold?1:0,wd=d>=wetThreshold?1:0;
      const occupancy=w00*wa+w10*wb+w01*wc+w11*wd;
      // Mask antialiasing is done on the DISPLAY pixels, not on obstacle
      // cells or the hydraulic depth grid. Nearest invalid stays transparent.
      const maskCoverage=valid?
        w00*(valid[i00]?1:0)+w10*(valid[i10]?1:0)+
        w01*(valid[i01]?1:0)+w11*(valid[i11]?1:0):1;
      // Subcell wet coverage: interpolate the visual contour between pixels,
      // not the simulation's real depths, building masks or wet-area metrics.
      if(occupancy<=0.16)continue;
      const wetMean=(w00*wa*a+w10*wb*b+w01*wc*c+w11*wd*d)/
        Math.max(0.000001,occupancy);
      const depth=nearestIsWet?
        0.30*depths[nearest]/1000+0.70*wetMean:wetMean;
      let lo=palette[0],hi=palette[palette.length-1];
      for(let k=1;k<palette.length;k++)
        if(depth<=palette[k][0]){lo=palette[k-1];hi=palette[k];break;}
      const t=smooth(lo[0],hi[0],depth);
      const rim=1-smooth(.0015,.044,depth);
      const ripples=Math.sin(u*.56+v*.19-clock*.95)*.55+
        Math.sin(u*.26-v*.67+clock*1.15)*.45;
      const light=Math.max(0,ripples)*(avg?1.3:2.6)+rim*1.4;
      const foam=(contacts?.[nearest]||0)*smooth(.012,.08,depth)*2;
      const pos=(y*outWidth+x)*4;
      const shallow=depth<.020;
      let rgb=[lerp(lo[1],hi[1],t)+light+foam,
        lerp(lo[2],hi[2],t)+light+foam,
        lerp(lo[3],hi[3],t)+light+foam*.3];
      let alpha=shallow
        ?((avg?.39:.31)+.18*smooth(.001,.020,depth))
        :(.51+.29*smooth(.020,.60,depth));
      // Continuous visual shoreline: low-alpha fringe only in valid, dry
      // neighbouring pixels. Invalid and building pixels stay transparent.
      alpha*=smooth(.16,.85,occupancy)*(nearestIsWet?1:.38);
      // Stop hard-edged 10m building/site masks from producing visible
      // square steps on small parcels. Fade only WITHIN valid cells.
      alpha*=smooth(.10,.95,maskCoverage);
      if(alpha<.004)continue;
      // Contrast is a categorical comparison of actual solver depths;
      // highlight never changes the physical depth or water mesh height.
      const cls=contrast?.[nearest]||0;
      if(!shallow&&cls===1){rgb=[47,230,209];alpha=Math.max(alpha,.90);}
      else if(!shallow&&cls===2){rgb=[133,113,244];alpha=Math.max(alpha,.90);}
      else if(cls===3){rgb=[240,171,73];alpha=Math.max(alpha,.30);}
      // shallow wet ground follows the same low-saturation water palette
      dest[pos]=Math.min(255,rgb[0]);
      dest[pos+1]=Math.min(255,rgb[1]);
      dest[pos+2]=Math.min(255,rgb[2]);
      dest[pos+3]=Math.round(alpha*255);
    }
  }
  context.putImageData(image,0,0);
  return true;
}

function createFloodVolumeLayer(maplibregl,bounds){
  const layer={
    id:'focus-volumetric-water',
    type:'custom',
    renderingMode:'3d',
    ready:false,
    visible:true,
    animate:false,
    frame:null,
    mesh:null,
    dirty:false,
    count:0,
    lastBuildAt:0,
    timeBase:performance.now(),
    map:null,
    context:null,
    metreScale:1,
    program:null,
    buffer:null,
    vao:null,
    onAdd(map,gl){
      this.map=map;
      this.context=gl;
      try{
        const vertex=[
          '#version 300 es',
          'precision highp float;',
          'in vec3 a_pos;',
          'in vec4 a_meta;',
          'in float a_contact;',
          'in float a_contrast;',
          'in float a_mask;',
          'uniform mat4 u_matrix;',
          'uniform float u_time;',
          'uniform float u_metres;',
          'out vec4 v_meta;',
          'out float v_contact;',
          'out float v_mask;',
          'flat out float v_contrast;',
          'void main(){',
          'vec3 p=a_pos;',
          'float depth=max(0.0,a_meta.z);',
          'float shimmer=sin(a_meta.x*0.85+a_meta.y*0.42-u_time*2.3)*0.5+',
          '  sin(a_meta.x*0.31-a_meta.y*1.15+u_time*1.7)*0.5;',
          'float amplitude=min(0.020,depth*0.08);',
          'if(a_meta.w<0.5)p.z+=shimmer*amplitude*u_metres;',
          'gl_Position=u_matrix*vec4(p,1.0);',
          'v_meta=a_meta;',
          'v_contact=a_contact;',
          'v_mask=a_mask;',
          'v_contrast=a_contrast;',
          '}'
        ].join('\n');
        const fragment=[
          '#version 300 es',
          'precision highp float;',
          'in vec4 v_meta;',
          'in float v_contact;',
          'in float v_mask;',
          'flat in float v_contrast;',
          'uniform float u_time;',
          'uniform float u_shallow;',
          'out vec4 fragColor;',
          'void main(){',
          'float depth=max(v_meta.z,0.0);',
          'vec3 water=vec3(0.70588,0.80784,1.00000);',
          'water=mix(water,vec3(0.51765,0.69412,0.99608),smoothstep(0.001,0.030,depth));',
          'water=mix(water,vec3(0.29020,0.57255,1.00000),smoothstep(0.030,0.050,depth));',
          'water=mix(water,vec3(0.13333,0.44314,1.00000),smoothstep(0.050,0.150,depth));',
          'water=mix(water,vec3(0.10980,0.35294,0.87451),smoothstep(0.150,0.300,depth));',
          'water=mix(water,vec3(0.08235,0.27059,0.71765),smoothstep(0.300,0.600,depth));',
          'water=mix(water,vec3(0.03922,0.19608,0.48235),smoothstep(0.600,0.900,depth));',
          'water=mix(water,vec3(0.01569,0.10980,0.29412),smoothstep(0.900,1.200,depth));',
          'float deep=smoothstep(0.04,0.85,depth);',
          'float ripple=sin(v_meta.x*1.15+v_meta.y*0.35-u_time*1.8)*0.52+',
          '  sin(v_meta.y*0.62-v_meta.x*0.46+u_time*1.3)*0.32+',
          '  sin((v_meta.x+v_meta.y)*0.22-u_time*0.8)*0.16;',
          'float glint=pow(max(0.0,0.5+0.35*ripple),7.0);',
          'water=mix(water,vec3(0.83,0.90,1.0),glint*(0.04+0.05*deep));',
          'float contactFoam=clamp(v_contact*0.22*(0.55+0.45*abs(ripple)),0.0,0.22);',
          'water=mix(water,vec3(0.84,0.92,1.0),contactFoam);',
          '// comparison coloring kept separate from main water material',
          '// cyan/purple comparison overlay suppressed',
          'float threshold=u_shallow>0.5?0.001:0.020;',
          '// pixel-adaptive antialiasing for 3D water silhouettes',
          'float edgeWidth=max(0.006,2.0*fwidth(depth));',
          'float edge=smoothstep(max(0.0,threshold-0.0012),threshold+edgeWidth,depth);',
          'float alpha=(0.55+0.43*smoothstep(0.020,0.60,depth))*edge;',
          'if(depth<0.020){alpha=(0.34+0.18*smoothstep(0.001,0.02,depth))*edge;}',
          '// mask feather is a display-only, subcell coverage alpha.',
          '// Invalid native building/site cells still contain no geometry.',
          'float maskFeather=max(0.03,1.5*fwidth(v_mask));',
          'alpha*=smoothstep(0.14,0.94+maskFeather,v_mask);',
          '// no contrast-driven alpha',
          'if(v_meta.w>0.5){water*=0.96;alpha*=0.82;}',
          'fragColor=vec4(water,alpha);',
          '}'
        ].join('\n');
        const compile=(type,source)=>{
          const shader=gl.createShader(type);
          gl.shaderSource(shader,source);
          gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
            const error=gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('3D water shader: '+error);
          }
          return shader;
        };
        const vs=compile(gl.VERTEX_SHADER,vertex);
        const fs=compile(gl.FRAGMENT_SHADER,fragment);
        const program=gl.createProgram();
        gl.attachShader(program,vs);
        gl.attachShader(program,fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
          const error=gl.getProgramInfoLog(program);
          gl.deleteProgram(program);
          throw new Error('3D water program: '+error);
        }
        this.program=program;
        this.matrixLoc=gl.getUniformLocation(program,'u_matrix');
        this.timeLoc=gl.getUniformLocation(program,'u_time');
        this.metresLoc=gl.getUniformLocation(program,'u_metres');
        this.shallowLoc=gl.getUniformLocation(program,'u_shallow');
        this.buffer=gl.createBuffer();
        this.vao=gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        const stride=10*4;
        const coords=gl.getAttribLocation(program,'a_pos');
        const meta=gl.getAttribLocation(program,'a_meta');
        const contact=gl.getAttribLocation(program,'a_contact');
        const contrastLoc=gl.getAttribLocation(program,'a_contrast');
        const maskLoc=gl.getAttribLocation(program,'a_mask');
        gl.enableVertexAttribArray(coords);
        gl.vertexAttribPointer(coords,3,gl.FLOAT,false,stride,0);
        gl.enableVertexAttribArray(meta);
        gl.vertexAttribPointer(meta,4,gl.FLOAT,false,stride,3*4);
        gl.enableVertexAttribArray(contact);
        gl.vertexAttribPointer(contact,1,gl.FLOAT,false,stride,7*4);
        gl.enableVertexAttribArray(contrastLoc);
        gl.vertexAttribPointer(contrastLoc,1,gl.FLOAT,false,stride,8*4);
        gl.enableVertexAttribArray(maskLoc);
        gl.vertexAttribPointer(maskLoc,1,gl.FLOAT,false,stride,9*4);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER,null);
        const origin=maplibregl.MercatorCoordinate.fromLngLat(bounds[0]);
        this.metreScale=origin.meterInMercatorCoordinateUnits();
        this.ready=true;
        if(this.frame)this.updateFrame(this.frame,true);
      }catch(error){
        this.ready=false;
        this.failed=String(error?.message||error);
        console.warn('3D flood renderer unavailable; using original raster water layer',error);
      }
    },
    onRemove(map,gl){
      this.ready=false;
      if(this.vao)gl.deleteVertexArray(this.vao);
      if(this.buffer)gl.deleteBuffer(this.buffer);
      if(this.program)gl.deleteProgram(this.program);
      this.vao=null;this.buffer=null;this.program=null;
      this.map=null;this.mesh=null;
    },
    setVisible(on){
      this.visible=Boolean(on);
      if(this.visible&&this.map)this.map.triggerRepaint();
    },
    updateFrame(data,force=false){
      this.frame=data;
      if(!this.ready||!this.map||!data?.depthMm)return;
      const jumping=Number.isInteger(data.scenarioYear)&&
        Number.isInteger(this.lastScenarioYear)&&
        Math.abs(data.scenarioYear-this.lastScenarioYear)>1;
      if(Number.isInteger(data.scenarioYear))this.lastScenarioYear=data.scenarioYear;
      if(jumping){this.displayDepth=null;force=true;}
      const now=performance.now();
      // Limit geometry upload to about 6-7 Hz; waves continue on the GPU.
      if(!force&&now-this.lastBuildAt<145)return;
      this.lastBuildAt=now;
      const widths=data.width,rows=data.height;
      const buffer=data.depthMm;
      const depths=new Uint16Array(buffer);
      const contacts=data.contactMask?new Uint8Array(data.contactMask):null;
      const compare=Boolean(this.showContrast&&data.comparisonMask)?
        new Uint8Array(data.comparisonMask):null;
      if(depths.length!==widths*rows)return;
      const nw=maplibregl.MercatorCoordinate.fromLngLat(bounds[0]);
      const ne=maplibregl.MercatorCoordinate.fromLngLat(bounds[1]);
      const sw=maplibregl.MercatorCoordinate.fromLngLat(bounds[3]);
      const dx=(ne.x-nw.x)/widths;
      const dy=(sw.y-nw.y)/rows;
      // Water simulation remains on its original physical grid. Only the
      // display mesh uses contour interpolation between measured solver cells.
      // This avoids square steps along flooded edges and does NOT add water to
      // the worker grid or alter collision/hydrology statistics.
      const stride=Math.max(1,Math.ceil(Math.sqrt(widths*rows/72000)));
      const meshCols=Math.ceil(widths/stride),meshRows=Math.ceil(rows/stride);
      const sampled=new Float32Array(meshCols*meshRows);
      const foam=new Float32Array(meshCols*meshRows);
      const categories=new Uint8Array(meshCols*meshRows);
      for(let rr=0;rr<meshRows;rr++){
        for(let cc=0;cc<meshCols;cc++){
          let peak=0,sum=0,amount=0,hit=0,hasNew=false,hasDeep=false;
          for(let y=rr*stride;y<Math.min(rows,(rr+1)*stride);y++){
            for(let x=cc*stride;x<Math.min(widths,(cc+1)*stride);x++){
              const i=y*widths+x,d=depths[i]/1000;
              peak=Math.max(peak,d);
              sum+=d;amount++;
              if(contacts?.[i])hit++;
              if(compare?.[i]===1)hasNew=true;
              if(compare?.[i]===2)hasDeep=true;
            }
          }
          const id=rr*meshCols+cc;
          // No averaging at native resolution. At larger study sites, carry
          // some channel peaks through the performance downsampling step.
          sampled[id]=stride===1?peak:Math.max(sum/Math.max(1,amount),peak*0.72);
          foam[id]=Math.min(1,hit/Math.max(1,amount)*1.1);
          categories[id]=hasNew?1:hasDeep?2:0;
        }
      }
      // Temporal low-pass on displayed depth avoids hard mesh jumps between
      // yearly scenarios; calculation values and statistics remain unchanged.
      if(force||['rainfall-risk-scenario','storm-event'].includes(data.annualAreaStage?.kind)||
         !this.displayDepth||this.displayDepth.length!==sampled.length)
        this.displayDepth=sampled.slice();
      else for(let i=0;i<sampled.length;i++){
        this.displayDepth[i]+=Math.max(-0.06,Math.min(0.06,(sampled[i]-this.displayDepth[i])*.28));
      }
      sampled.set(this.displayDepth);
      // Two low-pass passes only on display depths. Dry solver cells stay dry.
      // A nine-tap kernel smooths diagonal corners as well as orthogonal steps.
      const meshSoft=new Float32Array(sampled.length);
      for(let pass=0;pass<2;pass++){
        for(let row=0;row<meshRows;row++)for(let col=0;col<meshCols;col++){
          const idx=row*meshCols+col,value=sampled[idx];
          if(value<=0){meshSoft[idx]=0;continue;}
          let total=value*8,weight=8;
          for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
            if(!ox&&!oy)continue;
            const x=col+ox,y=row+oy;
            if(x<0||y<0||x>=meshCols||y>=meshRows)continue;
            const n=sampled[y*meshCols+x];
            if(n<=0)continue;
            const w=ox&&oy?1:2;
            total+=n*w;weight+=w;
          }
          meshSoft[idx]=total/weight;
        }
        sampled.set(meshSoft);
      }
      const cutoff=this.showShallow?0.001:0.020; // display cutoff only, solver unchanged
      const metre=this.metreScale;
      const quads=[];
      const visualHeight=depth=>Math.max(cutoff,Math.min(3,depth*1.45))*metre;
      const makeVertex=(point,side,zOverride,category)=>{
        const z=zOverride===undefined?visualHeight(point.d):zOverride;
        quads.push(point.x,point.y,z,point.u,point.v,point.d,side,point.foam,
          category??point.category??0,point.mask??1);
      };
      const triangle=(a,b,c,side=0)=>{
        // Flat categorical tint: same comparison class for whole triangle.
        const category=([a.category,b.category,c.category].includes(1))?1:
          ([a.category,b.category,c.category].includes(2)?2:0);
        makeVertex(a,side,undefined,category);
        makeVertex(b,side,undefined,category);
        makeVertex(c,side,undefined,category);
      };
      // More detailed visual contours on small sites. <=120k display nodes;
      // the DEM and flood calculation grids are never resampled as input.
      const displayCells=meshCols*meshRows;
      const subdivisions=displayCells<=1200?6:
        displayCells<=2500?5:displayCells<=5000?4:
        displayCells<=12000?3:displayCells<=30000?2:1;
      const renderCols=meshCols*subdivisions,renderRows=meshRows*subdivisions;
      const validCells=data.validMask?new Uint8Array(data.validMask):null;
      // Bilinear source-grid mask coverage; used only for the rendering
      // alpha at an edge. Native building collision/terrain are untouched.
      const maskAt=(u,v)=>{
        if(!validCells)return 1;
        const gx=Math.max(0,Math.min(widths-1,u-.5));
        const gy=Math.max(0,Math.min(rows-1,v-.5));
        const x0=Math.floor(gx),y0=Math.floor(gy);
        const x1=Math.min(widths-1,x0+1),y1=Math.min(rows-1,y0+1);
        const tx=gx-x0,ty=gy-y0;
        const a=validCells[y0*widths+x0]?1:0;
        const b=validCells[y0*widths+x1]?1:0;
        const c=validCells[y1*widths+x0]?1:0;
        const d=validCells[y1*widths+x1]?1:0;
        return (a*(1-tx)+b*tx)*(1-ty)+
          (c*(1-tx)+d*tx)*ty;
      };
      const fieldAt=(field,x,y)=>{
        const cx=Math.max(0,Math.min(meshCols-1,x));
        const cy=Math.max(0,Math.min(meshRows-1,y));
        const x0=Math.floor(cx),y0=Math.floor(cy);
        const x1=Math.min(meshCols-1,x0+1),y1=Math.min(meshRows-1,y0+1);
        const tx=cx-x0,ty=cy-y0;
        const top=field[y0*meshCols+x0]*(1-tx)+field[y0*meshCols+x1]*tx;
        const bottom=field[y1*meshCols+x0]*(1-tx)+field[y1*meshCols+x1]*tx;
        return top*(1-ty)+bottom*ty;
      };
      const physicalNode=(col,row)=>{
        const within=col>=0&&row>=0&&col<renderCols&&row<renderRows;
        const gx=col/subdivisions,gy=row/subdivisions;
        const u=Math.max(0,Math.min(widths,(gx+.5)*stride));
        const v=Math.max(0,Math.min(rows,(gy+.5)*stride));
        const nativeX=Math.max(0,Math.min(widths-1,Math.floor(u)));
        const nativeY=Math.max(0,Math.min(rows-1,Math.floor(v)));
        // Keep the exact native solver obstacle/study-area mask at subcell nodes.
        const exposed=within&&(!validCells||validCells[nativeY*widths+nativeX]!==0);
        const colIndex=Math.max(0,Math.min(meshCols-1,Math.round(gx)));
        const rowIndex=Math.max(0,Math.min(meshRows-1,Math.round(gy)));
        return {
          x:nw.x+u*dx,y:nw.y+v*dy,u,v,
          d:exposed?fieldAt(sampled,gx,gy):0,
          foam:exposed?fieldAt(foam,gx,gy)*.45:0,
          category:exposed?categories[rowIndex*meshCols+colIndex]:0,
          mask:exposed?maskAt(u,v):0,
          contour:false
        };
      };
      const interpolate=(a,b)=>{
        const t=Math.max(0,Math.min(1,(cutoff-a.d)/(b.d-a.d||1)));
        return {
          x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
          u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t,
          d:cutoff,foam:a.foam+(b.foam-a.foam)*t,
          category:a.category===1||b.category===1?1:a.category===2||b.category===2?2:0,
          mask:(a.mask??1)+((b.mask??1)-(a.mask??1))*t,
          contour:true
        };
      };
      const clipWetPolygon=vertices=>{
        const output=[];
        let prev=vertices[vertices.length-1];
        let prevWet=prev.d>=cutoff;
        for(const current of vertices){
          const wet=current.d>=cutoff;
          if(wet!==prevWet)output.push(interpolate(prev,current));
          if(wet)output.push(current);
          prev=current;prevWet=wet;
        }
        return output;
      };
      const emitPoly=poly=>{
        if(poly.length<3)return;
        // Non-overlapping triangulation of the clipped water surface.
        for(let i=1;i+1<poly.length;i++)triangle(poly[0],poly[i],poly[i+1]);
        // Only the true wet/dry contour receives a water edge wall. Internal
        // triangulation edges must not grow vertical dark streaks.
        for(let k=0;k<poly.length;k++){
          const a=poly[k],b=poly[(k+1)%poly.length];
          if(!a.contour||!b.contour)continue;
          // Shorelines are thin softened lips, not deep rectangular walls.
          const za=Math.max(cutoff*metre,visualHeight(a.d)-.009*metre);
          const zb=Math.max(cutoff*metre,visualHeight(b.d)-.009*metre);
          makeVertex(a,1);makeVertex(b,1);
          makeVertex(b,1,zb);
          makeVertex(a,1);makeVertex(b,1,zb);
          makeVertex(a,1,za);
        }
      };
      for(let row=-1;row<renderRows;row++){
        for(let col=-1;col<renderCols;col++){
          const a=physicalNode(col,row),b=physicalNode(col+1,row);
          const c=physicalNode(col+1,row+1),d=physicalNode(col,row+1);
          const n=[a,b,c,d];
          const mask=n.map(p=>p.d>=cutoff);
          const count=mask.filter(Boolean).length;
          if(!count)continue;
          if(count===4){
            triangle(a,b,c);triangle(a,c,d);continue;
          }
          const hasSaddle=count===2&&mask[0]===mask[2]&&mask[1]===mask[3];
          if(!hasSaddle){
            // The common case: one clipped polygon per marching square.
            // This sharply reduces triangles, memory uploads and frame drops.
            emitPoly(clipWetPolygon(n));
            continue;
          }
          // Only diagonal saddle crossings need a centre subdivision.
          const middle={
            x:(a.x+c.x)*.5,y:(a.y+c.y)*.5,
            u:(a.u+c.u)*.5,v:(a.v+c.v)*.5,
            d:(a.d+b.d+c.d+d.d)*.25,
            foam:(a.foam+b.foam+c.foam+d.foam)*.25,
            category:[a,b,c,d].some(n=>n.category===1)?1:[a,b,c,d].some(n=>n.category===2)?2:0,
            mask:((a.mask??1)+(b.mask??1)+(c.mask??1)+(d.mask??1))*.25,
            contour:false
          };
          for(let k=0;k<4;k++){
            const tri=[n[k],n[(k+1)%4],middle];
            const wet=tri.map(v=>v.d>=cutoff);
            if(wet.every(Boolean))emitPoly(tri);
            else if(wet.some(Boolean))emitPoly(clipWetPolygon(tri));
          }
        }
      }
      this.mesh=new Float32Array(quads);
      this.count=this.mesh.length/10;
      this.dirty=true;
      this.map.triggerRepaint();
    },
    render(gl,options){
      if(!this.ready||!this.visible||this.count<=0)return;
      const matrix=options?.defaultProjectionData?.mainMatrix||
        options?.modelViewProjectionMatrix||options;
      if(!matrix||matrix.length!==16)return;
      const oldProgram=gl.getParameter(gl.CURRENT_PROGRAM);
      const oldVao=gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const oldArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const blend=gl.isEnabled(gl.BLEND);
      const depth=gl.isEnabled(gl.DEPTH_TEST);
      const cull=gl.isEnabled(gl.CULL_FACE);
      const stencil=gl.isEnabled(gl.STENCIL_TEST);
      const depthFunc=gl.getParameter(gl.DEPTH_FUNC);
      const oldSrcRGB=gl.getParameter(gl.BLEND_SRC_RGB);
      const oldDstRGB=gl.getParameter(gl.BLEND_DST_RGB);
      const oldSrcAlpha=gl.getParameter(gl.BLEND_SRC_ALPHA);
      const oldDstAlpha=gl.getParameter(gl.BLEND_DST_ALPHA);
      const oldDepthWrite=gl.getParameter(gl.DEPTH_WRITEMASK);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      if(this.dirty&&this.mesh){
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER,this.mesh,gl.DYNAMIC_DRAW);
        this.dirty=false;
        this.mesh=null;
      }
      gl.uniformMatrix4fv(this.matrixLoc,false,matrix);
      gl.uniform1f(this.timeLoc,(performance.now()-this.timeBase)/1000);
      gl.uniform1f(this.metresLoc,this.metreScale);
      gl.uniform1f(this.shallowLoc,this.showShallow?1:0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES,0,this.count);
      gl.depthMask(oldDepthWrite);
      gl.depthFunc(depthFunc);
      gl.blendFuncSeparate(oldSrcRGB,oldDstRGB,oldSrcAlpha,oldDstAlpha);
      if(!blend)gl.disable(gl.BLEND);
      if(!depth)gl.disable(gl.DEPTH_TEST);
      if(stencil)gl.enable(gl.STENCIL_TEST);
      if(cull)gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(oldVao);
      gl.bindBuffer(gl.ARRAY_BUFFER,oldArray);
      gl.useProgram(oldProgram);
      if(this.animate&&this.visible&&this.map)this.map.triggerRepaint();
    }
  };
  return layer;
}

export function createLocalFloodUI({
  map,maplibregl,assetUrl,demBounds,demWidth,demHeight,
  ensureCityBuildings,setCityView,getFirstSymbolLayerId,cityBuildingsLayerId,
  setCityBuildingFloodSelection,setCityIsolateMode,
  getFocusAnalysisSettings,getFocusReferenceTile,
  onOpenParcelGenerator
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
  let lowResWater=null;
  let lowResWaterContext=null;
  let waterUpscale=1;
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
  let volumetricWater=null;
  let hydroVector=null;
  let tensorShowBuildings=false;
  let focusWaterBounds=null;
  let focusSiteSerial=0;
  let focusAppliedThreshold=null;
  let focusThresholdTimer=null;
  let siteRainData=null,siteRainRequest=0,rainfallMode='manual',manualFourHourMm=null;
  let lastHydroFrame=null,hydroState='ready';
  let futureYear=2026, floodMode='rain-risk', climateScenario='central', externalStageM=null,siteTerrainMinM=null;
  // Official-reference 2h comparison events. These are NOT official intensity classes:
  // Heathrow (1991-2020) 614.98 mm / 111.66 rain-days = 5.51 mm/wet day;
  // Met Office 2021 London warning 20-30 mm/h; GLA 2021 ~100 mm in 2h.
  const RAIN_PRESETS=Object.freeze({
    average:{rate:2.75,total:5.5,label:'平均降雨'},
    moderate:{rate:20,total:40,label:'中等降雨'},
    extreme:{rate:50,total:100,label:'特大暴雨'}
  });
  let rainPreset='moderate';
  let showShallowWater=true;
  let displayMode='year',eventTimeMin=0,criticalDurationMin=120;
  let fehDurationDepthsMm=null; // only explicitly entered FEH DDF values
  const presetRainRate=()=>RAIN_PRESETS[rainPreset].rate;
  let siteRiskAvailable=false;
  let forceEaRiskOverlay=false;
  let siteRiskMappedCount=0;
  const stormProfile='peak';
  let externalInlet='low',externalRiseMin=30,externalFallMin=90;
  let annualPlaying=false,annualAdvanceTimer=null;
  let longTermMode=true,annualBudget=null;
  let awaitingInitialReset=false;
  // The standalone 2026–2100 timeline now uses one coherent annual
  // accumulation scenario; its removed checkbox is no longer required.
  let lastRequestedScenarioToken=0,yearSeekDebounce=0;
  const yearFrames=new Map();
  let applyingYearFrame=false;
  let pendingBaselineFrame=false;
  const clearYearFrames=()=>yearFrames.clear();
  const showCachedYear=(year)=>{
    const frame=yearFrames.get(year);
    if(!frame)return false;
    applyingYearFrame=true;
    try{handleFrame(frame);}finally{applyingYearFrame=false;}
    return true;
  };
  const scenarioRequest=year=>({
    year,climateScenario,floodMode,rainfallCase:rainPreset,
    eventRainMmH:presetRainRate(),
    eventTotalMm:RAIN_PRESETS[rainPreset].total,
    durationMin:120,
    fehDurationDepthsMm,
    displayMode,eventTimeMin,
    interventions:siteFacilities.map(({id,type,lng,lat,radiusM})=>({id,type,lng,lat,radiusM})),
    infiltrationMmH:Number($('localFloodInfil')?.value??0.5),
    assumedUrbanDrainageMmH:0, // Same default after removing this control.
    stormProfile,drainageGuide:$('localFloodDrainageGuide')?.checked!==false,
    drainageThreshold:Number($('networkThreshold')?.value)||0,
    externalStageM,externalRiseMin,externalFallMin,externalInlet
  });
  const needsExternalStage=()=>floodMode==='external'||floodMode==='coupled';
  const enableEaRiskGuidance=()=>{
    // Legacy rain-risk mode means rainfall + independent EA comparison.
    // EA coverage is optional: physics works from DEM even without EA.
    // Distinct model: no invented boundary water level. The coupled mode is
    // transparently replaced only when its required datum is absent.
    floodMode='rain-risk';
    const selector=siteHud('siteHudFutureMode');
    if(selector)selector.value='rain-risk';
    clearYearFrames();
    updateFocusAnalysisLayers();
    setSiteHud('siteHudRiskFusionNote',
      '统一水流路径：三档降雨共用 DEM / 可淹没建筑基地 / 汇水网络。EA 风险及官方水深独立校核，不改变水流方向。');
    if(siteHud('siteHudFutureStage'))siteHud('siteHudFutureStage').disabled=true;
    for(const id of ['siteHudExternalInlet','siteHudRise','siteHudFall'])
      if(siteHud(id))siteHud(id).disabled=true;
    status('当前为地形驱动的降雨模拟，EA 仅作官方范围和水深校核，不提供额外水量或水流偏好。');
    return true;
  };
  const resolveFloodModeForPlayback=()=>{
    // Respect the user's selected scenario: never silently substitute rain
    // for a boundary-driven hydraulic simulation.
    if(needsExternalStage()&&!Number.isFinite(externalStageM)){
      status('当前已选择「'+(floodMode==='external'?'仅外部洪水':'降雨＋外部洪水')+
        '」，但尚未提供同一高程基准的外部边界水位。请先输入水位；不会自动切换模式，也不会伪造外部洪水。',true);
      return false;
    }
    return true;
  };
  const requestYear=year=>{
    if(!resolveFloodModeForPlayback())return false;
    ensureSimulator().seekYear({...scenarioRequest(year),scenarioToken:++lastRequestedScenarioToken});
    return true;
  };
  const seekYear=value=>{
    stopAnnual();
    futureYear=Math.max(2026,Math.min(2100,Math.round(Number(value)||2026)));
    // Manual year-scrub interrupts automatic keyframes, not the tensor layer.
    const manualTensor=hydroDisplay.flow&&tensorSession?tensorSession:null;
    if(manualTensor){
      if(tensorStageTimer){clearTimeout(tensorStageTimer);tensorStageTimer=0}
      manualTensor.completed=true;manualTensor.manual=true;
      manualTensor.awaitingYear=futureYear;
    }
    // The accepted curves reveal immediately on both timeline sliders.
    // Hydrology data remains authoritative only once this year's Worker finishes.
    simYearDisplay();
    if(!longTermMode)return;
    if(!manualTensor&&displayMode==='year'&&showCachedYear(futureYear))return;
    clearTimeout(yearSeekDebounce);
    const requestedYear=futureYear;
    yearSeekDebounce=setTimeout(()=>{
      yearSeekDebounce=0;
      if(!isolatedSelection||!prepared||requestedYear!==futureYear)return;
      if(requestYear(requestedYear)){
        if(manualTensor&&tensorSession===manualTensor)
          manualTensor.awaitingToken=lastRequestedScenarioToken;
        status('正在计算 '+requestedYear+' 年已选择的真实水深与张量场…');
      }
    },145); // Debounce heavy rain-event runs during fast scrubbing.
  };
  let previousWaterFrame=null,waterBlendStart=0,waterBlendHandle=0;
  let riskEnvelope=null; // maximum predicted depth encountered through the current year
  const clearRiskEnvelope=()=>{riskEnvelope=null;};
  const WATER_BLEND_MS=580;
  const stopAnnual=()=>{annualPlaying=false;clearTimeout(annualAdvanceTimer);annualAdvanceTimer=null;
    if(yearSeekDebounce){clearTimeout(yearSeekDebounce);yearSeekDebounce=0;}};
  // No undisclosed climate uplift: the three chosen 2h rainfall inputs are used unchanged.
  const climateRainFactor=()=>1;
  const siteHydroHistory=[];
  let siteFacilities=[];
  let nextFacilityId=1;
  let spongeTool='navigate';
  let hydroDisplay={depth:true,flow:false,collision:true,volume:true};
  let lastFlowUpdateAt=0;
  // Flood rendering is independent of tensor generation. Never accept an
  // undated request-flow-field response as a year-specific flood snapshot.
  let tensorSession=null,tensorSessionId=0,tensorContext=null,tensorStageTimer=0;
  const TENSOR_YEARS=[2026,2035,2045,2055,2065,2075,2085,2095,2100];
  const tensorPeakFrame=()=>{
    const peak=yearFrames.get(2100);
    return peak?.annualAreaStage?.kind==='rainfall-risk-scenario'&&
      peak.annualAreaStage.rainfallCase===rainPreset&&
      peak.grid&&peak.depthMm&&peak.flowField?peak:null;
  };
  function stopTensorSequence({restoreRain=false}={}){
    const original=tensorSession?.originalYear;
    tensorSessionId++;tensorSession=null;
    if(tensorStageTimer){clearTimeout(tensorStageTimer);tensorStageTimer=0}
    hydroVector?.setEnabled(false);
    if(restoreRain&&Number.isInteger(original)){
      futureYear=original;simYearDisplay();
      const frame=yearFrames.get(original);
      if(frame){
        const previous=applyingYearFrame;applyingYearFrame=true;
        try{handleFrame(frame)}finally{applyingYearFrame=previous}
      }
    }
  }
  function advanceTensorStage(session,index){
    if(tensorSession!==session||!hydroDisplay.flow||!isolatedSelection)return;
    if(index>=TENSOR_YEARS.length){
      session.completed=true;
      setSiteHud('siteHudTensorGrowthStatus','2026–2100 张量场生成完成 · 2100 年最终曲线');
      status('2100 年张量场已完成；关闭开关可回到原雨水画面。');
      return;
    }
    session.index=index;session.awaitingYear=TENSOR_YEARS[index];
    futureYear=session.awaitingYear;simYearDisplay();
    if(!requestYear(futureYear)){
      status('无法读取 '+futureYear+' 年水文情景');return;
    }
    session.awaitingToken=lastRequestedScenarioToken;
    setSiteHud('siteHudTensorGrowthStatus','自动生成 '+futureYear+
      ' 年 · '+(index+1)+'/'+TENSOR_YEARS.length+' · 等待当年流线');
    if(tensorStageTimer)clearTimeout(tensorStageTimer);
    tensorStageTimer=setTimeout(()=>{
      tensorStageTimer=0;
      if(tensorSession!==session||!hydroDisplay.flow||session.index!==index||session.completed)return;
      status(futureYear+' 年积分超时；继续下一个设计年份');
      advanceTensorStage(session,index+1);
    },22000);
  }
  function startTensorSequence(){
    if(annualPlaying){status('请等雨水模拟运行至2100年结束，再开启张量场');return false}
    const peak=tensorPeakFrame();
    if(!peak){
      status('请先完成雨水模拟至2100年，再开启张量场，程序将自动从2026年开始生成。');
      return false;
    }
    stopTensorSequence();
    tensorContext=null;
    const session={id:++tensorSessionId,index:-1,awaitingYear:null,awaitingToken:null,
      originalYear:futureYear,completed:false,grid:peak.grid,rainfallCase:rainPreset};
    tensorSession=session;
    lastFlowUpdateAt=0;
    hydroVector?.clear();
    hydroVector?.setEnabled(true);
    hydroVector?.setTimelineYear(2026,{instant:true});
    setSiteHud('siteHudTensorGrowthStatus','正在读取当前场地真实地形与汇水格网…');
    simulator?.requestFlowField();
    // An unavailable DEM/context must return to the existing rain picture
    // instead of leaving the user with an indefinitely black tensor scene.
    tensorStageTimer=setTimeout(()=>{
      tensorStageTimer=0;
      if(tensorSession!==session||session.index>=0)return;
      hydroDisplay.flow=false;stopTensorSequence({restoreRain:true});
      const box=siteHud('siteHudShowFlow');if(box)box.checked=false;
      updateHydroLayerVisibility();
      status('张量场启动超时：未取得匹配的 DEM／汇水格网；雨水模拟已恢复。',true);
    },15000);
    return true;
  }


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
  const FOCUS_FOOTPRINT_SOURCE='focus-building-footprint-source';
  const FOCUS_FOOTPRINT_FILL='focus-building-footprint-fill';
  const FOCUS_FOOTPRINT_LINE='focus-building-footprint-outline';
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
  const FOCUS_FLOW_LAYER='focus-flow-streamlines';
  const FOCUS_FLOW_GLOW='focus-flow-streamlines-glow';
  const FOCUS_FLOW_PARTICLES='focus-flow-particles';
  const FOCUS_FLOW_PARTICLE_LAYER='focus-flow-particle-layer';
  const FOCUS_TENSOR_RIBBON_SOURCE='focus-tensor-ribbon-source';
  const FOCUS_TENSOR_RIBBON_LAYER='focus-tensor-ribbon-line';
  const FOCUS_TENSOR_RIBBON_GLOW='focus-tensor-ribbon-glow';


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
      // Reference overlays are opt-in; unconfigured/unchecked is OFF.
      ea:ctx.ea===true,
      drainage:ctx.drainage===true,
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
    // Both references follow their own checkboxes, in either display mode.
    // EA is a long-term probability reference, never a depth/solver input.
    for(const [id,on] of [
      [FOCUS_EA_LAYER,ctx.ea],
      [FOCUS_DRAINAGE_LAYER,ctx.drainage]]){
      if(!viewer.getLayer(id))continue;
      const visibility=on?'visible':'none';
      if(viewer.getLayoutProperty(id,'visibility')!==visibility)
        viewer.setLayoutProperty(id,'visibility',visibility);
    }
    viewer.setPaintProperty(FOCUS_EA_LAYER,'raster-opacity',.78);
    if(viewer.getLayer(FOCUS_DRAINAGE_LAYER))
      viewer.setPaintProperty(FOCUS_DRAINAGE_LAYER,'raster-opacity',.85);
    setSiteHud('siteHudReferenceStatus',
      ctx.ea&&ctx.drainage?'已开启 EA 长期风险和 DEM 排水网络参考图层':
      ctx.ea?'已开启 EA 长期风险参考图层（不是水深）':
      ctx.drainage?'已开启 DEM 地形排水网络参考图层':
      '参考图层已隐藏');
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
      syncFocusFloodWaterRendering();
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
    // Keep footprints for optional visuals and impact highlighting, but not
    // hydrological blocking. Hide the footprint when buildings are hidden.
    isolateViewer?.getSource(FOCUS_FOOTPRINT_SOURCE)?.setData({
      type:'FeatureCollection',features:selectedBuildingVisuals()
    });
    syncFocusFootprintVisibility();
  }

  function syncFocusFootprintVisibility(){
    if(!isolateViewer)return;
    // Hiding the building must also hide its detached neutral footprint.
    const visible=hydroDisplay.flow&&tensorShowBuildings&&!hideSelectedBuildings
      ?'visible':'none';
    // Neutral footprints are shown only in the independent vector view.
    for(const [id,paint,defaultPaint] of [
      [FOCUS_FOOTPRINT_FILL,'fill-color',
        ['case',['boolean',['get','impacted'],false],'#ef615d','#94a3b8']],
      [FOCUS_FOOTPRINT_LINE,'line-color',
        ['case',['boolean',['get','impacted'],false],'#ff3b30','#8497a5']]
    ]){
      if(isolateViewer.getLayer(id))
        isolateViewer.setPaintProperty(id,paint,
          hydroDisplay.flow?'#8a9ba8':defaultPaint);
    }
    if(isolateViewer.getLayer(FOCUS_FOOTPRINT_FILL))
      isolateViewer.setPaintProperty(FOCUS_FOOTPRINT_FILL,'fill-opacity',
        hydroDisplay.flow?.24:
        ['case',['boolean',['get','impacted'],false],.45,.12]);
    for(const id of [FOCUS_FOOTPRINT_FILL,FOCUS_FOOTPRINT_LINE]){
      if(isolateViewer.getLayer(id)&&isolateViewer.getLayoutProperty(id,'visibility')!==visible)
        isolateViewer.setLayoutProperty(id,'visibility',visible);
    }
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
    stopAnnual();clearYearFrames();
    if(prepared&&isolatedSelection&&longTermMode)requestYear(futureYear);
    hydroState='reset';lastHydroFrame=null;
    siteHydroHistory.length=0;
    hydroVector?.clear();
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
  function syncFocusFloodWaterRendering(){
    const viewer=isolateViewer;
    if(!viewer)return;
    // Keep reference rasters readable: the custom 3D water mesh otherwise
    // renders later and covers the EA/drainage comparison layers.
    const reference=focusContextSettings();
    const useVolume=Boolean(!hydroDisplay.flow&&hydroDisplay.depth&&
      !reference.ea&&!reference.drainage&&hydroDisplay.volume&&
      viewer.getPitch()>.5&&volumetricWater?.ready);
    volumetricWater?.setVisible(useVolume);
    if(viewer.getLayer(FOCUS_RAIN_LAYER)){
      const visibility=!hydroDisplay.flow&&hydroDisplay.depth&&!useVolume?'visible':'none';
      if(viewer.getLayoutProperty(FOCUS_RAIN_LAYER,'visibility')!==visibility)
        viewer.setLayoutProperty(FOCUS_RAIN_LAYER,'visibility',visibility);
    }
  }
  function updateHydroLayerVisibility(){
    const viewer=isolateViewer;
    if(!viewer)return;
    if(hydroDisplay.flow&&viewer.getPitch()>.01)viewer.jumpTo({pitch:0});
    syncFocusFloodWaterRendering();
    const desired=hydroDisplay.flow?'visible':'none';
    hydroVector?.setEnabled(hydroDisplay.flow);
    // Reapply the accepted year frame when switching to the hydrology view.
    // Never override a displayed earlier year with a stale 2100 worker state.
    // No stale frame is reattached on a display-only switch.
    // Dark academic scene is applied only while the independent flow layer is on.
    const ground=hydroDisplay.flow?'#000000':'#e8e7e2';
    const green=hydroDisplay.flow?'#000000':'#bfd9b1';
    const road=hydroDisplay.flow?'#000000':'#c4c2bd';
    for(const [id,property,color] of [
      ['focus-parcel-ground','fill-color',ground],
      ['focus-green-ground','fill-color',green],
      ['focus-water-ground','fill-color',hydroDisplay.flow?'#000000':'#a8d5ec'],
      ['focus-road-casing','fill-color',road],
      ['focus-road-surface','fill-color',hydroDisplay.flow?'#000000':['match',['get','kind'],'major','#f8f5f0','pedestrian','#e8e2d1','#ffffff']]
    ])if(viewer.getLayer(id))viewer.setPaintProperty(id,property,color);
    setFocusPitchMode();
    for(const id of [FOCUS_2D,FOCUS_3D]){
      if(viewer.getLayer(id))viewer.setPaintProperty(id,
        id===FOCUS_3D?'fill-extrusion-color':'fill-color',
        hydroDisplay.flow?'#8b929d':
          hydroDisplay.collision?buildingColourExpression():'#ff9f1a');
    }
    // Reference overlays are independent of flood/tensor presentation mode.
    // Re-apply their checkbox state, never hide a requested drainage layer.
    updateFocusAnalysisLayers();
    // Mode switching must never modify the hydraulic solver or request undated water.
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
        [FOCUS_FOOTPRINT_SOURCE]:{type:'geojson',data:{type:'FeatureCollection',features:selectedBuildingVisuals()}},
        [FOCUS_GREEN]:{type:'geojson',data:details.greens},
        [FOCUS_WATER]:{type:'geojson',data:details.waters},
        [FOCUS_ROADS]:{type:'geojson',data:details.roads},
        [FOCUS_SPONGE_SOURCE]:{type:'geojson',data:spongeCollection(
          siteFacilities.map(siteSpongeFeature).filter(Boolean)
        )},
        [FOCUS_FLOW_SOURCE]:{type:'geojson',lineMetrics:true,data:spongeCollection([])},
        [FOCUS_TENSOR_RIBBON_SOURCE]:{type:'geojson',lineMetrics:true,data:spongeCollection([])},
        [FOCUS_FLOW_PARTICLES]:{type:'geojson',data:spongeCollection([])},
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
        // Outside the selected polygon: solid black for a clean isolated
        // architectural model display. All parcel-internal layers stay intact.
        {id:'focus-background',type:'background',
          paint:{'background-color':'#000000'}},
        {id:'focus-parcel-ground',type:'fill',source:FOCUS_SITE,
          paint:{'fill-color':'#e8e7e2','fill-opacity':1}},
        {id:'focus-green-ground',type:'fill',source:FOCUS_GREEN,
          paint:{'fill-color':'#bfd9b1','fill-opacity':0.95}},
        {id:'focus-water-ground',type:'fill',source:FOCUS_WATER,
          paint:{'fill-color':'#a8d5ec','fill-opacity':0.95}},
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
        {id:FOCUS_SPONGE_FILL,type:'fill',source:FOCUS_SPONGE_SOURCE,
          paint:{'fill-color':['get','color'],'fill-opacity':0.78}},
        {id:FOCUS_SPONGE_LINE,type:'line',source:FOCUS_SPONGE_SOURCE,
          paint:{'line-color':'#175967','line-width':1.5}},
        ...(canvas&&focusWaterBounds?[{
          id:FOCUS_RAIN_LAYER,type:'raster',source:FOCUS_RAIN_SOURCE,
          paint:{'raster-opacity':1,'raster-resampling':'linear','raster-fade-duration':0}
        }]:[]),
        // These opt-in references must be ABOVE the opaque flood canvas
        // and road/ground fills, otherwise toggles change but nothing appears.
        // Keep them BELOW the red site outline and the building geometry.
        {id:FOCUS_EA_LAYER,type:'raster',source:FOCUS_EA_SOURCE,
          layout:{visibility:'none'},
          paint:{'raster-opacity':.78,'raster-resampling':'nearest','raster-fade-duration':0}},
        {id:FOCUS_DRAINAGE_LAYER,type:'raster',source:FOCUS_DRAINAGE_SOURCE,
          layout:{visibility:'none'},
          paint:{'raster-opacity':.85,'raster-resampling':'linear','raster-fade-duration':0}},
        // Display hydrological flow ABOVE the water colour raster, and below
        // the architectural 3D buildings so walls still occlude the field.
        {id:FOCUS_FLOW_GLOW,type:'line',source:FOCUS_FLOW_SOURCE,
          layout:{visibility:hydroDisplay.flow?'visible':'none',
            'line-cap':'round','line-join':'round'},
          paint:{
            'line-color':['get','color'],
            'line-width':['*',['get','width'],2.7],
            'line-blur':1.8,'line-opacity':0.27
          }},
        {id:FOCUS_FLOW_LAYER,type:'line',source:FOCUS_FLOW_SOURCE,
          layout:{visibility:hydroDisplay.flow?'visible':'none',
            'line-cap':'round','line-join':'round'},
          paint:{
            'line-color':['get','color'],
            'line-width':['get','width'],
            'line-opacity':0.91
          }},
        {id:FOCUS_TENSOR_RIBBON_GLOW,type:'line',source:FOCUS_TENSOR_RIBBON_SOURCE,
          layout:{visibility:hydroDisplay.flow?'visible':'none',
            'line-cap':'round','line-join':'round'},
          paint:{
            'line-color':['get','color'],
            'line-width':['*',['get','width'],4.5],
            'line-blur':2.5,'line-opacity':.22
          }},
        {id:FOCUS_TENSOR_RIBBON_LAYER,type:'line',source:FOCUS_TENSOR_RIBBON_SOURCE,
          layout:{visibility:hydroDisplay.flow?'visible':'none',
            'line-cap':'round','line-join':'round'},
          paint:{
            'line-color':['get','color'],
            'line-width':['get','width'],
            'line-opacity':['get','opacity']
          }},
        {id:FOCUS_FLOW_PARTICLE_LAYER,type:'circle',source:FOCUS_FLOW_PARTICLES,
          layout:{visibility:'none'},
          paint:{
            'circle-color':['get','color'],
            'circle-radius':['get','radius'],
            'circle-opacity':.82,
            'circle-blur':.20,
            'circle-stroke-width':.3,
            'circle-stroke-color':'#c9ebff'
          }},
        // The dashed red boundary is a ground-level graphic, not an overlay
        // painted across roofs/walls. Extruded buildings must draw after it
        // for physically correct occlusion from every camera bearing.
        {id:'focus-parcel-border',type:'line',source:FOCUS_SITE,
          paint:{'line-color':'#ef4444','line-width':2.6,'line-dasharray':[2,1]}},
        {id:FOCUS_2D,type:'fill',source:FOCUS_BUILDINGS,
          layout:{visibility:'none'},
          paint:{'fill-color':buildingColourExpression(),'fill-opacity':1}},
        {id:FOCUS_FOOTPRINT_FILL,type:'fill',source:FOCUS_FOOTPRINT_SOURCE,
          layout:{visibility:hideSelectedBuildings?'visible':'none'},
          paint:{'fill-color':['case',['boolean',['get','impacted'],false],'#ef615d','#94a3b8'],
            'fill-opacity':['case',['boolean',['get','impacted'],false],0.45,0.12]}},
        {id:FOCUS_FOOTPRINT_LINE,type:'line',source:FOCUS_FOOTPRINT_SOURCE,
          layout:{visibility:hideSelectedBuildings?'visible':'none'},
          paint:{'line-color':['case',['boolean',['get','impacted'],false],'#ff3b30','#8497a5'],
            'line-width':['case',['boolean',['get','impacted'],false],2.2,1.1],
            'line-opacity':0.96}},
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
    if(hydroDisplay.flow&&viewer.getPitch()>.01){viewer.jumpTo({pitch:0});return}
    const is3D=viewer.getPitch()>.5;
    const show=!hydroDisplay.flow||tensorShowBuildings;
    for(const [id,v] of [
      [FOCUS_2D,show&&!is3D?'visible':'none'],
      [FOCUS_3D,show&&is3D?'visible':'none']
    ]){
      if(viewer.getLayer(id)&&viewer.getLayoutProperty(id,'visibility')!==v){
        viewer.setLayoutProperty(id,'visibility',v);
      }
    }
    syncFocusFloodWaterRendering();
    syncFocusFootprintVisibility();
  }

  function installFocusFloodVolume(viewer){
    if(!focusWaterBounds||volumetricWater)return;
    const volume=createFloodVolumeLayer(maplibregl,focusWaterBounds);
    volumetricWater=volume;
    try{
      viewer.addLayer(volume,FOCUS_FOOTPRINT_FILL);
      if(volume.failed)throw new Error(volume.failed);
      if(lastHydroFrame?.depthMm)volume.updateFrame(lastHydroFrame,true);
      volume.animate=hydroState==='running';
    }catch(error){
      console.warn('3D flood unavailable; using raster water fallback',error);
      if(viewer.getLayer(volume.id))viewer.removeLayer(volume.id);
      if(volumetricWater===volume)volumetricWater=null;
    }
    syncFocusFloodWaterRendering();
  }

  function destroyFocusViewer(){
    stopTensorSequence();
    tensorContext=null;hydroDisplay.flow=false;
    if(focusThresholdTimer)clearTimeout(focusThresholdTimer);
    focusThresholdTimer=null;
    const viewer=isolateViewer;
    hydroVector?.dispose();
    hydroVector=null;
    delete window.getLondonHydroVectorFieldData;
    delete window.getLondonHydroTensorFieldData;
    delete window.getLondonHydroTensorDiagnostics;
    delete window.getLondonHydroTensorGeometryData;
    delete window.getLondonHydroTensorSiteSnapshot;
    isolateViewer=null;
    volumetricWater=null;
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
    setSiteHud('siteHudRainValue',presetRainRate()+' mm/h');
    if(siteHud('siteHudManualRain')&&rainfallMode==='manual'){
      siteHud('siteHudManualRain').value=$('localFloodRain').value;
    }
    setSiteHud('siteHudInfilValue',$('localFloodInfil')?.value+' mm/h');
    setSiteHud('siteHudDurationValue',$('localFloodDuration')?.value+' min');
    setSiteHud('siteHudGrid',$('localFloodGridInfo')?.textContent||'');
    setSiteRainMode();
  }
  function simYearDisplay(){
    hydroVector?.setTimelineYear(futureYear);
    setSiteHud('siteHudYearText',String(futureYear));
    setSiteHud('siteHudTensorYear',String(futureYear));
    for(const id of ['siteHudYear','siteHudFooterYear'])if(siteHud(id))siteHud(id).value=String(futureYear);
    setSiteHud('siteHudFutureFactor',RAIN_PRESETS[rainPreset].label+
      ' · 四历时设计对比（30/60/120/360 min） · '+
      (fehDurationDepthsMm?'使用手动输入的 FEH DDF 雨量':
        '等总雨量 '+RAIN_PRESETS[rainPreset].total+' mm，灵敏度测试；不是 FEH DDF'));
    updateSiteHydroDashboard();
  }
  function updateSiteHydroDashboard(frame=lastHydroFrame){
    if(!isolatedSelection)return;
    const v=frame?.stats;
    if(siteHud('siteHudOfficialAgreement')){
      if(v?.officialDepthAvailable){
        const ha=x=>(Number(x||0)/10000).toFixed(2)+' ha';
        const overlap=ha(v.officialOverlapAreaM2);
        const extra=ha(v.simulatedOutsideOfficialM2);
        const missed=ha(v.officialNotSimulatedM2);
        const iou=Number.isFinite(v.officialIoU)?(v.officialIoU*100).toFixed(1)+'%':'无可比淹没单元';
        const band=Number.isFinite(v.officialBandAgreement)?(v.officialBandAgreement*100).toFixed(1)+'%':'暂无可比单元';
        setSiteHud('siteHudOfficialAgreement',
          '交集 '+overlap+' · 模拟范围超出 EA '+extra+
          ' · EA 范围未覆盖 '+missed+' · 范围 IoU '+iou+
          ' · 水深分级落在 EA 区间 '+band);
      }else setSiteHud('siteHudOfficialAgreement',
        '本次尚未读取到 EA 官方水深参考，无法对范围与水深作校核；不能据此宣称与官方吻合。');
    }
    setSiteHud('siteHudDepthLegendNote',showShallowWater?
      '地图显示 ≥1 mm 的模拟水深，1–20 mm 浅湿润仅增强视觉，不计入 ≥2 cm 积水面积；以下是原始网格分级统计。':
      '当前隐藏 1–20 mm 浅湿润，但首档统计仍包含其真实计算面积；≥2 cm 积水面积保持不变。');
    for(let i=0;i<6;i++){
      const ha=(v?.depthAreaM2?.[i]||0)/10000;
      setSiteHud('siteDepthArea'+i,ha.toFixed(2)+' ha');
      const el=siteHud('siteDepthBin'+i);
      if(el)el.dataset.wet=ha>0?'true':'false';
    }
    const stage=longTermMode&&
      ['rainfall-risk-scenario','storm-event'].includes(frame?.annualAreaStage?.kind)
      ?frame.annualAreaStage:null;
    if(stage?.resetInitial){
      setSiteHud('siteHudAreaProgress','2026 年 · 已重置 · 0.00 ha');
    }else if(stage?.kind==='storm-event'){
      setSiteHud('siteHudAreaProgress','单次临界暴雨 · '+Math.round(stage.eventTimeMin||0)+
        '/'+stage.durationMin+' min · 当前积水 '+((v?.wetAreaM2||0)/1e4).toFixed(2)+' ha');
    }else if(stage){
      const baseHa=(stage.baselineWetAreaM2||0)/10000;
      const nowHa=(v?.wetAreaM2||0)/10000;
      const finalHa=(stage.finalWetAreaM2||0)/10000;
      const pct=(stage.fraction*100).toFixed(1);
      const riskText=stage.riskAvailable
        ?'EA 现状风险独立对照 · 淹没格与风险区重合 '+
          (v?.eaRiskOverlapPercent||0).toFixed(1)+'%'
        :'EA 风险覆盖缺失（仍可计算地表积水）';
      setSiteHud('siteHudAreaProgress',
        futureYear+' 年 / 设计包络展示 '+pct+'% · 积水 '+nowHa.toFixed(2)+
        ' ha（2026展示起点 0.00 → 2100最大包络 '+finalHa.toFixed(2)+
        ' ha） · '+riskText);
    }else{
      setSiteHud('siteHudAreaProgress',longTermMode
        ?'等待该年份的淹没面积快照':'');
    }
    setSiteHud('siteHudFloodPhase',longTermMode?
      (displayMode==='year'?
        futureYear+' 年 · 多历时最大水深包络逐步展示，2100 达到设计峰值（非逐年洪灾预报）':
        '临界单场暴雨 · '+Math.round(eventTimeMin)+' min · 可能涨水或退水，与年份无关'):annualPlaying?
      futureYear+' 年 · 无新增干预的累计最大淹没风险包络（非持续积水）':
      (!v||v.timeMin===0?'尚未运行 · 无动态积水':'模拟 '+simulationClock(v.timeMin)+' · 蓝色区域按计算水深逐步变化'));
    if(v){
      setSiteHud('siteHudDepth',v.maxDepthM<.01?v.maxDepthM.toFixed(3)+' m':v.maxDepthM.toFixed(2)+' m');
      setSiteHud('siteHudArea',(v.wetAreaM2/1e4).toFixed(2)+' ha');
      setSiteHud('siteHudShallowWet',(Number(v.shallowWetAreaM2||0)/1e4).toFixed(2)+' ha');
      setSiteHud('siteHudImpacted',v.impactedCount+' 栋');
      setSiteHud('siteHudVolume',Math.round(v.volumeM3).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudRetained',Math.round(v.retainedM3||0).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudExtraInfil',Math.round(v.spongeInfiltrationM3||0).toLocaleString('en-GB')+' m³');
    }else{
      for(const [id,value] of [
        ['siteHudDepth','0.000 m'],['siteHudArea','0.00 ha'],['siteHudShallowWet','0.00 ha'],
        ['siteHudImpacted','0 栋'],['siteHudVolume','0 m³'],
        ['siteHudRetained','0 m³'],['siteHudExtraInfil','0 m³'],
        ['siteHudLiveRain','0.0 mm/h']
      ])setSiteHud(id,value);
    }
    const elapsed=v?.timeMin||0,duration=Number($('localFloodDuration')?.value)||60;
    setSiteHud('siteHudClock',displayMode==='year'?futureYear+' 年 / 2100 年':'单次暴雨 '+Math.round(eventTimeMin)+' / '+criticalDurationMin+' min');
    if(stage?.stormComparisons){
      criticalDurationMin=Number(stage.criticalDurationMin)||120;
      const slider=siteHud('siteHudEventTime');
      if(slider){slider.max=String(criticalDurationMin);slider.value=String(Math.min(eventTimeMin,criticalDurationMin));}
      setSiteHud('siteHudEventTimeText',Math.round(eventTimeMin)+' / '+criticalDurationMin+' min');
      const ha=x=>(Number(x||0)/1e4).toFixed(2);
      setSiteHud('siteHudCriticalStorm','控制单场：'+criticalDurationMin+
        ' 分钟 · 总雨量 '+Number(stage.criticalRainTotalMm).toFixed(1)+
        ' mm · 峰值积水 '+ha(stage.criticalPeakAreaM2)+' ha · 出现于第 '+
        Math.round(stage.criticalPeakMinute)+' 分钟');
      setSiteHud('siteHudStormComparison',stage.stormComparisons.map(item=>
        item.durationMin+' min · '+Number(item.rainTotalMm).toFixed(1)+' mm · 峰值 '+
        ha(item.peakAreaM2)+' ha · 最大水深 '+Number(item.peakMaxDepthM).toFixed(3)+' m').join(' | '));
      setSiteHud('siteHudDdfSource',stage.depthDataSource==='user-entered-FEH-DDF'
        ?'采用用户手动输入的四个 FEH 深度值（未自动核实来源）'
        :'相同总雨量下的历时敏感性试验，不是同一 AEP 的 FEH 设计暴雨');
    }
    if(v&&Number.isFinite(v.currentRainMmH)){
      setSiteHud('siteHudLiveRain',v.currentRainMmH.toFixed(1)+' mm/h');
    }
    const progress=siteHud('siteHudProgress');
    if(progress)progress.style.width=(
      displayMode==='event'?eventTimeMin/Math.max(1,criticalDurationMin):
        (futureYear-2026)/74)*100+'%';
    if(longTermMode&&v&&hydroState==='preparing')hydroState='ready';
    setSiteHud('siteHudRunState',longTermMode?
      (annualPlaying?'水流演算回放中 · ':'模拟快照可回放 · ')+
      (v?.wetAreaM2!=null?(v.wetAreaM2/1e4).toFixed(2)+' ha':'等待计算') :
      (({ready:'准备就绪',running:'洪水事件运行中',paused:'洪水事件已暂停',complete:'洪水事件完成',reset:'已重置'}[hydroState]||'等待模拟')+
        ' · 事件 '+simulationClock(elapsed)+' / '+simulationClock(duration)));
    if(siteHud('siteHudRun'))siteHud('siteHudRun').disabled=!prepared||annualPlaying||hydroState==='running'||hydroState==='preparing';
    if(siteHud('siteHudPause'))siteHud('siteHudPause').disabled=!prepared||(!annualPlaying&&hydroState!=='running');
    const chart=siteHud('siteHudChart');
    if(chart){
      chart.replaceChildren();
      if(siteHydroHistory.length){
      const mx=Math.max(.02,...siteHydroHistory.map(r=>r[1]));
      for(const [t,depth] of siteHydroHistory){
        const bar=document.createElement('span');
        bar.style.height=Math.max(2,Math.round(depth/mx*48))+'px';
        bar.title=simulationClock(t)+' / '+depth.toFixed(2)+'m';
        chart.appendChild(bar);
      }
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
      '<small>REAL SITE FLOOD ANALYSIS · OS TERRAIN 50 · v3.22.57-reference-overlay-fix</small></div>',
      '<span class="site-hydro-chip">EA RISK / DRAINAGE / RAINFALL</span>',
      '<button id="siteHudTop" class="site-hydro-btn" type="button" style="flex:0 0 58px">2D</button>',
      '<button id="siteHudIso" class="site-hydro-btn" type="button" style="flex:0 0 58px">3D</button>',
      '<button id="siteHudExit" class="site-hydro-close" type="button">✕ 返回城市地图 · Esc</button></header>',
      '<section class="site-hydro-side site-hydro-left">',
      '<div class="site-hydro-eyebrow">SCENARIO BUILDER</div>',
      '<div class="site-hydro-title">真实场地洪涝模拟</div>',
      '<div class="site-hydro-pill"><div id="siteHudLocation">查询地块坐标…</div><small id="siteHudGrid"></small></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">2026—2100 · 长期设计包络（2100峰值）</div>',
      '<div class="site-hydro-row"><input type="range" id="siteHudYear" min="2026" max="2100" step="1" value="2026" style="flex:1;min-width:70px"><strong id="siteHudYearText">2026</strong></div>',
      '<input type="hidden" id="siteHudFutureMode" value="rain-risk">',
      '<label class="site-hydro-row">外部洪水位 <input id="siteHudFutureStage" type="number" step="0.1" placeholder="绝对高程 m" style="width:105px"> m</label>',
      '<button type="button" class="site-hydro-btn" id="siteHudTrialStage">采用 DEM 低点 + 1.0 m（仅设计试验）</button>',
      '<div class="site-hydro-mini" style="display:none;margin:8px 0;border:1px solid #426279;border-radius:7px;padding:8px">',
      '<strong>EA 官方外部洪水数据</strong> · <a href="https://www.data.gov.uk/dataset/67a734bb-2b7b-491a-aafd-3f7e52c8d7f3/rivers-and-sea-defended-and-undefended-flood-risk-depths-climate-change" target="_blank" rel="noopener noreferrer">气候变化深度数据集</a>',
      '<div id="siteHudEaStageStatus" style="margin:5px 0">尚未查询场地附近官方河流水位站。</div>',
      '<div id="siteHudEaFloodZoneStatus" style="margin:5px 0">尚未查询 EA 官方 Flood Zone 2 / 3 场地覆盖。</div>',
      '<button type="button" class="site-hydro-btn" id="siteHudQueryEaZones">查询 EA 官方洪水区</button>',
      '<button type="button" class="site-hydro-btn" id="siteHudQueryEaStage">查询附近 EA 实测水位</button>',
      '<div style="margin-top:5px">注意：站点读数可能是 mASD（相对站点零点），不能代入 DEM；即使 mAOD，也必须验证水力连接及高程基准，不能作为任意地块外部边界。官方洪水深度分级不代表实时边界水位。</div>',
      '</div>',
      '<div id="siteHudStageHint" class="site-hydro-mini" style="margin:3px 0 8px;color:#edc98a">外部洪水模式须输入外部边界绝对水位（m，须与 DEM 同一高程基准）；不提供时只能保留选择，不能产生可信水深。</div>',
      '<label class="site-hydro-row">降雨情景 <select id="siteHudFutureClimate" style="width:140px"><option value="average">平均降雨</option><option value="moderate" selected>中等降雨</option><option value="extreme">特大暴雨</option></select></label>',
      '<div class="site-hydro-actions"><button type="button" class="site-hydro-btn" id="siteHudUseRiskGuide">使用统一降雨模型 + EA 校核</button></div>',
      '<div class="site-hydro-actions"><button type="button" id="siteHudShowEARisk" class="site-hydro-btn">显示 EA 官方风险图</button></div>',
      
      '<label class="site-hydro-row">入流位置 <select id="siteHudExternalInlet" style="width:140px"><option value="low">边界低洼 10%（假设）</option><option value="all">全部边界（试验）</option></select></label>',
      '<label class="site-hydro-row">涨水时间 <input id="siteHudRise" type="number" min="1" max="1440" value="30" style="width:88px"> min</label>',
      '<label class="site-hydro-row">退水结束 <input id="siteHudFall" type="number" min="2" max="2880" value="90" style="width:88px"> min</label>',
      '</div>',
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
      '<label class="site-hydro-check"><input type="checkbox" id="siteHudEA"> EA 官方长期风险图（静态参考，默认隐藏）</label>',
      '<label class="site-hydro-check"><input type="checkbox" id="siteHudDrainage"> DEM 推导排水网络（可选参考）</label>',
      '<div class="site-hydro-mini" id="siteHudReferenceStatus" style="color:#91cedc">参考图层已隐藏</div>',
      '<div class="site-hydro-mini">使用真实 DEM 和建筑障碍计算四种暴雨历时。年份是规划包络的展示尺度；单次暴雨另有独立分钟级时间轴，EA 概率不等于水深。</div>',
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
      '<label class="site-hydro-check"><input id="siteHudShowBuildings" type="checkbox" checked> 显示场地内建筑（仅视觉；积水可覆盖建筑地面占地）</label>',
      '<label class="site-hydro-check"><input id="siteHudShowDepth" type="checkbox" checked> 水深</label>',
      '<label class="site-hydro-check"><input id="siteHudShowShallow" type="checkbox" checked> 显示浅湿润（1–20 mm；默认开启，不增加真实降雨量）</label>',
      '<label class="site-hydro-check"><input id="siteHudShowVolume" type="checkbox" checked> 3D 立体动态水体 · 波纹 / 接触水花</label>',
      '<label class="site-hydro-check"><input id="siteHudShowCollision" type="checkbox" checked> 建筑碰撞效果</label>',
      '<div class="site-hydro-mini">3D水面显示高度按水深约放大1.45倍（最大显示3m）；颜色及浅水开关只影响渲染。面积、水深、建筑影响统计始终使用未放大的计算值。</div>',
      '</div>', // Close 03 only; keep the left sidebar section open through 04.
      '<div class="site-hydro-section site-vector-panel" id="siteHudVectorPanel"><div class="site-hydro-section-title">04 · 水文张量场</div>',
      '<label class="site-hydro-check site-vector-enable"><input id="siteHudShowFlow" type="checkbox"> 雨水完成后生成张量场（2026–2100）</label>',
      '<div class="site-hydro-mini site-tensor-caption">雨水模拟到2100年完成后，开启此项自动依次计算2026–2100年张量场；关闭恢复原雨水画面。</div>',
      '<div class="site-vector-modes" role="group"><button type="button" class="site-vector-mode active" data-vector-mode="analysis" aria-pressed="true">分析模式</button><button type="button" class="site-vector-mode" data-vector-mode="presentation" aria-pressed="false">演示模式</button></div>',
      '<div class="site-hydro-mini site-tensor-year">模拟年份 · <strong id="siteHudTensorYear">2026</strong> / 2100</div>',
      '<div class="site-hydro-section-title site-tensor-subtitle">方向结构</div>',
      '<div class="site-vector-modes site-tensor-directions" role="group"><button type="button" class="site-vector-mode" data-tensor-direction="primary" aria-pressed="false">主方向</button><button type="button" class="site-vector-mode" data-tensor-direction="secondary" aria-pressed="false">次方向</button><button type="button" class="site-vector-mode active" data-tensor-direction="dual" aria-pressed="true">双方向</button></div>',
      '<div class="site-vector-params">',
      '<label class="site-vector-param"><span>地形影响<output id="siteHudVectorTerrainWeightValue">35</output></span><input id="siteHudVectorTerrainWeight" type="range" min="0" max="100" step="5" value="35"></label>',
      '<label class="site-vector-param"><span>汇水影响<output id="siteHudVectorDrainageWeightValue">45</output></span><input id="siteHudVectorDrainageWeight" type="range" min="0" max="100" step="5" value="45"></label>',
      '<label class="site-vector-param"><span>积水影响<output id="siteHudVectorAvoidanceValue">70</output></span><input id="siteHudVectorAvoidance" type="range" min="0" max="100" step="5" value="70"></label>',
      '<label class="site-vector-param"><span>方向平滑<output id="siteHudVectorSmoothnessValue">60</output></span><input id="siteHudVectorSmoothness" type="range" min="0" max="100" step="5" value="60"></label>',
      '<label class="site-vector-param"><span>线条密度<output id="siteHudVectorDensityValue">55</output></span><input id="siteHudVectorDensity" type="range" min="0" max="100" step="1" value="55"></label>',
      '<label class="site-vector-param"><span>线条长度<output id="siteHudVectorLengthValue">65</output></span><input id="siteHudVectorLength" type="range" min="0" max="100" step="1" value="65"></label>',
      '<label class="site-vector-param"><span>发光强度<output id="siteHudVectorGlowValue">0</output></span><input id="siteHudVectorGlow" type="range" min="0" max="1" step="0.05" value="0"></label>',
      '<label class="site-vector-param"><span>动画速度<output id="siteHudVectorSpeedValue">0</output></span><input id="siteHudVectorSpeed" type="range" min="0" max="3" step="0.1" value="0"></label>',
      '</div>',
      '<label class="site-hydro-check site-tensor-buildings"><input id="siteHudTensorBuildings" type="checkbox"> 显示建筑（默认隐藏）</label>',
      '<div class="site-vector-scale"><span>弱</span><div aria-hidden="true"></div><span>强</span></div>',
      '<div class="site-hydro-mini" id="siteHudTensorGrowthStatus" style="margin:7px 0;color:#9de9eb">张量场准备中 · 首次计算将先显示真实方向预览</div>',
      '<button type="button" class="site-vector-mode" id="siteHudTensorReplay">▶ 回放张量场生成（约4秒）</button>',
      '<div class="site-hydro-mini" style="font-size:11px">回放与线条生长百分比是可视化进度，不代表真实逐年道路建设；方向仍取当前计算场景。</div>',
      '<div class="site-hydro-mini" id="siteHudVectorStatus" style="white-space:pre-line">启用后读取当前年份的地形与积水方向场</div>',
      '<button type="button" class="site-vector-mode" id="siteHudTensorExport">导出真实场地诊断</button>',
      '<div class="site-hydro-mini" id="siteHudTensorExportStatus">保存选区、视角、原始格网和已计算的2026/2100情景，供同场地复核。</div>',
      '<div class="site-hydro-mini site-vector-provenance">OS Terrain 50 · 坡向 · 地形汇水 · 模拟水深 · 建筑占地可淹没<br>2026—2100 随年份更新。张量线及粒子不表示真实水流速度。</div>',
      '</div></section>',
      '<aside class="site-hydro-side site-hydro-right">',
      '<div class="site-hydro-eyebrow">LIVE PERFORMANCE</div><div class="site-hydro-title">场地模拟结果</div>',
      '<div class="site-hydro-section" style="margin-top:4px;padding-top:7px;border-top:0">',
      '<div class="site-hydro-section-title">动态积水水深分级 · SIMULATED DEPTH</div>',
      '<div class="site-hydro-mini" id="siteHudDepthLegendNote">地图默认显示 ≥1 mm 的浅湿润；1–20 mm 仅增强可见性，不计入 ≥2 cm 的积水面积。右侧颜色与地图一致，分级面积来自原始模拟网格。</div>',
      '<div class="site-hydro-depth-legend">',
      '<div class="site-hydro-depth-bin" id="siteDepthBin0" data-wet="false"><i style="background:linear-gradient(90deg,#b4ceff,#4a92ff)"></i><span>0.001–0.05m（含浅湿润）<strong id="siteDepthArea0">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin1" data-wet="false"><i style="background:linear-gradient(90deg,#4a92ff,#2271ff)"></i><span>0.05–0.15m <strong id="siteDepthArea1">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin2" data-wet="false"><i style="background:linear-gradient(90deg,#2271ff,#1c5adf)"></i><span>0.15–0.30m <strong id="siteDepthArea2">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin3" data-wet="false"><i style="background:linear-gradient(90deg,#1c5adf,#1545b7)"></i><span>0.30–0.60m <strong id="siteDepthArea3">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin4" data-wet="false"><i style="background:linear-gradient(90deg,#1545b7,#041c4b)"></i><span>0.60–1.20m <strong id="siteDepthArea4">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin5" data-wet="false"><i style="background:linear-gradient(90deg,#041c4b,#041c4b)"></i><span>≥1.20m <strong id="siteDepthArea5">0.00 ha</strong></span></div>',
      '</div><div class="site-hydro-depth-note" id="siteHudFloodPhase">尚未运行 · 无动态积水</div></div>',
      '<div class="site-hydro-metric"><small>MAX DEPTH · 最大地表水深</small><b id="siteHudDepth">0.000 m</b></div>',
      '<div class="site-hydro-metric"><small>WET AREA · 积水面积 ≥ 0.02 m</small><b id="siteHudArea">0.00 ha</b></div>',
      '<div class="site-hydro-metric"><small>IMPACTED BUILDINGS · 受影响建筑</small><b id="siteHudImpacted">0 栋</b></div>',
      '<div class="site-hydro-metric"><small>SHALLOW WETTING · 浅表湿润 ≥ 1 mm（非洪涝）</small><b id="siteHudShallowWet">0.00 ha</b></div>',
      '<div class="site-hydro-metric"><small>SURFACE WATER · 地表积水体积（深度 ≥ 2 cm）</small><b id="siteHudVolume">0 m³</b></div>',
      '<div class="site-hydro-metric"><small>SPONGE STORAGE · 设施内滞蓄水量</small><b id="siteHudRetained">0 m³</b></div>',
      '<div class="site-hydro-metric"><small>ADDITIONAL INFILTRATION · 设施额外累计下渗</small><b id="siteHudExtraInfil">0 m³</b></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">LIVE RAINFALL · 当前计算雨强</div>',
      '<div class="site-hydro-value" id="siteHudLiveRain">— mm/h</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">MAX DEPTH · 水深变化</div>',
      '<div id="siteHudChart" class="site-hydro-chart"></div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">EA RISK · 静态长期概率（手动查看）</div>',
      '<div class="site-hydro-mini" style="line-height:1.9">',
      '<span style="color:#9cdeea">■</span> 极低 &lt;0.1% · ',
      '<span style="color:#f7d359">■</span> 低 0.1–&lt;1%<br>',
      '<span style="color:#f29d38">■</span> 中 1–&lt;3.3% · ',
      '<span style="color:#d73731">■</span> 高 ≥3.3%</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">EA 官方范围校核 · 2070s Upper End</div>',
      '<div id="siteHudOfficialStatus" class="site-hydro-mini">正在读取 EA 官方 0.1% AEP 水深与淹没范围…</div>',
      '<div id="siteHudOfficialAgreement" class="site-hydro-mini">等待模拟。EA 官方范围和研究暴雨不是同一事件重现期。</div>',
      '<div class="site-hydro-section-title" style="margin-top:9px">MULTI-DURATION · 四历时控制暴雨</div>',
      '<div id="siteHudCriticalStorm" class="site-hydro-mini">待求解四场暴雨，按峰值积水面积选出控制历时</div>',
      '<div id="siteHudStormComparison" class="site-hydro-mini">30 / 60 / 120 / 360 min：等待面积与水深比较</div>',
      '<div class="site-hydro-mini">EA 独立校核口径：模型积水 ≥ 0.02 m；官方参考为 0.1% AEP 七档水深。参考范围不会裁剪模拟积水，也不会改变水文求解。</div>',
      '<div class="site-hydro-mini"><a href="https://www.data.gov.uk/dataset/ff48e392-ab66-49fa-b6dc-3dc72485a6db/flood-map-for-planning-surface-water-spatial-planning-depths-climate-change" target="_blank" rel="noopener noreferrer">© Environment Agency · 深度来源 ↗</a></div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">MAP DATA STATUS</div>',
      '<div id="siteHudEAStatus" class="site-hydro-mini">EA 风险：等待瓦片</div>',
      '<div id="siteHudDrainStatus" class="site-hydro-mini">地形网络：等待瓦片</div></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">DATA PROVENANCE</div>',
      '<div class="site-hydro-mini">EA 风险等级 = 长期概率，不是水深；地形网络 = 汇水路径，不是地下管网；',
      '动态水深 = 输入降雨、地形及可淹没建筑基地的概念模拟。此工具不能替代工程级洪水模型。</div></div></aside>',
      '<div class="site-hydro-zoom">独立地块 3D · 拖动平移 / 右键旋转 / 滚轮缩放</div>',
      '<footer class="site-hydro-footer">',
      '<button id="siteHudRun" class="site-hydro-btn primary" style="flex:0 0 85px" type="button">▶ 运行</button>',
      '<button id="siteHudPause" class="site-hydro-btn" style="flex:0 0 70px" type="button">Ⅱ 暂停</button>',
      '<button id="siteHudReset" class="site-hydro-btn" style="flex:0 0 75px" type="button">↺ 重置</button>',
      '<div class="site-hydro-timeline"><div style="display:flex;justify-content:space-between">',
      '<strong id="siteHudClock">2026 年 / 2100 年</strong><span id="siteHudRunState" class="site-hydro-mini">准备就绪</span>',
      '</div><div class="site-hydro-track" style="position:relative;overflow:visible"><div id="siteHudProgress" class="site-hydro-progress"></div><input id="siteHudFooterYear" aria-label="预测年份 2026 到 2100" type="range" min="2026" max="2100" step="1" value="2026" style="position:absolute;inset:-8px 0 auto 0;width:100%;height:18px;margin:0;cursor:pointer;opacity:0.65;accent-color:#5dd2db"></div><div class="site-hydro-mini" style="display:flex;justify-content:space-between"><span>2026</span><span>2050</span><span>2075</span><span>2100</span></div>',
      '<div class="site-hydro-mini" id="siteHudNotice">2026—2100 是多事件设计包络的单调展示，2100达到设定峰值；可切换单次暴雨分钟级回放。非EA逐年预测。</div></div></footer>'
    ].join('');
    container.appendChild(shell);
    const bounds=bboxLngLat(polygon[0]);
    setSiteHud('siteHudLocation','Lat '+((bounds.south+bounds.north)/2).toFixed(5)+
      ' · Lon '+((bounds.west+bounds.east)/2).toFixed(5));
    syncSiteControls();
    siteHud('siteHudShowBuildings').checked=!hideSelectedBuildings;
    siteHud('siteHudShowBuildings').onchange=event=>{
      hideSelectedBuildings=!event.target.checked;
      const mapToggle=$('localFloodHideSelectedBuildings');
      if(mapToggle)mapToggle.checked=hideSelectedBuildings;
      publishBuildingScene();
      updateFocusBuildings();
    };
    updateSiteHydroDashboard();
    const clearPreviousFloodVisuals=()=>{
      cancelAnimationFrame(waterBlendHandle);
      previousWaterFrame=null;
      waterBlendStart=0;
      canvasContext?.clearRect(0,0,canvas?.width||0,canvas?.height||0);
      lowResWaterContext?.clearRect(0,0,lowResWater?.width||0,lowResWater?.height||0);
      if(volumetricWater){
        volumetricWater.frame=null;
        volumetricWater.mesh=null;
        volumetricWater.count=0;
        volumetricWater.dirty=false;
        volumetricWater.displayDepth=null;
        volumetricWater.lastScenarioYear=null;
      }
      hydroVector?.clear(); // Discard cached tensor, particles and stale runoff directions.
      lastFlowUpdateAt=0;
      let changed=false;
      for(const scene of sceneFeatures.values()){
        if(scene?.properties?.selected&&scene.properties.impacted){
          scene.properties.impacted=false;
          changed=true;
        }
      }
      if(changed){publishBuildingScene();updateFocusBuildings();}
      map.triggerRepaint();isolateViewer?.triggerRepaint();
    };
    const resetFuture=()=>{
      stopTensorSequence();hydroDisplay.flow=false;
      if(siteHud('siteHudShowFlow'))siteHud('siteHudShowFlow').checked=false;
      updateHydroLayerVisibility();
      stopAnnual();clearRiskEnvelope();clearYearFrames();
      simulator?.reset();
      siteHydroHistory.length=0;lastHydroFrame=null;hydroState='reset';
      clearPreviousFloodVisuals();
      updateSiteHydroDashboard(null);
    };
    const syncFuture=()=>{
      setSiteHud('siteHudYearText',String(futureYear));
    setSiteHud('siteHudTensorYear',String(futureYear));
      siteHud('siteHudYear').value=String(futureYear);
      siteHud('siteHudFooterYear').value=String(futureYear);
      setSiteHud('siteHudFutureFactor',RAIN_PRESETS[rainPreset].label+
        ' · 四历时设计对比 · '+
        (fehDurationDepthsMm?'使用手动输入的 FEH DDF 雨量':'同一总雨量 '+RAIN_PRESETS[rainPreset].total+' mm（敏感性试验）'));
      floodMode='rain-risk';
      if(siteHud('siteHudFutureMode'))siteHud('siteHudFutureMode').value='rain-risk';
      const external=false;
      siteHud('siteHudFutureStage').disabled=!external;
      const stageHint=siteHud('siteHudStageHint');
      if(stageHint){stageHint.style.display=external?'block':'none';stageHint.textContent=Number.isFinite(externalStageM)?'已输入边界绝对水位 '+externalStageM.toFixed(2)+' m（请确认与 DEM 高程基准一致；该值为用户设定，不是 EA 实测水位）。':'此模式需要边界绝对水位：在此输入与 DEM 同基准的水位（m）；没有真实水位时不能计算外部洪水。';}
      for(const id of ['siteHudExternalInlet','siteHudRise','siteHudFall'])
        siteHud(id).disabled=!external;
      if(siteHud('siteHudUseRiskGuide'))
        siteHud('siteHudUseRiskGuide').disabled=false;
      setSiteHud('siteHudRiskFusionNote',
        '平均、中等、特大暴雨使用相同 DEM 高程、可淹没建筑基地和地形汇水路径（路径权重不因雨强或 EA 风险分级而切换）。EA 官方范围与深度只用于独立结果校核。');
      updateFocusAnalysisLayers();
      setSiteHud('siteHudFutureNote',longTermMode?
        (floodMode==='rain-risk'
          ?'四种暴雨历时采用同一 DEM/建筑/汇水网络模型，EA 仅进行独立校核。2026–2100 是最大水深设计包络的展示插值，2100 为规划峰值，不是官方逐年预报。'
          :'本演示以2026年零新增积水画面为起点（不表示现实中2026年无洪水风险），以设计降雨、DEM、建筑和假设排水计算得到的2100年水深为终点。未来淹没范围与水深随年份渐进显示，EA现状风险仅用于空间校核和展示顺序。中间年份为视觉分期，不是逐年真实洪水预报。'):
        (floodMode==='rain'?
        '2026—2100 为研究设计包络展示刻度，2100 达到最大规划情景；不是年度气象预测，也不等于单场暴雨持续74年。':
        '外部洪水仅使用手动给定的同基准绝对水位；无真实边界数据不能自动运行。不是 EA 官方洪水水位预报。'));
      resetFuture();
      if(needsExternalStage()&&!Number.isFinite(externalStageM)){
        status('已切换到外部洪水模式。请在模式下方输入外部边界绝对水位（m）再运行；未输入时不会运行或切换模式。');
      }
      if(floodMode==='rain-risk'&&!siteRiskAvailable)
        status('EA 现状风险参考在此区域不可用，仍可按 DEM、建筑和降雨计算；官方重合率会标注不可用。');
    };
    const redrawDisplayOnly=()=>{
      if(!lastHydroFrame)return;
      const previous=applyingYearFrame;
      applyingYearFrame=true;
      // A display toggle must not leak old blue film into the next frame.
      cancelAnimationFrame(waterBlendHandle);
      previousWaterFrame=null;
      if(volumetricWater)volumetricWater.lastBuildAt=0;
      try{handleFrame(lastHydroFrame);}finally{applyingYearFrame=previous;}
    };
    const shallowToggle=siteHud('siteHudShowShallow');
    if(shallowToggle)shallowToggle.onchange=e=>{
      showShallowWater=Boolean(e.target.checked);
      updateSiteHydroDashboard();
      redrawDisplayOnly();
    };
    siteHud('siteHudYear').oninput=e=>{if(longTermMode)seekYear(e.target.value);else{futureYear=Number(e.target.value);syncFuture();}};
    siteHud('siteHudFooterYear').oninput=e=>{if(longTermMode)seekYear(e.target.value);else{futureYear=Number(e.target.value);syncFuture();}};
    siteHud('siteHudQueryEaZones').onclick=async()=>{
      const output=siteHud('siteHudEaFloodZoneStatus');
      const ring=polygon?.[0];
      if(!output||!ring?.length){if(output)output.textContent='场地边界不可用';return;}
      const pts=ring.map(p=>[Number(p[0]),Number(p[1])]);
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      const bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
      output.textContent='查询 Environment Agency 官方 Flood Zone 2、3…';
      try{
        const base='https://services1.arcgis.com/JZM7qJpmv7vJ0Hzx/ArcGIS/rest/services/Flood_Map_for_Planning/FeatureServer/';
        const geometry=encodeURIComponent(JSON.stringify({xmin:bbox[0],ymin:bbox[1],xmax:bbox[2],ymax:bbox[3],spatialReference:{wkid:4326}}));
        const query=n=>fetch(base+n+'/query?geometry='+geometry+
          '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json',
          {signal:controller.signal}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();});
        const results=await Promise.all([query(1),query(2)]);
        if(results.some(x=>x.error||!Number.isFinite(x.count)))
          throw Error(results.find(x=>x.error)?.error?.message||'EA 空间服务未返回有效数量');
        output.textContent='EA 官方洪水区查询完成：Zone 3 '+results[0].count+
          ' 个相交图斑；Zone 2 '+results[1].count+
          ' 个相交图斑（基于地块外包矩形，初步筛查，非精确地块交集或洪水深度）。'
          +'数据来源：EA Flood Map for Planning (Rivers and Sea)。此结果不提供动态边界水位。';
      }catch(e){
        output.textContent='EA 官方洪水区查询失败：'+(e?.message||String(e))+'。未生成虚构洪水数据。';
      }finally{clearTimeout(timer);}
    };
    siteHud('siteHudQueryEaStage').onclick=async()=>{
      const output=siteHud('siteHudEaStageStatus');
      const ring=polygon?.[0];
      if(!ring?.length){output.textContent='无法确定场地边界';return;}
      const pts=ring.slice(0,-1);
      const lng=pts.reduce((a,p)=>a+p[0],0)/pts.length;
      const lat=pts.reduce((a,p)=>a+p[1],0)/pts.length;
      output.textContent='正在查询 EA 官方附近水位站…';
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const query='https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=level&lat='+lat.toFixed(6)+'&long='+lng.toFixed(6)+'&dist=10&_view=full&_limit=30';
        const response=await fetch(query,{signal:controller.signal,headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        const stations=(Array.isArray(data.items)?data.items:[])
          .filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.long)))
          .sort((a,b)=>geodesicDistanceM([lng,lat],[+a.long,+a.lat])-geodesicDistanceM([lng,lat],[+b.long,+b.lat]));
        const station=stations[0];
        if(!station){output.textContent='场地周边10 km没有可用 EA 水位站；未生成外部洪水边界。';return;}
        const measures=Array.isArray(station.measures)?station.measures:(station.measures?[station.measures]:[]);
        const lvl=measures.filter(x=>x.parameter==='level'||x.parameterName==='Water Level');
        const measure=lvl.find(x=>String(x.unitName||'').includes('mAOD'))||lvl[0];
        const latest=measure?.latestReading;
        const distance=(geodesicDistanceM([lng,lat],[+station.long,+station.lat])/1000).toFixed(1);
        const parts=[String(station.label||station.stationReference||'附近水位站'),distance+' km'];
        if(Number.isFinite(Number(latest?.value))&&latest?.value!=null)
          parts.push('最近读数 '+latest.value+' '+(measure?.unitName||'单位未声明')+' · '+(latest.dateTime||'日期未知'));
        else parts.push('无可核实的最新读数');
        output.textContent=parts.join('；')+'。仅作官方观测参考，不自动设为模拟边界水位。';
      }catch(error){
        output.textContent='EA 站点查询失败：'+(error?.message||String(error))+'。未替换为估计水位。';
      }finally{clearTimeout(timeout);}
    };
    // v3.22.29: same DEM runoff model for every rainfall scenario; EA = validation only.
    siteHud('siteHudUseRiskGuide').onclick=()=>{
      if(enableEaRiskGuidance())syncFuture();
      else status('无法应用降雨分析模式。',true);
    };
    // Risk layers remain available for independent comparison; never force a map overlay.
    siteHud('siteHudShowEARisk').onclick=()=>{
      forceEaRiskOverlay=false;
      updateFocusAnalysisLayers();
      status('EA 风险及深度仅作结果校核；红黄风险图层保持隐藏，不影响蓝色积水。');
    };
        siteHud('siteHudFutureClimate').onchange=e=>{
      rainPreset=Object.prototype.hasOwnProperty.call(RAIN_PRESETS,e.target.value)?e.target.value:'moderate';
      rainfallMode='manual';manualFourHourMm=null;
      fehDurationDepthsMm=null; // different precipitation scenarios cannot reuse old FEH entries
      for(const m of [30,60,120,360])if(siteHud('siteHudDdf'+m))siteHud('siteHudDdf'+m).value='';
      setSiteHud('siteHudDdfSource','已切换降雨等级，旧 FEH 值已清除。当前为等总雨量敏感性测试。');
      copyHudControl('localFloodDuration',120,'input');
      syncSiteControls();
      syncFuture();
      if(prepared&&isolatedSelection&&longTermMode)requestYear(futureYear);
      status('已选择 '+RAIN_PRESETS[rainPreset].label+'：四历时按同一总量 '+
        RAIN_PRESETS[rainPreset].total+' mm 比较（非同一 FEH 重现期），2100 为设计包络峰值。');
    };
    siteHud('siteHudTrialStage').onclick=()=>{
      if(!needsExternalStage()){status('请先选择仅外部洪水或降雨＋外部洪水模式。');return;}
      if(!Number.isFinite(siteTerrainMinM)){
        status('尚未取得场地 DEM 最低高程，请等地形准备完成后再试。',true);return;
      }
      externalStageM=Math.round((siteTerrainMinM+1)*100)/100;
      siteHud('siteHudFutureStage').value=String(externalStageM);
      syncFuture();
      status('已设置设计试验外部边界水位 '+externalStageM.toFixed(2)+
        ' m（场地 DEM 最低高程 + 1.0 m）。这是人为假设，不是 EA 官方洪水水位，也不是2100年预测。');
    };
    siteHud('siteHudFutureStage').onchange=e=>{externalStageM=e.target.value.trim()===''?null:Number(e.target.value);resetFuture();syncFuture();};
    // v3.22.21: storm profile is fixed to the single-peak design event, no dropdown.
    siteHud('siteHudExternalInlet').onchange=e=>{externalInlet=e.target.value;resetFuture();};
    siteHud('siteHudRise').onchange=e=>{externalRiseMin=Math.max(1,Number(e.target.value)||30);resetFuture();};
    siteHud('siteHudFall').onchange=e=>{externalFallMin=Math.max(externalRiseMin+1,Number(e.target.value)||90);resetFuture();};
    for(const id of ['siteHudFutureStage','siteHudStageHint','siteHudTrialStage','siteHudQueryEaZones','siteHudQueryEaStage','siteHudUseRiskGuide','siteHudShowEARisk','siteHudExternalInlet','siteHudRise','siteHudFall','siteHudEaStageStatus','siteHudEaFloodZoneStatus']){
      const el=siteHud(id);if(el){const parent=el.closest('.site-hydro-row,.site-hydro-actions');(parent||el).style.display='none';}
    }
    // The source citation is next to the three presets; keep legacy EA gauge
    // and FEH controls mounted for compatibility but remove the extra
    // configuration section from this simplified scenario chooser.
    const legacyRainSection=siteHud('siteHudRainStation')?.closest('.site-hydro-section');
    if(legacyRainSection)legacyRainSection.style.display='none';
    // Keep older rain data controls mounted for legacy handlers, but offer
    // only the three official-reference event choices in the study UI.
    for(const id of ['siteHudManualRain','siteHudFeh','siteHudUseEA','siteHudUseFeh','siteHudUseManual']){
      const el=siteHud(id);if(el){const wrap=el.closest('.site-hydro-row,.site-hydro-actions');(wrap||el).style.display='none';}
    }
    if(siteHud('siteHudFutureClimate'))siteHud('siteHudFutureClimate').value=rainPreset;
    copyHudControl('localFloodDuration',120,'input');
    rainfallMode='manual';manualFourHourMm=null;
    forceEaRiskOverlay=false;
    syncFuture();

    const resetForNewRain=()=>{
      stopTensorSequence();hydroDisplay.flow=false;
      if(siteHud('siteHudShowFlow'))siteHud('siteHudShowFlow').checked=false;
      updateHydroLayerVisibility();
      stopAnnual();clearYearFrames();clearRiskEnvelope();
      if(simulator){simulator.pause();simulator.reset();}
      hydroState='reset';siteHydroHistory.length=0;lastHydroFrame=null;
      clearPreviousFloodVisuals();
      updateSiteHydroDashboard(null);
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
    ])siteHud(hudId).onchange=e=>{
      copyHudControl(actual,e.target.checked,'change');
      if(hudId==='siteHudEA'||hudId==='siteHudDrainage'){
        // Update directly and do not rely solely on the city-panel listener.
        updateFocusAnalysisLayers();
        syncFocusFloodWaterRendering();
        if(e.target.checked)setSiteHud(
          hudId==='siteHudEA'?'siteHudEAStatus':'siteHudDrainStatus',
          '已勾选，等待地图加载参考瓦片…');
      }
    };
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
      hydroDisplay={depth:true,flow:false,collision:true,volume:true};
      if(siteHud('siteHudShowShallow'))siteHud('siteHudShowShallow').checked=showShallowWater;
      for(const [id,flag] of [
        ['siteHudShowDepth','depth'],
        ['siteHudShowVolume','volume'],
        ['siteHudShowFlow','flow'],
        ['siteHudShowCollision','collision']
      ])siteHud(id).checked=hydroDisplay[flag];
      switchSpongeTool('navigate');
      resetRunAfterSpongeChange();
      updateHydroLayerVisibility();
    };
    for(const [id,flag] of [
      ['siteHudShowDepth','depth'],
      ['siteHudShowVolume','volume'],
      ['siteHudShowFlow','flow'],
      ['siteHudShowCollision','collision']
    ])siteHud(id).onchange=e=>{
      if(flag==='flow'){
        if(e.target.checked){
          if(startTensorSequence())hydroDisplay.flow=true;
          else{hydroDisplay.flow=false;e.target.checked=false;}
        }else{
          hydroDisplay.flow=false;stopTensorSequence({restoreRain:true});
        }
      }else hydroDisplay[flag]=e.target.checked;
      updateHydroLayerVisibility();
    };
    const tensorControls=[
      ['TerrainWeight','terrainWeight'],['DrainageWeight','drainageWeight'],
      ['Avoidance','avoidance'],['Smoothness','smoothness'],
      ['Density','density'],['Length','length'],['Glow','glow'],['Speed','speed']
    ];
    for(const [name,key] of tensorControls){
      const slider=siteHud('siteHudVector'+name);
      const output=siteHud('siteHudVector'+name+'Value');
      if(!slider)continue;
      const number=document.createElement('input');
      number.type='number';number.min=slider.min;number.max=slider.max;
      number.step=slider.step||'1';number.value=slider.value;
      number.setAttribute('aria-label',key+' 数值');
      number.style.cssText='width:58px;max-width:58px;padding:4px;background:#181a1d;color:#f5f5f7;border:1px solid #4a4a50;border-radius:5px;font-size:12px;margin-left:6px';
      if(output){output.style.display='none';output.insertAdjacentElement('afterend',number);}
      const update=value=>{
        const v=Math.max(Number(slider.min),Math.min(Number(slider.max),Number(value)));
        if(!Number.isFinite(v))return;
        slider.value=String(v);number.value=slider.value;
        if(output)output.textContent=slider.value;
        hydroVector?.configure({[key]:Number(slider.value)});
      };
      slider.oninput=()=>update(slider.value);
      number.oninput=()=>{if(number.value!==''&&Number.isFinite(Number(number.value)))update(number.value)};
      number.onchange=()=>update(number.value===''?slider.value:number.value);
    }
    siteHud('siteHudTensorReplay').onclick=()=>hydroVector?.replayGrowth();
    for(const button of container.querySelectorAll('[data-vector-mode]')){
      button.onclick=()=>{
        const mode=button.dataset.vectorMode;
        for(const item of container.querySelectorAll('[data-vector-mode]')){
          const active=item.dataset.vectorMode===mode;
          item.classList.toggle('active',active);
          item.setAttribute('aria-pressed',String(active));
        }
        hydroVector?.configure({mode});
      };
    }
    for(const button of container.querySelectorAll('[data-tensor-direction]')){
      button.onclick=()=>{
        const direction=button.dataset.tensorDirection;
        for(const item of container.querySelectorAll('[data-tensor-direction]')){
          const active=item.dataset.tensorDirection===direction;
          item.classList.toggle('active',active);
          item.setAttribute('aria-pressed',String(active));
        }
        hydroVector?.configure({direction});
      };
    }
    const showTensorBuildings=siteHud('siteHudTensorBuildings');
    siteHud('siteHudTensorExport').onclick=()=>{
      const snapshot=window.getLondonHydroTensorSiteSnapshot?.();
      const hint=siteHud('siteHudTensorExportStatus');
      if(!snapshot){hint.textContent='请先启用张量场，等待方向场计算完成后导出。';return}
      const blob=new Blob([JSON.stringify(snapshot)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='LondonMap_Tensor_Site_'+snapshot.current.scenario.year+'.json';
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      const years=snapshot.scenarios.map(s=>s.scenario.year);
      hint.textContent='已导出当前场地，已计算年份：'+(years.join('、')||snapshot.current.scenario.year)+
        '。'+([2026,2100].every(y=>years.includes(y))?'':'请分别停留在2026和2100并等待计算，再导出以包含两种情景。')+
        (snapshot.pending.tensor||snapshot.pending.geometry?' 当前仍在计算，包内已标注待完成状态。':'');
    };
    if(showTensorBuildings){
      showTensorBuildings.checked=tensorShowBuildings;
      showTensorBuildings.onchange=e=>{
        tensorShowBuildings=Boolean(e.target.checked);
        setFocusPitchMode();
        syncFocusFootprintVisibility();
      };
    }
    siteHud('siteHudRun').onclick=()=>{
      if(!prepared)return;
      // Starting new rainfall never mixes with an active tensor animation.
      if(hydroDisplay.flow){
        hydroDisplay.flow=false;stopTensorSequence();
        if(siteHud('siteHudShowFlow'))siteHud('siteHudShowFlow').checked=false;
        updateHydroLayerVisibility();
      }
      if(longTermMode){
        if(!resolveFloodModeForPlayback())return;
        stopAnnual();annualPlaying=true;
        if(displayMode==='event'){
          eventTimeMin=0;
          const slider=siteHud('siteHudEventTime');
          if(slider)slider.value='0';
          setSiteHud('siteHudEventTimeText','0 / '+criticalDurationMin+' min');
          if(requestYear(futureYear))
            status('正在计算四种历时，随后仅回放临界单场暴雨的真实涨水与退水过程。');
        }else{
          futureYear=2026;
          clearRiskEnvelope();clearYearFrames();simYearDisplay();
          if(requestYear(2026))
            status('正在计算四种历时的最大水深设计包络，逐步展示到2100年峰值。');
        }
        return;
      }
      if(!resolveFloodModeForPlayback())return;
      if(futureYear>=2100){futureYear=2026;clearRiskEnvelope();}
      if(!annualPlaying&&futureYear===2026)clearRiskEnvelope();
      annualPlaying=true;
      simulator?.reset(true);
      ensureSimulator().start({...currentParams(),annualPreview:true});
      updateSiteHydroDashboard();
    };
    siteHud('siteHudPause').onclick=()=>{
      if(hydroDisplay.flow){
        hydroDisplay.flow=false;stopTensorSequence({restoreRain:true});
        if(siteHud('siteHudShowFlow'))siteHud('siteHudShowFlow').checked=false;
        updateHydroLayerVisibility();
      }
      stopAnnual();simulator?.pause();updateSiteHydroDashboard();
    };
    siteHud('siteHudReset').onclick=()=>{
      if(hydroDisplay.flow){
        hydroDisplay.flow=false;stopTensorSequence();
        if(siteHud('siteHudShowFlow'))siteHud('siteHudShowFlow').checked=false;
        updateHydroLayerVisibility();
      }
      // Reset the actual scenario, not just the position of the year slider.
      stopAnnual();
      clearRiskEnvelope();clearYearFrames();
      annualBudget=null;pendingBaselineFrame=false;
      futureYear=2026;eventTimeMin=0;hydroState='reset';
      if(siteHud('siteHudEventTime'))siteHud('siteHudEventTime').value='0';
      setSiteHud('siteHudEventTimeText','0 / '+criticalDurationMin+' min');
      lastHydroFrame=null;siteHydroHistory.length=0;
      lastFlowUpdateAt=0;
      awaitingInitialReset=Boolean(simulator&&prepared);
      cancelAnimationFrame(waterBlendHandle);
      previousWaterFrame=null;waterBlendStart=0;
      canvasContext?.clearRect(0,0,canvas?.width||0,canvas?.height||0);
      lowResWaterContext?.clearRect(0,0,lowResWater?.width||0,lowResWater?.height||0);
      if(volumetricWater){
        volumetricWater.animate=false;
        volumetricWater.displayDepth=null;
        volumetricWater.mesh=null;
        volumetricWater.count=0;
        volumetricWater.dirty=true;
      }
      hydroVector?.clear();
      // Restore orange buildings (including the base outlines) and cancel
      // the red flooded-building state from the previous prediction.
      hideSelectedBuildings=false;
      if(siteHud('siteHudShowBuildings'))siteHud('siteHudShowBuildings').checked=true;
      const mapBuildingToggle=$('localFloodHideSelectedBuildings');
      if(mapBuildingToggle)mapBuildingToggle.checked=false;
      for(const scene of sceneFeatures.values()){
        if(scene?.properties?.selected)scene.properties.impacted=false;
      }
      publishBuildingScene();
      updateFocusBuildings();
      simYearDisplay();
      updateSiteHydroDashboard(null);
      map.triggerRepaint();
      isolateViewer?.triggerRepaint();
      if(simulator&&prepared)simulator.resetInitial();
      status('已恢复 2026 年初始场地：积水、风险建筑和回放记录均已清零。');
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
      'background:#000000;overflow:hidden;pointer-events:auto;';
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
    hydroVector=createHydroTensorRenderer({
      map:viewer,sourceId:FOCUS_FLOW_SOURCE,
      particleSourceId:FOCUS_FLOW_PARTICLES,
      glowLayerId:FOCUS_FLOW_GLOW,lineLayerId:FOCUS_FLOW_LAYER,
      ribbonSourceId:FOCUS_TENSOR_RIBBON_SOURCE,
      ribbonLayerId:FOCUS_TENSOR_RIBBON_LAYER,
      ribbonGlowLayerId:FOCUS_TENSOR_RIBBON_GLOW,
      particleLayerId:FOCUS_FLOW_PARTICLE_LAYER,
      getBounds:()=>focusWaterBounds,
      onStatus:message=>setSiteHud('siteHudVectorStatus',message),
      onGeometryReady:({year,token,rainfallCase,lineCount})=>{
        const session=tensorSession;
        if(!session||!hydroDisplay.flow||session.completed||
          year!==session.awaitingYear||token!==session.awaitingToken||
          rainfallCase!==session.rainfallCase)return;
        if(tensorStageTimer){clearTimeout(tensorStageTimer);tensorStageTimer=0}
        setSiteHud('siteHudTensorGrowthStatus',year+' 年完整流线 '+lineCount+
          ' 条 · '+(session.index+1)+'/'+TENSOR_YEARS.length);
        tensorStageTimer=setTimeout(()=>{
          tensorStageTimer=0;
          if(tensorSession===session&&hydroDisplay.flow)
            advanceTensorStage(session,session.index+1);
        },260);
      },
      onProgress:({year,fraction,geometryYear,waitingForGeometry})=>{
        const exact=geometryYear===year&&!waitingForGeometry;
        setSiteHud('siteHudTensorGrowthStatus','线条生长 '+Math.round(fraction*100)+
          '% · '+year+' 年'+(exact?' · 年份数据匹配':
            ' · 显示预览，真实方向重算中'));
      }
    });
    hydroVector.setTimelineYear(futureYear,{instant:true});
    // Typed native-grid design tensor contract for future Wool and roads.
    window.getLondonHydroTensorFieldData=()=>hydroVector?.exportStructuredData()||null;
    window.getLondonHydroTensorDiagnostics=(stride=4)=>hydroVector?.exportDiagnostics(stride)||null;
    window.getLondonHydroTensorGeometryData=()=>hydroVector?.exportGeometry()||null;
    window.getLondonHydroTensorSiteSnapshot=()=>{
      const snapshot=hydroVector?.exportSiteSnapshot();if(!snapshot)return null;
      return {...snapshot,selection:{type:'Polygon',coordinates:structuredClone(polygon)},
        buildings:{type:'FeatureCollection',features:structuredClone([...sceneFeatures.values()])},
        floodSettings:{futureYear,displayMode,floodMode,climateScenario,rainPreset,
          externalStageM,stormProfile,criticalDurationMin,rainfallMode,manualFourHourMm},
        display:{...hydroDisplay,tensorShowBuildings},
        visualAcceptance:{status:'pending',reason:'This export captures source arrays and camera; it does not certify screenshots or whole-site visual acceptance.'}};
    };
    window.getLondonHydroVectorFieldData=window.getLondonHydroTensorFieldData;
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
      installFocusFloodVolume(viewer);
      setFocusPitchMode();
      updateFocusAnalysisLayers();
      // Controls can be toggled before the map style finishes loading.
      // Rehydrate the vector layers once their GeoJSON sources are ready.
      if(hydroDisplay.flow&&tensorSession)hydroVector?.setEnabled(true);
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
        pitch:hydroDisplay.flow?0:42,bearing:isolateCamera?.bearing||0,duration:550
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
    // Clean initial comparison state, even when returning from an earlier flood.
    // These checkboxes ONLY control reference overlays in the isolated map.
    if($('localFloodFocusEA'))$('localFloodFocusEA').checked=false;
    if($('localFloodFocusDrainage'))$('localFloodFocusDrainage').checked=false;
    canvasContext?.clearRect(0,0,canvas?.width||0,canvas?.height||0);
    let impactedReset=false;
    for(const feature of sceneFeatures.values()){
      if(feature?.properties?.selected&&feature.properties.impacted){
        feature.properties.impacted=false;
        impactedReset=true;
      }
    }
    if(impactedReset)publishBuildingScene();
    simulator?.reset();
    rainfallMode='manual';manualFourHourMm=null;
    lastHydroFrame=null;siteHydroHistory.length=0;hydroState='ready';siteRainData=null;
    focusSiteSerial++;
    try{
      createFocusViewer();
      // v3.22.23: suppress unrelated river/sea gauge queries in the fixed
      // rainfall + EA surface-water guidance scenario. No boundary water stage required.
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
    stopAnnual();simulator?.pause();
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
    const parcelDisabled=!polygon?.[0]||polygon[0].length<4||
      drawing||isPreparingSelection||dragVertexIndex>=0;
    for(const id of ['parcelGeneratorOpen','parcelGeneratorLaunch']){
      const button=$(id);
      if(button)button.disabled=parcelDisabled;
    }
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
    cancelAnimationFrame(waterBlendHandle);previousWaterFrame=null;
    if(map.getLayer(WATER_LAYER))map.removeLayer(WATER_LAYER);
    if(map.getSource(WATER_SOURCE))map.removeSource(WATER_SOURCE);
    focusWaterBounds=null;
    if(canvas){canvas.remove();canvas=null;canvasContext=null;}
    lowResWater=null;lowResWaterContext=null;waterUpscale=1;
  }

  function clearSimulation(keepSelection=false){
    stopAnnual();clearRiskEnvelope();
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
      riskMetaUrl:new URL(assetUrl('assets/flood_risk/surface_water_metadata.json'),location.href).href,
      riskTileUrls:[
        new URL(assetUrl('assets/flood_risk/surface_water_0-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/surface_water_0-1.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/surface_water_1-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/surface_water_1-1.webp'),location.href).href
      ],
      depthMetaUrl:new URL(assetUrl('assets/flood_risk/ea_depth_cc_0p1_metadata.json'),location.href).href,
      depthTileUrls:[
        new URL(assetUrl('assets/flood_risk/ea_depth_cc_0p1_0-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/ea_depth_cc_0p1_0-1.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/ea_depth_cc_0p1_1-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/ea_depth_cc_0p1_1-1.webp'),location.href).href
      ],
      onFrame:handleFrame,
      onFlowField:data=>{
        // Undated reply supplies only native DEM and accumulation.
        // The per-year water depth is taken from the verified frame below.
        if(!hydroDisplay.flow||!tensorSession||!data?.spatialContext)return;
        const session=tensorSession;
        if(!sameHydroGrid(data.grid,session.grid))return;
        tensorContext=data.spatialContext;
        if(session.index<0){
          if(tensorStageTimer){clearTimeout(tensorStageTimer);tensorStageTimer=0}
          advanceTensorStage(session,0);
        }
      },
      onStatus:data=>{
        hydroState=data.state;
        if(data.state==='preparing'){
          status(data.message||'正在计算 2100 年终态淹没范围…');
          updateSiteHydroDashboard();
          return;
        }
        if(volumetricWater){
          volumetricWater.animate=data.state==='running';
          if(data.state==='running')isolateViewer?.triggerRepaint();
        }
        updateSiteHydroDashboard();
        if(data.state==='running')status('模拟运行中：雨水按地形和水头传播，建筑底面可淹没，不形成隐形阻水区。');
        else if(data.state==='paused')status('模拟已暂停。');
        else if(data.state==='complete'){
          if(annualPlaying&&isolatedSelection&&futureYear<2100){
            annualAdvanceTimer=setTimeout(()=>{
              if(!annualPlaying||!isolatedSelection)return;
              futureYear++;
              simYearDisplay();
              simulator?.reset(true);
              simulator?.start({...currentParams(),annualPreview:true});
            },100);
          }else{
            if(annualPlaying)stopAnnual();
            status('当前预测年份的洪水事件计算完成。');
          }
        }
      },
      onError:error=>status(error.message,true)
    });
    return simulator;
  }

  function ensureWaterLayer(info){
    removeWaterLayers();
    canvas=document.createElement('canvas');
    canvas.id='localFloodCanvas';
    // Higher visual sampling only for small selected parcels; the native
    // 10-50m physical cells, DEM and flood statistics are NEVER resampled.
    const cells=Math.max(1,info.cols*info.rows);
    const preferred=cells<=6000?12:cells<=16000?9:6;
    const targetSide=Math.floor(2400/Math.max(1,info.cols,info.rows));
    const pixelBudget=Math.floor(Math.sqrt(4200000/cells));
    waterUpscale=Math.max(1,Math.min(preferred,targetSide,pixelBudget));
    canvas.width=info.cols*waterUpscale;
    canvas.height=info.rows*waterUpscale;
    lowResWater=document.createElement('canvas');
    lowResWater.width=info.cols;lowResWater.height=info.rows;
    lowResWaterContext=lowResWater.getContext('2d');
    focusWaterBounds=info.boundsLngLat;
    canvas.style.cssText='position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none';
    document.body.appendChild(canvas);
    canvasContext=canvas.getContext('2d');
    canvasContext.imageSmoothingEnabled=true;
    canvasContext.imageSmoothingQuality='high';

    map.addSource(WATER_SOURCE,{
      type:'canvas',
      canvas:canvas.id,
      animate:true,
      coordinates:info.boundsLngLat
    });
    map.addLayer({
      id:WATER_LAYER,type:'raster',source:WATER_SOURCE,
      paint:{'raster-opacity':1,'raster-resampling':'linear','raster-fade-duration':0}
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
    siteRiskAvailable=false;siteRiskMappedCount=0;
    forceEaRiskOverlay=false;
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
      hydroDisplay={depth:true,flow:false,collision:true,volume:true};
      ensureSimulator().setParams(currentParams());
      const info=await ensureSimulator().setup({polygon,buildings});
      siteTerrainMinM=Number.isFinite(Number(info.terrainMinM))&&info.terrainMinM!==null?Number(info.terrainMinM):null;
      siteRiskMappedCount=Number(info.riskMappedCells)||0;
      setSiteHud('siteHudOfficialStatus',info.eaDepthAvailable?
        'EA 2070s Upper End 0.1% AEP 官方水深已配准（'+
          (info.eaDepthMappedCells||0)+' 格）。三档降雨使用同一水流规则；官方范围独立校核，绝不吸引水流。'
        :(info.eaDepthInfo||'EA 官方深度参考不可用；仍可按 DEM 计算，但不能进行官方水深校核。'));
      floodMode='rain-risk';
      forceEaRiskOverlay=false;
      siteRiskAvailable=Boolean(info.riskAvailable&&siteRiskMappedCount>0);
      if(siteHud('siteHudUseRiskGuide'))
        siteHud('siteHudUseRiskGuide').disabled=false;
      if(siteHud('siteHudShowEARisk')){
        siteHud('siteHudShowEARisk').disabled=!siteRiskAvailable;
        siteHud('siteHudShowEARisk').textContent='显示 EA 官方风险图';
      }
      if(siteHud('siteHudRiskFusionNote'))
        setSiteHud('siteHudRiskFusionNote',siteRiskAvailable
          ?'EA 现状 RoFSW 风险等级已配准（'+siteRiskMappedCount+' 格）；仅用于和 DEM 降雨结果独立对比，非水深或流动权重。'
          :'EA 现状风险等级缺失；蓝色洪水仍使用统一 DEM/建筑/汇水规则计算，EA 校核项标记为不可用。');
      prepared=true;
      ensureWaterLayer(info);
      publishBuildingScene();
      $('localFloodGridInfo').textContent=
        info.cellSizeM+' m 网格 · '+info.buildingCount+' 栋建筑 · '+
        (info.drainageAvailable?'汇水路径数据就绪':'地形独立计算（汇水数据不可用）')+
        ' · '+(siteRiskAvailable?'EA 地表水 '+siteRiskMappedCount+' 格可用':'EA 地表水等级不可用');
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



  // FlowField direction / relative intensity is calculated in the existing
  // worker from DEM hydraulic head and building obstructions. This adapter
  // never adjusts rainfall, solver physics or simulated volume.
  let lastDisplayedVectorYear=null;
  function updateFocusFlowVectors(data){
    if(!hydroDisplay.flow||!hydroVector||!tensorSession||!data?.flowField)return;
    const now=performance.now();
    const year=Number.isInteger(data.scenarioYear)?data.scenarioYear:futureYear;
    const yearChanged=year!==lastDisplayedVectorYear;
    if(now-lastFlowUpdateAt<430&&!yearChanged&&!data.spatialContext&&
      !data.forceVectorRefresh)return;
    lastFlowUpdateAt=now;
    lastDisplayedVectorYear=year;
    setSiteHud('siteHudTensorYear',String(year));
    hydroVector.setField(data.flowField,tensorContext,{
      year,kind:data.annualAreaStage?.kind||'rainfall-simulation',
      rainPreset:data.annualAreaStage?.rainfallCase||null,
      depthMm:data.depthMm||null,grid:data.grid,token:data.scenarioToken,
      drainageThresholdKm2:Number($('networkThreshold')?.value)||0,
      force:data.forceVectorRefresh===true
    });
  }

  function handleFrame(data){
    if(awaitingInitialReset){
      if(data?.annualAreaStage?.resetInitial!==true)return;
      awaitingInitialReset=false;
    }
    if(!canvas||!canvasContext)return;
    if(data?.annualAreaStage?.resetInitial){
      cancelAnimationFrame(waterBlendHandle);
      previousWaterFrame=null;
      canvasContext.clearRect(0,0,canvas.width,canvas.height);
      lowResWaterContext?.clearRect(0,0,lowResWater?.width||0,lowResWater?.height||0);
      if(volumetricWater){volumetricWater.displayDepth=null;volumetricWater.count=0;volumetricWater.dirty=true;}
    }
    if(longTermMode&&!applyingYearFrame){
      if(['rainfall-risk-scenario','storm-event'].includes(data?.annualAreaStage?.kind)&&
         Number.isInteger(data.scenarioYear)){
        // Both date and request token must match. A prior rainfall scenario
        // can finish with the SAME year after the user selects a new preset.
        if(data.scenarioYear!==futureYear||
           data.scenarioToken!==lastRequestedScenarioToken||
           (data.annualAreaStage.rainfallCase&&
             data.annualAreaStage.rainfallCase!==rainPreset))return;
        if(data.annualAreaStage.kind==='rainfall-risk-scenario')
          yearFrames.set(data.scenarioYear,data);
      }else{
        // Annual interpolation must NEVER render an unrelated event/setup/
        // paused-state worker frame (previously this leaked a full flood
        // event into 2034 while the slider showed an early year).
        return;
      }
    }
    // In the 2026–2100 baseline playback, show the maximum inundation
    // envelope observed up to the selected year. Never clear risk patches
    // when a new representative storm starts. This is a design-risk envelope,
    // NOT 74 years of continuously retained physical floodwater.
    if(annualPlaying&&!longTermMode&&data.depthMm){
      const current=new Uint16Array(data.depthMm);
      const rgba=new Uint8ClampedArray(data.pixels);
      const contact=data.contactMask?new Uint8Array(data.contactMask):null;
      if(!riskEnvelope||riskEnvelope.depth.length!==current.length){
        riskEnvelope={depth:new Uint16Array(current.length),
          rgba:new Uint8ClampedArray(rgba.length),
          contacts:new Uint8Array(current.length),
          impacted:new Set(),maxDepthM:0,wetAreaM2:0,volumeM3:0};
      }
      const env=riskEnvelope;
      for(let i=0;i<current.length;i++){
        if(current[i]>env.depth[i]){
          env.depth[i]=current[i];
          env.rgba.set(rgba.subarray(i*4,i*4+4),i*4);
        }
        if(contact?.[i])env.contacts[i]=1;
      }
      for(const id of data.impactedIds||[])env.impacted.add(id);
      env.maxDepthM=Math.max(env.maxDepthM,data.stats?.maxDepthM||0);
      env.wetAreaM2=Math.max(env.wetAreaM2,data.stats?.wetAreaM2||0);
      env.volumeM3=Math.max(env.volumeM3,data.stats?.volumeM3||0);
      data={...data,pixels:env.rgba.buffer,depthMm:env.depth.buffer,
        contactMask:env.contacts.buffer,impactedIds:[...env.impacted],
        stats:{...data.stats,maxDepthM:env.maxDepthM,
          wetAreaM2:env.wetAreaM2,volumeM3:env.volumeM3,
          impactedCount:env.impacted.size}};
    }
    const pixels=new Uint8ClampedArray(data.pixels);
    if(isolatedSelection&&volumetricWater?.ready&&data.depthMm){
      volumetricWater.showShallow=showShallowWater;
      volumetricWater.showContrast=false;
      volumetricWater.updateFrame(data,applyingYearFrame);
    }
    if(!lowResWater||!lowResWaterContext)return;
    if(lowResWater.width!==data.width||lowResWater.height!==data.height){
      lowResWater.width=data.width;lowResWater.height=data.height;
    }
    const outWidth=data.width*waterUpscale,outHeight=data.height*waterUpscale;
    if(canvas.width!==outWidth||canvas.height!==outHeight){
      canvas.width=outWidth;canvas.height=outHeight;
    }
    // Supersample a softly thresholded colour field. The DEM grid remains
    // authoritative; smoothing here is rendering-only, not added precision.
    const nextFrame=document.createElement('canvas');
    nextFrame.width=outWidth;nextFrame.height=outHeight;
    const nc=nextFrame.getContext('2d');
    if(!data.depthMm||!renderSoftWaterCanvas(nc,data,outWidth,outHeight,{showShallow:showShallowWater,showContrast:false,scenario:rainPreset})){
      lowResWaterContext.putImageData(new ImageData(pixels,data.width,data.height),0,0);
      nc.imageSmoothingEnabled=true;nc.imageSmoothingQuality='high';
      nc.drawImage(lowResWater,0,0,outWidth,outHeight);
    }
    if(canvas.width!==outWidth||canvas.height!==outHeight)previousWaterFrame=null;
    if(!previousWaterFrame){
      previousWaterFrame=document.createElement('canvas');
      previousWaterFrame.width=outWidth;previousWaterFrame.height=outHeight;
      previousWaterFrame.getContext('2d').drawImage(canvas,0,0);
    }
    cancelAnimationFrame(waterBlendHandle);
    const oldFrame=document.createElement('canvas');
    oldFrame.width=outWidth;oldFrame.height=outHeight;
    oldFrame.getContext('2d').drawImage(canvas,0,0);
    const paintBlend=()=>{
      if(!canvasContext||!canvas)return;
      const alpha=Math.min(1,(performance.now()-waterBlendStart)/
        (['rainfall-risk-scenario','storm-event'].includes(data.annualAreaStage?.kind)?125:WATER_BLEND_MS));
      canvasContext.clearRect(0,0,outWidth,outHeight);
      const blend=alpha*alpha*(3-2*alpha);
      canvasContext.globalAlpha=1-blend;
      canvasContext.drawImage(oldFrame,0,0);
      canvasContext.globalAlpha=blend;
      canvasContext.drawImage(nextFrame,0,0);
      canvasContext.globalAlpha=1;
      map.triggerRepaint();isolateViewer?.triggerRepaint();
      if(alpha<1)waterBlendHandle=requestAnimationFrame(paintBlend);
    };
    waterBlendStart=performance.now();
    paintBlend();
    map.triggerRepaint();
    // The independent 3D viewer shares this very same simulation canvas.
    // Water is painted before buildings so roofs/facades stay unobscured.
    isolateViewer?.triggerRepaint();
    // Only an accepted matching year/case/token can update tensor input.
    if(hydroDisplay.flow&&tensorSession&&tensorContext&&
      data.scenarioYear===tensorSession.awaitingYear&&
      data.scenarioToken===tensorSession.awaitingToken&&
      data.annualAreaStage?.rainfallCase===tensorSession.rainfallCase)
      updateFocusFlowVectors({...data,forceVectorRefresh:true});

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
    if(!applyingYearFrame&&(!siteHydroHistory.length||s.timeMin-siteHydroHistory[siteHydroHistory.length-1][0]>=2)){
      siteHydroHistory.push([s.timeMin,s.maxDepthM]);
      if(siteHydroHistory.length>32)siteHydroHistory.shift();
    }
    updateSiteHydroDashboard(data);
    if(longTermMode&&annualPlaying&&!applyingYearFrame&&
       data.scenarioYear===futureYear){
      if(displayMode==='year'&&data.annualAreaStage?.kind==='rainfall-risk-scenario'){
        clearTimeout(annualAdvanceTimer);
        if(futureYear<2100){
          annualAdvanceTimer=setTimeout(()=>{
            if(!annualPlaying||!isolatedSelection||displayMode!=='year')return;
            futureYear++;
            simYearDisplay();
            requestYear(futureYear);
          },165);
        }else{
          stopAnnual();
          status('2100 年最大设计包络展示完成 · 该范围为多个独立暴雨事件的并集，不是单场水面。');
        }
      }else if(displayMode==='event'&&data.annualAreaStage?.kind==='storm-event'){
        clearTimeout(annualAdvanceTimer);
        if(eventTimeMin<criticalDurationMin){
          annualAdvanceTimer=setTimeout(()=>{
            if(!annualPlaying||!isolatedSelection||displayMode!=='event')return;
            eventTimeMin=Math.min(criticalDurationMin,
              eventTimeMin+Math.max(1,Math.ceil(criticalDurationMin/90)));
            const t=siteHud('siteHudEventTime');
            if(t)t.value=String(eventTimeMin);
            setSiteHud('siteHudEventTimeText',Math.round(eventTimeMin)+' / '+criticalDurationMin+' min');
            requestYear(futureYear);
          },145);
        }else{
          stopAnnual();
          status('单场临界暴雨分钟级模拟回放完成；拖动滑块可以检查峰值和退水。');
        }
      }
    }
    $('localFloodStats').textContent=
      't '+s.timeMin.toFixed(1)+' min · 最大水深 '+s.maxDepthM.toFixed(2)+' m · '+
      '积水 '+(s.wetAreaM2/10000).toFixed(2)+' ha · 影响建筑 '+s.impactedCount;
  }

  function currentParams(){
    return {
      rainfall:floodMode==='external'?0:presetRainRate(),
      floodMode,externalStageM,climateYear:futureYear,
      stormProfile,externalInlet,externalRiseMin,externalFallMin,
      interventions:siteFacilities.map(({id,type,lng,lat,radiusM})=>
        ({id,type,lng,lat,radiusM})),
      showFlow:hydroDisplay.flow,
      rainSeriesMm15:floodMode==='external'?null:rainfallMode==='ea-observed'&&siteRainData?.complete&&siteRainData?.recent
        ?siteRainData.series15.map(v=>v*climateRainFactor())
        :rainfallMode==='feh-manual'&&Number.isFinite(manualFourHourMm)
          ?Array(16).fill(manualFourHourMm/16*climateRainFactor()):null,
      infiltration:Number($('localFloodInfil').value),
      duration:120,
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

  const launchParcelGenerator=()=>{
    if(!polygon?.[0]||polygon[0].length<4||drawing||isPreparingSelection)return;
    try{
      const exactSite=polygon.map(r=>closeRing(r).map(([lng,lat])=>[lng,lat]));
      onOpenParcelGenerator?.({polygon:exactSite});
    }catch(error){
      status('Parcel Generator 初始化失败：'+(error?.message||error),true);
    }
  };
  for(const id of ['parcelGeneratorOpen','parcelGeneratorLaunch']){
    $(id)?.addEventListener('click',launchParcelGenerator);
  }
  $('localFloodDraw').addEventListener('click',startDrawing);
  $('localFloodFinish').addEventListener('click',()=>finishAndConfirmSelection());
  $('localFloodClear').addEventListener('click',()=>{
    clearSimulation(false);
    status('已清除局部洪涝模拟。');
  });
  $('localFloodRun').addEventListener('click',()=>{
    if(!prepared)return;
    if(!resolveFloodModeForPlayback())return;
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
  // EA and DEM reference checkboxes are PRESENTATION ONLY. Never dispatch
  // extra flood simulation frames or mutate its parameters on checkbox clicks.
  for(const id of ['localFloodFocusEA','localFloodFocusDrainage']){
    $(id)?.addEventListener('change',()=>scheduleFocusContextRefresh());
  }
  // Only the hydrological threshold is a physical solver input.
  for(const id of ['networkThreshold','networkThresholdInput']){
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
