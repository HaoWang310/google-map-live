// The worker starts on first selection, and renders only requested map tiles.
export {AREA_MIN_ZOOM,AREA_MAX_ZOOM,AREA_TILE_SIZE} from './drainage_worker.js?v=3.15.1';

export function createDrainageDisplayLoader(config){
  let worker=null,nextId=0;
  const pending=new Map();
  function start(){
    if(worker)return;
    worker=new Worker(new URL('./drainage_worker.js?v=3.15.1',import.meta.url),{type:'module'});
    worker.postMessage({type:'init',config});
    worker.onmessage=({data})=>{
      const request=pending.get(data.id);if(!request)return;
      pending.delete(data.id);request.cleanup();
      if(data.error)request.reject(new Error(data.error));
      else request.resolve({data:data.data,cacheControl:'max-age=86400'});
    };
    worker.onerror=()=>{
      for(const request of pending.values()){request.cleanup();request.reject(new Error('汇水显示加载失败，请重新勾选图层'));}
      pending.clear();worker.terminate();worker=null;
    };
  }
  return (request,controller)=>{
    const match=/^drainage-area:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
    if(!match)return Promise.reject(new Error('Invalid contributing-area URL'));
    const signal=controller.signal;
    if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    start();const id=++nextId,[z,x,y]=match.slice(1).map(Number);
    return new Promise((resolve,reject)=>{
      const cancel=()=>{
        pending.delete(id);worker?.postMessage({type:'cancel',id});cleanup();
        reject(new DOMException('Aborted','AbortError'));
      };
      const cleanup=()=>signal.removeEventListener('abort',cancel);
      pending.set(id,{resolve,reject,cleanup});signal.addEventListener('abort',cancel,{once:true});
      worker.postMessage({id,z,x,y});
    });
  };
}
