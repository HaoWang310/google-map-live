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
const tscope=vm.createContext({self:{}});vm.runInContext(fs.readFileSync(new URL('./hydro_tensor_worker.js',import.meta.url),'utf8'),tscope);
const solve=vm.runInContext('solve',tscope);
const input={type:'solve',requestId:1,cols,rows,grid,cellX:grid.cellProjectedM*grid.groundScale,
 cellY:grid.cellProjectedM*grid.groundScale,terrain,accumulation,inside,obstacle,
 vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n),
 drainageThresholdKm2:1,config:{smoothness:60},scenario:{year:2026,kind:'offline-dry-diagnostic'}};
const dry=solve({...input,depthMm:new Uint16Array(n)});
const depthMm=new Uint16Array(b.frame.depthMm);
const wet=solve({...input,depthMm,scenario:{year:2026,kind:'offline-illustrative-storm-25mmh-120min'}});
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
const serial=r=>({...r,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,Array.from(v)]))});
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({dry:serial(dry),wet:serial(wet),terrain:Array.from(terrain),depthMm:Array.from(depthMm),
 baselineFloodDepthBitIdentical:true,baselineFloodVolumeIdentical:true,
 modelEvent:{rainMmH:25,durationMin:120,infiltrationMmH:.5,buildingInput:'none; building collisions tested separately with synthetic fixtures',EAReference:'not loaded in offline diagnostic; no EA data used to drive floodwater'},
 drainageTerrainComparisonCells:diffs.length,medianDrainageTerrainAxisDifferenceDeg:median(diffs),
 wetDryComparisonCells:changes.length,medianWetDryAxisChangeDeg:median(changes),
 cellsWetDryAxisChangeOver5Deg:changes.filter(v=>v>5).length,
 maxEigenResidual:residual,peakDepthM:b.frame.stats.maxDepthM}));
console.log('Original and patched flood depths are bit-identical on the real DEM sample.');
