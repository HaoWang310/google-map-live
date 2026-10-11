// Explicit searches only: no autocomplete, one request per second, session cache.
const SEARCH_ENDPOINT='https://nominatim.openstreetmap.org/search';
const MAX_LATITUDE=85.0511287798066;

export function readPlace(row){
  if(!row||typeof row.lat!=='string'||typeof row.lon!=='string')return null;
  const lat=Number(row.lat),lng=Number(row.lon);
  if(!row.lat.trim()||!row.lon.trim()||!Number.isFinite(lat)||!Number.isFinite(lng)||
     Math.abs(lat)>MAX_LATITUDE||Math.abs(lng)>180)return null;
  let bounds=null;
  if(Array.isArray(row.boundingbox)&&row.boundingbox.length===4){
    // Nominatim: south,north,west,east. MapLibre: [west,south],[east,north].
    const [south,north,west,east]=row.boundingbox.map(Number);
    if([south,north,west,east].every(Number.isFinite)&&south<=north&&west<=east&&
       south>=-MAX_LATITUDE&&north<=MAX_LATITUDE&&west>=-180&&east<=180&&
       lat>=south&&lat<=north&&lng>=west&&lng<=east){
      bounds=[[west,south],[east,north]];
    }
  }
  return {lat,lng,bounds,name:String(row.display_name||row.name||'搜索地点')};
}

function wait(ms,signal){
  return new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
    if(signal.aborted){cancel();return;}
    signal.addEventListener('abort',cancel,{once:true});
  });
}

export function createPlaceSearch(){
  const cache=new Map();
  let lastStarted=0;
  return async(query,{signal,viewbox}={})=>{
    const q=query.trim().replace(/\s+/g,' ');
    if(!q)throw new Error('请输入地点名称、地址或邮编');
    if(!signal)signal=new AbortController().signal;
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const key=q.toLocaleLowerCase();
    if(cache.has(key))return cache.get(key);
    // Recheck after waiting, including when a newer search cancels an older one.
    while(Date.now()-lastStarted<1100)await wait(1100-(Date.now()-lastStarted),signal);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    lastStarted=Date.now();
    const params=new URLSearchParams({q,format:'jsonv2',limit:'5','accept-language':'zh-CN,en'});
    if(Array.isArray(viewbox)&&viewbox.length===4&&viewbox.every(Number.isFinite)&&
       viewbox[0]>=-180&&viewbox[2]<=180&&viewbox[0]<viewbox[2]&&
       viewbox[3]>=-90&&viewbox[1]<=90&&viewbox[3]<viewbox[1]){
      params.set('viewbox',viewbox.join(','));params.set('bounded','0');
    }
    const response=await fetch(SEARCH_ENDPOINT+'?'+params,{
      signal,referrerPolicy:'strict-origin-when-cross-origin'
    });
    if(!response.ok)throw new Error('搜索服务暂不可用（'+response.status+'），请稍后重试');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('搜索服务返回格式不正确');
    const places=rows.map(readPlace).filter(Boolean).slice(0,5);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    cache.set(key,places);while(cache.size>30)cache.delete(cache.keys().next().value);
    return places;
  };
}
