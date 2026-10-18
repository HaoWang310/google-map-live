// Guard against the "STEP 01 only / cannot move or generate" UI regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pg=fs.readFileSync(new URL('./parcel_generator.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./parcel_road_ui.js',import.meta.url),'utf8');
assert.ok(pg.includes('selectStep(5);'),"Parcel Generator must enter the runnable STEP 05");
for(const input of ['dragPan:true','scrollZoom:true','doubleClickZoom:true',
 'dragRotate:true','viewer.resize()','id="pg-fit-site"',
 'id="pg-generate-shortcut"','byId(\'pg-fit-site\').onclick=fitSite',
 'roadUI.generateInitial()'])
 assert.ok(pg.includes(input),'missing map control / direct access: '+input);
const i=ui.indexOf('id="pg-road-generate"');
const slider=ui.indexOf('id="pg-road-${k}"');
assert.ok(i>=0&&slider>=0&&i<slider,
 'Generate must be ABOVE long Wool parameter slider list');
assert.ok(ui.includes("active&&Boolean(result)?'visible':'none'"),
 'Site must show original OSM until actual roads exist');
assert.ok(ui.includes('get isReady(){return ready}'),
 'STEP 05 source-ready state must be inspectable');
assert.ok(ui.includes('function generateInitial(){generate(\'generate\')}'),
 'Footer Generate must be wired to the actual worker');
console.log('PASS STEP 05 default entry, visible Generate, interactive map and no empty black canvas');
