// London Map v3.22.60: two safe, paint-only OpenStreetMap palettes.
// Run: node scripts/test_basemap_themes.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBasemapThemeController,BASEMAP_THEMES,
  normaliseBasemapTheme} from './osm_basemap_themes.js';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const index=read('../index.html');
const focus=read('./local_flood_ui.js');
const basemap=[
 {id:'background',type:'background'},
 {id:'landuse',type:'fill','source-layer':'landuse'},
 {id:'park',type:'fill','source-layer':'landcover'},
 {id:'water',type:'fill','source-layer':'water'},
 {id:'road-major',type:'line','source-layer':'transportation'},
 {id:'road-minor',type:'line','source-layer':'transportation'},
 {id:'building',type:'fill','source-layer':'building'},
 {id:'place-label',type:'symbol','source-layer':'place'}
];
const all=basemap.slice(),paints=new Map();
let fullStyleReloads=0,operations=0;
const map={
 getStyle:()=>({layers:all}),
 getLayer:id=>all.find(x=>x.id===id),
 setStyle:()=>{fullStyleReloads++},
 setPaintProperty(id,key,val){
   if(!all.some(layer=>layer.id===id))throw Error('Unknown layer');
   const record=paints.get(id)||{};
   record[key]=val;paints.set(id,record);operations++;
 }
};
const controller=createBasemapThemeController(map);
controller.capture(); // Initial OpenFreeMap style before site overlays mount.
const captured=controller.getCapturedCount();
all.push({id:'ea-flood-depth',type:'raster',source:'ea-flood'});
all.push({id:'local-flood-building-scene',type:'fill',source:'local-flood'});
all.push({id:'hydro-tensor',type:'line',source:'hydro-tensor'});
controller.apply('planning');
const light={background:paints.get('background')['background-color'],
  building:paints.get('building')['fill-color'],
  roads:paints.get('road-major')['line-color']};
controller.apply('dark');
const dark={background:paints.get('background')['background-color'],
  building:paints.get('building')['fill-color'],
  roads:paints.get('road-major')['line-color']};
assert.equal(captured,basemap.length);
assert.notDeepEqual(light,dark);
assert.equal(normaliseBasemapTheme('invalid'),'planning');
assert.ok(BASEMAP_THEMES.planning);
assert.ok(BASEMAP_THEMES.dark);
assert.equal(controller.getMode(),'dark');
assert.equal(fullStyleReloads,0);
assert.ok(!paints.has('ea-flood-depth'));
assert.ok(!paints.has('hydro-tensor'));
assert.ok(!paints.has('local-flood-building-scene'));
const before=operations;controller.apply('dark');
assert.equal(operations,before,'re-applying unchanged palette should do no paint work');
assert.ok(index.includes('<option value="planning" selected>03 · 建筑规划</option>'));
assert.ok(index.includes('let osmStructuresHidden=true'));
assert.ok(index.includes('basemapThemeController.capture()'));
assert.ok(index.includes('basemapThemeController.apply(basemapTheme)'));
assert.ok(index.includes('getBasemapTheme:()=>basemapTheme'));
assert.ok(focus.includes('siteHudBasemapTheme'));
assert.ok(focus.includes('focusThemePalette()'));
console.log('PASS planning 03 default, dark 02 palette and repeat-switch stability');
console.log('PASS OSM base layers only; flood/tensor/site overlays and sources untouched');
