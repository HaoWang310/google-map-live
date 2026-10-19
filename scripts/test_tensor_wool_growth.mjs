// STEP05 architecture: hydrological tensor integration is the initial generator,
// Wool is the branching generator, and A* only repairs network connectivity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sk=read('scripts/parcel_road_skeleton.js'),
 wool=read('scripts/parcel_wool_solver.js'),
 worker=read('scripts/parcel_road_worker.js'),
 hydro=read('scripts/local_flood_ui.js');
const start=sk.indexOf('export function initialRoadSkeleton('),
 end=sk.indexOf('export function repairRoadConnectivity(');
assert.ok(start>0&&end>start,'Both growth and repair stages must exist');
const initial=sk.slice(start,end);
assert.ok(initial.includes('trace(domain,i,false'), 'Initial main fibers must integrate primary tensor axes');
assert.ok(initial.includes('trace(domain,i,true'), 'Initial secondary fibers must integrate secondary axes');
assert.ok(!initial.includes('search(domain'), 'A* must not be called during initial generation');
assert.ok(sk.slice(end).includes('search(domain,'), 'A* must remain as later connectivity repair');
assert.ok(sk.includes('vx*vx-vy*vy'), 'Tensor eigen-axis must interpolate orientations without sign ambiguity');
assert.ok(wool.includes('function woolGrowth('));
assert.ok(wool.includes("growTier('secondary'"));
assert.ok(wool.includes("growTier('local'"));
assert.ok(wool.includes('woolAxis(domain,mid,perpendicular,heading)'));
assert.ok(wool.includes('if(!safeSegment(domain,p,candidate))break;'));
assert.ok(wool.includes('if(pathSafe(refined))road.points=refined'));
const a=worker.indexOf('const skeleton=initialRoadSkeleton('),
 b=worker.indexOf('const wool=optimiseWool('),
 c=worker.indexOf('const repaired=repairRoadConnectivity('),
 d=worker.indexOf('const network=createRoadTopology(repaired,');
assert.ok(a>0&&a<b&&b<c&&c<d,'Pipeline must be tensor→Wool→A*repair→topology');
assert.ok(worker.includes('astarRepairs:wool.stats.astarRepairs||0'));
assert.ok(hydro.includes('id="siteHudWoolAuto"'),'Keep one-switch auto workflow');
console.log('PASS: tensor-integrated primary/secondary growth, active Wool branches, A* only for final repair');
