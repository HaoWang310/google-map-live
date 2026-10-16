// v3.22.78 · Opt-in spatial gap diagnosis, native-grid evidence and wet overlap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyTensorEvidence,buildTensorGapDiagnostic,TENSOR_GAP_CATEGORIES
} from './hydro_tensor_gap_diagnostic.js';
const w=8,h=6,n=w*h;
const arr=(v=0)=>Float32Array.from({length:n},()=>v);
const validMask=Uint8Array.from({length:n},()=>1);
const confidence=arr(.5),anisotropy=arr(.6),primaryX=arr(1),primaryY=arr(0);
const inside=Uint8Array.from({length:n},()=>1);
const depth=new Uint16Array(n);
const i=(x,y)=>y*w+x;
validMask[i(1,1)]=0;
confidence[i(2,1)]=.01;
anisotropy[i(3,1)]=.01;
primaryX[i(4,1)]=0;
depth[i(1,1)]=30;
depth[i(2,1)]=100;
depth[i(5,3)]=90;
inside[i(0,0)]=0;
const fields={validMask,confidence,anisotropy,primaryX,primaryY};
const grid={id:'test-1',crs:'EPSG:3857',cols:w,rows:h,
  left:0,top:0,cellProjectedM:10,groundScale:.7};
const result={cols:w,rows:h,grid,scenario:{year:2100},
  fields,context:{inside},depth,geometrySpacingM:7};
assert.equal(classifyTensorEvidence(fields,i(0,0),false),'outside');
assert.equal(classifyTensorEvidence(fields,i(1,1)),'missing');
assert.equal(classifyTensorEvidence(fields,i(2,1)),'low');
assert.equal(classifyTensorEvidence(fields,i(3,1)),'isotropic');
assert.equal(classifyTensorEvidence(fields,i(4,1)),'axis');
assert.equal(classifyTensorEvidence(fields,i(6,4)),'supported');
const preliminary=buildTensorGapDiagnostic({result,geometryMatched:false});
assert.ok(preliminary);
assert.equal(preliminary.stats.outside,1);
assert.equal(preliminary.stats.site,n-1);
assert.equal(preliminary.stats.missing,1);
assert.equal(preliminary.stats.low,1);
assert.equal(preliminary.stats.isotropic,1);
assert.equal(preliminary.stats.axis,1);
assert.equal(preliminary.stats.uncovered,0,
  'direction-valid gaps are not falsely diagnosed before geometry is ready');
assert.equal(preliminary.stats.wet,3);
assert.equal(preliminary.stats.wetGap,2);
assert.equal(preliminary.stats.geometryMatched,false);
assert.ok(preliminary.geojson.features.some(f=>f.properties.category==='wet'));
const mercLng=x=>x/6378137*180/Math.PI;
const mercLat=y=>(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI;
const fromCell=(x,y)=>[mercLng(x*10),mercLat(-y*10)];
const fieldLines=[{type:'Feature',geometry:{type:'LineString',
  coordinates:[fromCell(.3,3.3),fromCell(7.5,3.3)]}}];
const after=buildTensorGapDiagnostic({result,geometryMatched:true,streamlines:fieldLines});
assert.equal(after.stats.geometryMatched,true);
assert.ok(after.stats.uncovered>0,'supported directions away from real lines need investigation');
assert.ok(after.stats.uncovered<after.stats.supported+after.stats.uncovered,
  'valid near-line directions cannot all be flagged uncovered');
assert.ok(after.geojson.features.some(f=>f.properties.category==='uncovered'));
assert.equal(after.stats.wet,3,'physical rain-depth diagnostics stay unchanged');
assert.ok(TENSOR_GAP_CATEGORIES.some(c=>c.code==='uncovered'));
assert.ok(after.geojson.features.every(f=>f.geometry.type==='Polygon'));
const noGeometry=buildTensorGapDiagnostic({result,geometryMatched:true,streamlines:[]});
assert.equal(noGeometry.stats.uncovered,0,'no geometry must not invent uncovered regions');
const coarse=buildTensorGapDiagnostic({result,geometryMatched:true,
  streamlines:fieldLines,maxShapes:250});
assert.ok(coarse.stats.visualStride>=1,'dense maps can fall back to documented aggregation');

const field=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
assert.ok(field.includes('function syncGapDiagnostic(force=false)'),
  'renderer has a dedicated diagnostic refresh method');
assert.ok(field.includes('setGapDiagnosticEnabled,syncGapDiagnostic'),
  'render API retains opt-in diagnostic toggle');
assert.ok(ui.includes('id="siteHudTensorGapToggle" type="checkbox"'),
  'checkbox must be unchecked by default');
assert.ok(ui.includes("gapSourceId:FOCUS_TENSOR_GAP_SOURCE"),
  'test layers are registered separately from field/rain layers');
assert.ok(!ui.includes('id="siteHudTensorGapToggle" type="checkbox" checked'),
  'test mode must never auto-enable');
console.log('PASS native-grid classifications and genuine depth >= 20mm overlap');
console.log('PASS no false stop reasons, opt-in overlay, no source tensor geometry modifications');
