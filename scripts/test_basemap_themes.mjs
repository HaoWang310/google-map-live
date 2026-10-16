// London Map v3.22.63: restore original Liberty sprite patterns on style switch.
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
 {id:'park',type:'fill','source-layer':'park',
   paint:{'fill-color':'#d8e8c8','fill-outline-color':'rgba(95, 208, 100, 1)'}},
 {id:'landcover_wetland',type:'fill','source-layer':'landcover',
   paint:{'fill-pattern':'wetland_bg_11','fill-opacity':.8}},
 {id:'road_area_pattern',type:'fill','source-layer':'transportation',
   paint:{'fill-pattern':'pedestrian_polygon'}},
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
const wetlandDark=paints.get('landcover_wetland');
const pedestrianDark=paints.get('road_area_pattern');
const parkDark=paints.get('park');
assert.equal(wetlandDark['fill-pattern'],null,
  'wetland_bg_11 sprite must not override grayscale wetland fill in dark mode');
assert.equal(pedestrianDark['fill-pattern'],null,
  'pedestrian_polygon sprite must not introduce bright patterns in dark mode');
assert.equal(wetlandDark['fill-color'],BASEMAP_THEMES.dark.park);
assert.equal(parkDark['fill-outline-color'],BASEMAP_THEMES.dark.park,
  'park green outline should be neutral in Dark mode');
const before=operations;controller.apply('dark');
assert.equal(operations,before,'re-applying unchanged palette should do no paint work');
controller.apply('planning');
assert.equal(paints.get('landcover_wetland')['fill-pattern'],'wetland_bg_11',
  'switching back to planning restores original vegetation sprite');
assert.equal(paints.get('road_area_pattern')['fill-pattern'],'pedestrian_polygon',
  'switching back to planning restores pedestrian pavement sprite');
assert.equal(paints.get('park')['fill-outline-color'],'rgba(95, 208, 100, 1)',
  'switching back to planning restores original park outline');
controller.apply('dark');
assert.equal(paints.get('landcover_wetland')['fill-pattern'],null,
  'repeat dark switch still suppresses the colored wetland sprite');
assert.equal(paints.get('park')['fill-outline-color'],BASEMAP_THEMES.dark.park);
assert.equal(fullStyleReloads,0,'basemap style switching must not reload sources');
assert.ok(!paints.has('ea-flood-depth'));
assert.ok(!paints.has('hydro-tensor'));
assert.ok(!paints.has('local-flood-building-scene'));
assert.ok(index.includes('<option value="planning" selected>建筑规划</option>'));
assert.ok(index.includes('<option value="dark">黑色科技</option>'));
assert.ok(focus.includes('<option value="planning" selected>建筑规划</option>'));
assert.ok(focus.includes('<option value="dark">黑色科技</option>'));
assert.equal(BASEMAP_THEMES.planning.name,'建筑规划');
assert.equal(BASEMAP_THEMES.dark.name,'黑色科技');
assert.equal(BASEMAP_THEMES.dark.background,'#161616');
assert.equal(BASEMAP_THEMES.dark.building,'#2b2f33');
assert.equal(BASEMAP_THEMES.dark.primaryRoad,'#62676c');
assert.equal(BASEMAP_THEMES.dark.water,'#0f0f10');
assert.ok(!index.includes('03 · 建筑规划</option>')&&!index.includes('02 · 黑色科技</option>'));
assert.ok(focus.includes("ground:'#1f1f1f',green:'#202020',water:'#0f0f10'"));
assert.ok(index.includes('let osmStructuresHidden=true'));
assert.ok(index.includes('basemapThemeController.capture()'));
assert.ok(index.includes('basemapThemeController.apply(basemapTheme)'));
assert.ok(index.includes('getBasemapTheme:()=>basemapTheme'));
assert.ok(focus.includes('siteHudBasemapTheme'));
assert.ok(focus.includes('focusThemePalette()'));
console.log('PASS Planning remains default; Dark Tech uses charcoal gray palette and unnumbered labels');
console.log('PASS original Liberty sprite patterns and green park outlines are neutral in Dark');
console.log('PASS Planning restores exact original textures; GIS overlays/sources untouched');
