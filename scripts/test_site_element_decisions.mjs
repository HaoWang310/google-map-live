// Site-element collaboration regression: planning state is separate from OSM
// and hydraulic state; stable keys, filters and independent site controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sitePlanStorageKey,siteElementId,normalizeSiteDecisions,siteDecisionLabel}
  from './site_element_decisions.js';

const a=[[0,0],[2,0],[2,1],[0,1],[0,0]];
const b=[[2,1],[0,1],[0,0],[2,0],[2,1]];
const c=[[0,0],[0,1],[2,1],[2,0],[0,0]];
assert.equal(sitePlanStorageKey(a),sitePlanStorageKey(b));
assert.equal(sitePlanStorageKey(a),sitePlanStorageKey(c));
assert.notEqual(sitePlanStorageKey(a),sitePlanStorageKey([[0,0],[3,0],[3,1],[0,1],[0,0]]));
assert.equal(siteElementId('road','geometry a'),siteElementId('road','geometry a'));
assert.notEqual(siteElementId('road','geometry a'),siteElementId('park','geometry a'));
assert.notEqual(siteElementId('road','geometry a'),siteElementId('road','geometry b'));
assert.deepEqual(normalizeSiteDecisions({[siteElementId('road','x')]:'keep',
  [siteElementId('park','a')]:'remove',
  [siteElementId('green','b')]:'pending',
  unknown:'keep'}),{
  [siteElementId('road','x')]:'keep',[siteElementId('park','a')]:'remove'
});
assert.equal(siteDecisionLabel('pending'),'待定');
assert.throws(()=>siteElementId('invalid','foo'));
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('scripts/local_flood_ui.js');
for(const token of [
  "const elementId=siteElementId('road',dedupe)",
  "siteElementId(elementType,dedupe)",
  "siteElementId('building',groupId)",
  "sitePlanStorageKey(polygon?.[0])",
  "function pickSitePlanElement(event)",
  "function setSitePlanDecision(status)",
  "function exportSitePlanGeoJSON()",
  "window.getLondonSitePlanningData=()=>exportSitePlanGeoJSON()",
  "siteHud('siteHudPlanToggle').onclick",
  "if(sitePlanMode){\n      pickSitePlanElement(event);",
  "syncSitePlanLayers();"
])assert.ok(ui.includes(token),'missing site-planning integration: '+token);
assert.ok(ui.includes("originalOSMUnchanged:true,hydrologyUnchanged:true"));
assert.ok(ui.includes("sourceAttribution:'© OpenStreetMap contributors / OpenFreeMap vector tiles'"));
const worker=read('scripts/local_flood_worker.js');
assert.ok(worker.includes('function sendFrame()'));
assert.ok(!worker.includes('sitePlanDecisions'),'site planning must not enter hydrology worker');
console.log('PASS: repeatable site IDs, road/park/building decisions, local persistence and no hydrology coupling');
