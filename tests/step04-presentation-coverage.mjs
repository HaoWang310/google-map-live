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
  siteMask[i]=1;
  // Entire missing-data islands must remain inside the red display parcel.
  const unsupported=mode==='sparse'&&(
   ((x+y)%9>=5)||x>=31&&x<=60&&y>=25&&y<=55);
  fields.validMask[i]=unsupported?0:1;
  const theta=.28+.3*Math.sin(x*.038)+.25*Math.cos(y*.048);
  if(fields.validMask[i]){
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
 assert.equal(d.presentationSource.smoothedValid,d.presentationMaskCells,
  'every parcel cell must receive an extended presentation orientation');
 assert.equal(d.presentationCoverageFraction,1,'presentation must cover the full site');
 if(mode==='sparse')assert.ok(d.presentationSource.harmonicFilledCells>300,
  'missing analysis direction islands were not harmonically extended');
 assert.ok(d.field.primary.finalLines>=25,
  'principal-direction display prematurely terminated or collapsed');
 assert.ok(d.field.secondary.finalLines>=25,
  'orthogonal-direction display prematurely terminated or collapsed');
 let missingSamples=0,buildingSamples=0;
 for(const line of lines){
  assert.ok(line.path.length>=8,'too-short isolated line was accepted');
  for(const p of line.path){
   const x=Math.floor(p.x),y=Math.floor(p.y),i=y*result.cols+x;
   assert.ok(result.siteMask[i],
    'presentation line crosses the outer red parcel boundary');
   if(!result.fields.validMask[i])missingSamples++;
   if(result.obstacleMask[i])buildingSamples++;
  }
 }
 if(mode==='sparse')assert.ok(missingSamples>100,
  'presentation lines are still being clipped at missing tensor cells');
 assert.ok(buildingSamples>10,'flood-water building mask still clips the presentation');
 console.log(JSON.stringify({mode,missingSamples,buildingSamples,principal:d.field.primary.finalLines,
  orthogonal:d.field.secondary.finalLines,coverage:d.presentationCoverageFraction,
  points:lines.reduce((n,l)=>n+l.path.length,0)}));
}
console.log('STEP04 sparse-support presentation regression PASS (synthetic fixtures only)');
