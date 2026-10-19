// Regression: a single Wool switch auto-hands genuine 2100 tensor/flood data
// into STEP05's one-pass skeleton + elastic Wool worker, without JSON imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hydro=read('scripts/local_flood_ui.js');
const tensor=read('scripts/hydro_tensor_field.js');
const roads=read('scripts/parcel_road_ui.js');
const worker=read('scripts/parcel_road_worker.js');
const contracts=[
  [hydro,'id="siteHudWoolAuto"','Single in-panel Wool toggle must exist'],
  [hydro,"siteHud('siteHudWoolAuto').onchange=event=>{",'Toggle must be wired'],
  [hydro,'showImport:false','Hydro Lab must not ask for a JSON upload'],
  [hydro,'hydroAutoWoolTimer=setInterval(beginAutoWoolIfReady,1300)','Auto mode should wait for real tensor results'],
  [hydro,'!tensorSession.completed||!info?.ready||info.year!==2100','Visual year cannot stand in for true 2100 computation'],
  [hydro,'info.rainfallCase!==rainPreset','Reject stale rainfall scenarios'],
  [hydro,'hydroVector.getSiteSnapshotReadiness?.()','Poll lightweight data readiness'],
  [hydro,'hydroVector.exportSiteSnapshot?.()','Read the computed in-memory tensor'],
  [hydro,'hydroRoadUI.setAutoGenerate(true)','Enable the worker auto-run'],
  [hydro,'hydroRoadUI.loadSnapshot({','Transfer the original current-site data'],
  [hydro,"selection:{type:'Polygon',coordinates:structuredClone(polygon)}",'Keep the same polygon'],
  [hydro,'hydroRoadUI.resetRoads();','Turning off should reset roads'],
  [hydro,'hydroAutoWoolCheck=beginAutoWoolIfReady','Recompute should reactivate the readiness watcher'],
  [tensor,'function getSiteSnapshotReadiness(){','The tensor must expose lightweight readiness'],
  [tensor,'scenarioSnapshots.get(2100)','Read a genuine computed 2100 scenario'],
  [roads,'if(autoGenerateOnReady)generate(\'optimise\')','Auto source-ready must launch optimisation'],
  [roads,'showImport=true','Legacy standalone mode may still accept files'],
  [worker,'const skeleton=initialRoadSkeleton(domain,parameters','One action must generate a skeleton'],
  [worker,'const wool=optimiseWool(skeleton,domain','The same action must apply Wool'],
  [worker,"woolStrength:mode==='generate'?0:parameters.woolStrength",'Optimise applies elastic strength'],
];
for(const [source,token,description] of contracts)
 assert.ok(source.includes(token),description+': '+token);
assert.ok(!hydro.includes('siteHudStep05Begin'),'Remove redundant manual import/sync action');
assert.ok(roads.includes("${showImport?"),'Import control should be optional');
assert.ok(roads.includes("if(el('pg-road-import'))"),'Missing import field must not crash mount');
console.log('PASS: one-switch, same-parcel, real-2100 automatic Wool workflow');
