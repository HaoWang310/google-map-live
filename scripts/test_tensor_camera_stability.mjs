// Regression: tensor-mode camera is independent of hydrological geometry.
// Run: node scripts/test_tensor_camera_stability.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTensorGeometry} from './hydro_tensor_geometry.js';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const viewer=read('./local_flood_ui.js');
const renderer=read('./hydro_tensor_field.js');
assert.ok(viewer.includes('viewer.dragRotate?.enable()'),'3D right-drag rotation enabled');
assert.ok(viewer.includes('viewer.touchZoomRotate?.enable()'),'touch rotation enabled');
assert.ok(!viewer.includes("if(hydroDisplay.flow&&viewer.getPitch()>.01"),
  'tensor mode must not forcibly reset camera pitch');
assert.ok(!renderer.includes("map.on?.('moveend',onViewportChanged)"),
  'rotations/pans cannot dispatch new geometry worker jobs');
assert.ok(renderer.includes('viewRect:[0,0,result.cols,result.rows]'),
  'geometry coverage must be complete and camera-independent');
assert.ok(renderer.includes('metersPerPixel:clamp(result.cellX/12,.65,1.8)'),
  'stable metric line spacing must not depend on current zoom');
const cols=24,rows=20,n=cols*rows;
const fields={
  validMask:new Uint8Array(n).fill(1),confidence:new Float32Array(n).fill(.85),
  anisotropy:new Float32Array(n).fill(.8),primaryX:new Float32Array(n).fill(1),
  primaryY:new Float32Array(n),drainageRank:new Float32Array(n).fill(.2),
  rainfallInfluence:new Float32Array(n).fill(.25),drainageMask:new Uint8Array(n),
  drainageConfidence:new Float32Array(n)
};
const result={cols,rows,cellX:10,cellY:10,fields,siteMask:new Uint8Array(n).fill(1),
  obstacleMask:new Uint8Array(n),demNativeResolutionM:50};
const settings={density:55,length:65,metersPerPixel:.83,
  viewRect:[0,0,cols,rows],mode:'analysis',direction:'dual',curvatureSmoothing:65};
const solve=()=>createTensorGeometry(result,settings).buildLines();
const a=solve(),b=solve();
assert.ok(a.length>20,'real source-direction integration returns a visible network');
assert.deepEqual(a.map(x=>x.path),b.map(x=>x.path),
  'camera-independent integration is reproducible');
console.log('PASS free 3D rotation, zoom-independent full-site field and deterministic geometry');
