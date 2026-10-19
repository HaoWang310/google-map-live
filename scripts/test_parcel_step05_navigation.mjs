// End-to-end placement contract: STEP 05 belongs AFTER tensor inside
// Hydro Lab; Parcel Generator becomes the receiving STEP 06 workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
const pg=read('parcel_generator.js'),ui=read('parcel_road_ui.js'),
  hydro=read('local_flood_ui.js');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(hydro.includes("id=\"siteHudStep05Section\""),'Hydro Lab must contain STEP05 section');
assert.ok(hydro.indexOf("id=\"siteHudStep05Section\"")>
  hydro.indexOf("id=\"siteHudTensorExport\""),
  'STEP05 should appear AFTER STEP04 tensor controls');
for(const token of [
 'createParcelRoadUI({',
 'autoHandoff:false',
 "boundarySource:FOCUS_SITE,outlineLayer:'focus-parcel-border'",
 "hydroRoadUI.loadSnapshot({",
 'exportSiteSnapshot?.()',
 "id=\"siteHudStep05Final\"",
 'roadNetwork:hydroRoadResult',
 'hydroRoadUI.attachMap()'
])assert.ok(hydro.includes(token),'missing Hydro Lab STEP05 integration: '+token);
// Regression: STEP05 must stay INSIDE the scrollable Hydro Lab left sidebar.
const leftStart=hydro.indexOf('site-hydro-side site-hydro-left');
const step05Start=hydro.indexOf('id="siteHudStep05Section"');
const rightStart=hydro.indexOf('site-hydro-side site-hydro-right');
assert.ok(leftStart>=0&&step05Start>leftStart&&rightStart>step05Start,
  'STEP05 must appear between the Hydro Lab left and right panels');
assert.ok(hydro.includes("'</div>', // Close STEP04 only; leave the scrollable left sidebar open for STEP05."),
  'STEP04 must not prematurely close the scrollable left sidebar');
assert.ok(hydro.includes("'</section>', // Close the scrollable left sidebar AFTER STEP05."),
  'Hydro Lab must close the scrollable sidebar only after STEP05');
// STEP05 controls and Generate/Wool actions must remain visible even before a 2100 snapshot.
assert.ok(hydro.includes("'<div id=\"siteHudStep05Controls\"></div>'"),
  'STEP05 controls should not be hidden before real source data arrives');
assert.ok(!hydro.includes("siteHud('siteHudStep05Controls').style.display='none'"),
  'STEP05 must never hide the Wool panel in response to missing snapshots');
assert.ok(ui.indexOf('id="pg-road-generate"') < ui.indexOf('id="pg-road-import"'),
  'Generate and Wool buttons should be shown before the optional JSON import');
assert.ok(index.includes('parcelGenerator.open({polygon,roadNetwork})'),
  'Page must pass Hydro Lab road output to final Parcel Generator');
assert.ok(pg.includes('selectStep(finalMode?6:1)'),
  'Final Parcel Generator must open STEP06 on completed roads and STEP01 otherwise');
assert.ok(pg.includes('roadUI.loadResult(roadNetwork)'),
  'Final map must preview incoming computed road network');
assert.ok(!pg.includes('selectStep(5);'),
  'Final Parcel Generator must not open the legacy standalone STEP05 by default');
assert.ok(pg.includes('title="STEP 05 已移动到 Hydro Lab'),
  'Final Parcel Generator must not duplicate STEP05 controls');
for(const input of ['dragPan:true','scrollZoom:true','doubleClickZoom:true',
 'dragRotate:true','viewer.resize()','id="pg-fit-site"',
 "byId('pg-fit-site').onclick=fitSite"])
 assert.ok(pg.includes(input),'Map navigation regression: '+input);
const i=ui.indexOf('id="pg-road-generate"'),slider=ui.indexOf('id="pg-road-${k}"');
assert.ok(i>=0&&slider>=0&&i<slider,'Generate control should precede Wool sliders');
assert.ok(ui.includes("active&&Boolean(result)?'visible':'none'"),
 'Existing OSM remains visible until real roads exist');
assert.ok(ui.includes("boundarySource='pg-boundary'")&&
  ui.includes("onDone=()=>{}")&&ui.includes('loadSnapshot,loadResult'),
 'Road UI must be reusable in Hydro Lab and final preview');
console.log('PASS Hydro Lab STEP05 → final STEP06 handoff, accurate stage UI, map navigation');
