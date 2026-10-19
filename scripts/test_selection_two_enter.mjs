// STEP selection contract: first Enter previews, second Enter confirms; editing
// invalidates confirmation and independent-site entry, without changing flooding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('scripts/local_flood_ui.js'),html=read('index.html');
const start=ui.indexOf('  async function finishAndConfirmSelection(){');
const end=ui.indexOf('  function normaliseBuilding(',start);
assert.ok(start>0&&end>start,'Selection confirmation function must exist');
const code=ui.slice(start,end);
const model={drawing:true,editingSelection:false,selectionConfirmed:false,
 selectionDirty:false,isPreparingSelection:false,vertices:[[0,0],[1,0],[1,1]],
 previews:0,confirms:0,
 finishDrawing(){this.drawing=false;this.editingSelection=true;this.selectionDirty=true;this.previews++;},
 async confirmEditedSelection(){this.confirms++;this.selectionConfirmed=true;this.selectionDirty=false;return true;}};
// Use closures for the small unit under test, not the entire browser UI.
const scope={...model};
scope.finishDrawing=()=>{scope.drawing=false;scope.editingSelection=true;
 scope.selectionDirty=true;scope.previews++;};
scope.confirmEditedSelection=async()=>{scope.confirms++;scope.selectionConfirmed=true;
 scope.selectionDirty=false;return true;};
const handler=vm.runInNewContext(code+';finishAndConfirmSelection;',scope);
assert.equal(await handler(),true,'First Enter must preview');
assert.equal(scope.previews,1,'Initial Enter closes and previews only');
assert.equal(scope.confirms,0,'Initial Enter must NOT prepare/build selected site');
assert.equal(scope.selectionConfirmed,false,'First Enter must not unlock double-click');
assert.equal(await handler(),true,'Second Enter confirms even without moving vertices');
assert.equal(scope.confirms,1);
assert.equal(scope.selectionConfirmed,true);
assert.equal(await handler(),true);
assert.equal(scope.confirms,1,'Confirmed geometry must not be regenerated again');
scope.selectionDirty=true;scope.selectionConfirmed=false;
assert.equal(await handler(),true);
assert.equal(scope.confirms,2,'After moving boundary, one more Enter reconfirms');
scope.isPreparingSelection=true;scope.selectionConfirmed=false;
assert.equal(await handler(),false,'Must block concurrent preparation');
assert.equal(scope.confirms,2);
assert.ok(ui.includes("if(bounds)map.fitBounds(bounds,{padding:70"),'Preview must fit selected site');
assert.ok(ui.includes('if(event.key===\'Enter\'&&!event.repeat)'), 'Repeated keydown must not trigger both stages');
assert.ok(ui.includes('selectionConfirmed=false;\n      syncEditablePolygon()'),'Boundary change invalidates entry');
assert.ok(ui.includes('if(drawing||isolatedSelection||!selectionConfirmed||!prepared||selectionDirty||'),
 'Native double-click must require final confirmation');
assert.ok(ui.includes('!selectionConfirmed||selectionDirty||!prepared||drawing'),
 'Parcel Generator entry must require final confirmation');
assert.ok(ui.includes("if(!selectionConfirmed)return '请按第二次 Enter"),
 'Premature entry must explain the missing step');
assert.ok(html.includes('id="localFloodSelectionStep"'),'The UI must show current step');
assert.ok(html.includes('第一次 Enter 预览范围；第二次 Enter 确认最终选区'),
 'The confirm button must explain two-Enter workflow');
console.log('PASS: preview first, confirm second, edit invalidation and entry gating');
