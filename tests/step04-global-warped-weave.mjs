/* Regression: STEP04 shared global U/V parametric sheet, not local seed tracing.
   Deterministic synthetic tensors only; not a real London visual sign-off. */
import assert from 'node:assert/strict';
import {createTensorGeometry} from '../scripts/hydro_tensor_geometry.js';

function site(shape='A'){
 const w=100,h=82,n=w*h,siteMask=new Uint8Array(n),obstacleMask=new Uint8Array(n);
 const fields={primaryX:new Float32Array(n),primaryY:new Float32Array(n),
  confidence:new Float32Array(n),anisotropy:new Float32Array(n),
  validMask:new Uint8Array(n),rainfallInfluence:new Float32Array(n)};
 function contains(x,y){
  if(shape==='A')return x>=6&&x<=94&&y>=5&&y<=77&&
   x>10+y*.11&&x<97-y*.08;
  return ((x-50)/43)**2+((y-41)/36)**2<1;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!contains(x+.5,y+.5))continue;
  siteMask[i]=1;
  const gap=shape==='B'&&x>=34&&x<=64&&y>=22&&y<=57;
  fields.validMask[i]=gap?0:1;
  const theta=shape==='A'?.28+.48*Math.sin(x*.050)+.26*Math.cos(y*.062):
   -.40+.7*Math.sin((x+y)*.031)+.21*Math.cos(y*.054);
  // Sparse direction evidence must NOT create separate presentation islands.
  if(fields.validMask[i]&&(shape!=='A'||(x+y)%9<6)){
   fields.primaryX[i]=Math.cos(theta);fields.primaryY[i]=Math.sin(theta);
   fields.confidence[i]=.52;fields.anisotropy[i]=.64;
  }
  fields.rainfallInfluence[i]=.1+.23*Math.cos(x*.03)**2;
  if(shape==='B'&&x>=48&&x<=51&&y>=16&&y<=62)obstacleMask[i]=1;
 }
 return {cols:w,rows:h,cellX:25,cellY:25,
  grid:{left:0,top:h*25,cellProjectedM:25},siteMask,obstacleMask,
  fields,scenario:{year:2100}};
}
function check(name){
 const raw=site(name),originalX=raw.fields.primaryX.slice(),originalMask=raw.fields.validMask.slice();
 const engine=createTensorGeometry(raw,{mode:'presentation',density:74,
  curvatureSmoothing:85,direction:'dual',viewRect:[0,0,raw.cols,raw.rows]});
 const result=engine.buildLines(),d=engine.diagnostics,global=d.globalWarp;
 assert.equal(global?.schema,'site-derived-shared-parametric-grid-v1');
 assert.equal(global?.solver,'regularized-Jacobian Poisson / global bilinear map');
 assert.ok(global.minimumJacobian>=.199,'deformed lattice has an inverted or collapsed cell');
 assert.equal(global.foldedCells,0,'global sheet must be non-folding');
 assert.equal(global.maxCrossingError,0,'U and V use different maps');
 assert.ok(global.sourceDirectionSamples>30);
 assert.ok(d.field.primary.finalLines>=25,'broken U-family continuous weave');
 assert.ok(d.field.secondary.finalLines>=25,'broken V-family continuous weave');
 assert.deepEqual(raw.fields.primaryX,originalX,'presentation cannot modify hydrological tensor');
 assert.deepEqual(raw.fields.validMask,originalMask,'presentation cannot alter valid areas');
 let invalid=0;
 for(const line of result)for(const p of line.path){
  const i=Math.floor(p.y)*raw.cols+Math.floor(p.x);
  if(i<0||i>=originalMask.length||!raw.siteMask[i])invalid++;
 }
 assert.equal(invalid,0,'presentation line crossed the outer red boundary');
 assert.equal(d.presentationSource.smoothedValid,d.presentationMaskCells);
 assert.equal(d.presentationCoverageFraction,1);
 if(name==='B'){
  assert.ok(d.presentationSource.harmonicFilledCells>300,
   'central unsupported island must be interpolated');
  let innerCrossings=0;
  for(const line of result)for(const p of line.path){
   if(p.x>=34&&p.x<=64&&p.y>=22&&p.y<=57)innerCrossings++;
  }
  assert.ok(innerCrossings>300,
   'shared global U/V sheet is still fragmented at local tensor NoData');
 }
 assert.ok(Number.isFinite(global.orientationMeanResidualDeg));
 assert.ok(global.orientationSamples>20);
 // Explicit intersection vertices are required in BOTH drawn polylines,
 // not only in the abstract continuous mapping F(u,v).
 const uVertices=new Set(result.filter(l=>l.branch==='primary')
  .flatMap(l=>l.path.map(p=>p.x.toFixed(6)+','+p.y.toFixed(6))));
 let commonVertices=0;
 for(const line of result.filter(l=>l.branch==='secondary'))
  for(const p of line.path)if(uVertices.has(p.x.toFixed(6)+','+p.y.toFixed(6)))
   commonVertices++;
 assert.ok(commonVertices>30,'U/V drawing polylines lack shared exact crossing vertices');
 return {shape:name,commonVertices,lines:result.length,U:d.field.primary.finalLines,
  V:d.field.secondary.finalLines,vertices:global.outputVertices,
  minJacobian:global.minimumJacobian,orientationErrorDeg:global.orientationMeanResidualDeg,
  invalid,meanSourceOrientation:global.orientationMeanRadians};
}
const a=check('A'),b=check('B');
assert.ok(Math.abs(a.meanSourceOrientation-b.meanSourceOrientation)>.1,
 'different site tensors should not be replaced by the same artistic template');
console.log(JSON.stringify({status:'PASS synthetic only',cases:[a,b]},null,2));
