// Official present-day risk polygons rendered at the map's own XYZ tile grid.
// No upsampling, 25 m max aggregation, or invented boundary smoothing.
export const DETAIL_MIN_ZOOM=13;
export const DETAIL_MAX_ZOOM=17;
export const DETAIL_TILE_SIZE=512;
const R=6378137, HALF=Math.PI*R;
const SOURCES=[
  {layer:'rofrs_4band',style:'rivers_sea_fill_only.sld',
   urls:['https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea/wms',
         'https://environment.data.gov.uk/geoservices/datasets/96ab4342-82c1-4095-87f1-0082e8d84ef1/wms']},
  {layer:'rofsw',style:'surface_water_fill_only.sld',
   urls:['https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water/wms',
         'https://environment.data.gov.uk/geoservices/datasets/b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e/wms']}
];
const FILL_RANKS=new Map([[0xc8f7ff,1],[0xc3e0ff,2],[0x9a9fde,3],[0x555b9d,4],[0xb0b3b4,5]]);
const COLOURS=[[0,0,0,0],[156,221,234,255],[247,211,89,255],
               [242,157,56,255],[215,55,49,255],[153,156,158,255]];

export function tileBounds(z,x,y){
  const n=2**z,side=2*HALF/n;
  if(!Number.isInteger(z)||z<DETAIL_MIN_ZOOM||z>DETAIL_MAX_ZOOM||
     !Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=n||y>=n){
    throw new Error('Invalid flood detail tile');
  }
  return [-HALF+x*side,HALF-(y+1)*side,-HALF+(x+1)*side,HALF-y*side];
}

export function decodeRank(pixels,i){
  if(pixels[i+3]===0)return 0;
  const rank=FILL_RANKS.get((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
  if(pixels[i+3]!==255||rank===undefined)throw new Error('官方精细图返回未知的风险颜色');
  return rank;
}

export function higherAvailable(a,b){
  const known=Math.max(a===5?0:a,b===5?0:b);
  return known||((a===5||b===5)?5:0);
}

export function createFloodDetailLoader({center,radius,bounds,assetUrl}){
  const cache=new Map();
  let stylesPromise=null,active=0;
  const queue=[];
  const aborted=()=>new DOMException('Aborted','AbortError');
  function pump(){
    while(active<6&&queue.length){
      const job=queue.shift();
      job.signal.removeEventListener('abort',job.cancel);
      if(job.signal.aborted){job.reject(aborted());continue;}
      active++;
      job.resolve(()=>{active--;pump();});
    }
  }
  async function limited(task,signal){
    if(signal.aborted)throw aborted();
    const release=await new Promise((resolve,reject)=>{
      const job={resolve,reject,signal};
      job.cancel=()=>{const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);reject(aborted());};
      signal.addEventListener('abort',job.cancel,{once:true});queue.push(job);pump();
    });
    try{return await task();}finally{release();}
  }
  async function styles(){
    if(!stylesPromise){
      stylesPromise=Promise.all(SOURCES.map(async source=>{
        const r=await fetch(assetUrl('assets/flood_risk/'+source.style),{cache:'force-cache'});
        if(!r.ok)throw new Error('官方风险图样式加载失败（'+r.status+'）');
        const text=await r.text();
        if(!text.includes('<sld:StyledLayerDescriptor')||!text.includes(source.layer)){
          throw new Error('官方风险图样式不匹配');
        }
        return text;
      })).catch(error=>{stylesPromise=null;throw error;});
    }
    return stylesPromise;
  }
  async function readLayer(source,sld,bbox,signal){
    return limited(async()=>{
      let lastError;
      for(let attempt=0;attempt<4;attempt++){
        if(signal.aborted)throw aborted();
        const controller=new AbortController();
        const cancel=()=>controller.abort();
        signal.addEventListener('abort',cancel,{once:true});
        const timeout=setTimeout(()=>controller.abort(),18000);
        let bitmap;
        try{
          const p=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',
            LAYERS:source.layer,STYLES:'',CRS:'EPSG:3857',BBOX:bbox.join(','),
            WIDTH:String(DETAIL_TILE_SIZE),HEIGHT:String(DETAIL_TILE_SIZE),
            FORMAT:'image/png',TRANSPARENT:'TRUE',FORMAT_OPTIONS:'antialias:none',SLD_BODY:sld});
          if(attempt)p.set('_retry',String(Date.now()));
          const response=await fetch(source.urls[attempt%2]+'?'+p,{signal:controller.signal});
          if(!response.ok)throw new Error('EA 精细服务暂不可用（'+response.status+'）');
          bitmap=await createImageBitmap(await response.blob());
          if(bitmap.width!==DETAIL_TILE_SIZE||bitmap.height!==DETAIL_TILE_SIZE){
            throw new Error('官方精细图尺寸不匹配');
          }
          if(signal.aborted)throw aborted();
          const canvas=new OffscreenCanvas(DETAIL_TILE_SIZE,DETAIL_TILE_SIZE);
          const ctx=canvas.getContext('2d',{willReadFrequently:true});
          ctx.drawImage(bitmap,0,0);
          return ctx.getImageData(0,0,DETAIL_TILE_SIZE,DETAIL_TILE_SIZE).data;
        }catch(error){
          if(signal.aborted)throw aborted();
          lastError=error;
        }finally{
          bitmap?.close();clearTimeout(timeout);signal.removeEventListener('abort',cancel);
        }
      }
      throw lastError;
    },signal);
  }
  const clat=center.lat*Math.PI/180,clon=center.lng*Math.PI/180;
  return async(request,abortController)=>{
    const signal=abortController.signal;
    if(signal.aborted)throw aborted();
    const match=/^ea-flood:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if(!match)throw new Error('Invalid flood detail URL');
    const [z,x,y]=match.slice(1).map(Number),bbox=tileBounds(z,x,y);
    const key=z+'/'+x+'/'+y;
    if(cache.has(key)){
      if(signal.aborted)throw aborted();
      const data=cache.get(key);cache.delete(key);cache.set(key,data);
      return {data:data.slice(0),cacheControl:'max-age=86400'};
    }
    const size=DETAIL_TILE_SIZE;
    const canvas=new OffscreenCanvas(size,size),ctx=canvas.getContext('2d');
    const output=ctx.createImageData(size,size);
    if(bbox[2]>bounds.left&&bbox[0]<bounds.right&&bbox[3]>bounds.bottom&&bbox[1]<bounds.top){
      const sld=await styles();
      if(signal.aborted)throw aborted();
      const [a,b]=await Promise.all(SOURCES.map((s,i)=>readLayer(s,sld[i],bbox,signal)));
      const dx=(bbox[2]-bbox[0])/size,dy=(bbox[3]-bbox[1])/size;
      for(let row=0;row<size;row++){
        const my=bbox[3]-(row+.5)*dy;
        const lat=2*Math.atan(Math.exp(my/R))-Math.PI/2;
        const dlat=Math.sin((lat-clat)/2)**2,cos=Math.cos(lat)*Math.cos(clat);
        for(let col=0;col<size;col++){
          const mx=bbox[0]+(col+.5)*dx;
          if(mx<bounds.left||mx>bounds.right||my<bounds.bottom||my>bounds.top)continue;
          const hav=dlat+cos*Math.sin((mx/R-clon)/2)**2;
          if(2*R*Math.asin(Math.sqrt(Math.min(1,hav)))>radius)continue;
          const i=(row*size+col)*4;
          output.data.set(COLOURS[higherAvailable(decodeRank(a,i),decodeRank(b,i))],i);
        }
      }
    }
    if(signal.aborted)throw aborted();
    ctx.putImageData(output,0,0);
    const data=await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
    if(signal.aborted)throw aborted();
    cache.set(key,data);while(cache.size>64)cache.delete(cache.keys().next().value);
    return {data:data.slice(0),cacheControl:'max-age=86400'};
  };
}
