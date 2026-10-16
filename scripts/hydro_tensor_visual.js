/* London Map tensor display palette, v3.22.65.
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
    color:mixTensorColor(HYDRO_TENSOR_PALETTE.flowBlue,
      HYDRO_TENSOR_PALETTE.lavender,.35+.6*strength),
    opacity:.25+.20*strength,glowFactor:.22+.20*strength
  };
  const cold= mixTensorColor(HYDRO_TENSOR_PALETTE.flowBlue,
    HYDRO_TENSOR_PALETTE.iceBlue,.22+.72*strength);
  const veryBright=clamp01((strength-.80)/.20);
  return {
    color:mixTensorColor(cold,HYDRO_TENSOR_PALETTE.iceWhite,.28*veryBright),
    opacity:.23+.44*strength,glowFactor:.25+.40*strength
  };
}
export function ribbonTensorMaterial({hierarchy='tributary',rank=0}={}){
  const strength=clamp01(rank),trunk=hierarchy==='trunk';
  // An occasional pink highlight belongs to a high-rank network strand,
  // not a velocity/depth scale. Core palette gradient is separate below.
  const pink=trunk&&strength>.90?clamp01((strength-.90)/.10)*.22:0;
  return {
    color:mixTensorColor(
      mixTensorColor(HYDRO_TENSOR_PALETTE.iceBlue,
        HYDRO_TENSOR_PALETTE.lavender,trunk?.62:.26),
      HYDRO_TENSOR_PALETTE.softPink,pink),
    opacity:trunk?.77:.56,glowFactor:trunk?.95:.56
  };
}
// MapLibre line-gradient works with the EXISTING ribbon source lineMetrics:true.
// This is a silk-like colour transition along the computed curve, NOT flow speed.
export const HYDRO_TENSOR_RIBBON_GRADIENT=Object.freeze([
  'interpolate',['linear'],['line-progress'],
  0,'#E3F4FF',
  .19,'#9DDCFF',
  .47,'#518DCE',
  .79,'#A9D9FA',
  .92,'#A9D9FA',
  .955,'rgba(237, 189, 249, 0.38)',
  1,'#A9D9FA'
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
