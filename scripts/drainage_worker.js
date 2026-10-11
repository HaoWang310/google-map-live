// Dynamic threshold view of one authoritative 50 m Thames upstream-accumulation field.
// The encoded field is fetched once per Worker and reused for all threshold changes.
// No second drainage-network dataset and no visible contributing-area raster are created.
export const AREA_MIN_ZOOM=8,AREA_MAX_ZOOM=18,AREA_TILE_SIZE=512;
const R=6378137,HALF=Math.PI*R;
const MIN_AREA=.0025,MAX_AREA=20000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function areaTileBounds(z,x,y){
  const n=2**z;
  if(!Number.isInteger(z)||z<AREA_MIN_ZOOM||z>AREA_MAX_ZOOM||
     !Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=n||y>=n){
    throw new Error('Invalid drainage-network tile');
  }
  const side=2*HALF/n;
  return [-HALF+x*side,HALF-(y+1)*side,-HALF+(x+1)*side,HALF-y*side];
}

function cubicWeights(t){
  const t2=t*t,t3=t2*t,u=1-t;
  return [u*u*u/6,(3*t3-6*t2+4)/6,(-3*t3+3*t2+3*t+1)/6,t3/6];
}

function areaCode(km2){
  const ratio=Math.log(clamp(km2,MIN_AREA,MAX_AREA)/MIN_AREA)/Math.log(MAX_AREA/MIN_AREA);
  return 1+Math.round(ratio*65534);
}

function decodeArea(code){
  if(!code)return 0;
  return MIN_AREA*Math.exp((code-1)/65534*Math.log(MAX_AREA/MIN_AREA));
}

function networkColour(code){
  const a=decodeArea(code);
  if(a>=100)return [112,255,241,235];
  if(a>=25)return [0,224,230,230];
  if(a>=5)return [0,183,228,225];
  if(a>=1)return [35,152,255,220];
  return [75,169,255,210];
}

function sourceSampler({field,width,bounds,bbox,size}){
  const dx=(bbox[2]-bbox[0])/size,dy=(bbox[3]-bbox[1])/size;
  const scaleX=width/(bounds.right-bounds.left);
  const columns=Array.from({length:size},(_,col)=>{
    const mx=bbox[0]+(col+.5)*dx,sx=(mx-bounds.left)*scaleX-.5;
    const base=Math.floor(sx);
    return {
      mx,
      nx:clamp(Math.round(sx),0,width-1),
      weights:cubicWeights(sx-base),
      ix:[-1,0,1,2].map(k=>clamp(base+k,0,width-1))
    };
  });
  const horizontalRows=new Map();
  function horizontal(y){
    y=clamp(y,0,configHeight-1);
    if(horizontalRows.has(y))return horizontalRows.get(y);
    const values=new Float32Array(size),offset=y*width;
    for(let col=0;col<size;col++){
      const {ix,weights:w}=columns[col];
      values[col]=w[0]*(field[offset+ix[0]]||1)+w[1]*(field[offset+ix[1]]||1)+
                  w[2]*(field[offset+ix[2]]||1)+w[3]*(field[offset+ix[3]]||1);
    }
    horizontalRows.set(y,values);
    return values;
  }
  return {dy,columns,horizontal};
}

let configHeight=0;

function insideRadius(mx,my,clat,clon,radius){
  const lat=2*Math.atan(Math.exp(my/R))-Math.PI/2;
  const dlat=Math.sin((lat-clat)/2)**2,cos=Math.cos(lat)*Math.cos(clat);
  const hav=dlat+cos*Math.sin((mx/R-clon)/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,hav)))<=radius;
}

async function renderNetworkTile({field,width,height,bounds,center,radius,threshold,z,x,y,
                                  size=AREA_TILE_SIZE,cancelled=()=>false,
                                  pause=()=>new Promise(resolve=>setTimeout(resolve,0))}){
  configHeight=height;
  const bbox=areaTileBounds(z,x,y),pixels=new Uint8ClampedArray(size*size*4);
  if(bbox[2]<=bounds.left||bbox[0]>=bounds.right||
     bbox[3]<=bounds.bottom||bbox[1]>=bounds.top)return pixels;
  if(field.length!==width*height)throw new Error('Drainage-network dimensions mismatch');

  const thresholdCode=areaCode(threshold);
  const {dy,columns,horizontal}=sourceSampler({field,width,bounds,bbox,size});
  const scaleY=height/(bounds.top-bounds.bottom);
  const clat=center.lat*Math.PI/180,clon=center.lng*Math.PI/180;

  for(let row=0;row<size;row++){
    if(row%32===0){
      await pause();
      if(cancelled())throw new DOMException('Aborted','AbortError');
    }
    const my=bbox[3]-(row+.5)*dy;
    if(my<bounds.bottom||my>bounds.top)continue;

    const sy=(bounds.top-my)*scaleY-.5,baseY=Math.floor(sy),wy=cubicWeights(sy-baseY);
    const ny=clamp(Math.round(sy),0,height-1);
    const h0=horizontal(baseY-1),h1=horizontal(baseY),h2=horizontal(baseY+1),h3=horizontal(baseY+2);
    const y0=clamp(baseY,0,height-1)*width,y1=clamp(baseY+1,0,height-1)*width;

    for(let col=0;col<size;col++){
      const {mx,nx,ix}=columns[col];
      if(mx<bounds.left||mx>bounds.right||!insideRadius(mx,my,clat,clon,radius))continue;

      const nearest=field[ny*width+nx];
      if(!nearest)continue;

      const value=wy[0]*h0[col]+wy[1]*h1[col]+wy[2]*h2[col]+wy[3]*h3[col];
      const a=field[y0+ix[1]]||1,b=field[y0+ix[2]]||1,
            c=field[y1+ix[1]]||1,d=field[y1+ix[2]]||1;
      const code=clamp(Math.round(value),Math.min(a,b,c,d),Math.max(a,b,c,d));
      if(code<thresholdCode)continue;

      const colour=networkColour(code),index=(row*size+col)*4;
      pixels[index]=colour[0];
      pixels[index+1]=colour[1];
      pixels[index+2]=colour[2];
      pixels[index+3]=colour[3];
    }
  }
  return pixels;
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  let config,fieldPromise,running=false,activeId=null;
  const queue=[],cancelled=new Set(),cache=new Map();

  const source=()=>{
    if(!fieldPromise)fieldPromise=(async()=>{
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
      let bitmap;
      try{
        const response=await fetch(config.sourceUrl,{cache:'force-cache',signal:controller.signal});
        if(!response.ok)throw new Error('50 m 汇水源数据加载失败（'+response.status+'）');
        bitmap=await createImageBitmap(await response.blob());
        const {width,height}=bitmap;
        if(width!==config.width||height!==config.height)throw new Error('汇水源数据尺寸不匹配');

        const canvas=new OffscreenCanvas(width,height);
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);
        const pixels=ctx.getImageData(0,0,width,height).data;
        const field=new Uint16Array(width*height);
        for(let i=0;i<field.length;i++)field[i]=(pixels[i*4]<<8)|pixels[i*4+1];
        canvas.width=1;canvas.height=1;
        return {field,width,height};
      }finally{
        bitmap?.close();
        clearTimeout(timeout);
      }
    })().catch(error=>{fieldPromise=null;throw error;});
    return fieldPromise;
  };

  async function pump(){
    if(running)return;
    running=true;
    try{
      while(queue.length){
        const job=queue.shift(),{id,threshold,z,x,y}=job;
        const key=Number(threshold).toPrecision(6)+'/'+z+'/'+x+'/'+y;
        activeId=id;
        try{
          if(cancelled.has(id))continue;
          let data=cache.get(key);
          if(data){
            cache.delete(key);
            cache.set(key,data);
          }else{
            const input=await source();
            if(cancelled.has(id))continue;
            const pixels=await renderNetworkTile({
              ...config,...input,threshold,z,x,y,
              cancelled:()=>cancelled.has(id)
            });
            if(cancelled.has(id))continue;

            const canvas=new OffscreenCanvas(AREA_TILE_SIZE,AREA_TILE_SIZE);
            canvas.getContext('2d').putImageData(
              new ImageData(pixels,AREA_TILE_SIZE,AREA_TILE_SIZE),0,0
            );
            data=await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
            if(cancelled.has(id))continue;

            cache.set(key,data);
            while(cache.size>96)cache.delete(cache.keys().next().value);
          }
          const copy=data.slice(0);
          postMessage({id,data:copy},[copy]);
        }catch(error){
          if(!cancelled.has(id))postMessage({id,error:error.message});
        }finally{
          cancelled.delete(id);
          activeId=null;
        }
      }
    }finally{
      running=false;
    }
  }

  globalThis.onmessage=({data})=>{
    if(data.type==='init'){config=data.config;return;}
    if(data.type==='cancel'){
      if(activeId===data.id||queue.some(job=>job.id===data.id))cancelled.add(data.id);
      return;
    }
    queue.push(data);
    pump();
  };
}
