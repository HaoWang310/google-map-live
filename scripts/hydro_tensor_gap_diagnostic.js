/* v3.22.78 · Opt-in, read-only tensor gap diagnostic.
 * Field thresholds exactly mirror hydro_tensor_geometry.js. "Uncovered"
 * is a proximity diagnostic, NOT an attributed integration stop reason.
 * The water overlay uses model depth >= 20 mm; no flood re-simulation.
 */
const R=6378137;
const TO_RAD=Math.PI/180,TO_DEG=180/Math.PI;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const merc=([lng,lat])=>[R*lng*TO_RAD,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*TO_RAD/2))];
const geo=(x,y)=>[x/R*TO_DEG,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*TO_DEG];
export const TENSOR_GAP_CATEGORIES=Object.freeze([
  {code:'missing',label:'无有效数据 / 掩膜缺口',color:'#FA6379'},
  {code:'low',label:'方向置信度不足（<0.075）',color:'#F59E78'},
  {code:'isotropic',label:'方向不唯一（各向异性≤0.02）',color:'#E9B85B'},
  {code:'axis',label:'主轴缺失',color:'#B79BFA'},
  {code:'uncovered',label:'方向有效但流线未覆盖（原因待查）',color:'#37BDF2'}
]);
export function classifyTensorEvidence(f,i,inside=true){
  if(!inside)return 'outside';
  if(!f.validMask?.[i])return 'missing';
  if(!(Number(f.confidence?.[i])>=.075))return 'low';
  if(!(Number(f.anisotropy?.[i])>.02))return 'isotropic';
  if(Math.hypot(Number(f.primaryX?.[i]||0),Number(f.primaryY?.[i]||0))<=.5)
    return 'axis';
  return 'supported';
}
function coverageDistance(cols,rows,grid,streamlines){
  const n=cols*rows,occupied=new Uint8Array(n),dist=new Float32Array(n);
  dist.fill(1e6);
  const step=grid.cellProjectedM,xy=p=>{
    const v=merc(p);return [(v[0]-grid.left)/step,(grid.top-v[1])/step];
  };
  let segmentCount=0;
  for(const feature of streamlines||[]){
    const coords=feature.geometry?.coordinates||feature.coordinates;
    if(!Array.isArray(coords)||coords.length<2)continue;
    for(let j=1;j<coords.length;j++){
      const a=xy(coords[j-1]),b=xy(coords[j]);
      if(!a.every(Number.isFinite)||!b.every(Number.isFinite))continue;
      // Sample native-cell raster and no further: high-resolution curves
      // remain untouched, and diagnostics are independent of screen zoom.
      const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2));
      for(let k=0;k<=steps;k++){
        const t=k/steps,x=Math.floor(a[0]+(b[0]-a[0])*t),
          y=Math.floor(a[1]+(b[1]-a[1])*t);
        if(x>=0&&x<cols&&y>=0&&y<rows){occupied[y*cols+x]=1;segmentCount++}
      }
    }
  }
  for(let i=0;i<n;i++)if(occupied[i])dist[i]=0;
  const diag=Math.SQRT2;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const i=y*cols+x;let v=dist[i];
    if(x>0)v=Math.min(v,dist[i-1]+1);
    if(y>0){v=Math.min(v,dist[i-cols]+1);
      if(x>0)v=Math.min(v,dist[i-cols-1]+diag);
      if(x+1<cols)v=Math.min(v,dist[i-cols+1]+diag)}
    dist[i]=v;
  }
  for(let y=rows-1;y>=0;y--)for(let x=cols-1;x>=0;x--){
    const i=y*cols+x;let v=dist[i];
    if(x+1<cols)v=Math.min(v,dist[i+1]+1);
    if(y+1<rows){v=Math.min(v,dist[i+cols]+1);
      if(x>0)v=Math.min(v,dist[i+cols-1]+diag);
      if(x+1<cols)v=Math.min(v,dist[i+cols+1]+diag)}
    dist[i]=v;
  }
  return {dist,segmentCount};
}
function rect(grid,x0,y0,x1,y1,category){
  const sx=grid.cellProjectedM,x=grid.left,y=grid.top;
  const left=x+x0*sx,right=x+x1*sx,top=y-y0*sx,bottom=y-y1*sx;
  return {type:'Feature',properties:{category},
    geometry:{type:'Polygon',coordinates:[[
      geo(left,top),geo(right,top),geo(right,bottom),geo(left,bottom),geo(left,top)
    ]]}};
}
function encodeTiles(codes,cols,rows,grid,stride,maxShapes){
  const features=[];
  for(let y=0;y<rows;y+=stride){
    const blocks=[];
    for(let x=0;x<cols;x+=stride){
      const frequency=new Map();
      for(let yy=y;yy<Math.min(rows,y+stride);yy++)
        for(let xx=x;xx<Math.min(cols,x+stride);xx++){
          const v=codes[yy*cols+xx];if(v!=='supported'&&v!=='outside'&&v!=='none')
            frequency.set(v,(frequency.get(v)||0)+1);
        }
      let best='none',votes=0;
      for(const [key,count] of frequency)if(count>votes){best=key;votes=count}
      blocks.push(best);
    }
    // Merge horizontal runs of identical classifications, reducing map load.
    for(let j=0;j<blocks.length;){
      const category=blocks[j];let k=j+1;
      while(k<blocks.length&&blocks[k]===category)k++;
      if(category!=='none'){
        features.push(rect(grid,j*stride,y,Math.min(cols,k*stride),
          Math.min(rows,y+stride),category));
        if(features.length>maxShapes)return null;
      }
      j=k;
    }
  }
  return features;
}
export function buildTensorGapDiagnostic({result,streamlines=[],geometryMatched=false,
  maxShapes=5200}={}){
  if(!result?.grid||!result.fields)return null;
  const {cols,rows,grid,fields:f}=result,n=cols*rows;
  if(!n||n>70000||f.validMask?.length!==n)return null;
  const site=result.context?.inside||result.siteMask;
  const wetDepth=result.depth||result.depthMm;
  const categories=new Array(n),wetCodes=new Array(n);
  const counts={missing:0,low:0,isotropic:0,axis:0,uncovered:0,supported:0,
    outside:0,wet:0,wetGap:0,site:0};
  const canCompare=Boolean(geometryMatched&&streamlines.length);
  const coverage=canCompare?coverageDistance(cols,rows,grid,streamlines):null;
  const spacingM=Number(result.geometrySpacingM)||grid.cellProjectedM*grid.groundScale*1.5;
  const thresholdCells=clamp(1.5*spacingM/
    Math.max(.001,grid.cellProjectedM*grid.groundScale),1.5,7);
  for(let i=0;i<n;i++){
    const inside=!site||Boolean(site[i]);
    let category=classifyTensorEvidence(f,i,inside);
    if(category==='supported'&&coverage?.dist[i]>thresholdCells)category='uncovered';
    categories[i]=category;counts[category]++;
    if(!inside){wetCodes[i]='none';continue}
    counts.site++;
    const wet=Boolean(wetDepth&&wetDepth[i]>=20);
    wetCodes[i]=wet?'wet':'none';
    if(wet){counts.wet++;if(category!=='supported')counts.wetGap++}
  }
  const shapeLimit=Math.max(250,Math.floor(maxShapes));
  let shapes=null,wetShapes=null,visualStride=1;
  for(const stride of [1,2,3,4,6,8]){
    shapes=encodeTiles(categories,cols,rows,grid,stride,shapeLimit);
    wetShapes=encodeTiles(wetCodes,cols,rows,grid,stride,shapeLimit);
    if(shapes&&wetShapes){visualStride=stride;break}
  }
  if(!shapes||!wetShapes){shapes=[];wetShapes=[];visualStride=0}
  return {
    // The blue underlay renders first, categorical causes above it.
    geojson:{type:'FeatureCollection',features:[
      ...wetShapes,...shapes]},
    stats:{...counts,year:result.scenario?.year??null,geometryMatched:canCompare,
      coverageThresholdM:Number((thresholdCells*grid.cellProjectedM*grid.groundScale).toFixed(1)),
      nativeCellGroundM:Number((grid.cellProjectedM*grid.groundScale).toFixed(1)),
      visualStride,shapes:shapes.length+wetShapes.length,
      interpretation:'Uncovered = supported direction without nearby accepted geometry; individual curvature/spacing stop reasons are not spatially available.'}
  };
}
