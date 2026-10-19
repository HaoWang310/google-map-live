/* Regression for v3.28.0 STEP04 presentation disappearing over sparse
   analysis-supported cells. Synthetic fixture only; not a London validation. */
import assert from 'node:assert/strict';
import {createTensorGeometry} from '../scripts/hydro_tensor_geometry.js';
function fixture(mode='sparse'){
 const w=90,h=80,n=w*h;
 const fields={
  primaryX:new Float32Array(n),primaryY:new Float32Array(n),
  confidence:new Float32Array(n),anisotropy:new Float32Array(n),
  validMask:new Uint8Array(n),rainfallInfluence:new Float32Array(n)
 };
 const siteMask=new Uint8Array(n),obstacleMask=new Uint8Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;
  if(x<4||y<4||x>=w-4||y>=h-4)continue;
  siteMask[i]=fields.validMask[i]=1;
  const theta=.28+.3*Math.sin(x*.038)+.25*Math.cos(y*.048);
  if(mode==='dense'||(x+y)%9<5){
   fields.primaryX[i]=Math.cos(theta);
   fields.primaryY[i]=Math.sin(theta);
   fields.confidence[i]=.22;
   fields.anisotropy[i]=.42;
  }
  fields.rainfallInfluence[i]=.24;
  if(x>=43&&x<=45&&y>=10&&y<=24)obstacleMask[i]=1;
 }
 return {cols:w,rows:h,cellX:25,cellY:25,
  grid:{left:0,top:h*25,cellProjectedM:25},fields,siteMask,obstacleMask,
  scenario:{year:2100}};
}
for(const mode of ['sparse','dense']){
 const result=fixture(mode),before=result.fields.primaryX.slice();
 const geometry=createTensorGeometry(result,{mode:'presentation',density:70,
  curvatureSmoothing:85,direction:'dual',viewRect:[0,0,result.cols,result.rows]});
 const lines=geometry.buildLines(),d=geometry.diagnostics;
 assert.deepEqual(result.fields.primaryX,before,'presentation must not modify the real tensor');
 assert.ok(d.presentationSource.smoothedValid/d.validCells>.90,
  'display must cover the complete source-valid parcel, not high-confidence seed islands');
 assert.ok(d.field.primary.finalLines>=25,
  'principal-direction display prematurely terminated or collapsed');
 assert.ok(d.field.secondary.finalLines>=25,
  'orthogonal-direction display prematurely terminated or collapsed');
 for(const line of lines){
  assert.ok(line.path.length>=8,'too-short isolated line was accepted');
  for(const p of line.path){
   const x=Math.floor(p.x),y=Math.floor(p.y),i=y*result.cols+x;
   assert.ok(result.siteMask[i]&&result.fields.validMask[i]&&!result.obstacleMask[i],
    'presentation line crosses parcel boundary / building obstacle / invalid cell');
  }
 }
 console.log(JSON.stringify({mode,principal:d.field.primary.finalLines,
  orthogonal:d.field.secondary.finalLines,coverage:d.presentationCoverageFraction,
  points:lines.reduce((n,l)=>n+l.path.length,0)}));
}
console.log('STEP04 sparse-support presentation regression PASS (synthetic fixtures only)');
