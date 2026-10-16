/* London Map v3.22.76 · DISPLAY ONLY particle spatial balancing.
 * Never modifies eigenfield, drainage tensor, original streamline vertices
 * or GeoJSON line geometry. Spatial coordinates are visualization-only. */

/** Select trajectories round-robin across geographic cells, not source order.
 * @template T
 * @param {T[]} items candidate paths
 * @param {number} limit maximum selection
 * @param {(item:T)=>[number,number]} location path midpoint in lon/lat
 */
export function selectSpatialParticlePaths(items,limit,location){
  if(!Array.isArray(items)||!items.length||limit<=0)return [];
  if(items.length<=limit)return items.slice();
  const positions=items.map(item=>location(item));
  const valid=positions.filter(p=>p&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!valid.length)return items.slice(0,limit);
  const xs=valid.map(p=>p[0]),ys=valid.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const bins=8,buckets=Array.from({length:bins*bins},()=>[]);
  for(let i=0;i<items.length;i++){
    const p=positions[i];
    if(!p||!Number.isFinite(p[0])||!Number.isFinite(p[1]))continue;
    const cx=Math.min(bins-1,Math.max(0,Math.floor(
      (p[0]-minX)/Math.max(1e-10,maxX-minX)*bins)));
    const cy=Math.min(bins-1,Math.max(0,Math.floor(
      (p[1]-minY)/Math.max(1e-10,maxY-minY)*bins)));
    buckets[cy*bins+cx].push(items[i]);
  }
  const chosen=[],indices=new Uint32Array(buckets.length);
  // A pass draws one path from every occupied cell before revisiting dense
  // cells. This avoids source-order clustering even when lines are sorted.
  while(chosen.length<limit){
    let added=0;
    for(let k=0;k<buckets.length&&chosen.length<limit;k++){
      const group=buckets[k],idx=indices[k];
      if(idx<group.length){chosen.push(group[idx]);indices[k]++;added++;}
    }
    if(!added)break;
  }
  return chosen;
}

/** Suppress coincident luminous heads in screen space, preserving one visible
 * particle per proximity disk. Input is deterministic and priority-ordered.
 * This prevents overexposed edge clusters without moving a single particle
 * or changing its underlying flow path.
 */
export function thinVisibleParticles(features,project,minSpacingPx=13){
  if(!features?.length||typeof project!=='function')return features||[];
  const radius=Math.max(2,Number(minSpacingPx)||13);
  const radiusSq=radius*radius,grid=new Map(),chosen=[];
  for(const feature of features){
    let p;
    try{p=project(feature.geometry.coordinates)}catch{p=null}
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)){
      chosen.push(feature);continue;
    }
    const gx=Math.floor(p.x/radius),gy=Math.floor(p.y/radius);
    let crowd=false;
    for(let dx=-1;dx<=1&&!crowd;dx++)for(let dy=-1;dy<=1&&!crowd;dy++){
      const nearby=grid.get((gx+dx)+','+(gy+dy))||[];
      for(const q of nearby){
        if((q.x-p.x)**2+(q.y-p.y)**2<radiusSq){crowd=true;break}
      }
    }
    if(crowd)continue;
    const key=gx+','+gy;
    if(!grid.has(key))grid.set(key,[]);
    grid.get(key).push(p);
    chosen.push(feature);
  }
  return chosen;
}
