// Compare the actual v3.22.48 renderer with the new pure geometry engine.
// Input comes from TENSOR_GEOMETRY_FIXTURE in the existing real-raster audit.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createTensorGeometry} from './hydro_tensor_geometry.js';
const inputPath=process.argv[2],outPath=process.argv[3];
const saved=JSON.parse(fs.readFileSync(inputPath)),r={...saved.result,
 fields:Object.fromEntries(Object.entries(saved.result.fields).map(([k,v])=>[k,new globalThis[v.type](v.values)]))};
const sourceHash=()=>{const h=createHash('sha256');for(const a of Object.values(r.fields))h.update(new Uint8Array(a.buffer));return h.digest('hex')};
const before=sourceHash(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'london-geometry-'));
let old=execFileSync('git',['show','c7b118e4fe0f54b4d73c1dd8588c6a0898811adc:scripts/hydro_tensor_field.js'],{encoding:'utf8'});
old=old.replace(/from '\.\/hydro_tensor_grid.js[^']*'/,"from '"+pathToFileURL(path.resolve('scripts/hydro_tensor_grid.js')).href+"'");
old=old.replace('  let ribbons=[],ribbonFeatures=[],hydroCorePaths=[];',
 '  let ribbons=[],ribbonFeatures=[],hydroCorePaths=[],legacyRibbonStats={};');
old=old.replace('  function buildRibbons(){','  function buildRibbons(){\n    legacyRibbonStats={validSkeletonCells:0,seedCount:0,integrationAttempts:0,integrationSucceeded:0,lengthRejected:0,coreAccepted:0,finalBundles:0};');
old=old.replace('    const seeds=[];\n    for(let y=1;',
 '    legacyRibbonStats.validSkeletonCells=Array.from(f.trunkMask).filter(v=>v===1).length;\n    const seeds=[];\n    for(let y=1;');
old=old.replace('    seeds.sort((a,b)=>b.score-a.score||a.id-b.id);',
 '    legacyRibbonStats.seedCount=seeds.length;\n    seeds.sort((a,b)=>b.score-a.score||a.id-b.id);');
old=old.replace('      const budget=Math.round(110+settings.length*1.7);',
 '      legacyRibbonStats.integrationAttempts++;\n      const budget=Math.round(110+settings.length*1.7);');
old=old.replace('      if(path.length<14)continue;',
 '      if(path.length>2)legacyRibbonStats.integrationSucceeded++;\n      if(path.length<14){legacyRibbonStats.lengthRejected++;continue;}');
old=old.replace('      hydroCorePaths.push({path,rank:seed.score});',
 '      legacyRibbonStats.coreAccepted++;\n      hydroCorePaths.push({path,rank:seed.score});');
old=old.replace('    out.hydrologyRibbonCount=ribbons.length;',
 '    out.hydrologyRibbonCount=ribbons.length;out.geometryDiagnostics={ribbons:{...legacyRibbonStats,finalBundles:ribbons.length}};');
fs.writeFileSync(path.join(tmp,'baseline.mjs'),old);
const {createHydroTensorRenderer}=await import(pathToFileURL(path.join(tmp,'baseline.mjs')));
const drawn=new Map();let done;
const ready=new Promise(resolve=>done=resolve);
globalThis.Worker=class{
 postMessage(d){queueMicrotask(()=>this.onmessage({data:{...r,requestId:d.requestId,scenario:d.scenario,grid:d.grid}}))}
 terminate(){}
};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const map={getLayer:()=>false,getSource:id=>({setData:data=>drawn.set(id,data)})};
const renderer=createHydroTensorRenderer({map,sourceId:'axes',particleSourceId:'particles',ribbonSourceId:'ribbons',
 getBounds:()=>[[0,1],[1,1],[1,0],[0,0]],onStatus:message=>{if(message.includes(' lines'))done(message)}});
renderer.configure({mode:'analysis'});renderer.setEnabled(true);
const n=r.cols*r.rows,grid=r.grid;
renderer.setField({cols:r.cols,rows:r.rows,vx:new Int8Array(n),vy:new Int8Array(n),intensity:new Uint8Array(n)},
 {cols:r.cols,rows:r.rows,grid,terrain:Float32Array.from(saved.input.terrain),
 accumulation:Uint16Array.from(saved.input.accumulation),inside:Uint8Array.from(saved.input.inside),obstacle:Uint8Array.from(saved.input.obstacle)},
 {grid,depthMm:Uint16Array.from(saved.input.depthMm),year:2026,force:true});
await ready;
const oldStats=renderer.exportStructuredData().geometryDiagnostics;
const R=6378137;
const toGrid=([lng,lat])=>[(R*lng*Math.PI/180-grid.left)/grid.cellProjectedM,
 (grid.top-R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)))/grid.cellProjectedM];
const oldLines=(drawn.get('axes')?.features||[]).map(f=>({branch:f.properties.branch,path:f.geometry.coordinates.map(p=>{const [x,y]=toGrid(p);return {x,y}})}));
const oldRibbons=(drawn.get('ribbons')?.features||[]).map(f=>({branch:'network',path:f.geometry.coordinates.map(p=>{const [x,y]=toGrid(p);return {x,y}})}));
renderer.dispose();
const settings={density:55,length:65,curvatureSmoothing:65,ribbonConcentration:68,ribbonWidth:42,
 direction:'dual',metersPerPixel:r.cols*r.cellX/1200};
const start=performance.now(),engine=createTensorGeometry(r,settings);
const lines=engine.buildLines(),ribbons=engine.buildRibbons();
const elapsed=performance.now()-start;
assert.equal(sourceHash(),before,'source tensor arrays must remain identical');
const summarize=paths=>{
 const lengths=paths.map(line=>engine.lengthOf(line.path)).sort((a,b)=>a-b);
 return {count:paths.length,medianLengthM:lengths[Math.floor(lengths.length/2)]||0,
 p90LengthM:lengths[Math.floor(lengths.length*.9)]||0,totalLengthM:lengths.reduce((a,b)=>a+b,0),
 under50m:lengths.filter(v=>v<50).length};
};
// Independent segment index for like-for-like old/new supported-cell coverage.
function coverage(paths,branch){
 const gap=engine.diagnostics.primarySpacingM*(branch==='secondary'?1.35:1),radius=gap*1.5,bins=new Map();
 const segments=[];
 for(const line of paths.filter(p=>p.branch===branch))for(let k=1;k<line.path.length;k++){
  const a={x:line.path[k-1].x*r.cellX,y:line.path[k-1].y*r.cellY},b={x:line.path[k].x*r.cellX,y:line.path[k].y*r.cellY},id=segments.length;
  segments.push([a,b]);
  for(let y=Math.floor(Math.min(a.y,b.y)/radius);y<=Math.floor(Math.max(a.y,b.y)/radius);y++)
   for(let x=Math.floor(Math.min(a.x,b.x)/radius);x<=Math.floor(Math.max(a.x,b.x)/radius);x++){
    const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(id);
   }
 }
 let total=0,covered=0;
 for(let y=0;y<r.rows;y++)for(let x=0;x<r.cols;x++){
  const i=y*r.cols+x;if(!r.fields.validMask[i]||r.fields.confidence[i]<.075||r.fields.anisotropy[i]<=.02)continue;
  total++;const px=(x+.5)*r.cellX,py=(y+.5)*r.cellY,ix=Math.floor(px/radius),iy=Math.floor(py/radius);let hit=false;
  for(let oy=-1;oy<=1&&!hit;oy++)for(let ox=-1;ox<=1&&!hit;ox++)for(const id of bins.get((ix+ox)+','+(iy+oy))||[]){
   const [a,b]=segments[id],vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
   const t=den?Math.max(0,Math.min(1,((px-a.x)*vx+(py-a.y)*vy)/den)):0;
   if(Math.hypot(px-a.x-t*vx,py-a.y-t*vy)<radius){hit=true;break}
  }
  if(hit)covered++;
 }return total?covered/total:0;
}
const metrics={old:{field:summarize(oldLines),ribbons:summarize(oldRibbons),ribbonPipeline:oldStats.ribbons,
 primaryCoverage:coverage(oldLines,'primary'),secondaryCoverage:coverage(oldLines,'secondary')},
 current:{field:summarize(lines),ribbons:summarize(ribbons),diagnostics:engine.diagnostics,
 primaryCoverage:coverage(lines,'primary'),secondaryCoverage:coverage(lines,'secondary')},
 unchangedTensorHash:before,tensorArraysUnchanged:true,geometryMilliseconds:elapsed,
 site:{cols:r.cols,rows:r.rows,cellX:r.cellX,cellY:r.cellY,grid:r.grid,hasRealBuildingInput:false}};
const pack=lines=>lines.map(p=>({branch:p.branch,rank:p.rank||0,hierarchy:p.hierarchy,path:p.path.map(q=>[q.x,q.y])}));
fs.writeFileSync(outPath,JSON.stringify({metrics,oldLines:pack(oldLines),oldRibbons:pack(oldRibbons),
 lines:pack(lines),ribbons:pack(ribbons),skeleton:pack(engine.getSkeleton()),
 validMask:Array.from(r.fields.validMask),confidence:Array.from(r.fields.confidence)}));
console.log(JSON.stringify(metrics,null,2));
fs.rmSync(tmp,{recursive:true,force:true});
