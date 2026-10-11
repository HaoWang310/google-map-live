// Smooth display of the actual 50 m contributing-area values, on OSM's grid.
// Interpolation changes the appearance only; it creates no new hydrology data.
export const AREA_MIN_ZOOM=8,AREA_MAX_ZOOM=18,AREA_TILE_SIZE=512;
const R=6378137,HALF=Math.PI*R;
const MIN_AREA=.0025,MAX_AREA=8192;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function areaTileBounds(z,x,y){
  const n=2**z;
  if(!Number.isInteger(z)||z<AREA_MIN_ZOOM||z>AREA_MAX_ZOOM||
     !Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=n||y>=n){
    throw new Error('Invalid contributing-area tile');
  }
  const side=2*HALF/n;
  return [-HALF+x*side,HALF-(y+1)*side,-HALF+(x+1)*side,HALF-y*side];
}

export function cubicWeights(t){
  const t2=t*t,t3=t2*t;
  return [-.5*t+t2-.5*t3,1-2.5*t2+1.5*t3,.5*t+2*t2-1.5*t3,-.5*t2+.5*t3];
}

function palette(){
  const out=new Uint8ClampedArray(65536*4),span=Math.log(MAX_AREA/MIN_AREA);
  const start=Math.log(.025/MIN_AREA),solid=Math.log(.125/MIN_AREA);
  const strong=Math.log(1000/MIN_AREA);
  for(let code=1;code<65536;code++){
    const a=(code-1)/65534*span;
    const v=clamp((a-start)/(solid-start),0,1),visible=v*v*(3-2*v);
    const t=clamp((a-solid)/(strong-solid),0,1);
    let r,g,b,q;
    if(t<.4){q=t/.4;r=255;g=224+(153-224)*q;b=120*(1-q);}
    else if(t<.75){q=(t-.4)/.35;r=255+(239-255)*q;g=153+(68-153)*q;b=68*q;}
    else{q=(t-.75)/.25;r=239+(127-239)*q;g=68+(29-68)*q;b=g;}
    const i=code*4;out[i]=r;out[i+1]=g;out[i+2]=b;
    out[i+3]=(45+205*t**.72)*visible;
  }
  return out;
}
const COLOURS=palette();

// Exported pure renderer is also exercised against synthetic georeferenced data.
export async function renderAreaTile({field,width,height,bounds,center,radius,z,x,y,
                                     size=AREA_TILE_SIZE,cancelled=()=>false,
                                     pause=()=>new Promise(resolve=>setTimeout(resolve,0))}){
  const bbox=areaTileBounds(z,x,y),pixels=new Uint8ClampedArray(size*size*4);
  if(bbox[2]<=bounds.left||bbox[0]>=bounds.right||
     bbox[3]<=bounds.bottom||bbox[1]>=bounds.top)return pixels;
  if(field.length!==width*height)throw new Error('Contributing-area dimensions mismatch');
  const dx=(bbox[2]-bbox[0])/size,dy=(bbox[3]-bbox[1])/size;
  const scaleX=width/(bounds.right-bounds.left),scaleY=height/(bounds.top-bounds.bottom);
  const clat=center.lat*Math.PI/180,clon=center.lng*Math.PI/180;
  const columns=Array.from({length:size},(_,col)=>{
    const mx=bbox[0]+(col+.5)*dx,sx=(mx-bounds.left)*scaleX-.5;
    const base=Math.floor(sx);
    return {mx,sx,nx:clamp(Math.round(sx),0,width-1),weights:cubicWeights(sx-base),
            ix:[-1,0,1,2].map(k=>clamp(base+k,0,width-1))};
  });
  // A street tile contains only a few dozen source rows. Reuse the horizontal
  // pass instead of reading a 4×4 neighbourhood for every display pixel.
  const horizontalRows=new Map();
  function horizontal(y){
    y=clamp(y,0,height-1);
    if(horizontalRows.has(y))return horizontalRows.get(y);
    const values=new Float32Array(size),offset=y*width;
    for(let col=0;col<size;col++){
      const {ix,weights:w}=columns[col];
      values[col]=w[0]*(field[offset+ix[0]]||1)+w[1]*(field[offset+ix[1]]||1)+
                  w[2]*(field[offset+ix[2]]||1)+w[3]*(field[offset+ix[3]]||1);
    }
    horizontalRows.set(y,values);return values;
  }
  for(let row=0;row<size;row++){
    if(row%32===0){await pause();if(cancelled())throw new DOMException('Aborted','AbortError');}
    const my=bbox[3]-(row+.5)*dy;
    if(my<bounds.bottom||my>bounds.top)continue;
    const sy=(bounds.top-my)*scaleY-.5,baseY=Math.floor(sy),wy=cubicWeights(sy-baseY);
    const ny=clamp(Math.round(sy),0,height-1);
    const h0=horizontal(baseY-1),h1=horizontal(baseY),h2=horizontal(baseY+1),h3=horizontal(baseY+2);
    const y0=clamp(baseY,0,height-1)*width,y1=clamp(baseY+1,0,height-1)*width;
    const lat=2*Math.atan(Math.exp(my/R))-Math.PI/2;
    const dlat=Math.sin((lat-clat)/2)**2,cos=Math.cos(lat)*Math.cos(clat);
    for(let col=0;col<size;col++){
      const {mx,nx,ix}=columns[col];
      if(mx<bounds.left||mx>bounds.right)continue;
      const hav=dlat+cos*Math.sin((mx/R-clon)/2)**2;
      if(2*R*Math.asin(Math.sqrt(Math.min(1,hav)))>radius)continue;
      const nearest=field[ny*width+nx];
      if(!nearest)continue; // NoData is not a zero contributing area.
      const value=wy[0]*h0[col]+wy[1]*h1[col]+wy[2]*h2[col]+wy[3]*h3[col];
      const a=field[y0+ix[1]]||1,b=field[y0+ix[2]]||1,
            c=field[y1+ix[1]]||1,d=field[y1+ix[2]]||1;
      const lo=Math.min(a,b,c,d),hi=Math.max(a,b,c,d);
      // Cubic overshoot must not create stronger values than nearby source cells.
      const colour=clamp(Math.round(value),lo,hi)*4,index=(row*size+col)*4;
      pixels[index]=COLOURS[colour];pixels[index+1]=COLOURS[colour+1];
      pixels[index+2]=COLOURS[colour+2];pixels[index+3]=COLOURS[colour+3];
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
        if(!response.ok)throw new Error('汇水源数据加载失败（'+response.status+'）');
        bitmap=await createImageBitmap(await response.blob());
        const {width,height}=bitmap;
        if(width!==config.width||height!==config.height)throw new Error('汇水源数据尺寸不匹配');
        const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);
        const pixels=ctx.getImageData(0,0,width,height).data,field=new Uint16Array(width*height);
        for(let i=0;i<field.length;i++)field[i]=(pixels[i*4]<<8)|pixels[i*4+1];
        canvas.width=1;canvas.height=1;
        return {field,width,height};
      }finally{bitmap?.close();clearTimeout(timeout);}
    })().catch(error=>{fieldPromise=null;throw error;});
    return fieldPromise;
  };
  async function pump(){
    if(running)return;running=true;
    try{
      while(queue.length){
        const job=queue.shift(),{id,z,x,y}=job,key=z+'/'+x+'/'+y;activeId=id;
        try{
          if(cancelled.has(id))continue;
          let data=cache.get(key);
          if(data){cache.delete(key);cache.set(key,data);}
          else{
            const input=await source();if(cancelled.has(id))continue;
            const pixels=await renderAreaTile({...config,...input,z,x,y,cancelled:()=>cancelled.has(id)});
            if(cancelled.has(id))continue;
            const canvas=new OffscreenCanvas(AREA_TILE_SIZE,AREA_TILE_SIZE),ctx=canvas.getContext('2d');
            ctx.putImageData(new ImageData(pixels,AREA_TILE_SIZE,AREA_TILE_SIZE),0,0);
            data=await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
            if(cancelled.has(id))continue;
            cache.set(key,data);while(cache.size>64)cache.delete(cache.keys().next().value);
          }
          const copy=data.slice(0);postMessage({id,data:copy},[copy]);
        }catch(error){if(!cancelled.has(id))postMessage({id,error:error.message});}
        finally{cancelled.delete(id);activeId=null;}
      }
    }finally{running=false;}
  }
  globalThis.onmessage=({data})=>{
    if(data.type==='init'){config=data.config;return;}
    if(data.type==='cancel'){
      if(activeId===data.id||queue.some(job=>job.id===data.id))cancelled.add(data.id);
      return;
    }
    queue.push(data);pump();
  };
}
