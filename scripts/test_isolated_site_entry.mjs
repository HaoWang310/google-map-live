// Regression: confirmed site double-click must enter even if MapLibre swallows
// its dblclick event; unconfirmed boundary and anchor edits are preserved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html');
const ui=read('scripts/local_flood_ui.js');
assert.match(html, /<button id="localFloodEnterSite"[^>]*>进入独立场地/u);
assert.ok(html.includes(':not(#localFloodFocusEntry)'), 'focus entry must not be hidden by selection-only CSS');
assert.ok(ui.includes("enterSite.disabled=Boolean(drawing||isPreparingSelection||selectionDirty||!selectionConfirmed||!prepared||isolatedSelection)"));
assert.ok(ui.includes("status('无法进入独立场地：'+blocker,true)"));
assert.ok(ui.includes("function selectionEntryBlocker()"));
assert.ok(ui.includes("map.on('dblclick',event=>{"));
assert.ok(ui.includes("canvasContainer.addEventListener('dblclick',onNativeSiteDoubleClick,true)"));
assert.ok(ui.includes("canvasContainer.removeEventListener('dblclick',onNativeSiteDoubleClick,true)"));
assert.ok(ui.includes("pointInRingLngLat([lngLat.lng,lngLat.lat],polygon[0])"));
assert.ok(ui.includes("if(clickedInside&&selectionConfirmed&&prepared&&!selectionDirty&&!isPreparingSelection&&!atHandle)"));
assert.ok(ui.includes("if(findAnchorAtPoint(point)!==null||nearestEdgeAtPoint(point))return"),
  'native fallback must preserve vertex and edge editing');
assert.ok(ui.includes("if(clickedInside&&!selectionConfirmed&&!atHandle)"),
  'unconfirmed geometry must remain editable and show confirmation blocker');
assert.ok(ui.includes("Math.hypot(point.x-anchorDragStart.x,point.y-anchorDragStart.y)<5"),
  'a click with zero movement must not invalidate the polygon');
const down=ui.slice(ui.indexOf("const onAnchorMouseDownCapture=event=>{"),
  ui.indexOf("const onAnchorMouseMoveWindow=event=>{"));
assert.ok(!down.includes('selectionDirty=true'), 'mousedown should not set dirty selection');
const move=ui.slice(ui.indexOf("const onAnchorMouseMoveWindow=event=>{"),
  ui.indexOf("const onAnchorMouseUpWindow=()=>{"));
assert.ok(move.includes('selectionDirty=true'), 'drag must still invalidate edited polygon');
assert.ok(ui.includes("if(!moved)return; // Pure click or double-click did not change the boundary."));
assert.ok(ui.includes("$('localFloodEnterSite')?.addEventListener('click',()=>enterSelectionIsolate())"));
assert.ok(ui.includes("function createFocusViewer()"));
assert.ok(ui.includes("if(isolatedSelection)exitSelectionIsolate(false)"));
console.log('PASS: native double-click, manual 3D entry, edit-state guards, drag threshold');
