import {createLocalFloodSimulator} from './local_flood_sim.js?v=3.22.10';
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
// exclusively from the flood solver's obstacle-masked depth field, never from
// arbitrary random flood shapes. Building collisions stay in the solver.
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
          'uniform mat4 u_matrix;',
          'uniform float u_time;',
          'uniform float u_metres;',
          'out vec4 v_meta;',
          'out float v_contact;',
          'void main(){',
          'vec3 p=a_pos;',
          'float depth=max(0.0,a_meta.z);',
          'float shimmer=sin(a_meta.x*0.85+a_meta.y*0.42-u_time*2.3)*0.5+',
          '  sin(a_meta.x*0.31-a_meta.y*1.15+u_time*1.7)*0.5;',
          'float amplitude=min(0.075,depth*0.07+0.007);',
          'if(a_meta.w<0.5)p.z+=shimmer*amplitude*u_metres;',
          'gl_Position=u_matrix*vec4(p,1.0);',
          'v_meta=a_meta;',
          'v_contact=a_contact;',
          '}'
        ].join('\n');
        const fragment=[
          '#version 300 es',
          'precision highp float;',
          'in vec4 v_meta;',
          'in float v_contact;',
          'uniform float u_time;',
          'out vec4 fragColor;',
          'void main(){',
          'float depth=max(v_meta.z,0.0);',
          'vec3 water=vec3(0.745,0.925,1.000);',
          'water=mix(water,vec3(0.498,0.812,1.000),smoothstep(0.005,0.05,depth));',
          'water=mix(water,vec3(0.267,0.635,0.976),smoothstep(0.05,0.15,depth));',
          'water=mix(water,vec3(0.169,0.427,0.914),smoothstep(0.15,0.30,depth));',
          'water=mix(water,vec3(0.176,0.275,0.773),smoothstep(0.30,0.60,depth));',
          'water=mix(water,vec3(0.153,0.176,0.553),smoothstep(0.60,1.20,depth));',
          'float deep=smoothstep(0.05,1.20,depth);',
          'float w1=sin(v_meta.x*2.65+v_meta.y*0.86-u_time*2.8);',
          'float w2=sin(v_meta.x*1.21-v_meta.y*1.72+u_time*2.1);',
          'float w3=sin((v_meta.x+v_meta.y)*0.71-u_time*1.35);',
          'float glint=pow(max(0.0,0.45+0.20*w1+0.14*w2+0.10*w3),5.0);',
          'water=mix(water,vec3(0.88,0.98,1.0),glint*0.20);',
          'float collisionFoam=clamp(v_contact*(0.22+0.12*(0.5+0.5*w1)),0.0,0.30);',
          'water=mix(water,vec3(0.87,0.97,0.98),collisionFoam);',
          'float alpha=mix(0.57,0.95,deep);',
          'if(v_meta.w>0.5){water*=0.80;alpha=min(0.94,alpha+0.05);}',
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
        this.buffer=gl.createBuffer();
        this.vao=gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        const stride=8*4;
        const coords=gl.getAttribLocation(program,'a_pos');
        const meta=gl.getAttribLocation(program,'a_meta');
        const contact=gl.getAttribLocation(program,'a_contact');
        gl.enableVertexAttribArray(coords);
        gl.vertexAttribPointer(coords,3,gl.FLOAT,false,stride,0);
        gl.enableVertexAttribArray(meta);
        gl.vertexAttribPointer(meta,4,gl.FLOAT,false,stride,3*4);
        gl.enableVertexAttribArray(contact);
        gl.vertexAttribPointer(contact,1,gl.FLOAT,false,stride,7*4);
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
      const stride=Math.max(1,Math.ceil(Math.sqrt(widths*rows/18000)));
      const meshCols=Math.ceil(widths/stride),meshRows=Math.ceil(rows/stride);
      const sampled=new Float32Array(meshCols*meshRows);
      const foam=new Float32Array(meshCols*meshRows);
      for(let rr=0;rr<meshRows;rr++){
        for(let cc=0;cc<meshCols;cc++){
          let peak=0,sum=0,amount=0,hit=0;
          for(let y=rr*stride;y<Math.min(rows,(rr+1)*stride);y++){
            for(let x=cc*stride;x<Math.min(widths,(cc+1)*stride);x++){
              const i=y*widths+x,d=depths[i]/1000;
              peak=Math.max(peak,d);
              sum+=d;amount++;
              if(contacts?.[i])hit++;
            }
          }
          const id=rr*meshCols+cc;
          // No averaging at native resolution. At larger study sites, carry
          // some channel peaks through the performance downsampling step.
          sampled[id]=stride===1?peak:Math.max(sum/Math.max(1,amount),peak*0.72);
          foam[id]=Math.min(1,hit/Math.max(1,amount)*1.1);
        }
      }
      // Temporal low-pass on displayed depth avoids hard mesh jumps between
      // yearly scenarios; calculation values and statistics remain unchanged.
      if(force||data.annualAreaStage?.kind==='rainfall-risk-scenario'||
         !this.displayDepth||this.displayDepth.length!==sampled.length)
        this.displayDepth=sampled.slice();
      else for(let i=0;i<sampled.length;i++){
        this.displayDepth[i]+=Math.max(-0.06,Math.min(0.06,(sampled[i]-this.displayDepth[i])*.28));
      }
      sampled.set(this.displayDepth);
      const cutoff=0.008;
      const metre=this.metreScale;
      const quads=[];
      const visualHeight=depth=>Math.max(0.025,Math.min(4,depth*2))*metre;
      const makeVertex=(point,side,zOverride)=>{
        const z=zOverride===undefined?visualHeight(point.d):zOverride;
        quads.push(point.x,point.y,z,point.u,point.v,point.d,side,point.foam);
      };
      const triangle=(a,b,c,side=0)=>{
        makeVertex(a,side);makeVertex(b,side);makeVertex(c,side);
      };
      const physicalNode=(col,row)=>{
        const valid=col>=0&&row>=0&&col<meshCols&&row<meshRows;
        const idx=row*meshCols+col;
        const u=Math.max(0,Math.min(widths,(col+.5)*stride));
        const v=Math.max(0,Math.min(rows,(row+.5)*stride));
        return {
          x:nw.x+u*dx,y:nw.y+v*dy,u,v,
          d:valid?sampled[idx]:0,
          foam:valid?foam[idx]*.45:0,
          contour:false
        };
      };
      const interpolate=(a,b)=>{
        const t=Math.max(0,Math.min(1,(cutoff-a.d)/(b.d-a.d||1)));
        return {
          x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
          u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t,
          d:cutoff,foam:a.foam+(b.foam-a.foam)*t,
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
          const bottom=.008*metre;
          makeVertex(a,1);makeVertex(b,1);
          makeVertex(b,1,bottom);
          makeVertex(a,1);makeVertex(b,1,bottom);
          makeVertex(a,1,bottom);
        }
      };
      for(let row=-1;row<meshRows;row++){
        for(let col=-1;col<meshCols;col++){
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
      this.count=this.mesh.length/8;
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
  let focusWaterBounds=null;
  let focusSiteSerial=0;
  let focusAppliedThreshold=null;
  let focusThresholdTimer=null;
  let siteRainData=null,siteRainRequest=0,rainfallMode='manual',manualFourHourMm=null;
  let lastHydroFrame=null,hydroState='ready';
  let futureYear=2026, floodMode='rain', climateScenario='central', externalStageM=null;
  let stormProfile='peak',externalInlet='low',externalRiseMin=30,externalFallMin=90;
  let annualPlaying=false,annualAdvanceTimer=null;
  let longTermMode=true,annualBudget=null;
  let awaitingInitialReset=false;
  // The standalone 2026–2100 timeline now uses one coherent annual
  // accumulation scenario; its removed checkbox is no longer required.
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
    year,climateScenario,floodMode,
    eventRainMmH:rainfallMode==='feh-manual'&&Number.isFinite(manualFourHourMm)
      ?manualFourHourMm/4:Number($('localFloodRain')?.value)||0,
    durationMin:Number($('localFloodDuration')?.value)||60,
    infiltrationMmH:Number($('localFloodInfil')?.value)||5,
    assumedUrbanDrainageMmH:Number(siteHud('siteHudAssumedDrainage')?.value??25),
    stormProfile,drainageGuide:$('localFloodDrainageGuide')?.checked!==false,
    drainageThreshold:Number($('networkThreshold')?.value)||0,
    externalStageM,externalRiseMin,externalFallMin,externalInlet
  });
  const requestYear=year=>{
    if(floodMode!=='rain'&&!Number.isFinite(externalStageM)){
      status('外部洪水或耦合情景需先输入有依据的绝对边界水位。',true);
      stopAnnual();return;
    }
    ensureSimulator().seekYear(scenarioRequest(year));
  };
  const seekYear=value=>{
    stopAnnual();
    futureYear=Math.max(2026,Math.min(2100,Math.round(Number(value)||2026)));
    simYearDisplay();
    if(longTermMode&&!showCachedYear(futureYear)){
      requestYear(futureYear);
      status('正在加载 '+futureYear+' 年的设计暴雨洪水情景…');
    }
  };
  let previousWaterFrame=null,waterBlendStart=0,waterBlendHandle=0;
  let riskEnvelope=null; // maximum predicted depth encountered through the current year
  const clearRiskEnvelope=()=>{riskEnvelope=null;};
  const WATER_BLEND_MS=580;
  const stopAnnual=()=>{annualPlaying=false;clearTimeout(annualAdvanceTimer);annualAdvanceTimer=null;};
  // London management catchment 1% AEP design rainfall reference:
  // 2070s central +25%, upper end +40%; reference allowances, not yearly forecasts.
  const climateRainFactor=()=>1+Math.min(1,Math.max(0,(futureYear-2026)/74))*(climateScenario==='upper'?.40:.25);
  const siteHydroHistory=[];
  let siteFacilities=[];
  let nextFacilityId=1;
  let spongeTool='navigate';
  let hydroDisplay={depth:true,flow:true,collision:true,volume:true};
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
    // The footprint is a separate, always-populated copy of the actual clipped
    // building geometry. Hiding extrusions never deletes the flood-collision map.
    isolateViewer?.getSource(FOCUS_FOOTPRINT_SOURCE)?.setData({
      type:'FeatureCollection',features:selectedBuildingVisuals()
    });
    syncFocusFootprintVisibility();
  }

  function syncFocusFootprintVisibility(){
    if(!isolateViewer)return;
    const visible=hideSelectedBuildings?'visible':'none';
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
  function syncFocusFloodWaterRendering(){
    const viewer=isolateViewer;
    if(!viewer)return;
    const useVolume=Boolean(hydroDisplay.depth&&hydroDisplay.volume&&
      viewer.getPitch()>.5&&volumetricWater?.ready);
    volumetricWater?.setVisible(useVolume);
    if(viewer.getLayer(FOCUS_RAIN_LAYER)){
      const visibility=hydroDisplay.depth&&!useVolume?'visible':'none';
      if(viewer.getLayoutProperty(FOCUS_RAIN_LAYER,'visibility')!==visibility)
        viewer.setLayoutProperty(FOCUS_RAIN_LAYER,'visibility',visibility);
    }
  }
  function updateHydroLayerVisibility(){
    const viewer=isolateViewer;
    if(!viewer)return;
    syncFocusFloodWaterRendering();
    const desired=hydroDisplay.flow?'visible':'none';
    for(const id of [FOCUS_FLOW_GLOW,FOCUS_FLOW_LAYER]){
      if(viewer.getLayer(id)&&viewer.getLayoutProperty(id,'visibility')!==desired)
        viewer.setLayoutProperty(id,'visibility',desired);
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
        [FOCUS_FOOTPRINT_SOURCE]:{type:'geojson',data:{type:'FeatureCollection',features:selectedBuildingVisuals()}},
        [FOCUS_GREEN]:{type:'geojson',data:details.greens},
        [FOCUS_WATER]:{type:'geojson',data:details.waters},
        [FOCUS_ROADS]:{type:'geojson',data:details.roads},
        [FOCUS_SPONGE_SOURCE]:{type:'geojson',data:spongeCollection(
          siteFacilities.map(siteSpongeFeature).filter(Boolean)
        )},
        [FOCUS_FLOW_SOURCE]:{type:'geojson',lineMetrics:true,data:spongeCollection([])},
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
        {id:FOCUS_SPONGE_FILL,type:'fill',source:FOCUS_SPONGE_SOURCE,
          paint:{'fill-color':['get','color'],'fill-opacity':0.78}},
        {id:FOCUS_SPONGE_LINE,type:'line',source:FOCUS_SPONGE_SOURCE,
          paint:{'line-color':'#175967','line-width':1.5}},
        ...(canvas&&focusWaterBounds?[{
          id:FOCUS_RAIN_LAYER,type:'raster',source:FOCUS_RAIN_SOURCE,
          paint:{'raster-opacity':0.94,'raster-resampling':'linear','raster-fade-duration':0}
        }]:[]),
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
    const is3D=viewer.getPitch()>.5;
    for(const [id,v] of [
      [FOCUS_2D,is3D?'none':'visible'],
      [FOCUS_3D,is3D?'visible':'none']
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
    if(focusThresholdTimer)clearTimeout(focusThresholdTimer);
    focusThresholdTimer=null;
    const viewer=isolateViewer;
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
    setSiteHud('siteHudRainValue',$('localFloodRain')?.value+' mm/h');
    if(siteHud('siteHudManualRain')&&rainfallMode==='manual'){
      siteHud('siteHudManualRain').value=$('localFloodRain').value;
    }
    setSiteHud('siteHudInfilValue',$('localFloodInfil')?.value+' mm/h');
    setSiteHud('siteHudDurationValue',$('localFloodDuration')?.value+' min');
    setSiteHud('siteHudGrid',$('localFloodGridInfo')?.textContent||'');
    setSiteRainMode();
  }
  function simYearDisplay(){
    setSiteHud('siteHudYearText',String(futureYear));
    for(const id of ['siteHudYear','siteHudFooterYear'])if(siteHud(id))siteHud(id).value=String(futureYear);
    setSiteHud('siteHudFutureFactor','设计暴雨情景倍率 ×'+climateRainFactor().toFixed(3));
    updateSiteHydroDashboard();
  }
  function updateSiteHydroDashboard(frame=lastHydroFrame){
    if(!isolatedSelection)return;
    const v=frame?.stats;
    for(let i=0;i<6;i++){
      const ha=(v?.depthAreaM2?.[i]||0)/10000;
      setSiteHud('siteDepthArea'+i,ha.toFixed(2)+' ha');
      const el=siteHud('siteDepthBin'+i);
      if(el)el.dataset.wet=ha>0?'true':'false';
    }
    const stage=longTermMode&&frame?.annualAreaStage?.kind==='rainfall-risk-scenario'
      ?frame.annualAreaStage:null;
    if(stage?.resetInitial){
      setSiteHud('siteHudAreaProgress','2026 年 · 已重置 · 0.00 ha');
    }else if(stage){
      const baseHa=(stage.baselineWetAreaM2||0)/10000;
      const nowHa=(v?.wetAreaM2||0)/10000;
      const finalHa=(stage.finalWetAreaM2||0)/10000;
      const pct=(stage.fraction*100).toFixed(1);
      const riskText=stage.riskAvailable
        ?'EA 风险重合 '+(v?.eaRiskOverlapPercent||0).toFixed(1)+'%'
        :'EA 风险暂不可用';
      setSiteHud('siteHudAreaProgress',
        futureYear+' 年 / '+pct+'% · 淹没 '+nowHa.toFixed(2)+
        ' ha（2026 画面 0.00 → 2100 '+finalHa.toFixed(2)+
        ' ha） · '+riskText);
    }else{
      setSiteHud('siteHudAreaProgress',longTermMode
        ?'等待该年份的淹没面积快照':'');
    }
    setSiteHud('siteHudFloodPhase',longTermMode?
      futureYear+' 年 · 2026 零新增积水演示起点 → 2100 设计暴雨最大演示范围；年份分期不是实际洪水预报':annualPlaying?
      futureYear+' 年 · 无新增干预的累计最大淹没风险包络（非持续积水）':
      (!v||v.timeMin===0?'尚未运行 · 无动态积水':'模拟 '+simulationClock(v.timeMin)+' · 蓝色区域按计算水深逐步变化'));
    if(v){
      setSiteHud('siteHudDepth',v.maxDepthM.toFixed(2)+' m');
      setSiteHud('siteHudArea',(v.wetAreaM2/1e4).toFixed(2)+' ha');
      setSiteHud('siteHudImpacted',v.impactedCount+' 栋');
      setSiteHud('siteHudVolume',Math.round(v.volumeM3).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudRetained',Math.round(v.retainedM3||0).toLocaleString('en-GB')+' m³');
      setSiteHud('siteHudExtraInfil',Math.round(v.spongeInfiltrationM3||0).toLocaleString('en-GB')+' m³');
    }else{
      for(const [id,value] of [
        ['siteHudDepth','0.00 m'],['siteHudArea','0.00 ha'],
        ['siteHudImpacted','0 栋'],['siteHudVolume','0 m³'],
        ['siteHudRetained','0 m³'],['siteHudExtraInfil','0 m³'],
        ['siteHudLiveRain','0.0 mm/h']
      ])setSiteHud(id,value);
    }
    const elapsed=v?.timeMin||0,duration=Number($('localFloodDuration')?.value)||60;
    setSiteHud('siteHudClock',futureYear+' 年 / 2100 年');
    if(v&&Number.isFinite(v.currentRainMmH)){
      setSiteHud('siteHudLiveRain',v.currentRainMmH.toFixed(1)+' mm/h');
    }
    const progress=siteHud('siteHudProgress');
    if(progress)progress.style.width=((futureYear-2026)/74*100).toFixed(2)+'%';
    if(longTermMode&&v&&hydroState==='preparing')hydroState='ready';
    setSiteHud('siteHudRunState',longTermMode?
      (annualPlaying?'逐年演化中 · ':'年份可回放 · ')+
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
      '<small>REAL SITE FLOOD ANALYSIS · OS TERRAIN 50</small></div>',
      '<span class="site-hydro-chip">EA RISK / DRAINAGE / RAINFALL</span>',
      '<button id="siteHudTop" class="site-hydro-btn" type="button" style="flex:0 0 58px">2D</button>',
      '<button id="siteHudIso" class="site-hydro-btn" type="button" style="flex:0 0 58px">3D</button>',
      '<button id="siteHudExit" class="site-hydro-close" type="button">✕ 返回城市地图 · Esc</button></header>',
      '<section class="site-hydro-side site-hydro-left">',
      '<div class="site-hydro-eyebrow">SCENARIO BUILDER</div>',
      '<div class="site-hydro-title">真实场地洪涝模拟</div>',
      '<div class="site-hydro-pill"><div id="siteHudLocation">查询地块坐标…</div><small id="siteHudGrid"></small></div>',
      '<div class="site-hydro-section"><div class="site-hydro-section-title">2026—2100 · 未来洪水情景</div>',
      '<div class="site-hydro-row"><input type="range" id="siteHudYear" min="2026" max="2100" step="1" value="2026" style="flex:1;min-width:70px"><strong id="siteHudYearText">2026</strong></div>',
      '<div id="siteHudAreaProgress" class="site-hydro-mini" style="color:#82def3;font-weight:600">2026 零新增积水展示起点 → 2100 计算终态</div>',
      '<label class="site-hydro-row">模式 <select id="siteHudFutureMode" style="width:140px"><option value="rain">仅降雨</option><option value="external">仅外部洪水</option><option value="coupled">降雨 + 外部洪水</option></select></label>',
      '<label class="site-hydro-row">气候情景 <select id="siteHudFutureClimate" style="width:140px"><option value="central">Central +25%</option><option value="upper">Upper +40%</option></select></label>',
      '<div class="site-hydro-mini" id="siteHudFutureFactor">设计暴雨 ×1.000</div>',
      '<label class="site-hydro-row">假设雨水管网排水能力 <input id="siteHudAssumedDrainage" type="number" min="0" max="100" step="5" value="25" style="width:75px"> mm/h</label>',
      '<div class="site-hydro-mini">25 mm/h 为可调整的研究假设，不是 EA 测量的排水管网能力。仅用于改善缺失地下排水数据时的情景计算。</div>',
      '<label class="site-hydro-row">降雨事件过程 <select id="siteHudStormProfile" style="width:140px"><option value="peak">中段暴雨峰值</option><option value="front">前段强降雨</option><option value="uniform">均匀降雨</option></select></label>',
      '<label class="site-hydro-row">外部洪水位 <input id="siteHudFutureStage" type="number" step="0.1" placeholder="绝对高程 m" style="width:105px"> m</label>',
      '<label class="site-hydro-row">入流位置 <select id="siteHudExternalInlet" style="width:140px"><option value="low">边界低洼 10%（假设）</option><option value="all">全部边界（试验）</option></select></label>',
      '<label class="site-hydro-row">涨水时间 <input id="siteHudRise" type="number" min="1" max="1440" value="30" style="width:88px"> min</label>',
      '<label class="site-hydro-row">退水结束 <input id="siteHudFall" type="number" min="2" max="2880" value="90" style="width:88px"> min</label>',
      '<div id="siteHudFutureNote" class="site-hydro-mini">EA 伦敦 1% AEP 降雨设计增幅，2026—2075 插值，其后持平。外部边界水位须自行核实，EA 风险概率不是水位。每年对应短时洪水情景，非全年连续降雨。</div>',
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
      '<div class="site-hydro-mini">进入场地时仅显示建筑与地面。动态水深随「运行」时间变化；EA 风险概率不会随模拟时间变化。</div>',
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
      '<label class="site-hydro-check"><input id="siteHudShowBuildings" type="checkbox" checked> 显示场地内建筑（仅视觉隐藏，不影响水文计算）</label>',
      '<label class="site-hydro-check"><input id="siteHudShowDepth" type="checkbox" checked> 水深</label>',
      '<label class="site-hydro-check"><input id="siteHudShowVolume" type="checkbox" checked> 3D 立体动态水体 · 波纹 / 接触水花</label>',
      '<label class="site-hydro-check"><input id="siteHudShowFlow" type="checkbox" checked> 水流向量场</label>',
      '<label class="site-hydro-check"><input id="siteHudShowCollision" type="checkbox" checked> 建筑碰撞效果</label>',
      '<div class="site-hydro-mini">3D 水体厚度按真实计算水深视觉放大 2 倍（最大显示 4 m）；实际水深统计、碰撞阈值均保持原值。水花和波纹属于表现效果。</div>',
      '<div class="site-hydro-mini">水流箭头表示网格水位梯度方向，并非经过校准的流速数据。</div>',
      '</div></section>',
      '<aside class="site-hydro-side site-hydro-right">',
      '<div class="site-hydro-eyebrow">LIVE PERFORMANCE</div><div class="site-hydro-title">场地模拟结果</div>',
      '<div class="site-hydro-section" style="margin-top:4px;padding-top:7px;border-top:0">',
      '<div class="site-hydro-section-title">动态积水水深分级 · SIMULATED DEPTH</div>',
      '<div class="site-hydro-mini">以下是随模拟时间变化的水深，并非 EA 洪涝风险概率。</div>',
      '<div class="site-hydro-depth-legend">',
      '<div class="site-hydro-depth-bin" id="siteDepthBin0" data-wet="false"><i style="background:#36c5da"></i><span>0.005–0.05m <strong id="siteDepthArea0">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin1" data-wet="false"><i style="background:#10b1d1"></i><span>0.05–0.15m <strong id="siteDepthArea1">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin2" data-wet="false"><i style="background:#1797d7"></i><span>0.15–0.30m <strong id="siteDepthArea2">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin3" data-wet="false"><i style="background:#1868c6"></i><span>0.30–0.60m <strong id="siteDepthArea3">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin4" data-wet="false"><i style="background:#1440a7"></i><span>0.60–1.20m <strong id="siteDepthArea4">0.00 ha</strong></span></div>',
      '<div class="site-hydro-depth-bin" id="siteDepthBin5" data-wet="false"><i style="background:#0b236f"></i><span>≥1.20m <strong id="siteDepthArea5">0.00 ha</strong></span></div>',
      '</div><div class="site-hydro-depth-note" id="siteHudFloodPhase">尚未运行 · 无动态积水</div></div>',
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
      '<div class="site-hydro-section"><div class="site-hydro-section-title">EA RISK · 静态长期概率（手动查看）</div>',
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
      '<strong id="siteHudClock">2026 年 / 2100 年</strong><span id="siteHudRunState" class="site-hydro-mini">准备就绪</span>',
      '</div><div class="site-hydro-track" style="position:relative;overflow:visible"><div id="siteHudProgress" class="site-hydro-progress"></div><input id="siteHudFooterYear" aria-label="预测年份 2026 到 2100" type="range" min="2026" max="2100" step="1" value="2026" style="position:absolute;inset:-8px 0 auto 0;width:100%;height:18px;margin:0;cursor:pointer;opacity:0.65;accent-color:#5dd2db"></div><div class="site-hydro-mini" style="display:flex;justify-content:space-between"><span>2026</span><span>2050</span><span>2075</span><span>2100</span></div>',
      '<div class="site-hydro-mini" id="siteHudNotice">2026—2100 无新增干预：最大淹没风险包络逐年扩展（情景推算，非连续积水）</div></div></footer>'
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
    const resetFuture=()=>{
      stopAnnual();clearRiskEnvelope();clearYearFrames();
      simulator?.reset();siteHydroHistory.length=0;lastHydroFrame=null;hydroState='reset';
      updateSiteHydroDashboard();
    };
    const syncFuture=()=>{
      setSiteHud('siteHudYearText',String(futureYear));
      siteHud('siteHudYear').value=String(futureYear);
      siteHud('siteHudFooterYear').value=String(futureYear);
      setSiteHud('siteHudFutureFactor','2100 年设计降雨参考倍率 ×'+climateRainFactor().toFixed(3)+'（年份插值，非官方逐年预报）');
      siteHud('siteHudFutureStage').disabled=floodMode==='rain';
      for(const id of ['siteHudExternalInlet','siteHudRise','siteHudFall'])siteHud(id).disabled=floodMode==='rain';
      setSiteHud('siteHudFutureNote',longTermMode?
        '本演示以2026年零新增积水画面为起点（不表示现实中2026年无洪水风险），以设计降雨、DEM、建筑和假设排水计算得到的2100年水深为终点。未来淹没范围与水深随年份渐进显示，EA现状风险仅用于空间校核和展示顺序。中间年份为视觉分期，不是逐年真实洪水预报。':
        (floodMode==='rain'?
        'EA 伦敦 2070s 设计增幅；2026—2075 线性插值，之后持平。年份不是精确天气预报。':
        '外部洪水仅使用手动给定的同基准绝对水位；无真实边界数据不能自动运行。不是 EA 官方洪水水位预报。'));
      resetFuture();
    };
    siteHud('siteHudYear').oninput=e=>{if(longTermMode)seekYear(e.target.value);else{futureYear=Number(e.target.value);syncFuture();}};
    siteHud('siteHudFooterYear').oninput=e=>{if(longTermMode)seekYear(e.target.value);else{futureYear=Number(e.target.value);syncFuture();}};
    siteHud('siteHudFutureMode').onchange=e=>{floodMode=e.target.value;syncFuture();};
    siteHud('siteHudFutureClimate').onchange=e=>{climateScenario=e.target.value;syncFuture();};
    siteHud('siteHudFutureStage').onchange=e=>{externalStageM=e.target.value.trim()===''?null:Number(e.target.value);resetFuture();};
    siteHud('siteHudStormProfile').onchange=e=>{stormProfile=e.target.value;resetFuture();};
    siteHud('siteHudAssumedDrainage').onchange=()=>resetFuture();
    siteHud('siteHudExternalInlet').onchange=e=>{externalInlet=e.target.value;resetFuture();};
    siteHud('siteHudRise').onchange=e=>{externalRiseMin=Math.max(1,Number(e.target.value)||30);resetFuture();};
    siteHud('siteHudFall').onchange=e=>{externalFallMin=Math.max(externalRiseMin+1,Number(e.target.value)||90);resetFuture();};
    syncFuture();

    const resetForNewRain=()=>{
      stopAnnual();clearYearFrames();clearRiskEnvelope();
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
      hydroDisplay={depth:true,flow:true,collision:true,volume:true};
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
      hydroDisplay[flag]=e.target.checked;
      updateHydroLayerVisibility();
    };
    siteHud('siteHudRun').onclick=()=>{
      if(!prepared)return;
      if(longTermMode){
        if(floodMode!=='rain'&&!Number.isFinite(externalStageM)){
          status('外部洪水与耦合情景需要真实边界水位，不能根据 EA 风险概率虚构。',true);
          return;
        }
        stopAnnual();annualPlaying=true;futureYear=2026;
        clearRiskEnvelope();clearYearFrames();simYearDisplay();
        requestYear(2026);
        status('正在计算 2100 年设计暴雨终态，从 2026 年零新增积水画面开始逐步展示至最大范围…');
        return;
      }
      if(floodMode!=='rain'&&!Number.isFinite(externalStageM)){
        status('必须先填写有依据的外部洪水边界水位。',true);return;
      }
      if(futureYear>=2100){futureYear=2026;clearRiskEnvelope();}
      if(!annualPlaying&&futureYear===2026)clearRiskEnvelope();
      annualPlaying=true;
      simulator?.reset(true);
      ensureSimulator().start({...currentParams(),annualPreview:true});
      updateSiteHydroDashboard();
    };
    siteHud('siteHudPause').onclick=()=>{
      stopAnnual();simulator?.pause();updateSiteHydroDashboard();
    };
    siteHud('siteHudReset').onclick=()=>{
      // Reset the actual scenario, not just the position of the year slider.
      stopAnnual();
      clearRiskEnvelope();clearYearFrames();
      annualBudget=null;pendingBaselineFrame=false;
      futureYear=2026;hydroState='reset';
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
      isolateViewer?.getSource(FOCUS_FLOW_SOURCE)?.setData(spongeCollection([]));
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
      riskMetaUrl:new URL(assetUrl('assets/london_flood_risk_metadata.json'),location.href).href,
      riskTileUrls:[
        new URL(assetUrl('assets/flood_risk/flood_0-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/flood_0-1.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/flood_1-0.webp'),location.href).href,
        new URL(assetUrl('assets/flood_risk/flood_1-1.webp'),location.href).href
      ],
      onFrame:handleFrame,
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
        if(data.state==='running')status('模拟运行中：雨水沿 50 m 地形势能流动，OSM 建筑作为不可穿透障碍。');
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
    waterUpscale=Math.max(1,Math.min(3,
      Math.floor(1600/Math.max(1,info.cols,info.rows))));
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
      hydroDisplay={depth:true,flow:true,collision:true,volume:true};
      ensureSimulator().setParams(currentParams());
      const info=await ensureSimulator().setup({polygon,buildings});
      prepared=true;
      ensureWaterLayer(info);
      publishBuildingScene();
      $('localFloodGridInfo').textContent=
        info.cellSizeM+' m 网格 · '+info.buildingCount+' 栋建筑 · '+
        (info.drainageAvailable?'汇水路径数据就绪':'地形独立计算（汇水数据不可用）')+
        ' · '+(info.riskAvailable?'EA 现状风险可校核':'EA 风险不可用');
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



  // The colour scale expresses relative hydraulic-gradient intensity,
  // not physical velocity in metres/second (solver is not calibrated).
  function hydroFlowColour(strength){
    const stops=[
      [0,[167,244,255]],[0.20,[117,218,255]],
      [0.45,[71,171,255]],[0.70,[56,123,246]],
      [1,[116,91,236]]
    ];
    const t=Math.max(0,Math.min(1,strength));
    let a=stops[0],b=stops[stops.length-1];
    for(let k=1;k<stops.length;k++){
      if(t<=stops[k][0]){a=stops[k-1];b=stops[k];break;}
    }
    const f=(t-a[0])/Math.max(.00001,b[0]-a[0]);
    return '#'+a[1].map((v,i)=>
      Math.round(v+(b[1][i]-v)*f).toString(16).padStart(2,'0')).join('');
  }

  function buildHydroStreamlines(data){
    const field=data?.flowField;
    if(!field||!focusWaterBounds)return spongeCollection([]);
    const {cols,rows}=field;
    if(!cols||!rows||cols*rows>70000)return spongeCollection([]);
    const vx=new Int8Array(field.vx),vy=new Int8Array(field.vy);
    const intensity=new Uint8Array(field.intensity);
    if(vx.length!==cols*rows||vy.length!==vx.length||
       intensity.length!==vx.length)return spongeCollection([]);
    const nw=mercator(focusWaterBounds[0][0],focusWaterBounds[0][1]);
    const ne=mercator(focusWaterBounds[1][0],focusWaterBounds[1][1]);
    const sw=mercator(focusWaterBounds[3][0],focusWaterBounds[3][1]);
    const cellX=(ne[0]-nw[0])/cols,cellY=(nw[1]-sw[1])/rows;
    const value=(x,y)=>{
      if(x<0||y<0||x>=cols||y>=rows)return null;
      const ix=Math.floor(x),iy=Math.floor(y),index=iy*cols+ix;
      // A zero-intensity cell means dry, outside the site or a building.
      // This nearest-cell test prevents paths leaking through buildings.
      if(intensity[index]<6)return null;
      const cx=x-.5,cy=y-.5,x0=Math.floor(cx),y0=Math.floor(cy);
      let dx=0,dy=0,speed=0,total=0;
      for(let oy=0;oy<=1;oy++)for(let ox=0;ox<=1;ox++){
        const xx=x0+ox,yy=y0+oy;
        if(xx<0||yy<0||xx>=cols||yy>=rows)continue;
        const j=yy*cols+xx;
        if(intensity[j]<6)continue;
        const weight=(ox?cx-x0:1-(cx-x0))*
          (oy?cy-y0:1-(cy-y0));
        dx+=vx[j]/127*weight;
        dy+=vy[j]/127*weight;
        speed+=intensity[j]/255*weight;
        total+=weight;
      }
      const size=Math.hypot(dx,dy);
      if(total<.04||size<.09)return null;
      return {dx:dx/size,dy:dy/size,speed:speed/total};
    };
    const toLngLat=(point)=>unmercator(
      nw[0]+point.x*cellX,nw[1]-point.y*cellY
    );
    const trace=(sx,sy,sign)=>{
      const points=[];
      let x=sx,y=sy;
      for(let k=0;k<32;k++){
        const v=value(x,y);
        if(!v)break;
        points.push({x,y,speed:v.speed});
        const step=.62;
        const halfway=value(x+v.dx*sign*step/2,
          y+v.dy*sign*step/2)||v;
        const nx=x+halfway.dx*sign*step;
        const ny=y+halfway.dy*sign*step;
        if(nx<0||ny<0||nx>=cols||ny>=rows)break;
        if(!value(nx,ny))break;
        x=nx;y=ny;
      }
      return points;
    };
    const occupied=new Uint8Array(cols*rows);
    const features=[];
    const stride=Math.max(2,Math.round(Math.sqrt(cols*rows/460)));
    let traces=0;
    for(let row=1;row<rows-1&&traces<440;row+=stride){
      for(let col=1;col<cols-1&&traces<440;col+=stride){
        const index=row*cols+col;
        if(occupied[index]||intensity[index]<6)continue;
        const seedX=col+.5,seedY=row+.5;
        const forward=trace(seedX,seedY,1);
        const backward=trace(seedX,seedY,-1);
        const points=backward.reverse().slice(0,-1).concat(forward);
        if(points.length<5)continue;
        traces++;
        // Segment colours smoothly follow the underlying intensity.
        // Break only every four interpolated points for manageable GeoJSON.
        for(let start=0;start<points.length-1;start+=4){
          const portion=points.slice(start,Math.min(points.length,start+5));
          if(portion.length<2)continue;
          const avg=portion.reduce((sum,p)=>sum+p.speed,0)/portion.length;
          features.push({
            type:'Feature',
            properties:{
              color:hydroFlowColour(avg),
              width:Math.max(.85,Math.min(2.4,1+1.35*avg)),
              relativeIntensity:avg
            },
            geometry:{type:'LineString',coordinates:portion.map(toLngLat)}
          });
        }
        // Suppress near-duplicate starting positions, not the path itself.
        for(let k=0;k<points.length;k+=4){
          const p=points[k],x=Math.floor(p.x),y=Math.floor(p.y);
          if(x>=0&&x<cols&&y>=0&&y<rows)occupied[y*cols+x]=1;
        }
      }
    }
    return spongeCollection(features);
  }

  function updateFocusFlowVectors(data){
    if(!isolateViewer||!focusWaterBounds)return;
    const source=isolateViewer.getSource(FOCUS_FLOW_SOURCE);
    if(!source)return;
    if(!hydroDisplay.flow||!data?.flowField){
      source.setData(spongeCollection([]));
      return;
    }
    const now=performance.now();
    if(now-lastFlowUpdateAt<130&&data.stats?.timeMin>0)return;
    lastFlowUpdateAt=now;
    source.setData(buildHydroStreamlines(data));
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
      if(data?.annualAreaStage?.kind==='rainfall-risk-scenario'&&
         Number.isInteger(data.scenarioYear)){
        yearFrames.set(data.scenarioYear,data);
        // Ignore stale Worker results received after a rapid slider movement.
        if(data.scenarioYear!==futureYear)return;
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
    lowResWaterContext.putImageData(new ImageData(pixels,data.width,data.height),0,0);
    const nextFrame=document.createElement('canvas');
    nextFrame.width=outWidth;nextFrame.height=outHeight;
    const nc=nextFrame.getContext('2d');
    nc.imageSmoothingEnabled=true;nc.imageSmoothingQuality='high';
    nc.drawImage(lowResWater,0,0,outWidth,outHeight);
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
        (data.annualAreaStage?.kind==='rainfall-risk-scenario'?150:WATER_BLEND_MS));
      canvasContext.clearRect(0,0,outWidth,outHeight);
      canvasContext.globalAlpha=1;
      canvasContext.drawImage(oldFrame,0,0);
      canvasContext.globalAlpha=alpha*alpha*(3-2*alpha);
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
    if(!applyingYearFrame&&(!siteHydroHistory.length||s.timeMin-siteHydroHistory[siteHydroHistory.length-1][0]>=2)){
      siteHydroHistory.push([s.timeMin,s.maxDepthM]);
      if(siteHydroHistory.length>32)siteHydroHistory.shift();
    }
    updateSiteHydroDashboard(data);
    if(longTermMode&&annualPlaying&&!applyingYearFrame&&
       data.annualAreaStage?.kind==='rainfall-risk-scenario'&&
       data.scenarioYear===futureYear){
      clearTimeout(annualAdvanceTimer);
      if(futureYear<2100){
        annualAdvanceTimer=setTimeout(()=>{
          if(!annualPlaying||!isolatedSelection)return;
          futureYear++;
          simYearDisplay();
          requestYear(futureYear);
        },165);
      }else{
        stopAnnual();
        status('2026—2100 年度面积分期演示完成 · 可拖动时间轴逐年回放');
      }
    }
    $('localFloodStats').textContent=
      't '+s.timeMin.toFixed(1)+' min · 最大水深 '+s.maxDepthM.toFixed(2)+' m · '+
      '积水 '+(s.wetAreaM2/10000).toFixed(2)+' ha · 影响建筑 '+s.impactedCount;
  }

  function currentParams(){
    return {
      rainfall:floodMode==='external'?0:Number($('localFloodRain').value)*climateRainFactor(),
      floodMode,externalStageM,climateYear:futureYear,
      stormProfile,externalInlet,externalRiseMin,externalFallMin,
      interventions:((annualPlaying||longTermMode)?[]:siteFacilities).map(({id,type,lng,lat,radiusM})=>
        ({id,type,lng,lat,radiusM})),
      showFlow:hydroDisplay.flow,
      rainSeriesMm15:floodMode==='external'?null:rainfallMode==='ea-observed'&&siteRainData?.complete&&siteRainData?.recent
        ?siteRainData.series15.map(v=>v*climateRainFactor())
        :rainfallMode==='feh-manual'&&Number.isFinite(manualFourHourMm)
          ?Array(16).fill(manualFourHourMm/16*climateRainFactor()):null,
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
    if(floodMode!=='rain'&&!Number.isFinite(externalStageM)){
      status('缺少外部洪水的有效绝对边界水位；无法据 EA 风险概率凭空生成水位。',true);
      setSiteHud('siteHudFutureNote','外部洪水无法启动：请输入已核实、与 DEM 同高程基准的外部边界水位。');
      return;
    }
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
