export function createLocalFloodSimulator(config){
  let worker=null;
  let nextRequestId=0;
  const pending=new Map();
  const callbacks={
    onFrame:config.onFrame||(()=>{}),
    onStatus:config.onStatus||(()=>{}),
    onError:config.onError||(()=>{})
  };

  function ensureWorker(){
    if(worker)return;
    worker=new Worker(new URL('./local_flood_worker.js?v=3.21.85',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      if(data.type==='setup-complete'){
        const request=pending.get(data.requestId);
        if(request){pending.delete(data.requestId);request.resolve(data);}
        return;
      }
      if(data.type==='frame'){
        callbacks.onFrame(data);
        return;
      }
      if(data.type==='status'){
        callbacks.onStatus(data);
        return;
      }
      if(data.type==='error'){
        if(data.requestId&&pending.has(data.requestId)){
          const request=pending.get(data.requestId);
          pending.delete(data.requestId);
          request.reject(new Error(data.message||'局部洪涝模拟初始化失败'));
        }else{
          callbacks.onError(new Error(data.message||'局部洪涝模拟失败'));
        }
      }
    };
    worker.onerror=event=>callbacks.onError(new Error(event?.message||'局部洪涝模拟 Worker 加载失败'));
    worker.postMessage({
      type:'init',
      demUrl:config.demUrl,
      demBounds:config.demBounds,
      demWidth:config.demWidth,
      demHeight:config.demHeight,
      demEncoding:config.demEncoding,
      drainageUrl:config.drainageUrl||null
    });
  }

  return {
    async setup(payload){
      ensureWorker();
      const requestId=++nextRequestId;
      return new Promise((resolve,reject)=>{
        pending.set(requestId,{resolve,reject});
        worker.postMessage({type:'setup',requestId,...payload});
      });
    },
    start(params){ensureWorker();worker.postMessage({type:'start',params});},
    pause(){worker?.postMessage({type:'pause'});},
    reset(){worker?.postMessage({type:'reset'});},
    setParams(params){worker?.postMessage({type:'params',params});},
    destroy(){
      for(const request of pending.values())request.reject(new Error('模拟已关闭'));
      pending.clear();
      worker?.terminate();
      worker=null;
    }
  };
}
