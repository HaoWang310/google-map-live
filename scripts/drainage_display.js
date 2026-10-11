// Shared protocol loader for both hydrology layers.
// Both protocols are served by one Worker instance, so the encoded 50 m accumulation
// field is fetched/decoded once and reused for area rendering and thresholded networks.
export {AREA_MIN_ZOOM,AREA_MAX_ZOOM,AREA_TILE_SIZE} from './drainage_worker.js?v=3.16.1';

export function createDrainageDisplayLoader(config){
  let worker=null,nextId=0;
  const pending=new Map();

  function start(){
    if(worker)return;
    worker=new Worker(new URL('./drainage_worker.js?v=3.16.1',import.meta.url),{type:'module'});
    worker.postMessage({type:'init',config});
    worker.onmessage=({data})=>{
      const request=pending.get(data.id);if(!request)return;
      pending.delete(data.id);request.cleanup();
      if(data.error)request.reject(new Error(data.error));
      else request.resolve({data:data.data,cacheControl:'max-age=86400'});
    };
    worker.onerror=()=>{
      for(const request of pending.values()){
        request.cleanup();request.reject(new Error('共享水文显示 Worker 加载失败，请重新勾选图层'));
      }
      pending.clear();worker.terminate();worker=null;
    };
  }

  return (request,controller)=>{
    let mode,threshold=0,z,x,y;
    let match=/^drainage-area:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if(match){
      mode='area';[z,x,y]=match.slice(1).map(Number);
    }else{
      match=/^drainage-network:\/\/tiles\/([0-9.]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
      if(!match)return Promise.reject(new Error('Invalid hydrology URL'));
      mode='network';threshold=Number(match[1]);[z,x,y]=match.slice(2).map(Number);
      if(!(threshold>0))return Promise.reject(new Error('Invalid drainage threshold'));
    }

    const signal=controller.signal;
    if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    start();
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const cancel=()=>{
        pending.delete(id);worker?.postMessage({type:'cancel',id});cleanup();
        reject(new DOMException('Aborted','AbortError'));
      };
      const cleanup=()=>signal.removeEventListener('abort',cancel);
      pending.set(id,{resolve,reject,cleanup});
      signal.addEventListener('abort',cancel,{once:true});
      worker.postMessage({id,mode,threshold,z,x,y});
    });
  };
}
