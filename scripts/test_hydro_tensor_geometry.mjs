import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTensorGeometry} from './hydro_tensor_geometry.js';
function fixture(w=81,h=61){
 const n=w*h,f={};
 for(const name of ['primaryX','primaryY','confidence','anisotropy','drainageRank','drainageAreaKm2','drainageConfidence','rainfallInfluence'])f[name]=new Float32Array(n);
 for(const name of ['validMask','drainageMask','trunkMask'])f[name]=new Uint8Array(n);
 f.primaryX.fill(1);f.confidence.fill(.85);f.anisotropy.fill(1);f.validMask.fill(1);
 return {cols:w,rows:h,cellX:10,cellY:10,demNativeResolutionM:50,fields:f};
}
const options={metersPerPixel:2,density:55,length:65,curvatureSmoothing:65};
const digest=r=>{const h=createHash('sha256');for(const a of Object.values(r.fields))h.update(new Uint8Array(a.buffer));return h.digest('hex')};
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name)}
const straight=fixture(),g=createTensorGeometry(straight,options),lines=g.buildLines(),ribbons=g.buildRibbons();
test('long dual-family curves cover supported cells without fixed line caps',()=>{
 assert.ok(lines.filter(l=>l.branch==='primary').length>20);
 assert.ok(lines.filter(l=>l.branch==='secondary').length>20);
 assert.ok(g.diagnostics.field.primary.coverage>.9);
 assert.ok(g.diagnostics.field.secondary.coverage>.9);
 const major=lines.filter(l=>l.branch==='primary').map(l=>l.lengthM).sort((a,b)=>a-b);
 assert.ok(major[Math.floor(major.length/2)]>200);
 assert.equal(g.diagnostics.field.primary.budgetReached,false);
});
test('zero network output is explicit when no source channel reaches the threshold',()=>{
 assert.equal(ribbons.length,0);assert.equal(g.diagnostics.ribbons.networkMaskCells,0);
 assert.equal(g.diagnostics.ribbons.reason,'no_network_above_threshold');
 for(const k of ['validSkeletonCells','seedCount','integrationSucceeded','lengthRejected','finalBundles'])assert.equal(g.diagnostics.ribbons[k],0);
});
test('zoom changes physical spacing and curve count, not the tensor field',()=>{
 const close=createTensorGeometry(straight,{...options,metersPerPixel:1}),far=createTensorGeometry(straight,{...options,metersPerPixel:6});
 const a=close.buildLines(),b=far.buildLines();
 assert.ok(a.length>b.length*1.5);assert.ok(close.diagnostics.primarySpacingM<far.diagnostics.primarySpacingM);
});
test('more supported area creates more trajectories at the same physical spacing',()=>{
 const small=createTensorGeometry(fixture(41,31),options).buildLines();
 assert.ok(lines.length>small.length*1.3);
});
test('eigenvector sign flips do not truncate an undirected eigenaxis',()=>{
 const r=fixture();for(let y=0;y<r.rows;y++)for(let x=40;x<r.cols;x++)r.fields.primaryX[y*r.cols+x]=-1;
 const engine=createTensorGeometry(r,options),path=engine.integrate(40.5,30.5,'primary',1,700);
 assert.ok(engine.lengthOf(path)>350);
});
// Independent geometric rectangle intersection, not the generator's mask test.
function touchesRectangle(a,b,box){
 let lo=0,hi=1;const vx=b.x-a.x,vy=b.y-a.y;
 for(const [p,q] of [[-vx,a.x-box[0]],[vx,box[2]-a.x],[-vy,a.y-box[1]],[vy,box[3]-a.y]]){
  if(!p){if(q<0)return false;continue}
  const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
  if(lo>hi)return false;
 }return true;
}
test('bidirectional integration and smoothing never cross a parcel or NoData hole',()=>{
 const r=fixture(),box=[30,20,42,42];
 for(let y=20;y<42;y++)for(let x=30;x<42;x++)r.fields.validMask[y*r.cols+x]=0;
 for(let y=0;y<r.rows;y++)r.fields.validMask[y*r.cols+60]=0;
 const engine=createTensorGeometry(r,options),out=engine.buildLines();assert.ok(out.length>20);
 for(const line of out)for(let k=1;k<line.path.length;k++){
  const a=line.path[k-1],b=line.path[k];
  assert.equal(touchesRectangle(a,b,[30.001,20.001,41.999,41.999]),false);
  assert.ok((a.x<60&&b.x<60)||(a.x>=61&&b.x>=61));
 }
});
test('low confidence stays a real gap rather than being filled with random lines',()=>{
 const r=fixture();for(let y=0;y<r.rows;y++)for(let x=35;x<45;x++)r.fields.confidence[y*r.cols+x]=.01;
 const engine=createTensorGeometry(r,options),out=engine.buildLines();
 for(const line of out)for(const p of line.path)assert.ok(p.x<35||p.x>=45);
 assert.ok(engine.diagnostics.supportedDirectionCells<r.cols*r.rows);
});
const fork=fixture();
for(let y=0;y<fork.rows;y++)for(let x=0;x<fork.cols;x++){
 const main=Math.abs(x-40)<4;
 const left=y<31&&Math.abs(x-(10+y))<4;
 const right=y<31&&Math.abs(x-(70-y))<4;
 const i=y*fork.cols+x;
 if(main||left||right){fork.fields.drainageMask[i]=1;fork.fields.drainageRank[i]=main?.8:.55;fork.fields.drainageAreaKm2[i]=main?100:10;}
}
test('actual scalar-area mask recovers trunk and tributary geometry when PCA axes are absent',()=>{
 const engine=createTensorGeometry(fork,options),out=engine.buildRibbons(),d=engine.diagnostics.ribbons;
 assert.ok(d.validSkeletonCells>30);assert.ok(d.skeletonChains>=3);assert.ok(d.seedCount>0);
 assert.ok(d.integrationSucceeded>0);assert.ok(out.length>0);assert.equal(d.finalBundles,out.length);
 assert.equal(d.reason,null);assert.equal(d.pcaDirectionCells,0);
 for(const line of out)for(let k=1;k<line.path.length;k++)assert.ok(engine.segmentClear(line.path[k-1],line.path[k],'network'));
});
test('a missing network segment is never bridged to manufacture a channel',()=>{
 const r=structuredClone(fork);
 for(let y=40;y<44;y++)for(let x=0;x<r.cols;x++)r.fields.drainageMask[y*r.cols+x]=0;
 const engine=createTensorGeometry(r,options),out=engine.buildRibbons();
 for(const line of out)for(let k=1;k<line.path.length;k++){
  const a=line.path[k-1],b=line.path[k];assert.ok((a.y<40&&b.y<40)||(a.y>=44&&b.y>=44));
 }
});
test('one unsupported raster corner does not discard both long valid skeleton tails',()=>{
 const r=fixture();
 for(let x=10;x<=30;x++)r.fields.drainageMask[30*r.cols+x]=1;
 for(let x=31;x<=70;x++)r.fields.drainageMask[29*r.cols+x]=1;
 const engine=createTensorGeometry(r,options),out=engine.buildRibbons(),d=engine.diagnostics.ribbons;
 assert.ok(d.skeletonBrokenEdges>0);
 assert.equal(d.representedSkeletonCells,d.validSkeletonCells);
 assert.ok(out.filter(line=>line.centralSkeleton).length>=2);
 for(const line of out)for(let k=1;k<line.path.length;k++)assert.ok(engine.segmentClear(line.path[k-1],line.path[k],'network'));
});
test('a uniform high-area patch is not turned into an invented river skeleton',()=>{
 const r=fixture();r.fields.drainageMask.fill(1);r.fields.drainageRank.fill(.8);r.fields.drainageAreaKm2.fill(100);
 const engine=createTensorGeometry(r,options);assert.equal(engine.buildRibbons().length,0);
 assert.equal(engine.diagnostics.ribbons.reason,'network_mask_covers_site');
});
test('geometry is deterministic and leaves every source array unchanged',()=>{
 const before=digest(fork),saved=Math.random;Math.random=()=>{throw Error('random filler prohibited')};
 try{
  const a=createTensorGeometry(fork,{...options,direction:'primary'}),b=createTensorGeometry(fork,{...options,direction:'primary'});
  assert.deepEqual(a.buildRibbons(),b.buildRibbons());
 }finally{Math.random=saved}
 assert.equal(digest(fork),before);
});
test('whole-valid coverage never substitutes the supported-only denominator',()=>{
 const r=fixture(41,31);for(let i=0;i<r.fields.confidence.length;i++)if(i%41>=20)r.fields.confidence[i]=0;
 r.siteMask=new Uint8Array(41*31).fill(1);r.obstacleMask=new Uint8Array(41*31);
 const engine=createTensorGeometry(r,options);engine.buildLines();const d=engine.diagnostics,p=d.field.primary;
 assert.equal(d.validCells,1271);assert.equal(d.supportedDirectionCells,620);
 assert.equal(p.wholeValidCoverageDenominator,1271);assert.equal(p.supportedCoverageDenominator,620);
 assert.equal(p.wholeValidCoverage,p.coveredSupportedCells/1271);
 assert.ok(p.wholeValidCoverage<.5&&p.supportedCoverage>.8);
 assert.ok(p.confidenceStops>0);assert.ok(d.probeStopReasons.low_confidence>0);
});
test('static analysis seeds the full parcel even when only one corner is visible',()=>{
 const r=fixture(61,41),engine=createTensorGeometry(r,{...options,mode:'analysis',viewRect:[0,0,10,10]});
 const out=engine.buildLines();assert.deepEqual(engine.diagnostics.viewRect,[0,0,61,41]);
 assert.equal(engine.diagnostics.visibleSupportedDirectionCells,100);
 assert.ok(out.some(line=>line.path.some(p=>p.x>55&&p.y>30)));
 assert.ok(engine.diagnostics.field.primary.wholeValidCoverage>.9);
});
test('unambiguous real skeleton junctions retain a continuous main strand',()=>{
 const r=fixture();
 for(let x=5;x<76;x++){r.fields.drainageMask[30*r.cols+x]=1;r.fields.drainageRank[30*r.cols+x]=.9}
 for(let y=10;y<=30;y++){r.fields.drainageMask[y*r.cols+40]=1;r.fields.drainageRank[y*r.cols+40]=.5}
 const engine=createTensorGeometry(r,options),out=engine.buildRibbons();
 assert.ok(engine.diagnostics.ribbons.junctionContinuations>0);
 assert.ok(out.some(line=>line.centralSkeleton&&line.lengthM>600));
 for(const line of out)for(let k=1;k<line.path.length;k++)assert.ok(engine.segmentClear(line.path[k-1],line.path[k],'network'));
});
console.log(`${count} geometry regression groups passed`);
