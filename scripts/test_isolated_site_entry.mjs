// Regression for interactive entry into a prepared red parcel.
// The backup native canvas double-click and explicit action must stay wired
// independently of the MapLibre feature/anchor handlers.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html'),ui=read('scripts/local_flood_ui.js');
assert.match(html,/<button id="localFloodEnterSite"[^>]*>进入独立场地/u);
assert.match(ui,/function selectionEntryBlocker\(\)/);
for(const state of ['drawing','isPreparingSelection','selectionDirty','prepared']){
  assert.ok(ui.includes(state),'entry should account for '+state);
}
assert.ok(ui.includes("enterSite.disabled=Boolean(drawing||isPreparingSelection||selectionDirty||!prepared||isolatedSelection)"));
assert.ok(ui.includes("map.on('dblclick',event=>{"));
assert.ok(ui.includes("map.getCanvas().addEventListener('dblclick',onNativeSiteDoubleClick,true)"));
assert.ok(ui.includes("const lngLat=map.unproject([point.x,point.y])"));
assert.ok(ui.includes("pointInRingLngLat([lngLat.lng,lngLat.lat],polygon[0])"));
assert.ok(ui.includes("if(clickedInside&&prepared&&!selectionDirty&&!isPreparingSelection)"));
assert.ok(ui.includes("findAnchorAtPoint(event.point)===null&&!nearestEdgeAtPoint(event.point)"),
  'dirty-site double click still allows anchor/edge editing');
assert.ok(ui.includes("isPreparingSelection||!polygon?.[0]||dragVertexIndex>=0)return;"),
  'native focus must not steal unconfirmed polygon edits');
assert.ok(ui.includes("enterSelectionIsolate();"));
assert.ok(ui.includes("$('localFloodEnterSite')?.addEventListener('click',()=>enterSelectionIsolate())"));
assert.ok(ui.includes("status('无法进入独立场地：'+blocker,true)"));
assert.ok(ui.includes("function createFocusViewer()"));
assert.ok(ui.includes("if(isolatedSelection)exitSelectionIsolate(false)"));
console.log('PASS: native dblclick fallback, map dblclick, prepared site button and detailed state messaging');
