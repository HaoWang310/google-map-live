// London Map build-version contract: prevents stale labels or worker module caches.
// Run with: node scripts/test_release_version.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const index=read('index.html');
const label=index.match(/id="appVersionLabel">OpenStreetMap \/ OpenFreeMap · v([^<]+)</);
const runtime=index.match(/const APP_VERSION='([^']+)'/);
assert.ok(label, 'Visible application version label must exist');
assert.ok(runtime, 'APP_VERSION must exist');
const v=runtime[1];
assert.equal(label[1],v,'Header release label must match runtime APP_VERSION');
assert.ok(index.includes("getElementById('appVersionLabel').textContent='OpenStreetMap / OpenFreeMap · v'+APP_VERSION"),
  'Header must derive the displayed version from the runtime constant');
for(const [source,dependency] of [
  ['index.html','scripts/local_flood_ui.js'],
  ['scripts/local_flood_ui.js','local_flood_sim.js'],
  ['scripts/local_flood_ui.js','hydro_tensor_field.js'],
  ['scripts/local_flood_sim.js','local_flood_worker.js'],
  ['scripts/hydro_tensor_field.js','hydro_tensor_worker.js'],
  ['index.html','scripts/parcel_generator.js'],
  ['scripts/parcel_generator.js','parcel_road_ui.js'],
  ['scripts/parcel_road_ui.js','parcel_road_worker.js']]){
 const text=read(source);
 assert.ok(text.includes(dependency+'?v='+v),
    source+' must import '+dependency+' using the displayed release build id');
}
assert.ok(read('scripts/hydro_tensor_field.js').includes("version:'"+v+"'"),
  'Tensor site export version must match the release');
console.log('PASS matching UI, runtime, exported site data, nested modules and worker cache IDs:',v);
