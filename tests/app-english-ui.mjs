/* London Map English interface regression.
   The historical Chinese-key translation dictionary is intentionally excluded:
   its keys are internal lookup data, not displayed UI. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const paths=[
 'index.html',
 'scripts/ui_english.js',
 'scripts/flood_detail.js',
 'scripts/place_search.js',
 'scripts/drainage_display.js',
 'scripts/drainage_worker.js',
 'scripts/terrain_local.js',
 'scripts/terrain_worker.js',
 'scripts/osm_basemap_themes.js',
 'scripts/local_flood_ui.js',
 'scripts/local_flood_sim.js',
 'scripts/local_flood_worker.js',
 'scripts/flood_water_visual.js',
 'scripts/hydro_tensor_grid.js',
 'scripts/hydro_tensor_visual.js',
 'scripts/hydro_tensor_field.js',
 'scripts/hydro_tensor_worker.js',
 'scripts/hydro_tensor_geometry.js',
 'scripts/hydro_tensor_geometry_worker.js',
 'scripts/hydro_tensor_particle_layout.js',
 'scripts/hydro_tensor_gap_diagnostic.js',
 'scripts/site_planning_tensor.js',
 'scripts/site_visual_field.js',
 'scripts/global_warped_weave.js',
 'scripts/site_element_decisions.js',
 'scripts/parcel_generator.js',
 'scripts/parcel_generator_worker.js',
 'scripts/parcel_road_ui.js',
 'scripts/parcel_road_worker.js',
 'scripts/parcel_road_constraints.js',
 'scripts/parcel_road_skeleton.js',
 'scripts/parcel_road_presentation.js',
 'scripts/parcel_road_organic.js',
 'scripts/parcel_wool_solver.js',
 'scripts/parcel_road_topology.js'
];
const chinese=/[\u3400-\u9fff]/;
for(const path of paths){
 const source=readFileSync(path,'utf8');
 const offending=source.split('\n').map((line,i)=>({line,i:i+1}))
  .filter(({line})=>chinese.test(line));
 assert.equal(offending.length,0,
  path+' contains untranslated Chinese at lines: '+offending.map(x=>x.i).join(','));
}
const html=readFileSync('index.html','utf8');
assert.match(html,/<html\s+lang="en"/i,'HTML document language must be English');
assert.match(html,/APP_VERSION='3\.29\.4-english'/,'page must use English module build');
assert.match(html,/ui_english\.js\?v=3\.29\.4-english/,
 'English fallback translator must use current version');
console.log('PASS English London Map: '+paths.length+' active HTML/JS files; no visible Chinese source strings');
