export function createLocalFloodSimulator(config){
  let worker=null;
  let nextRequestId=0;
  const pending=new Map();
  const callbacks={
    onFrame:config.onFrame||(()=>{}),
    onFlowField:config.onFlowField||(()=>{}),
    onStatus:config.onStatus||(()=>{}),
    onError:config.onError||(()=>{})
  };

  function ensureWorker(){
    if(worker)return;
    worker=new Worker(new URL('./local_flood_worker.js?v=3.23.2-english',import.meta.url),{type:'module'});
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
      if(data.type==='flow-field'){
        callbacks.onFlowField(data);
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
          request.reject(new Error(data.message||'Local flood simulation failed to start'));
        }else{
          callbacks.onError(new Error(data.message||'Local flood simulation failed'));
        }
      }
    };
    worker.onerror=event=>callbacks.onError(new Error(event?.message||'Local flood simulation Worker failed to load'));
    worker.postMessage({
      type:'init',
      demUrl:config.demUrl,
      demBounds:config.demBounds,
      demWidth:config.demWidth,
      demHeight:config.demHeight,
      demEncoding:config.demEncoding,
      drainageUrl:config.drainageUrl||null,
      riskMetaUrl:config.riskMetaUrl||null,
      riskTileUrls:config.riskTileUrls||null,
      depthMetaUrl:config.depthMetaUrl||null,
      depthTileUrls:config.depthTileUrls||null
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
    annualStep(params){ensureWorker();worker.postMessage({type:'annual-step',...params});},
    seekYear(params){ensureWorker();worker.postMessage({type:'seek-year',...params});},
    requestFlowField(){worker?.postMessage({type:'request-flow-field'});},
    pause(){worker?.postMessage({type:'pause'});},
    reset(silent=false){worker?.postMessage({type:'reset',silent:Boolean(silent)});},
    resetInitial(){worker?.postMessage({type:'reset-initial'});},
    setParams(params){worker?.postMessage({type:'params',params});},
    destroy(){
      for(const request of pending.values())request.reject(new Error('Simulation closed'));
      pending.clear();
      worker?.terminate();
      worker=null;
    }
  };
}
