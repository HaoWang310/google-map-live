// Render-only, wet-cell-preserving depth prefilter for 2D and 3D flood water.
// Input is the solver's unchanged Uint16Array of millimetres. Output is metres.
// The 3x3 binomial kernel approximates Gaussian sigma ~0.85 native grid cells.
// Dry cells and invalid cells NEVER receive water during filtering.
export function smoothWetDepths(depthMm,width,height,validMask=null,thresholdMm=1){
  const count=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
     depthMm.length!==count||(validMask&&validMask.length!==count)){
    throw new Error('水面显示插值：网格尺寸或掩膜不匹配');
  }
  const wet=new Uint8Array(count);
  const metres=new Float32Array(count);
  const minimum=Math.max(1,Number(thresholdMm)||1);
  for(let i=0;i<count;i++){
    if((!validMask||validMask[i])&&depthMm[i]>=minimum){
      wet[i]=1;
      metres[i]=depthMm[i]/1000;
    }
  }
  const out=new Float32Array(count);
  const kernel=[1,2,1];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(!wet[i])continue;
    let total=0,weight=0;
    for(let oy=-1;oy<=1;oy++){
      const yy=y+oy;
      if(yy<0||yy>=height)continue;
      for(let ox=-1;ox<=1;ox++){
        const xx=x+ox;
        if(xx<0||xx>=width)continue;
        const j=yy*width+xx;
        if(!wet[j])continue;
        const w=kernel[ox+1]*kernel[oy+1];
        total+=metres[j]*w;
        weight+=w;
      }
    }
    // Preserve the centre sample for channel structure and readable peaks.
    // The Gaussian is visual-only and never modifies flooded-cell topology.
    out[i]=0.30*metres[i]+0.70*(total/Math.max(weight,1));
  }
  return out;
}
