// Dynamic terrain-derived drainage-network protocol.
// A single Worker loads/decodes the shared 50 m Thames accumulation raster once.
// There is no separate visible contributing-area layer and no independent network dataset.
export {AREA_MIN_ZOOM,AREA_MAX_ZOOM,AREA_TILE_SIZE} from './drainage_worker.js?v=3.23.2-english';

export function createDrainageDisplayLoader(config){
  let worker=null,nextId=0;
  const pending=new Map();

  function start(){
    if(worker)return;
    worker=new Worker(new URL('./drainage_worker.js?v=3.23.2-english',import.meta.url),{type:'module'});
    worker.postMessage({type:'init',config});
    worker.onmessage=({data})=>{
      const request=pending.get(data.id);
      if(!request)return;
      pending.delete(data.id);
      request.cleanup();
      if(data.error)request.reject(new Error(data.error));
      else request.resolve({data:data.data,cacheControl:'max-age=86400'});
    };
    worker.onerror=()=>{
      for(const request of pending.values()){
        request.cleanup();
        request.reject(new Error('Drainage network Worker failed to load; tick the layer again'));
      }
      pending.clear();
      worker.terminate();
      worker=null;
    };
  }

  return (request,controller)=>{
    const match=/^drainage-network:\/\/tiles\/([0-9.]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if(!match)return Promise.reject(new Error('Invalid drainage-network URL'));

    const threshold=Number(match[1]);
    const [z,x,y]=match.slice(2).map(Number);
    if(!Number.isFinite(threshold)||threshold<0)return Promise.reject(new Error('Invalid drainage threshold'));

    const signal=controller.signal;
    if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));

    start();
    const id=++nextId;
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
      worker.postMessage({id,threshold,z,x,y});
    });
  };
}
