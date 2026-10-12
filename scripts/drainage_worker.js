// Dynamic threshold display of one authoritative 50 m Thames upstream-accumulation field.
// Hydrological truth: thresholding is always evaluated on RAW 50 m accumulation cells.
// Visual treatment: the binary drainage result is then resampled and feathered in screen space
// so the map reads as a continuous drainage corridor instead of blocky raster squares.
// v3.21.15 adds a max-area mip pyramid and adaptive overview rendering so broad pan/zoom
// views do not rescan the full 50 m field for every output pixel.
export const AREA_MIN_ZOOM=8,AREA_MAX_ZOOM=18,AREA_TILE_SIZE=512;
const R=6378137,HALF=Math.PI*R;
const MIN_AREA=.0025,MAX_AREA=20000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smoothstep=(a,b,v)=>{
  const t=clamp((v-a)/(b-a),0,1);
  return t*t*(3-2*t);
};

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

function buildMaxPyramid(field,width,height){
  const levels=[{field,width,height,scale:1}];
  let prev=levels[0];

  while(prev.width>1||prev.height>1){
    const nextWidth=Math.max(1,Math.ceil(prev.width/2));
    const nextHeight=Math.max(1,Math.ceil(prev.height/2));
    const nextField=new Uint16Array(nextWidth*nextHeight);

    for(let y=0;y<nextHeight;y++){
      const y0=y*2,y1=Math.min(prev.height-1,y0+1);
      for(let x=0;x<nextWidth;x++){
        const x0=x*2,x1=Math.min(prev.width-1,x0+1);
        const a=prev.field[y0*prev.width+x0];
        const b=prev.field[y0*prev.width+x1];
        const c=prev.field[y1*prev.width+x0];
        const d=prev.field[y1*prev.width+x1];
        nextField[y*nextWidth+x]=Math.max(a,b,c,d);
      }
    }

    prev={
      field:nextField,
      width:nextWidth,
      height:nextHeight,
      scale:levels[levels.length-1].scale*2
    };
    levels.push(prev);
  }

  return levels;
}

function chooseOverviewLevel(pyramid,cellsPerPixel){
  if(!pyramid?.length||cellsPerPixel<=1.05)return null;

  // Pick a level whose cell is slightly smaller than one output pixel.
  // Then each output pixel needs only a tiny (usually 2x2) max lookup instead of
  // scanning many raw 50 m cells.
  const target=Math.max(1,cellsPerPixel/1.35);
  let chosen=pyramid[0];
  for(const level of pyramid){
    if(level.scale<=target)chosen=level;
    else break;
  }
  return chosen;
}

function sampleOverviewMax(level,sx,sy,halfX,halfY){
  const scale=level.scale;
  const c0=clamp(Math.floor((sx-halfX)/scale),0,level.width-1);
  const c1=clamp(Math.ceil((sx+halfX)/scale),0,level.width-1);
  const r0=clamp(Math.floor((sy-halfY)/scale),0,level.height-1);
  const r1=clamp(Math.ceil((sy+halfY)/scale),0,level.height-1);

  let best=0;
  for(let rr=r0;rr<=r1;rr++){
    const offset=rr*level.width;
    for(let cc=c0;cc<=c1;cc++){
      const code=level.field[offset+cc];
      if(code>best)best=code;
    }
  }
  return best;
}

function networkColour(code){
  const a=decodeArea(code);
  if(a>=100)return [112,255,241,238];
  if(a>=25)return [0,224,230,234];
  if(a>=5)return [0,183,228,230];
  if(a>=1)return [35,152,255,226];
  return [75,169,255,218];
}

function insideRadius(mx,my,clat,clon,radius){
  const lat=2*Math.atan(Math.exp(my/R))-Math.PI/2;
  const dlat=Math.sin((lat-clat)/2)**2,cos=Math.cos(lat)*Math.cos(clat);
  const hav=dlat+cos*Math.sin((mx/R-clon)/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,hav)))<=radius;
}

function blur5(src,size){
  const tmp=new Float32Array(src.length);
  const out=new Float32Array(src.length);
  const w0=1/16,w1=4/16,w2=6/16;

  for(let y=0;y<size;y++){
    const row=y*size;
    for(let x=0;x<size;x++){
      const xm2=Math.max(0,x-2),xm1=Math.max(0,x-1);
      const xp1=Math.min(size-1,x+1),xp2=Math.min(size-1,x+2);
      tmp[row+x]=
        src[row+xm2]*w0+src[row+xm1]*w1+src[row+x]*w2+
        src[row+xp1]*w1+src[row+xp2]*w0;
    }
  }

  for(let y=0;y<size;y++){
    const ym2=Math.max(0,y-2),ym1=Math.max(0,y-1);
    const yp1=Math.min(size-1,y+1),yp2=Math.min(size-1,y+2);
    for(let x=0;x<size;x++){
      out[y*size+x]=
        tmp[ym2*size+x]*w0+tmp[ym1*size+x]*w1+tmp[y*size+x]*w2+
        tmp[yp1*size+x]*w1+tmp[yp2*size+x]*w0;
    }
  }
  return out;
}

function neighbourCode(codes,size,row,col){
  let best=codes[row*size+col];
  if(best)return best;
  for(let r=1;r<=2;r++){
    for(let oy=-r;oy<=r;oy++){
      const yy=row+oy;
      if(yy<0||yy>=size)continue;
      for(let ox=-r;ox<=r;ox++){
        const xx=col+ox;
        if(xx<0||xx>=size)continue;
        const code=codes[yy*size+xx];
        if(code>best)best=code;
      }
    }
    if(best)return best;
  }
  return 0;
}

async function renderNetworkTile({
  field,width,height,pyramid,bounds,center,radius,threshold,z,x,y,
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
  const cellsPerPixelX=dx*scaleX;
  const cellsPerPixelY=dy*scaleY;
  const cellsPerPixel=Math.max(cellsPerPixelX,cellsPerPixelY);
  const overviewLevel=chooseOverviewLevel(pyramid,cellsPerPixel);
  const clat=center.lat*Math.PI/180,clon=center.lng*Math.PI/180;

  const coverage=new Float32Array(size*size);
  const codes=new Uint16Array(size*size);

  // When one output pixel is smaller than one 50 m source cell, sample the RAW
  // threshold mask bilinearly. This removes square cell edges while preserving the
  // exact threshold decision made on the four surrounding source cells.
  // At overview scales (>1 source cell per output pixel), max-pool ONLY across the
  // true pixel footprint so a one-cell D8 path remains visible without artificial
  // multi-cell dilation.
  for(let row=0;row<size;row++){
    if(row%24===0){
      await pause();
      if(cancelled())throw new DOMException('Aborted','AbortError');
    }

    const my=bbox[3]-(row+.5)*dy;
    if(my<bounds.bottom||my>bounds.top)continue;
    const sy=(bounds.top-my)*scaleY-.5;

    for(let col=0;col<size;col++){
      const mx=bbox[0]+(col+.5)*dx;
      if(mx<bounds.left||mx>bounds.right||
         !insideRadius(mx,my,clat,clon,radius))continue;

      const i=row*size+col;
      const sx=(mx-bounds.left)*scaleX-.5;

      if(cellsPerPixel<=1.05){
        const x0=clamp(Math.floor(sx),0,width-1);
        const y0=clamp(Math.floor(sy),0,height-1);
        const x1=clamp(x0+1,0,width-1);
        const y1=clamp(y0+1,0,height-1);
        const tx=clamp(sx-Math.floor(sx),0,1);
        const ty=clamp(sy-Math.floor(sy),0,1);

        const c00=field[y0*width+x0],c10=field[y0*width+x1];
        const c01=field[y1*width+x0],c11=field[y1*width+x1];
        const a00=c00>=thresholdCode?1:0;
        const a10=c10>=thresholdCode?1:0;
        const a01=c01>=thresholdCode?1:0;
        const a11=c11>=thresholdCode?1:0;

        const top=a00*(1-tx)+a10*tx;
        const bottom=a01*(1-tx)+a11*tx;
        coverage[i]=top*(1-ty)+bottom*ty;

        let best=0;
        if(a00)best=Math.max(best,c00);
        if(a10)best=Math.max(best,c10);
        if(a01)best=Math.max(best,c01);
        if(a11)best=Math.max(best,c11);
        codes[i]=best;
      }else{
        const halfX=cellsPerPixelX*.5;
        const halfY=cellsPerPixelY*.5;

        const best=overviewLevel
          ?sampleOverviewMax(overviewLevel,sx,sy,halfX,halfY)
          :0;

        if(best>=thresholdCode){
          coverage[i]=1;
          codes[i]=best;
        }
      }
    }
  }

  // Screen-space feathering. Two gentle Gaussian passes are used only at close zoom,
  // one pass at overview zoom. Hydrological values and threshold membership are untouched.
  let feather=blur5(coverage,size);
  if(cellsPerPixel<0.55)feather=blur5(feather,size);

  for(let row=0;row<size;row++){
    if(row%48===0){
      await pause();
      if(cancelled())throw new DOMException('Aborted','AbortError');
    }
    for(let col=0;col<size;col++){
      const i=row*size+col;

      // Preserve a readable core while using the blurred field for soft edges.
      const visual=Math.max(coverage[i]*0.72,feather[i]);
      if(visual<0.015)continue;

      const code=neighbourCode(codes,size,row,col);
      if(!code)continue;

      const colour=networkColour(code);
      const edge=smoothstep(0.015,0.82,visual);
      const j=i*4;
      pixels[j]=colour[0];
      pixels[j+1]=colour[1];
      pixels[j+2]=colour[2];
      pixels[j+3]=Math.round(colour[3]*edge);
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

        // One-time max pyramid. Total memory is ~4/3 of the base Uint16 field and
        // dramatically reduces overview tile work at z8–z12.
        const pyramid=buildMaxPyramid(field,width,height);
        return {field,width,height,pyramid};
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

            // Overview tiles do not need 512 hydrology samples in both dimensions.
            // Render smaller at broad zooms, then upscale smoothly to the fixed 512 px
            // MapLibre tile. This cuts z8–z10 work by ~4x while keeping the same bounds.
            const renderSize=z<=10?256:(z<=12?384:AREA_TILE_SIZE);

            const pixels=await renderNetworkTile({
              ...config,...input,threshold,z,x,y,
              size:renderSize,
              cancelled:()=>cancelled.has(id)
            });
            if(cancelled.has(id))continue;

            const small=new OffscreenCanvas(renderSize,renderSize);
            small.getContext('2d').putImageData(
              new ImageData(pixels,renderSize,renderSize),0,0
            );

            const canvas=new OffscreenCanvas(AREA_TILE_SIZE,AREA_TILE_SIZE);
            const ctx=canvas.getContext('2d');
            ctx.imageSmoothingEnabled=true;
            ctx.imageSmoothingQuality='high';
            ctx.drawImage(small,0,0,AREA_TILE_SIZE,AREA_TILE_SIZE);

            data=await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
            if(cancelled.has(id))continue;

            cache.set(key,data);
            while(cache.size>160)cache.delete(cache.keys().next().value);
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
    // New viewport requests should not sit behind a long backlog from the previous
    // camera position. LIFO is intentional for interactive pan/zoom responsiveness.
    // Keep every request id: MapLibre owns cancellation and each protocol promise must
    // eventually resolve or reject.
    queue.unshift(data);
    pump();
  };
}
