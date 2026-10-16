// v3.22.70 · Tensor controls must not reuse rain transport handlers.
// Run: node scripts/test_tensor_transport.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const between=(start,end)=>{
  const i=ui.indexOf(start);
  const j=ui.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i, 'missing UI handler: '+start);
  return ui.slice(i,j);
};
const run=between("    siteHud('siteHudRun').onclick=()=>{",
  "    siteHud('siteHudPause').onclick=()=>{");
const pause=between("    siteHud('siteHudPause').onclick=()=>{",
  "    siteHud('siteHudReset').onclick=()=>{");
const reset=between("    siteHud('siteHudReset').onclick=()=>{",
  "    redrawSpongeSite();");
assert.ok(run.includes("if(hydroDisplay.flow){") &&
  run.includes("requestTensorPlayback();return;"),
  'Run is a tensor replay, not a rainfall request');
assert.ok(!run.slice(0,run.indexOf("      if(longTermMode){")).includes("stopTensorSequence"),
  'Tensor Run must not exit to rainfall');
assert.ok(pause.includes("hydroVector?.pauseContinuousPlayback()"),
  'Pause must freeze the continuous display clock');
assert.ok(!pause.includes("stopTensorSequence"),
  'Tensor Pause must not close the tensor view');
assert.ok(reset.includes("stopTensorSequence({restoreRain:true})"),
  'Reset restores the saved completed rain snapshot');
assert.ok(reset.includes("updateSiteHydroDashboard();")&&
  reset.includes("return;"),'Reset returns before rainfall full-clear branch');
assert.ok(reset.indexOf('return;')<reset.indexOf('clearRiskEnvelope();clearYearFrames();'),
  'Tensor Reset must never delete the rainfall simulation cache');
assert.ok(ui.includes('if(session.playRequested){\n          requestTensorPlayback();'),
  'A queued Run starts after first accepted true geometry');
assert.ok(ui.includes('getPlaybackState?.()?.ready===true'),
  'Run waits for non-empty field or ribbon data');
assert.ok(ui.includes("session.playbackState='playing'") &&
  ui.includes("session.playbackState='paused'") &&
  ui.includes("session.playbackState='waiting'"),
  'Explicit transport states are maintained');
const geometryCallback=between('      onGeometryReady:({year,token,rainfallCase,lineCount})=>{',
  '      onProgress:({year,fraction,geometryYear,waitingForGeometry})=>{');
assert.ok(!geometryCallback.includes('autoSmoothStarted=hydroVector?.startContinuousPlayback'),
  'Preparing geometry must not autoplay before clicking Run');
assert.ok(renderer.includes('function pauseContinuousPlayback()'));
assert.ok(renderer.includes('function startContinuousPlayback('));
assert.ok(renderer.includes('function resumeContinuousPlayback()'));
assert.ok(renderer.includes('getPlaybackState,setField,setEnabled'),
  'renderer exposes reusable presentation transport');
assert.ok(ui.includes('请点击底部「重置」返回雨水模拟。'),
  'accidental checkbox uncheck must not escape tensor stage');
console.log('PASS tensor Run / Pause never trigger rainfall or exit the tensor stage');
console.log('PASS Reset alone restores saved rainfall; start/replay queue on real geometry');
