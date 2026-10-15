// Readonly grid contract. No flood-model state or display controls live here.
export function sameHydroGrid(a,b){
  return Boolean(a&&b&&a.id===b.id&&a.crs==='EPSG:3857'&&b.crs===a.crs&&
    ['cols','rows','left','top','cellProjectedM','groundScale'].every(k=>a[k]===b[k]));
}
export function validHydroGrid(g,cols,rows){
  return Boolean(g&&g.crs==='EPSG:3857'&&g.cols===cols&&g.rows===rows&&g.id&&
    Number.isFinite(g.left)&&Number.isFinite(g.top)&&
    Number.isFinite(g.cellProjectedM)&&g.cellProjectedM>0&&
    Number.isFinite(g.groundScale)&&g.groundScale>0&&g.groundScale<=1);
}
export function gridRenderGeometry(g){
  return {nw:[g.left,g.top],dx:g.cellProjectedM,dy:g.cellProjectedM};
}
// Four independently inspectable GeoJSON collections in the unmodified app.
// Line segments are centered on actual solver cells, never display seeds.
export function tensorDiagnosticGeoJSON(result,stride=4){
  if(!result?.grid)return null;
  const {grid:g,cols,rows,fields:f}=result;
  const R=6378137;
  const geo=(x,y)=>[x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];
  const definitions={terrain:['basePrimaryX','basePrimaryY','baseConfidence'],
    drainage:['drainageX','drainageY','drainageConfidence'],
    primary:['primaryX','primaryY','confidence'],secondary:['secondaryX','secondaryY','confidence']};
  const out={grid:{...g},scenario:{...result.scenario},diagnostics:result.diagnostics};
  stride=Math.max(1,Math.floor(Number(stride)||4));
  for(const [name,[kx,ky,kc]] of Object.entries(definitions)){
    const features=[];
    for(let y=0;y<rows;y+=stride)for(let x=0;x<cols;x+=stride){
      const i=y*cols+x,ux=f[kx][i],uy=f[ky][i];
      if(!f.validMask[i]||Math.hypot(ux,uy)<.5)continue;
      const cx=g.left+(x+.5)*g.cellProjectedM,cy=g.top-(y+.5)*g.cellProjectedM;
      const half=g.cellProjectedM*.38;
      features.push({type:'Feature',properties:{cell:i,col:x,row:y,axis:name,
        confidence:f[kc][i],areaKm2:f.drainageAreaKm2[i],
        anisotropy:f.anisotropy?.[i]??null,continuity:f.directionContinuity?.[i]??null,
        dominantProcess:f.dominantProcess?.[i]??null,
        terrainWeight:f.terrainCueWeight?.[i]??null,drainageWeight:f.drainageCueWeight?.[i]??null,
        wetnessWeight:f.hydraulicCueWeight?.[i]??null,obstacleConstraint:f.obstacleConstraint?.[i]??null,
        semantics:name==='terrain'?'DEM downhill':name==='drainage'?
          'inferred accumulation-ridge tangent; unsigned; not D8':'symmetric tensor eigenaxis; unsigned'},
        geometry:{type:'LineString',coordinates:[geo(cx-ux*half,cy+uy*half),geo(cx+ux*half,cy-uy*half)]}});
    }
    out[name]={type:'FeatureCollection',features};
  }
  return out;
}
