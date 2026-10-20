// Planning-only raster constraints for the London hydrological tensor.
// Retained roads become axial guidance; retained building/green polygons
// are barriers to *design streamlines*, never to the flood solver.
const R=6378137,DEG=Math.PI/180;
const merc=p=>[R*p[0]*DEG,R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,p[1]))*DEG/2))];
const insideRing=(x,y,ring)=>{
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
      inside=!inside;
  }
  return inside;
};
const polygons=geometry=>geometry?.type==='Polygon'
  ?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
export function rasterizeSitePlanning(features,grid,cols,rows){
  const n=cols*rows,mask=new Uint8Array(n),roadX=new Float32Array(n),
    roadY=new Float32Array(n),roadWeight=new Float32Array(n);
  const step=Number(grid?.cellProjectedM),left=Number(grid?.left),top=Number(grid?.top);
  if(!Number.isInteger(cols)||!Number.isInteger(rows)||n<1||n>70000||
    !(step>0)||!Number.isFinite(left)||!Number.isFinite(top))
    throw new Error('Existing-site planning constraints do not match the hydrological grid');
  const checked=new Set();
  let retainedRoads=0,retainedAreas=0;
  for(const f of features||[]){
    const p=f?.properties||{};
    if(p.planDecision!=='keep'||!['road','park','green','building'].includes(p.elementType))continue;
    if(p.elementType==='road'&&p.part!=='surface')continue;
    const key=p.elementId||'';
    if(!key||checked.has(key)&&p.elementType!=='road')continue;
    checked.add(key);
    const road=p.elementType==='road';
    if(road)retainedRoads++;else retainedAreas++;
    const ax=Number(p.roadAxisX),ay=Number(p.roadAxisY);
    const norm=Math.hypot(ax,ay);
    for(const polygon of polygons(f.geometry)){
      if(!polygon?.[0]?.length)continue;
      const rings=polygon.map(r=>r.map(merc));
      const box=rings[0].reduce((b,xy)=>[
        Math.min(b[0],xy[0]),Math.min(b[1],xy[1]),
        Math.max(b[2],xy[0]),Math.max(b[3],xy[1])
      ],[Infinity,Infinity,-Infinity,-Infinity]);
      const x0=Math.max(0,Math.floor((box[0]-left)/step-.5));
      const x1=Math.min(cols-1,Math.ceil((box[2]-left)/step-.5));
      const y0=Math.max(0,Math.floor((top-box[3])/step-.5));
      const y1=Math.min(rows-1,Math.ceil((top-box[1])/step-.5));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const wx=left+(x+.5)*step,wy=top-(y+.5)*step;
        if(!insideRing(wx,wy,rings[0])||
           rings.slice(1).some(hole=>insideRing(wx,wy,hole)))continue;
        const i=y*cols+x;
        if(road){
          if(norm>0.1){
            const ux=ax/norm,uy=ay/norm;
            // Orientation is undirected, so use axial double angles to
            // combine intersecting retained roads without directional flips.
            roadX[i]+=ux*ux-uy*uy;
            roadY[i]+=2*ux*uy;
            roadWeight[i]+=1;
          }
        }else mask[i]=1;
      }
    }
  }
  return {mask,roadX,roadY,roadWeight,
    diagnostics:{retainedRoadSegments:retainedRoads,retainedAreas,
      constrainedCells:mask.reduce((s,v)=>s+(v?1:0),0),
      roadCells:roadWeight.reduce((s,v)=>s+(v>0?1:0),0)}};
}
