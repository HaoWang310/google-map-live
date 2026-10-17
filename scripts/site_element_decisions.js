// Planning-only OSM feature keys and keep/remove/pending decisions.
// This module never modifies OSM or hydrology and contains no DOM dependencies.
const hash=input=>{
  let h=2166136261;
  for(let i=0;i<input.length;i++){
    h^=input.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0).toString(36);
};
export function sitePlanStorageKey(ring){
  // Canonicalise the ring start and traversal: a site re-opened after a
  // harmless vertex order change keeps its design decisions.
  const points=(ring||[]).map(p=>[Number(p[0]).toFixed(6),Number(p[1]).toFixed(6)].join(','));
  if(points.length>1&&points[0]===points.at(-1))points.pop();
  if(points.length<3)return null;
  const orders=[];
  for(const sequence of [points,[...points].reverse()]){
    for(let i=0;i<sequence.length;i++)
      orders.push([...sequence.slice(i),...sequence.slice(0,i)].join(';'));
  }
  orders.sort();
  return 'london-map-site-plan-v1:'+hash(orders[0]);
}
export function siteElementId(type,identity){
  if(!['road','park','green','building'].includes(type))throw new Error('Unknown OSM planning element');
  const raw=String(identity||'');
  if(!raw)throw new Error('OSM planning element identity missing');
  return type+':'+hash(raw)+':'+raw.length;
}
export function normalizeSiteDecisions(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const [key,status] of Object.entries(value)){
    if(typeof key==='string'&&key.length<160&&/^(road|park|green|building):[0-9a-z]+:[0-9]+$/.test(key)&&
       (status==='keep'||status==='remove'))result[key]=status;
  }
  return result;
}
export function siteDecisionLabel(status){
  return status==='keep'?'保留':status==='remove'?'移除 / 改造':'待定';
}
