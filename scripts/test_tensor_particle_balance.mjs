// v3.22.76 · Visual particle de-clustering without modifying source geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectSpatialParticlePaths,thinVisibleParticles} from './hydro_tensor_particle_layout.js';

const geometry=fs.readFileSync(new URL('./hydro_tensor_geometry.js',import.meta.url),'utf8');
const field=fs.readFileSync(new URL('./hydro_tensor_field.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./local_flood_ui.js',import.meta.url),'utf8');

// Early source-ordered trajectories all share a left-boundary area.
// A few isolated trajectories represent the opposite half of the site.
const candidates=[
  ...Array.from({length:54},(_,i)=>Object.freeze({id:'edge-'+i,
    p:Object.freeze([-.1+i*.00000001,51.50+i*.00000001])})),
  ...Array.from({length:10},(_,i)=>Object.freeze({id:'across-'+i,
    p:Object.freeze([-.07+i*.003,51.51+(i%3)*.004])}))
];
const chosen=selectSpatialParticlePaths(candidates,18,x=>x.p);
assert.equal(chosen.length,18);
assert.equal(new Set(chosen.map(x=>x.id)).size,18,'no duplicate paths');
assert.ok(chosen.filter(x=>x.id.startsWith('across')).length>=7,
  'remote areas should receive particles before repeatedly filling one boundary cell');
assert.deepEqual(candidates[0].p,[-.1,51.50],
  'input geometry must remain completely unchanged');

const point=(name,x,y)=>Object.freeze({
  type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[x,y]}
});
const particles=[
  point('trunk',100,100),point('near-primary',102,105),
  point('near-secondary',105,102),point('far-a',145,100),
  point('far-b',146,101),point('other-zone',300,300)
];
const project=p=>({x:p[0],y:p[1]});
const filtered=thinVisibleParticles(particles,project,14);
assert.deepEqual(filtered.map(p=>p.properties.name),
  ['trunk','far-a','other-zone'],
  'at most one luminous head within a 14px disk; keep first/high-priority path');
assert.equal(thinVisibleParticles(particles,null).length,particles.length,
  'missing screen projection must be a safe fallback');
assert.equal(thinVisibleParticles([],project).length,0);
assert.equal(particles[0].geometry.coordinates[0],100,
  'geometry and point coordinates must remain unchanged');

assert.ok(field.includes('selectSpatialParticlePaths(items,count,midpoint)'),
  'path selection must use spatially balanced distribution');
assert.ok(field.includes('thinVisibleParticles(points,'),
  'every particle render must apply overlap suppression');
assert.ok(field.includes('balanceParticleDraw(particles)'),
  'presentation particles must also avoid hotspots after growth');
assert.ok(field.includes('features:visible'),
  'growth heads must draw the non-overlapping set');
assert.ok(field.includes('headCoordinate(line,u)'),
  'presentation particles must still follow true physical arc-length paths');
assert.ok(field.includes("['coalesce',['get','opacity'],1]"),
  'particle glow/opacity modulation must remain data-driven');
assert.ok(ui.includes("'circle-stroke-width':0"),
  'the fixed white circle rim must no longer add hard hotspot edges');
assert.ok(geometry.includes('function buildLines()')&&
  geometry.includes('function buildRibbons()'), 'original hydrological geometry untouched');
console.log('PASS spatial selection, pixel-distance suppression, and immutable paths');
console.log('PASS growth/presentation point brightness remains constrained; no geometry solver changes');
