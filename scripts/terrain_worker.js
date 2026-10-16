const WORLD_HALF=20037508.342789244;
let config=null;
let bitmapPromise=null;
const cancelled=new Set();

function tileBounds3857(z,x,y){
  const n=2**z;
  const span=(WORLD_HALF*2)/n;
  return {
    left:-WORLD_HALF+x*span,
    right:-WORLD_HALF+(x+1)*span,
    top:WORLD_HALF-y*span,
    bottom:WORLD_HALF-(y+1)*span
  };
}

async function loadBitmap(){
  if(!bitmapPromise){
    bitmapPromise=(async()=>{
      const response=await fetch(config.imageUrl,{cache:'force-cache'});
      if(!response.ok)throw new Error('Local terrain overview failed to load: HTTP '+response.status);
      const blob=await response.blob();
      return createImageBitmap(blob);
    })();
  }
  return bitmapPromise;
}

async function transparentTile(size){
  const canvas=new OffscreenCanvas(size,size);
  const blob=await canvas.convertToBlob({type:'image/png'});
  return blob.arrayBuffer();
}

async function renderTile(z,x,y){
  const size=config.tileSize||256;
  const source=config.bounds;
  const tile=tileBounds3857(z,x,y);

  const ix0=Math.max(tile.left,source.left);
  const ix1=Math.min(tile.right,source.right);
  const iyTop=Math.min(tile.top,source.top);
  const iyBottom=Math.max(tile.bottom,source.bottom);

  if(ix0>=ix1||iyBottom>=iyTop)return transparentTile(size);

  const bitmap=await loadBitmap();
  const canvas=new OffscreenCanvas(size,size);
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)throw new Error('This browser cannot render local terrain tiles');

  ctx.clearRect(0,0,size,size);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';

  const sourceW=source.right-source.left;
  const sourceH=source.top-source.bottom;
  const tileW=tile.right-tile.left;
  const tileH=tile.top-tile.bottom;

  const sx=(ix0-source.left)/sourceW*bitmap.width;
  const sy=(source.top-iyTop)/sourceH*bitmap.height;
  const sw=(ix1-ix0)/sourceW*bitmap.width;
  const sh=(iyTop-iyBottom)/sourceH*bitmap.height;

  const dx=(ix0-tile.left)/tileW*size;
  const dy=(tile.top-iyTop)/tileH*size;
  const dw=(ix1-ix0)/tileW*size;
  const dh=(iyTop-iyBottom)/tileH*size;

  ctx.drawImage(bitmap,sx,sy,sw,sh,dx,dy,dw,dh);
  const blob=await canvas.convertToBlob({type:'image/png'});
  return blob.arrayBuffer();
}

self.onmessage=async({data})=>{
  if(data.type==='init'){
    config=data.config;
    bitmapPromise=null;
    return;
  }
  if(data.type==='cancel'){
    cancelled.add(data.id);
    return;
  }
  if(data.type!=='tile'||!config)return;

  const {id,z,x,y}=data;
  try{
    const buffer=await renderTile(z,x,y);
    if(cancelled.delete(id))return;
    self.postMessage({id,data:buffer},[buffer]);
  }catch(error){
    if(cancelled.delete(id))return;
    self.postMessage({id,error:error?.message||String(error)});
  }
};
