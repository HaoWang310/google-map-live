// Regression: STEP04 hydrological tensor presentation must show ONLY tensor
// graphics and selected-site boundary. No OSM roads/parks/buildings, water,
// sponge overlays, or EA/drainage references; restore on exit without
// changing underlying checkboxes or hydrological computation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');
function body(name){
 const start=ui.indexOf('  function '+name+'(');
 if(start<0)throw Error('Missing '+name);
 const end=ui.indexOf('\n  function ',start+15);
 if(end<0)throw Error('Missing subsequent function after '+name);
 return ui.slice(start,end);
}
const names=['syncFocusFloodWaterRendering','updateFocusAnalysisLayers',
 'syncSitePlanLayers','setFocusPitchMode','updateHydroLayerVisibility'];
const code=names.map(body).join('\n');
const keys={
 FOCUS_EA_LAYER:'focus-ea-risk-context',
 FOCUS_DRAINAGE_LAYER:'focus-drainage-context',
 FOCUS_DRAINAGE_SOURCE:'focus-drainage-network-source',
 FOCUS_RAIN_LAYER:'focus-dynamic-rain-layer',
 FOCUS_SPONGE_FILL:'focus-sponge-fill',FOCUS_SPONGE_LINE:'focus-sponge-line',
 FOCUS_2D:'focus-building-fill',FOCUS_3D:'focus-building-extrusion',
 FOCUS_FOOTPRINT_FILL:'focus-building-footprint-fill',
 FOCUS_FOOTPRINT_LINE:'focus-building-footprint-outline',
 FOCUS_ROAD_VISIBLE:'focus-existing-roads-visible',
 FOCUS_GREEN_VISIBLE:'focus-existing-greens-visible',
 FOCUS_PLAN_ROAD:'focus-plan-road-outline',
 FOCUS_PLAN_GREEN:'focus-plan-green-outline',
 FOCUS_PLAN_BUILDING:'focus-plan-building-outline'
};
const visibleIds=[
 'focus-parcel-ground','focus-parcel-border',
 'focus-green-ground','focus-water-ground',
 'focus-road-casing','focus-road-surface',
 ...Object.values(keys).filter(x=>!x.endsWith('-source'))
];
const layers=new Map(visibleIds.map(id=>[id,'visible']));
const toggles={roads:true,greens:true,ea:true,drainage:true};
let vectorOn=null;
const viewer={
 getLayer:id=>layers.has(id)?{id}:undefined,
 getLayoutProperty:(id,property)=>property==='visibility'?layers.get(id):undefined,
 setLayoutProperty:(id,property,value)=>{
  assert.equal(property,'visibility');assert.ok(layers.has(id),id);layers.set(id,value);
 },
 setPaintProperty(){},getPitch:()=>0,
 getSource:()=>({setTiles(){}})
};
const sandbox={
 ...keys,console,Math,Boolean,Object,
 isolateViewer:viewer,sitePlanShowRoads:toggles.roads,
 sitePlanShowGreens:toggles.greens,sitePlanMode:true,
 sitePlanDecisions:{kept:'keep'},hideSelectedBuildings:false,
 hydroDisplay:{flow:true,depth:true,volume:true,collision:true},
 hydroVector:{setEnabled:v=>{vectorOn=v}},
 focusAppliedThreshold:'0.123',
 focusContextSettings:()=>({ea:toggles.ea,drainage:toggles.drainage,threshold:'0.123'}),
 focusContextUrl:()=>'',setSiteHud(){},getBasemapTheme:()=> 'planning',
 volumetricWater:{ready:true,setVisible(){}},
 updatePlanBuildingColours(){},syncFocusFootprintVisibility(){
  // Real implementation always hides footprints in STEP04, as well as on exit.
  for(const id of [keys.FOCUS_FOOTPRINT_FILL,keys.FOCUS_FOOTPRINT_LINE])
   layers.set(id,'none');
 },
 buildingColourExpression:()=> '#eaeaea',
 focusThemePalette:()=>({
  ground:'#f9f9f9',green:'#f6f6f6',water:'#f4f4f4',
  roadCasing:'#e5e5e5',roadMajor:'#eaeaea',
  roadPedestrian:'#f1f1f1',roadMinor:'#eeeeee'
 }),
 HYDRO_TENSOR_RIBBON_GRADIENT:['literal','#fff']
};
vm.createContext(sandbox);
vm.runInContext(code,sandbox,{timeout:1000});
const hiddenInTensor=[
 'focus-road-casing','focus-road-surface','focus-green-ground','focus-water-ground',
 keys.FOCUS_ROAD_VISIBLE,keys.FOCUS_GREEN_VISIBLE,
 keys.FOCUS_2D,keys.FOCUS_3D,
 keys.FOCUS_SPONGE_FILL,keys.FOCUS_SPONGE_LINE,
 keys.FOCUS_FOOTPRINT_FILL,keys.FOCUS_FOOTPRINT_LINE,
 keys.FOCUS_EA_LAYER,keys.FOCUS_DRAINAGE_LAYER,keys.FOCUS_RAIN_LAYER,
 keys.FOCUS_PLAN_ROAD,keys.FOCUS_PLAN_GREEN,keys.FOCUS_PLAN_BUILDING
];
sandbox.updateHydroLayerVisibility();
for(const id of hiddenInTensor)assert.equal(layers.get(id),'none','Tensor-only leak: '+id);
assert.equal(layers.get('focus-parcel-border'),'visible','Retain selected site outline');
assert.equal(vectorOn,true,'Keep tensor field enabled');
assert.equal(sandbox.hydroDisplay.depth,true,'Do not erase rainfall visualization settings');
assert.deepEqual(toggles,{roads:true,greens:true,ea:true,drainage:true});
// Async style callbacks must never reveal a hidden reference or OSM layer.
sandbox.syncSitePlanLayers();
sandbox.updateFocusAnalysisLayers();
sandbox.setFocusPitchMode();
for(const id of hiddenInTensor)assert.equal(layers.get(id),'none','Late leak: '+id);
sandbox.hydroDisplay.flow=false;
sandbox.updateHydroLayerVisibility();
assert.equal(vectorOn,false,'Disable tensor field on exit');
for(const id of [
 'focus-road-casing','focus-road-surface','focus-green-ground','focus-water-ground',
 keys.FOCUS_ROAD_VISIBLE,keys.FOCUS_GREEN_VISIBLE,keys.FOCUS_2D,
 keys.FOCUS_SPONGE_FILL,keys.FOCUS_SPONGE_LINE,
 keys.FOCUS_EA_LAYER,keys.FOCUS_DRAINAGE_LAYER,keys.FOCUS_RAIN_LAYER,
 keys.FOCUS_PLAN_ROAD,keys.FOCUS_PLAN_GREEN,keys.FOCUS_PLAN_BUILDING
])assert.equal(layers.get(id),'visible','Layer not restored: '+id);
assert.deepEqual(toggles,{roads:true,greens:true,ea:true,drainage:true});
assert.ok(ui.includes('id="siteHudTensorOnlyHint"'));
assert.ok(!ui.includes('id="siteHudTensorBuildings"'));
console.log('PASS: STEP04 tensor only; source/checkboxes unchanged; original layers restored after exiting');
