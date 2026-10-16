/* London Map tensor display palette, v3.22.67.
 * VISUAL MATERIALS ONLY. Do not use these values for flood depth, solver
 * weights, tensor directions, particle speed or engineering thresholds. */
export const HYDRO_TENSOR_PALETTE=Object.freeze({
  iceWhite:'#E3F4FF',
  iceBlue:'#9DDCFF',
  flowBlue:'#518DCE',
  lavender:'#A9D9FA',
  softPink:'#EDBDF9'
});
const clamp01=n=>Math.max(0,Math.min(1,Number(n)||0));
export function mixTensorColor(a,b,weight){
  const t=clamp01(weight);
  const from=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16));
  const to=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16));
  return '#'+from.map((v,i)=>Math.round(v+(to[i]-v)*t)
    .toString(16).padStart(2,'0')).join('').toUpperCase();
}
// Vary only *appearance* using already computed line metadata. 'rank' and
// 'wetSupport' remain exactly as delivered by the existing geometry Worker.
export function baseTensorMaterial({branch='primary',rank=0,wetSupport=0}={}){
  const strength=clamp01(.60*clamp01(rank)+.40*clamp01(wetSupport));
  if(branch==='secondary')return {
    // Pink-violet is a true separate visual family, not a pale-blue blend.
    color:mixTensorColor(HYDRO_TENSOR_PALETTE.lavender,
      HYDRO_TENSOR_PALETTE.softPink,.84+.14*strength),
    opacity:.66+.17*strength,glowFactor:.28+.17*strength
  };
  return {
    // Keep the primary family visibly BLUE, even at high rank.
    // Do not mix toward iceWhite here: that previously washed both axes out.
    color:mixTensorColor(HYDRO_TENSOR_PALETTE.flowBlue,
      HYDRO_TENSOR_PALETTE.iceBlue,.15+.64*strength),
    opacity:.68+.16*strength,glowFactor:.42+.22*strength
  };
}
export function ribbonTensorMaterial({hierarchy='tributary',rank=0}={}){
  const strength=clamp01(rank),trunk=hierarchy==='trunk';
  return {
    color:trunk?
      mixTensorColor(HYDRO_TENSOR_PALETTE.iceBlue,
        HYDRO_TENSOR_PALETTE.iceWhite,.54+.30*strength):
      mixTensorColor(HYDRO_TENSOR_PALETTE.flowBlue,
        HYDRO_TENSOR_PALETTE.lavender,.30+.17*strength),
    opacity:trunk?.90:.79,glowFactor:trunk?.86:.48
  };
}
// MapLibre line-gradient works with the EXISTING ribbon source lineMetrics:true.
// This is a silk-like colour transition along the computed curve, NOT flow speed.
export const HYDRO_TENSOR_RIBBON_GRADIENT=Object.freeze([
  'interpolate',['linear'],['line-progress'],
  0,'#518DCE',
  .16,'#9DDCFF',
  .35,'#E3F4FF',
  .53,'#EDBDF9',
  .72,'#A9D9FA',
  .88,'#518DCE',
  1,'#E3F4FF'
]);
export function particleTensorMaterial({index=0,main=false,rank=0}={}){
  const palette=HYDRO_TENSOR_PALETTE;
  const rarePink=main&&rank>.85&&index%31===0;
  return {
    color:rarePink?palette.softPink:
      index%5===0?palette.iceWhite:index%3===0?palette.lavender:palette.iceBlue,
    radius:main?.90+clamp01(rank)*.40:.62+clamp01(rank)*.30
  };
}

// Presentation-only gradual reveal. MapLibre evaluates this against a stable
// GeoJSON source in the renderer; no vertices are sliced or re-uploaded per
// animation frame. Feature property revealOrder is visual draw order only.
export function tensorRevealGate(progress){
  const f=clamp01(progress);
  if(f<=.0001)return 0;
  if(f>=.999)return 1;
  const start=Math.max(0,f-.065),end=Math.min(1,f+.02);
  return ['interpolate',['linear'],['get','revealOrder'],
    start,1,end,0];
}
