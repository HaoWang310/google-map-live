export const TERRAIN_MIN_ZOOM=8;
export const TERRAIN_MAX_ZOOM=17;
export const TERRAIN_TILE_SIZE=256;

export function createTerrainLocalLoader(config){
  let worker=null,nextId=0;
  const pending=new Map();

  function start(){
    if(worker)return;
    worker=new Worker(new URL('./terrain_worker.js?v=3.15.0',import.meta.url),{type:'module'});
    worker.postMessage({type:'init',config});
    worker.onmessage=({data})=>{
      const request=pending.get(data.id);
      if(!request)return;
      pending.delete(data.id);
      request.cleanup();
      if(data.error)request.reject(new Error(data.error));
      else request.resolve({data:data.data,cacheControl:'max-age=31536000'});
    };
    worker.onerror=(event)=>{
      const error=new Error(event?.message||'本地地形瓦片加载失败');
      for(const request of pending.values()){
        request.cleanup();
        request.reject(error);
      }
      pending.clear();
      worker.terminate();
      worker=null;
    };
  }

  return (request,controller)=>{
    const match=/^ea-terrain-local:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if(!match)return Promise.reject(new Error('Invalid local terrain URL'));
    const signal=controller.signal;
    if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));

    start();
    const id=++nextId;
    const [z,x,y]=match.slice(1).map(Number);

    return new Promise((resolve,reject)=>{
      const cancel=()=>{
        pending.delete(id);
        worker?.postMessage({type:'cancel',id});
        cleanup();
        reject(new DOMException('Aborted','AbortError'));
      };
      const cleanup=()=>signal.removeEventListener('abort',cancel);
      pending.set(id,{resolve,reject,cleanup});
      signal.addEventListener('abort',cancel,{once:true});
      worker.postMessage({type:'tile',id,z,x,y});
    });
  };
}
