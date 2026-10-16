/* London Parcel Generator — STEP 01 geographic raster audit.
 * Runs in a worker; hydrology flood worker and its calculations remain unchanged.
 */
const R=6378137;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const merc=(lon,lat)=>[R*lon*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/360))];
const inverse=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
function inRing(x,y,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
async function pixels(url,w,h){
  const response=await fetch(url,{cache:'force-cache'});
  if(!response.ok)throw Error('Geographic raster read failed HTTP '+response.status);
  const image=await createImageBitmap(await response.blob());
  try{
    if(image.width!==w||image.height!==h)throw Error('Raster size does not match the registered geographic extent');
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Cannot decode the elevation raster');
    ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,w,h).data;
    const data=new Uint16Array(w*h);
    for(let i=0;i<data.length;i++)data[i]=(rgba[i*4]<<8)|rgba[i*4+1];
    canvas.width=canvas.height=1;
    return data;
  }finally{image.close();}
}
function sample(codes,x,y,config,kind){
  const b=config.bounds;
  if(x<b.left||x>b.right||y<b.bottom||y>b.top)return NaN;
  const sx=(x-b.left)/(b.right-b.left)*config.width-.5;
  const sy=(b.top-y)/(b.top-b.bottom)*config.height-.5;
  const x0=clamp(Math.floor(sx),0,config.width-1);
  const x1=clamp(x0+1,0,config.width-1);
  const y0=clamp(Math.floor(sy),0,config.height-1);
  const y1=clamp(y0+1,0,config.height-1);
  const tx=clamp(sx-Math.floor(sx),0,1);
  const ty=clamp(sy-Math.floor(sy),0,1);
  const decoded=(col,row)=>{
    const c=codes[row*config.width+col];
    if(!c)return NaN;
    if(kind==='dem')return -100+(c-1)*.1;
    return .0025*Math.exp((c-1)/65534*Math.log(20000/.0025));
  };
  const values=[decoded(x0,y0),decoded(x1,y0),decoded(x0,y1),decoded(x1,y1)];
  const good=values.filter(Number.isFinite);
  if(!good.length)return NaN;
  for(let i=0;i<4;i++)if(!Number.isFinite(values[i]))values[i]=good[0];
  return (values[0]*(1-tx)+values[1]*tx)*(1-ty)+
    (values[2]*(1-tx)+values[3]*tx)*ty;
}
onmessage=async event=>{
  const {id,polygon,config,demUrl,areaUrl}=event.data||{};
  if(!id||!polygon||!config)return;
  try{
    postMessage({id,type:'progress',message:'Decoding real OS Terrain 50 elevation data…'});
    const dem=await pixels(demUrl,config.width,config.height);
    postMessage({id,type:'progress',message:'Decoding terrain-derived catchment data…'});
    let drainage=null;
    try{drainage=await pixels(areaUrl,config.width,config.height);}
    catch(error){postMessage({id,type:'progress',message:'Catchment raster unavailable; terrain indicators will be calculated alone:'+error.message});}
    const ring=polygon.map(p=>merc(p[0],p[1]));
    const xMin=Math.min(...ring.map(p=>p[0]));
    const xMax=Math.max(...ring.map(p=>p[0]));
    const yMin=Math.min(...ring.map(p=>p[1]));
    const yMax=Math.max(...ring.map(p=>p[1]));
    const latitude=polygon.reduce((t,p)=>t+p[1],0)/polygon.length;
    const scale=Math.max(.15,Math.cos(latitude*Math.PI/180));
    const groundCell=50;
    const desired=groundCell/scale;
    const count=Math.ceil((xMax-xMin)/desired)*Math.ceil((yMax-yMin)/desired);
    const stride=Math.max(1,Math.ceil(Math.sqrt(count/48000)));
    const cell=desired*stride;
    const cols=Math.ceil((xMax-xMin)/cell);
    const rows=Math.ceil((yMax-yMin)/cell);
    if(cols*rows>65000)throw Error('Site sample grid too large; select a smaller area');
    let sampled=0,valid=0,elevMin=Infinity,elevMax=-Infinity,elevSum=0;
    let slopeSum=0,slopeMax=0,slopeN=0,channelCount=0;
    const visual=[];
    for(let row=0;row<rows;row++){
      const y=yMax-(row+.5)*cell;
      for(let col=0;col<cols;col++){
        const x=xMin+(col+.5)*cell;
        if(!inRing(x,y,ring))continue;
        sampled++;
        const z=sample(dem,x,y,config,'dem');
        if(!Number.isFinite(z))continue;
        valid++;
        elevMin=Math.min(elevMin,z);
        elevMax=Math.max(elevMax,z);
        elevSum+=z;
        const offset=75/scale;
        const e=sample(dem,x+offset,y,config,'dem');
        const w=sample(dem,x-offset,y,config,'dem');
        const n=sample(dem,x,y+offset,config,'dem');
        const so=sample(dem,x,y-offset,config,'dem');
        let slope=NaN;
        if([e,w,n,so].every(Number.isFinite)){
          const riseE=(e-w)/150,riseN=(n-so)/150;
          slope=Math.atan(Math.hypot(riseE,riseN))*180/Math.PI;
          slopeSum+=slope;slopeMax=Math.max(slopeMax,slope);slopeN++;
        }
        const accumulation=drainage?sample(drainage,x,y,config,'area'):NaN;
        if(Number.isFinite(accumulation)&&accumulation>=1)channelCount++;
        if(visual.length<1800&&row%Math.max(1,Math.floor(rows/45))===0&&
           col%Math.max(1,Math.floor(cols/45))===0){
          visual.push({coordinates:inverse(x,y),elevationM:Number(z.toFixed(2)),
            slopeDeg:Number.isFinite(slope)?Number(slope.toFixed(2)):null,
            upstreamKm2:Number.isFinite(accumulation)?Number(accumulation.toFixed(4)):null});
        }
      }
    }
    if(!sampled||!valid||valid/sampled<.90)
      throw Error('This site lacks enough real terrain coverage (under 90% valid samples); analysis stopped.');
    postMessage({id,type:'done',result:{
      gridSizeM:groundCell*stride,siteCells:sampled,validCells:valid,
      coveragePercent:Number((valid/sampled*100).toFixed(1)),
      minElevationM:Number(elevMin.toFixed(2)),
      maxElevationM:Number(elevMax.toFixed(2)),
      meanElevationM:Number((elevSum/valid).toFixed(2)),
      meanSlopeDeg:slopeN?Number((slopeSum/slopeN).toFixed(2)):null,
      maxSlopeDeg:slopeN?Number(slopeMax.toFixed(2)):null,
      drainageAvailable:Boolean(drainage),
      drainageCellsAbove1km2:drainage?channelCount:null,
      derivedPoints:visual,
      dataClass:'Observed terrain source / derived slope and drainage (not hydrodynamic model)',
      rasterGrid:'OS Terrain 50 preprocessed raster aligned to EPSG:3857'
    }});
  }catch(error){
    postMessage({id,type:'error',message:String(error?.message||error)});
  }
};
