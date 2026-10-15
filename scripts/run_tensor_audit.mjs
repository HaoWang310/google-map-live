// Invoked by build_tensor_audit.py; audit harness only, never loaded by app.
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const dir=process.argv[2],cfg=JSON.parse(fs.readFileSync(path.join(dir,'config.json')));
const u16=name=>{const b=fs.readFileSync(path.join(dir,name+'.bin'));return new Uint16Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};
const fixtureDem=u16('dem'),fixtureArea=u16('area');
const current=fs.readFileSync(new URL('./local_flood_worker.js',import.meta.url),'utf8');
const original=execFileSync('git',['show','b1832bbcadb85fe97136e4eb26018c31599e8a5a:scripts/local_flood_worker.js'],{encoding:'utf8'});
const [west,south,east,north]=cfg.bbox;
const polygon=[[[west,north],[east,north],[east,south],[west,south],[west,north]]];
async function run(source){
 const messages=[];
 const make=new Function('fixtureDem','fixtureArea','config','postMessage',
  'let onmessage;\n'+source+`
 demConfig={demBounds:{left:config.bounds[0],bottom:config.bounds[1],right:config.bounds[2],top:config.bounds[3]},demWidth:config.width,demHeight:config.height,demEncoding:{minimum:-100,step:.1},drainageUrl:'fixture'};
 loadDem=async()=>fixtureDem;loadDrainageCodes=async()=>fixtureArea;
 loadPublishedRiskForSite=async()=>{};loadOfficialEaDepthForSite=async()=>{};
 return {setup,run:()=>{params={...params,rainfall:25,infiltration:.5,duration:120,drainageThreshold:1,showFlow:true};for(let i=0;i<240;i++)simulationStep(30);sendFrame();},
 arrays:()=>({terrain:new Float32Array(sim.terrain),accumulation:new Uint16Array(sim.accumulation),inside:new Uint8Array(sim.inside),obstacle:new Uint8Array(sim.obstacle)})};`);
 const api=make(fixtureDem,fixtureArea,cfg,d=>messages.push(d));
 await api.setup({requestId:1,polygon,buildings:[]});api.run();
 return {arrays:api.arrays(),frame:messages.at(-1)};
}
const a=await run(original),b=await run(current);
assert.deepEqual(new Uint16Array(a.frame.depthMm),new Uint16Array(b.frame.depthMm));
assert.equal(a.frame.stats.volumeM3,b.frame.stats.volumeM3);
const {terrain,accumulation,inside,obstacle}=b.arrays;
const grid=b.frame.grid,cols=b.frame.width,rows=b.frame.height,n=cols*rows;
const solve=new Function('self',fs.readFileSync(new URL('./hydro_tensor_worker.js',import.meta.url),'utf8')+'\nreturn solve;')({});
const input={type:'solve',requestId:1,cols,rows,grid,cellX:grid.cellProjectedM*grid.groundScale,
 cellY:grid.cellProjectedM*grid.groundScale,terrain,accumulation,inside,obstacle,
 vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),
 drainageThresholdKm2:1,config:{smoothness:60},scenario:{year:2026,kind:'offline-dry-diagnostic'}};
const dry=solve({...input,depthMm:new Uint16Array(n)});
const depthMm=new Uint16Array(b.frame.depthMm);
const wet=solve({...input,depthMm,scenario:{year:2026,kind:'offline-illustrative-storm-25mmh-120min'}});
if(process.env.TENSOR_GEOMETRY_FIXTURE){
 const encode=r=>({...r,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,{type:v.constructor.name,values:Array.from(v)}]))});
 fs.writeFileSync(process.env.TENSOR_GEOMETRY_FIXTURE,JSON.stringify({input:{...input,terrain:Array.from(terrain),accumulation:Array.from(accumulation),inside:Array.from(inside),obstacle:Array.from(obstacle),depthMm:Array.from(depthMm)},result:encode(wet)}));
}
const diffs=[],changes=[];let residual=0;
for(let i=0;i<n;i++){
 const f=wet.fields;
 if(f.drainageConfidence[i]>.20&&Math.hypot(f.basePrimaryX[i],f.basePrimaryY[i])>.5)
  diffs.push(Math.acos(Math.min(1,Math.abs(f.drainageX[i]*f.basePrimaryX[i]+f.drainageY[i]*f.basePrimaryY[i])))*180/Math.PI);
 if(Math.hypot(f.primaryX[i],f.primaryY[i])>.5&&Math.hypot(dry.fields.primaryX[i],dry.fields.primaryY[i])>.5)
  changes.push(Math.acos(Math.min(1,Math.abs(f.primaryX[i]*dry.fields.primaryX[i]+f.primaryY[i]*dry.fields.primaryY[i])))*180/Math.PI);
 residual=Math.max(residual,Math.hypot(f.tensorXX[i]*f.primaryX[i]+f.tensorXY[i]*f.primaryY[i]-f.eigenvalueMajor[i]*f.primaryX[i],f.tensorXY[i]*f.primaryX[i]+f.tensorYY[i]*f.primaryY[i]-f.eigenvalueMajor[i]*f.primaryY[i]));
}
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]??null;
const plotKeys=['basePrimaryX','basePrimaryY','drainageX','drainageY','primaryX','primaryY','secondaryX','secondaryY',
 'validMask','drainageAreaKm2','confidence','anisotropy','directionContinuity',
 'terrainCueWeight','drainageCueWeight','hydraulicCueWeight'];
const serial=r=>({...r,fields:Object.fromEntries(Object.entries(r.fields).filter(([k])=>plotKeys.includes(k)).map(([k,v])=>[k,Array.from(v)]))});
const angle=(a,b,i)=>Math.acos(Math.min(1,Math.abs(a.primaryX[i]*b.primaryX[i]+a.primaryY[i]*b.primaryY[i])))*180/Math.PI;
const cases={},sensitivity=[];
for(const [key,lo,hi] of [['terrainWeight',5,95],['drainageWeight',5,95],['avoidance',0,100]]){
 const configs=[{...input.config,[key]:lo},{...input.config,[key]:hi}];
 const fields=configs.map(config=>solve({...input,depthMm,config}));
 const cueIndex={terrainWeight:'terrainCueWeight',drainageWeight:'drainageCueWeight',avoidance:'hydraulicCueWeight'}[key];
 const angles=[];
 for(let i=0;i<n;i++){
  const l=fields[0].fields,h=fields[1].fields;
  if(h[cueIndex][i]<.01||l.confidence[i]<.02||h.confidence[i]<.02||Math.hypot(l.primaryX[i],l.primaryY[i])<.5||Math.hypot(h.primaryX[i],h.primaryY[i])<.5)continue;
  if(key==='drainageWeight'&&h.drainageConfidence[i]<.2)continue;
  if(key==='avoidance'&&depthMm[i]<8)continue;
  angles.push(angle(l,h,i));
 }
 assert.ok(angles.some(a=>a>5),key+' failed real-raster sensitivity');
 sensitivity.push({parameter:key,from:lo,to:hi,comparedCells:angles.length,
  medianAngleDeg:median([...angles]),p95AngleDeg:[...angles].sort((a,b)=>a-b)[Math.floor(angles.length*.95)],
  meanAngleDeg:angles.reduce((a,b)=>a+b,0)/angles.length,changedOver5Deg:angles.filter(a=>a>5).length});
 cases[key]=fields.map(r=>({cols:r.cols,rows:r.rows,fields:Object.fromEntries(['primaryX','primaryY','confidence'].map(k=>[k,Array.from(r.fields[k])]))}));
}
const roughness=(f,other)=>{
 let total=0,count=0;
 for(let y=0;y<rows;y++)for(let x=0;x<cols-1;x++){
  const i=y*cols+x,j=i+1;if(f.confidence[i]<.075||f.confidence[j]<.075||other.confidence[i]<.075||other.confidence[j]<.075)continue;
  const dot=f.primaryX[i]*f.primaryX[j]+f.primaryY[i]*f.primaryY[j];total+=Math.max(0,1-dot*dot);count++;
 }return total/count;
};
const unsmoothed=solve({...input,depthMm,config:{smoothness:0}});
const regularized=solve({...input,depthMm,config:{smoothness:100}});
const continuity={rawRoughness:roughness(unsmoothed.fields,regularized.fields),smoothRoughness:roughness(regularized.fields,unsmoothed.fields)};
assert.ok(continuity.smoothRoughness<continuity.rawRoughness,'real-raster regularization must reduce roughness');
const roughIds=Object.values(wet.fields.confidence).filter(v=>v>=.075).length;
console.log(JSON.stringify({sensitivity,continuity,confidentWetCells:roughIds}));

fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({dry:serial(dry),wet:serial(wet),terrain:Array.from(terrain),depthMm:Array.from(depthMm),
 baselineFloodDepthBitIdentical:true,baselineFloodVolumeIdentical:true,
 sensitivity,continuity,cases,confidentWetCells:roughIds,
 modelEvent:{rainMmH:25,durationMin:120,infiltrationMmH:.5,buildingInput:'none; building collisions tested separately with synthetic fixtures',EAReference:'not loaded in offline diagnostic; no EA data used to drive floodwater'},
 drainageTerrainComparisonCells:diffs.length,medianDrainageTerrainAxisDifferenceDeg:median(diffs),
 wetDryComparisonCells:changes.length,medianWetDryAxisChangeDeg:median(changes),
 cellsWetDryAxisChangeOver5Deg:changes.filter(v=>v>5).length,
 maxEigenResidual:residual,peakDepthM:b.frame.stats.maxDepthM}));
console.log('Original and patched flood depths are bit-identical on the real DEM sample.');
