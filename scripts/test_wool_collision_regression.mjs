// Regression: an A* path may be simplified for display, but the simplified
// chord can cross a forbidden flood cell. Wool must use the safe cell chain.
import assert from 'node:assert/strict';
import {optimiseWool} from './parcel_wool_solver.js';
const w=12,h=11,cell=10,n=w*h;
const safe=new Uint8Array(n).fill(1);
for(const [x,y] of [[5,5],[6,5],[5,6]])safe[y*w+x]=0;
const toPoint=i=>[((i%w)+.5)*cell,(Math.floor(i/w)+.5)*cell];
const cellAt=p=>{
 const x=Math.floor(p[0]/cell),y=Math.floor(p[1]/cell);
 return x>=0&&x<w&&y>=0&&y<h?y*w+x:-1;
};
const domain={w,h,cell,scale:1,safe,toPoint,cellAt,
 ax:new Float32Array(n).fill(.8),ay:new Float32Array(n).fill(.6)};
const idx=(x,y)=>y*w+x;
const indices=[
 idx(2,5),idx(3,4),idx(4,4),idx(5,4),idx(6,4),
 idx(7,4),idx(8,5)
];
const endToEnd=[toPoint(indices[0]),toPoint(indices.at(-1))];
assert.ok(!safe[cellAt([55,55])], 'Deep-water test cell must be excluded');
const onSegment=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
assert.equal(safe[cellAt(onSegment(endToEnd[0],endToEnd[1],.5))],0,
 'Legacy two-point display shortcut crosses deep flood');
const skeleton={roads:[{
 kind:'main',start:indices[0],end:indices.at(-1),
 points:endToEnd,indices
}]};
const out=optimiseWool(skeleton,domain,{
 woolStrength:100,tensorAlignment:90,bundleStrength:100,
 curvatureSmoothing:100,branchingStrength:100
});
assert.equal(out.roads.length,1);
assert.ok(out.roads[0].points.length>indices.length-1,
 'Must reconstruct and resample original A* cells, not the unsafe display chord');
for(const road of out.roads){
 for(let i=0;i<road.points.length;i++){
  const a=road.points[i],id=cellAt(a);
  assert.ok(id>=0&&safe[id], 'Wool vertices must remain inside safe cells');
  if(i===0)continue;
  const p=road.points[i-1];
  const steps=Math.ceil(Math.hypot(a[0]-p[0],a[1]-p[1])/(cell*.12));
  for(let j=0;j<=steps;j++){
   const q=onSegment(p,a,j/steps),k=cellAt(q);
   assert.ok(k>=0&&safe[k], 'Full Wool segment must not cut through deep water');
  }
 }
}
assert.ok(out.stats.fullAStarCells>=indices.length);
assert.ok(Number.isFinite(out.stats.totalLengthM)&&out.stats.totalLengthM>0);
console.log('PASS Wool: unsafe shortcut replaced with full A* spine; constrained relaxation and assembled curve checked');
