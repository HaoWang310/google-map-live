// Dynamic threshold display of one authoritative 50 m Thames upstream-accumulation field.
// IMPORTANT: the network threshold is applied to RAW 50 m accumulation cells BEFORE
// any display resampling. This preserves one-cell-wide D8 flow paths.
// At low zoom, max-pooling keeps narrow channels visible; a 1 px display dilation improves
// legibility only and does not change the underlying hydrology or threshold.
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
  if(a>=100)return [112,255,241,245];
  if(a>=25)return [0,224,230,242];
  if(a>=5)return [0,183,228,238];
  if(a>=1)return [35,152,255,235];
  return [75,169,255,228];
}

function insideRadius(mx,my,clat,clon,radius){
  const lat=2*Math.atan(Math.exp(my/R))-Math.PI/2;
  const dlat=Math.sin((lat-clat)/2)**2,cos=Math.cos(lat)*Math.cos(clat);
  const hav=dlat+cos*Math.sin((mx/R-clon)/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,hav)))<=radius;
}

async function renderNetworkTile({
  field,width,height,bounds,center,radius,threshold,z,x,y,
  size=AREA_TILE_SIZE,cancelled=()=>false,
  pause=()=>new Promise(resolve=>setTimeout(resolve,0))
}){
  const bbox=areaTileBounds(z,x,y);
  const pixels=new Uint8ClampedArray(size*size*4);
  if(bbox[2]<=bounds.left||bbox[0]>=bounds.right||
     bbox[3]<=bounds.bottom||bbox[1]>=bounds.top)return pixels;
  if(field.length!==width*height)throw new Error('Drainage-network dimensions mismatch');

  const thresholdCode=areaCode(threshold);
  const dx=(bbox[2]-bbox[0])/size;
  const dy=(bbox[3]-bbox[1])/size;
  const scaleX=width/(bounds.right-bounds.left);
  const scaleY=height/(bounds.top-bounds.bottom);
  const clat=center.lat*Math.PI/180,clon=center.lng*Math.PI/180;

  // Source-cell footprint of one output pixel. At small scales we take the maximum
  // raw contributing-area code within that footprint, so a 50 m D8 channel cannot
  // vanish simply because it falls between output pixel centres.
  const rx=Math.max(.55,dx*scaleX*.55);
  const ry=Math.max(.55,dy*scaleY*.55);

  const xRanges=Array.from({length:size},(_,col)=>{
    const mx=bbox[0]+(col+.5)*dx;
    const sx=(mx-bounds.left)*scaleX-.5;
    return {
      mx,
      c0:clamp(Math.floor(sx-rx),0,width-1),
      c1:clamp(Math.ceil(sx+rx),0,width-1)
    };
  });

  // First pass: exact threshold on raw encoded source values + max-pool display.
  const mask=new Uint8Array(size*size);
  const maxCodes=new Uint16Array(size*size);

  for(let row=0;row<size;row++){
    if(row%24===0){
      await pause();
      if(cancelled())throw new DOMException('Aborted','AbortError');
    }

    const my=bbox[3]-(row+.5)*dy;
    if(my<bounds.bottom||my>bounds.top)continue;

    const sy=(bounds.top-my)*scaleY-.5;
    const r0=clamp(Math.floor(sy-ry),0,height-1);
    const r1=clamp(Math.ceil(sy+ry),0,height-1);

    for(let col=0;col<size;col++){
      const {mx,c0,c1}=xRanges[col];
      if(mx<bounds.left||mx>bounds.right||
         !insideRadius(mx,my,clat,clon,radius))continue;

      let maxCode=0;
      for(let rr=r0;rr<=r1;rr++){
        const offset=rr*width;
        for(let cc=c0;cc<=c1;cc++){
          const code=field[offset+cc];
          if(code>maxCode)maxCode=code;
        }
      }
      if(maxCode>=thresholdCode){
        const i=row*size+col;
        mask[i]=1;
        maxCodes[i]=maxCode;
      }
    }
  }

  // Second pass: 1 CSS-pixel visual dilation. This is intentionally display-only:
  // the threshold is already evaluated on the raw 50 m cells above.
  const DISPLAY_RADIUS=1;
  for(let row=0;row<size;row++){
    if(row%48===0){
      await pause();
      if(cancelled())throw new DOMException('Aborted','AbortError');
    }
    for(let col=0;col<size;col++){
      const i=row*size+col;
      if(!mask[i])continue;
      const code=maxCodes[i];
      const colour=networkColour(code);
      for(let oy=-DISPLAY_RADIUS;oy<=DISPLAY_RADIUS;oy++){
        const yy=row+oy;
        if(yy<0||yy>=size)continue;
        for(let ox=-DISPLAY_RADIUS;ox<=DISPLAY_RADIUS;ox++){
          const xx=col+ox;
          if(xx<0||xx>=size)continue;
          if(ox*ox+oy*oy>DISPLAY_RADIUS*DISPLAY_RADIUS+0.01)continue;
          const j=(yy*size+xx)*4;
          // Keep the stronger upstream class if multiple paths overlap.
          if(pixels[j+3] && maxCodes[yy*size+xx]>code)continue;
          pixels[j]=colour[0];
          pixels[j+1]=colour[1];
          pixels[j+2]=colour[2];
          pixels[j+3]=Math.max(pixels[j+3],colour[3]);
        }
      }
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
        const rgba=ctx.getImageData(0,0,width,height).data;
        const field=new Uint16Array(width*height);
        for(let i=0;i<field.length;i++)field[i]=(rgba[i*4]<<8)|rgba[i*4+1];
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
