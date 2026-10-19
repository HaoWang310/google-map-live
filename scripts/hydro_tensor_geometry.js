import {organicWarp,unevenLevels} from './organic_visual_field.js?v=3.26.3-organic-art-direction';
/* Static geometry only. Never writes tensor arrays, DEM, water depth or masks.
   Subcell samples interpolate existing evidence; they add no DEM resolution.
   Deterministic adaptive streamline placement + scalar-area mask skeleton. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hypot=Math.hypot;
const pointSegment=(x,y,a,b)=>{
  const vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
  const t=den?clamp(((x-a.x)*vx+(y-a.y)*vy)/den,0,1):0;
  return hypot(x-a.x-t*vx,y-a.y-t*vy);
};
export function createTensorGeometry(result,options={}){
  const {cols:w,rows:h,fields:f}=result,n=w*h;
  const dx=result.cellX,dy=result.cellY,cell=Math.min(dx,dy);
  const density=clamp(Number(options.density??55)/100,0,1);
  const lengthSetting=clamp(Number(options.length??65)/100,0,1);
  const smoothing=clamp(Number(options.curvatureSmoothing??65)/100,0,1);
  const mpp=Math.max(.01,Number(options.metersPerPixel)||w*dx/1200);
  const rect=options.viewRect||[0,0,w,h];
  const viewport=[clamp(rect[0],0,w),clamp(rect[1],0,h),clamp(rect[2],0,w),clamp(rect[3],0,h)];
  // Static analysis is a complete parcel, not a cache of its last viewport.
  const roi=options.mode==='presentation'?viewport:[0,0,w,h];
  const diag=hypot((roi[2]-roi[0])*dx,(roi[3]-roi[1])*dy)||cell;
  const spacing=Math.max(cell*.75,mpp*(8.2-5.2*density));
  const nominalStep=clamp(mpp*1.3,cell*.32,cell*.8);
  const targetLength=Math.max(cell*12,diag*(.40+.80*lengthSetting));
  const minLength=Math.max(cell*2.5,Math.min(40,diag*.018));
  // Same physical DEM/catchment for all presets: change placement by actual wetness.
  const wetAt=i=>clamp(Number(f.rainfallInfluence?.[i]||0),0,1);
  const fieldMask=new Uint8Array(n);
  let valid=0,supported=0,visibleSupported=0,parcel=0,obstacles=0;
  const evidenceRejections={confidence:0,anisotropy:0,missingAxis:0};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(f.validMask[i])valid++;
    if(result.siteMask?.[i])parcel++;
    if(result.siteMask?.[i]&&result.obstacleMask?.[i])obstacles++;
    if(f.validMask[i]&&f.confidence[i]>=.075&&f.anisotropy[i]>.02&&hypot(f.primaryX[i],f.primaryY[i])>.5){
      fieldMask[i]=1;supported++;
      if(x+.5>=viewport[0]&&x+.5<=viewport[2]&&y+.5>=viewport[1]&&y+.5<=viewport[3])visibleSupported++;
    }else if(f.validMask[i]){
      if(!(f.confidence[i]>=.075))evidenceRejections.confidence++;
      else if(!(f.anisotropy[i]>.02))evidenceRejections.anisotropy++;
      else evidenceRejections.missingAxis++;
    }
  }
  const diagnostics={gridCells:n,validCells:valid,supportedDirectionCells:supported,
    visibleSupportedDirectionCells:visibleSupported,validAreaM2:valid*dx*dy,
    supportedAreaM2:supported*dx*dy,viewRect:roi,viewportRect:viewport,metersPerPixel:mpp,
    parcelCells:result.siteMask?parcel:null,obstacleCells:result.siteMask?obstacles:null,
    directionEvidenceRatio:valid?supported/valid:0,evidenceRejections,
    coverageDefinition:'supported cells within 1.5 family spacings; whole-valid and parcel ratios use their complete denominators, never viewport-only',
    primarySpacingM:spacing,secondarySpacingM:spacing*1.35,
    targetLengthM:targetLength,minLengthM:minLength,nominalStepM:nominalStep,
    nativeDemResolutionM:result.demNativeResolutionM||50,
    subcellGeometryIsInterpolation:true,wetPlacementIsDesignVisualization:true,
    wetGeometryMethod:'depth-driven local seed priority, path length and spacing; invariant source directions',
    field:{},ribbons:{},stopReasons:{},probeStopReasons:{}};
  const stop=(reason,branch,probe)=>{
    const bucket=probe?diagnostics.probeStopReasons:diagnostics.stopReasons;
    bucket[reason]=(bucket[reason]||0)+1;
    const stats=diagnostics.field[branch];
    if(stats&&!probe){stats.stopReasons[reason]=(stats.stopReasons[reason]||0)+1}
  };
  const index=(x,y)=>{
    const xx=Math.floor(x),yy=Math.floor(y);
    return xx>=0&&yy>=0&&xx<w&&yy<h?yy*w+xx:-1;
  };
  function validAt(x,y,kind='field'){
    const i=index(x,y);return i>=0&&(kind==='network'?networkMask?.[i]&&f.validMask[i]:fieldMask[i]);
  }
  function segmentClear(a,b,kind='field'){
    const distance=hypot((b.x-a.x)*dx,(b.y-a.y)*dy),steps=Math.max(1,Math.ceil(distance/(cell*.18)));
    let px=a.x,py=a.y;
    for(let k=0;k<=steps;k++){
      const x=a.x+(b.x-a.x)*k/steps,y=a.y+(b.y-a.y)*k/steps;
      if(!validAt(x,y,kind))return false;
      if(Math.floor(x)!==Math.floor(px)&&Math.floor(y)!==Math.floor(py)){
        // Physical barriers and parcel holes must never be corner-cut.
        const ia=index(x,py),ib=index(px,y);
        if(ia<0||ib<0||!f.validMask[ia]||!f.validMask[ib])return false;
      }
      px=x;py=y;
    }
    return true;
  }
  let networkMask=null,networkC=null,networkS=null,networkSupport=null,skeletonPaths=[];
  let sampleFailure='no_direction_support',rkFailure='no_direction_support';
  function sample(x,y,branch='primary',previous=null,kind='field'){
    if(!validAt(x,y,kind)){
      const i=index(x,y);
      sampleFailure=i<0?'outside_grid':!f.validMask[i]?
        result.obstacleMask?.[i]?'building_obstacle':result.siteMask&&!result.siteMask[i]?'parcel_boundary':'boundary_obstacle_or_nodata':
        kind==='network'?'outside_network_mask':f.confidence[i]<.075?'low_confidence':
        f.anisotropy[i]<=.02?'isotropic':'missing_axis';
      return null;
    }
    const x0=Math.floor(x-.5),y0=Math.floor(y-.5),tx=x-.5-x0,ty=y-.5-y0;
    let c=0,s=0,total=0,conf=0,rank=0,water=0;
    for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
      const xx=x0+ox,yy=y0+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const i=yy*w+xx;if(!validAt(xx+.5,yy+.5,kind))continue;
      // Interpolation cannot borrow a sample from across an obstacle.
      if(!segmentClear({x,y},{x:xx+.5,y:yy+.5},kind))continue;
      const weight=(ox?tx:1-tx)*(oy?ty:1-ty);if(weight<=0)continue;
      const ux=f.primaryX[i],uy=f.primaryY[i];
      const ci=kind==='network'?networkC[i]:ux*ux-uy*uy;
      const si=kind==='network'?networkS[i]:2*ux*uy;
      const reliability=kind==='network'?networkSupport[i]:f.confidence[i];
      if(reliability<.04)continue;
      c+=ci*weight;s+=si*weight;total+=weight;
      conf+=reliability*weight;rank+=(f.drainageRank[i]||0)*weight;
      water+=(f.rainfallInfluence[i]||0)*weight;
    }
    const mag=hypot(c,s);
    if(total<.12||mag/total<.06){sampleFailure=total<.12?'insufficient_interpolation_support':'axis_cancellation';return null}
    let theta=.5*Math.atan2(s,c)+(branch==='secondary'?Math.PI/2:0);
    let ux=Math.cos(theta),uy=Math.sin(theta);
    if(previous&&ux*previous.x+uy*previous.y<0){ux=-ux;uy=-uy}
    return {x:ux,y:uy,confidence:conf/total,rank:rank/total,water:water/total};
  }
  class SpacingIndex{
    constructor(gap){this.gap=gap;this.bins=new Map();this.segments=[];
      this.visitedSegments=[];this.distanceQuery=0;}
    key(x,y){return Math.floor(x/this.gap)+','+Math.floor(y/this.gap)}
    add(path){
      for(let k=1;k<path.length;k++){
        const a={x:path[k-1].x*dx,y:path[k-1].y*dy},b={x:path[k].x*dx,y:path[k].y*dy};
        const id=this.segments.length;this.segments.push([a,b]);
        this.visitedSegments.push(0);
        const x0=Math.floor(Math.min(a.x,b.x)/this.gap),x1=Math.floor(Math.max(a.x,b.x)/this.gap);
        const y0=Math.floor(Math.min(a.y,b.y)/this.gap),y1=Math.floor(Math.max(a.y,b.y)/this.gap);
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const key=x+','+y;let bin=this.bins.get(key);if(!bin)this.bins.set(key,bin=[]);bin.push(id);
        }
      }
    }
    distance(x,y,radius=this.gap*1.6){
      x*=dx;y*=dy;const ix=Math.floor(x/this.gap),iy=Math.floor(y/this.gap),r=Math.ceil(radius/this.gap);
      let best=Infinity;
      const serial=++this.distanceQuery;
      for(let oy=-r;oy<=r;oy++)for(let ox=-r;ox<=r;ox++){
        const bin=this.bins.get((ix+ox)+','+(iy+oy));if(!bin)continue;
        // The same segment occupies several bins. Evaluate its distance
        // only once per query; this is a hot path during RK4 integration.
        for(const id of bin){
          if(this.visitedSegments[id]===serial)continue;
          this.visitedSegments[id]=serial;
          const [a,b]=this.segments[id];
          const distance=pointSegment(x,y,a,b);
          if(distance<best)best=distance;
        }
      }return best;
    }
  }
  const lengthOf=path=>{let sum=0;for(let i=1;i<path.length;i++)sum+=hypot((path[i].x-path[i-1].x)*dx,(path[i].y-path[i-1].y)*dy);return sum};
  function rk4(p,step,branch,sign,previous,kind){
    const read=(x,y,ref)=>{const v=sample(x,y,branch,ref,kind);if(!v)rkFailure=sampleFailure;return v};
    const a=read(p.x,p.y,previous);if(!a)return null;
    const at=(v,t,ref)=>read(p.x+sign*v.x*step*t/dx,p.y+sign*v.y*step*t/dy,ref);
    const b=at(a,.5,a);if(!b)return null;
    const c=at(b,.5,b);if(!c)return null;
    const d=at(c,1,c);if(!d)return null;
    const x=p.x+sign*step*(a.x+2*b.x+2*c.x+d.x)/(6*dx);
    const y=p.y+sign*step*(a.y+2*b.y+2*c.y+d.y)/(6*dy);
    const out={x,y,rank:a.rank,water:a.water,confidence:a.confidence};
    if(!segmentClear(p,out,kind)){rkFailure='segment_mask';return null}
    return {point:out,axis:d,turn:Math.acos(clamp(a.x*d.x+a.y*d.y,-1,1))};
  }
  function integrate(sx,sy,branch='primary',sign=1,maxLength=targetLength,kind='field',occupied=null,gap=spacing,probe=false){
    const traceStats=diagnostics.field[branch];
    if(traceStats){const key=probe?'probeTraceCalls':'traceCalls';traceStats[key]=(traceStats[key]||0)+1}
    let p={x:sx,y:sy},axis=null,arc=0,step=nominalStep;const points=[p],visits=new Map();
    const minimumStep=Math.max(cell*.025,Math.min(nominalStep*.08,mpp*.35));
    const maxSteps=Math.ceil(maxLength/minimumStep)+8;
    for(let k=0;k<maxSteps&&arc<maxLength;k++){
      let attempt=null,hstep=Math.min(step,maxLength-arc),failure='integration_error';
      if(hstep<minimumStep){stop('length_target',branch,probe);break}
      for(let retry=0;retry<9;retry++){
        const full=rk4(p,hstep,branch,sign,axis,kind);
        if(full){
          const half=rk4(p,hstep*.5,branch,sign,axis,kind);
          const end=half&&rk4(half.point,hstep*.5,branch,sign,half.axis,kind);
          const error=end?hypot((end.point.x-full.point.x)*dx,(end.point.y-full.point.y)*dy):Infinity;
          if(end&&error<cell*.055&&full.turn<.40){attempt=end;break}
          failure=!end?rkFailure:full.turn>=.40?'curvature':'integration_error';
        }else failure=rkFailure;
        if(traceStats&&!probe){traceStats.adaptiveRetries[failure]=(traceStats.adaptiveRetries[failure]||0)+1}
        hstep*=.5;if(hstep<minimumStep)break;
      }
      if(!attempt){stop(failure,branch,probe);break}
      const next=attempt.point,moved=hypot((next.x-p.x)*dx,(next.y-p.y)*dy);
      if(moved<minimumStep*.5){stop('stagnation',branch,probe);break}
      const localGap=gap*(1-.18*clamp(next.rank||0,0,1));
      if(occupied&&occupied.distance(next.x,next.y)<localGap*.82){stop('spacing',branch,probe);break}
      const key=Math.floor(next.x*dx/(gap*.45))+','+Math.floor(next.y*dy/(gap*.45));
      const seen=visits.get(key);
      if(seen!==undefined&&arc-seen>Math.max(4*gap,cell*5)){stop('loop',branch,probe);break}
      if(seen===undefined)visits.set(key,arc);
      points.push(next);arc+=moved;p=next;axis=attempt.axis;
      step=Math.min(nominalStep,hstep*(attempt.turn<.1?1.3:1));
      if(k===maxSteps-1)stop('step_budget',branch,probe);
    }
    return points;
  }
  function smoothPath(path,kind='field'){
    if(path.length<4||smoothing===0)return path;
    let out=path;
    for(let pass=0;pass<2;pass++){
      const next=out.map(p=>({...p}));
      for(let k=1;k<out.length-1;k++){
        const a=out[k-1],p=out[k],b=out[k+1],t=.16*smoothing;
        const q={...p,x:p.x*(1-2*t)+(a.x+b.x)*t,y:p.y*(1-2*t)+(a.y+b.y)*t};
        if(!segmentClear(a,q,kind)||!segmentClear(q,b,kind))continue;
        const field=sample(q.x,q.y,'primary',null,kind);
        const vx=(b.x-a.x)*dx,vy=(b.y-a.y)*dy,mag=hypot(vx,vy);
        // Keep either eigenfamily; smoothing may not turn across the field.
        const alignment=field&&mag?Math.abs((vx*field.x+vy*field.y)/mag):0;
        if(alignment>.97||alignment<.24)next[k]=q;
      }
      if(next.every((p,k)=>k===0||segmentClear(next[k-1],p,kind)))out=next;
    }return out;
  }
  const join=(back,forward)=>back.slice(1).reverse().concat(forward);
  function localVariation(i){
    const x=i%w,y=(i/w)|0;let sum=0,total=0;
    for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const j=yy*w+xx;if(!fieldMask[j])continue;
      const dot=f.primaryX[i]*f.primaryX[j]+f.primaryY[i]*f.primaryY[j];sum+=1-dot*dot;total++;
    }return total?sum/total:0;
  }
  // Exhibition-only visualization, independently removable from the real
  // hydrological tensor analysis. A single smooth diffeomorphic-like warp is
  // sampled by BOTH orthogonal grid families, so their intersections coincide.
  // This is a conceptual woven mesh, NOT evidence-derived water flow lines.
  function buildPresentationWeave(){
    // Real hydrological tensor is not changed: this is a separate visual
    // art-direction layer, sampled from one shared fluid-like warp map.
    // Both families use the SAME deformation, so crossings remain coherent.
    const output=[],distortion=1.18+.35*smoothing;
    const colCount=clamp(Math.round(w*(.58+.24*density)),12,65);
    const rowCount=clamp(Math.round(h*(.58+.24*density)),12,65);
    const levelsX=unevenLevels(colCount,.51),levelsY=unevenLevels(rowCount,.18);
    const fieldMask=result.siteMask||f.validMask;
    const validAtExhibit=(u,v)=>{
      const x=u*w,y=v*h,ix=Math.floor(x),iy=Math.floor(y);
      return ix>=0&&ix<w&&iy>=0&&iy<h&&fieldMask[iy*w+ix]>0;
    };
    const branches=options.direction==='primary'?['primary']:
      options.direction==='secondary'?['secondary']:['primary','secondary'];
    for(const branch of branches){
      const vertical=branch==='secondary',levels=vertical?levelsX:levelsY;
      const count=levels.length,steps=Math.min(420,Math.max(95,Math.round((vertical?h:w)*2.5)));
      const lengths=[],diagnostic={candidateSeeds:count,integrationAttempts:count,
        integrationSucceeded:0,finalLines:0,totalLengthM:0,
        meanLengthM:0,medianLengthM:0,under50m:0,
        wholeValidCoverage:0,supportedCoverage:0,
        visualizationOnly:true,stopReasons:{}};
      for(const fixed of levels){
        let path=[];
        const flush=()=>{
          if(path.length<4){path=[];return}
          const lengthM=lengthOf(path);
          if(lengthM<cell*1.2){path=[];return}
          output.push({branch,kind:'field',path,lengthM,rank:.68,
            wetSupport:0,visualizationOnly:true});
          lengths.push(lengthM);
          diagnostic.finalLines++;diagnostic.integrationSucceeded++;
          diagnostic.totalLengthM+=lengthM;path=[];
        };
        for(let j=0;j<=steps;j++){
          const t=.002+.996*j/steps;
          const [u,v]=vertical?organicWarp(fixed,t,distortion):
            organicWarp(t,fixed,distortion);
          if(!validAtExhibit(u,v)){flush();continue}
          path.push({x:u*w,y:v*h,rank:.68,confidence:1});
        }
        flush();
      }
      lengths.sort((a,b)=>a-b);
      diagnostic.meanLengthM=lengths.length?diagnostic.totalLengthM/lengths.length:0;
      diagnostic.medianLengthM=lengths.length?lengths[Math.floor(lengths.length/2)]:0;
      diagnostic.under50m=lengths.filter(v=>v<50).length;
      diagnostics.field[branch]=diagnostic;
    }
    diagnostics.visualizationOnly=true;
    diagnostics.displayMethod='Shared continuous curl-advection with uneven iso-lines (illustrative)';
    diagnostics.nativeTensorUnchanged=true;
    diagnostics.primarySpacingM=(h*dy)/Math.max(1,rowCount);
    diagnostics.secondarySpacingM=(w*dx)/Math.max(1,colCount);
    return output;
  }
  function buildLines(){
    if(options.mode==='presentation')return buildPresentationWeave();
    const output=[];
    const families=options.direction==='primary'?['primary']:options.direction==='secondary'?['secondary']:['primary','secondary'];
    for(const branch of families){
      const gap=spacing*(branch==='primary'?1:1.35),occupied=new SpacingIndex(gap);
      const stats={candidateSeeds:0,integrationAttempts:0,integrationSucceeded:0,lengthRejected:0,
        wetSensitiveSeeds:0,wetSensitiveLines:0,
        spacingRejected:0,seedSpacingRejected:0,pathSpacingRejected:0,finalLines:0,totalLengthM:0,coverage:0,budgetReached:false,stopReasons:{},adaptiveRetries:{}};
      diagnostics.field[branch]=stats;
      const queue=[],front=[],scheduled=new Set();let propagating=false;
      const enqueue=(x,y)=>{
        if(x<roi[0]||y<roi[1]||x>=roi[2]||y>=roi[3]||!validAt(x,y))return;
        const key=Math.floor(x*dx/(gap*.45))+','+Math.floor(y*dy/(gap*.45));
        if(scheduled.has(key))return;scheduled.add(key);(propagating?front:queue).push({x,y});stats.candidateSeeds++;
      };
      // Adaptive stratification; high angular variation subdivides a tile.
      const tileX=Math.max(1,Math.ceil(gap*8/dx)),tileY=Math.max(1,Math.ceil(gap*8/dy));
      function tile(x0,y0,x1,y1,level=0){
        let best=-1,score=-Infinity,variation=0,waterSum=0,count=0;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
          const i=y*w+x;if(!fieldMask[i])continue;
          const v=localVariation(i);variation+=v;waterSum+=wetAt(i);count++;
          const centre=hypot((x+.5-(x0+x1)/2)*dx,(y+.5-(y0+y1)/2)*dy);
          const s=f.confidence[i]*.25+.18*wetAt(i)-centre/Math.max(cell,gap*8);
          if(s>score){score=s;best=i}
        }
        if(best<0)return;
        if(level<2&&(variation/count>.09||waterSum/count>.36)&&x1-x0>2&&y1-y0>2){
          const mx=(x0+x1)>>1,my=(y0+y1)>>1;
          for(const [a,b,c,d] of [[x0,y0,mx,my],[mx,y0,x1,my],[x0,my,mx,y1],[mx,my,x1,y1]])tile(a,b,c,d,level+1);
        }else {
          if(wetAt(best)>.18)stats.wetSensitiveSeeds++;
          enqueue(best%w+.5,Math.floor(best/w)+.5);
        }
      }
      for(let y=Math.max(0,Math.floor(roi[1]));y<roi[3];y+=tileY)
        for(let x=Math.max(0,Math.floor(roi[0]));x<roi[2];x+=tileX)
          tile(x,y,Math.min(w,Math.ceil(roi[2]),x+tileX),Math.min(h,Math.ceil(roi[3]),y+tileY));
      // Long-potential anchors first, then grow lateral fronts before the
      // remaining anchors. Dense initial anchors otherwise fence each other
      // into short fragments even when a long integral curve is available.
      for(const seed of queue){
        const probe=Math.min(targetLength*.5,cell*28);
        seed.potential=lengthOf(integrate(seed.x,seed.y,branch,-1,probe,'field',null,spacing,true))+lengthOf(integrate(seed.x,seed.y,branch,1,probe,'field',null,spacing,true));
      }
      stats.probedSeeds=queue.length;queue.sort((a,b)=>b.potential-a.potential||a.y-b.y||a.x-b.x);
      let vertices=0;
      // Hard cap prevents the two eigenfamilies from overwhelming the map's
      // GeoJSON/3D paint pass. This limits resolution, not the source tensor.
      const vertexBudget=Math.min(220000,Math.max(12000,Math.ceil(supported*cell/gap*22)));
      const take=seed=>{
        const i=index(seed.x,seed.y),variation=localVariation(i),wet=wetAt(i);
        // Wet scenarios alter sample concentration, not tensor eigenaxes.
        const localGap=Math.max(cell*.50,gap*(1-.15*variation-.12*(f.drainageRank[i]||0)-.34*wet));
        if(occupied.distance(seed.x,seed.y)<localGap){stats.spacingRejected++;stats.seedSpacingRejected++;return}
        stats.integrationAttempts++;
        const limit=targetLength*(branch==='primary'?1:.78)*(1+.22*wet);
        let back=integrate(seed.x,seed.y,branch,-1,limit*.5,'field',occupied,localGap);
        const forward=integrate(seed.x,seed.y,branch,1,limit-lengthOf(back),'field',occupied,localGap);
        // Give the unblocked direction the remaining physical arc budget.
        // A boundary close to the seed must not waste half a long trajectory.
        if(lengthOf(back)>limit*.5-nominalStep*2&&lengthOf(forward)<limit*.45)
          back=integrate(seed.x,seed.y,branch,-1,limit-lengthOf(forward),'field',occupied,localGap);
        let path=join(back,forward);
        if(path.length>2)stats.integrationSucceeded++;
        path=smoothPath(path);const length=lengthOf(path);
        if(length<Math.max(minLength*(branch==='primary'?2.25:1.5),localGap*2.3)){stats.lengthRejected++;return}
        // Post-smoothing spacing is checked against actual accepted segments.
        if(path.some((p,k)=>k%3===0&&occupied.distance(p.x,p.y)<localGap*.73)){
          stats.spacingRejected++;stats.pathSpacingRejected++;return;
        }
        occupied.add(path);vertices+=path.length;stats.finalLines++;stats.totalLengthM+=length;
        if(wet>.18)stats.wetSensitiveLines++;
        output.push({branch,kind:'field',path,lengthM:length,
          rank:path.reduce((s,p)=>s+(p.rank||0),0)/path.length,
          wetSupport:path.reduce((s,p)=>s+(p.water||0),0)/path.length});
        // Jobard-style neighbour seeding propagates coverage perpendicular to
        // real accepted trajectories, rather than adding random filler lines.
        let since=0;
        for(let k=1;k<path.length;k++){
          since+=hypot((path[k].x-path[k-1].x)*dx,(path[k].y-path[k-1].y)*dy);
          if(since<localGap*2)continue;since=0;
          const p=path[k],a=sample(p.x,p.y,branch);if(!a)continue;
          for(const sign of [-1,1])enqueue(p.x-sign*a.y*localGap*1.12/dx,p.y+sign*a.x*localGap*1.12/dy);
        }
      };
      propagating=true;
      for(let head=0,frontHead=0,turn=0;(head<queue.length||frontHead<front.length)&&vertices<vertexBudget;turn++){
        // Breadth-first neighbours plus regularly interleaved anchors avoid
        // a depth-first cluster exhausting the budget before other regions.
        take(frontHead<front.length&&(head>=queue.length||turn%9!==0)?front[frontHead++]:queue[head++]);
      }
      propagating=false;
      // Coverage repair visits only cells with supported directions. It uses
      // the same integration, spacing and length tests; no interpolated hole fill.
      for(let phase=0;phase<2&&vertices<vertexBudget;phase++){
        const step=Math.max(1,Math.floor(gap/(cell*1.4)));
        for(let y=Math.max(0,Math.ceil(roi[1]));y<roi[3]&&vertices<vertexBudget;y+=step)
          for(let x=Math.max(0,Math.ceil(roi[0]));x<roi[2]&&vertices<vertexBudget;x+=step){
            const i=y*w+x,coverageGap=gap*(1.14-.45*wetAt(i));
            if(!fieldMask[i]||occupied.distance(x+.5,y+.5)<coverageGap)continue;
            stats.candidateSeeds++;take({x:x+.5,y:y+.5});
          }
      }
      let covered=0,total=0,viewportCovered=0,viewportTotal=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        if(x<roi[0]||y<roi[1]||x>=roi[2]||y>=roi[3]||!fieldMask[y*w+x])continue;
        total++;const hit=occupied.distance(x+.5,y+.5,gap*1.5)<gap*1.5;
        if(hit)covered++;
        if(x+.5>=viewport[0]&&x+.5<=viewport[2]&&y+.5>=viewport[1]&&y+.5<=viewport[3]){
          viewportTotal++;if(hit)viewportCovered++;
        }
      }
      stats.coverage=total?covered/total:0; // legacy name, explicitly evidence-only
      stats.supportedCoverage=stats.coverage;stats.coveredSupportedCells=covered;
      stats.supportedCoverageDenominator=total;stats.wholeValidCoverageDenominator=valid;
      stats.wholeValidCoverage=valid?covered/valid:0;
      stats.parcelCoverage=parcel?covered/parcel:null;
      stats.viewportSupportedCoverage=viewportTotal?viewportCovered/viewportTotal:0;
      const lengths=output.filter(line=>line.branch===branch).map(line=>line.lengthM).sort((a,b)=>a-b),mid=lengths.length>>1;
      stats.meanLengthM=lengths.length?stats.totalLengthM/lengths.length:0;
      stats.medianLengthM=lengths.length?(lengths.length%2?lengths[mid]:(lengths[mid-1]+lengths[mid])/2):0;
      stats.p90LengthM=lengths[Math.floor((lengths.length-1)*.9)]||0;
      stats.under50m=lengths.filter(v=>v<50).length;stats.under100m=lengths.filter(v=>v<100).length;
      stats.curvatureStops=stats.stopReasons.curvature||0;
      stats.confidenceStops=(stats.stopReasons.low_confidence||0)+(stats.stopReasons.insufficient_interpolation_support||0)+(stats.stopReasons.axis_cancellation||0);
      stats.spacingStops=stats.stopReasons.spacing||0;
      stats.budgetReached=vertices>=vertexBudget;
      stats.vertices=vertices;stats.vertexBudget=vertexBudget;
    }return output;
  }
  function extractSkeleton(){
    networkMask=new Uint8Array(n);let maskCells=0,pcaCells=0;
    for(let i=0;i<n;i++)if(f.validMask[i]&&f.drainageMask[i]){
      networkMask[i]=1;maskCells++;if(f.drainageConfidence[i]>.02)pcaCells++;
    }
    const stats=diagnostics.ribbons={networkMaskCells:maskCells,pcaDirectionCells:pcaCells,
      validSkeletonCells:0,skeletonChains:0,skeletonBrokenEdges:0,skeletonRoutedCorners:0,
      representedSkeletonCells:0,shortSkeletonChains:0,seedCount:0,integrationAttempts:0,
      integrationSucceeded:0,integratedPieces:0,lengthRejected:0,spacingRejected:0,finalBundles:0,
      junctionContinuations:0,junctionAmbiguities:0,
      reason:null,topology:'threshold-mask medial graph; not recovered D8 downstream links'};
    if(!maskCells){stats.reason='no_network_above_threshold';return []}
    if(maskCells>valid*.85){stats.reason='network_mask_covers_site';return []}
    // Zhang-Suen thinning on a padded mask; source mask membership is retained.
    const pw=w+2,ph=h+2,binary=new Uint8Array(pw*ph);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)binary[(y+1)*pw+x+1]=networkMask[y*w+x];
    let changed=true,passes=0;
    while(changed&&passes++<200){
      changed=false;
      for(let phase=0;phase<2;phase++){
        const remove=[];
        for(let y=1;y<ph-1;y++)for(let x=1;x<pw-1;x++){
          const i=y*pw+x;if(!binary[i])continue;
          const p=[binary[i-pw],binary[i-pw+1],binary[i+1],binary[i+pw+1],binary[i+pw],binary[i+pw-1],binary[i-1],binary[i-pw-1]];
          const sum=p.reduce((a,b)=>a+b,0);if(sum<2||sum>6)continue;
          let transitions=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
          if(transitions!==1)continue;
          if(phase===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
          remove.push(i);
        }
        if(remove.length)changed=true;for(const i of remove)binary[i]=0;
      }
    }
    const skeleton=new Uint8Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(binary[(y+1)*pw+x+1]){skeleton[y*w+x]=1;stats.validSkeletonCells++}
    const neighbours=i=>{
      const x=i%w,y=(i/w)|0,out=[];
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        if(!ox&&!oy)continue;const xx=x+ox,yy=y+oy;
        if(xx<0||yy<0||xx>=w||yy>=h||!skeleton[yy*w+xx])continue;
        if(ox&&oy){
          if(!f.validMask[y*w+xx]||!f.validMask[yy*w+x])continue;
          if(skeleton[y*w+xx]||skeleton[yy*w+x])continue;
        }out.push(yy*w+xx);
      }return out;
    };
    const nodes=[];for(let i=0;i<n;i++)if(skeleton[i])nodes.push(i);
    const graph=new Map(nodes.map(i=>[i,neighbours(i)])),visited=new Set(),paths=[];
    const key=(a,b)=>Math.min(a,b)+':'+Math.max(a,b);
    const trace=(start,next)=>{
      const ids=[start];let previous=start,current=next;
      visited.add(key(previous,current));
      for(let k=0;k<n;k++){
        ids.push(current);const near=graph.get(current)||[];
        if(current===start)break;
        const candidates=near.filter(i=>i!==previous&&!visited.has(key(current,i)));
        if(!candidates.length)break;
        let j=candidates[0];
        if(near.length>2){
          // Preserve only unambiguous, nearly tangent continuations through
          // actual graph junctions. This joins real edges, never absent gaps
          // and does not infer an unobserved downstream hydrological order.
          const before=ids[Math.max(0,ids.length-4)],ax=((current%w)-(before%w))*dx,
            ay=(Math.floor(current/w)-Math.floor(before/w))*dy,am=hypot(ax,ay);
          const ranked=candidates.map(id=>{
            const bx=((id%w)-(current%w))*dx,by=(Math.floor(id/w)-Math.floor(current/w))*dy;
            const alignment=am?(ax*bx+ay*by)/(am*hypot(bx,by)):-1;
            return {id,alignment,score:alignment*.85+(f.drainageRank[id]||0)*.15};
          }).sort((a,b)=>b.score-a.score||a.id-b.id);
          if(ranked[0].alignment<.25||ranked[1]&&ranked[0].score-ranked[1].score<.08){
            stats.junctionAmbiguities++;break;
          }
          j=ranked[0].id;stats.junctionContinuations++;
        }
        visited.add(key(current,j));previous=current;current=j;
      }
      const point=i=>({x:i%w+.5,y:Math.floor(i/w)+.5,rank:f.drainageRank[i]||0,confidence:1});
      let path=[point(ids[0])];
      const flush=()=>{
        if(path.length>1)paths.push({path,lengthM:lengthOf(path),rank:path.reduce((s,p)=>s+p.rank,0)/path.length});
      };
      for(let k=1;k<ids.length;k++){
        const a=path.at(-1),b=point(ids[k]);
        if(segmentClear(a,b,'network')){path.push(b);continue}
        // A raster corner may require an orthogonal waypoint. Use only an
        // existing source-mask cell; never bridge an unsupported gap.
        const corners=[{...b,x:a.x},{...b,y:a.y}];
        const via=corners.find(q=>segmentClear(a,q,'network')&&segmentClear(q,b,'network'));
        if(via){path.push(via,b);stats.skeletonRoutedCorners++;continue}
        stats.skeletonBrokenEdges++;flush();path=[b];
      }
      flush();
    };
    const starts=nodes.filter(i=>graph.get(i).length!==2).sort((a,b)=>
      (graph.get(a).length===1?0:1)-(graph.get(b).length===1?0:1)||
      (f.drainageRank[b]||0)-(f.drainageRank[a]||0)||a-b);
    for(const i of starts)for(const j of graph.get(i))if(!visited.has(key(i,j)))trace(i,j);
    for(const i of nodes)for(const j of graph.get(i))if(!visited.has(key(i,j)))trace(i,j);
    stats.skeletonChains=paths.length;stats.thinningPasses=passes;
    stats.representedSkeletonCells=new Set(paths.flatMap(chain=>chain.path.map(p=>index(p.x,p.y))).filter(i=>skeleton[i])).size;
    stats.unrepresentedSkeletonCells=stats.validSkeletonCells-stats.representedSkeletonCells;
    // Orient the mask from its own skeleton chain tangents. This is an
    // explicit geometry-derived network direction, separate from tensor PCA.
    networkC=new Float32Array(n);networkS=new Float32Array(n);networkSupport=new Float32Array(n);
    for(const chain of paths)for(let k=0;k<chain.path.length;k++){
      const a=chain.path[Math.max(0,k-2)],b=chain.path[Math.min(chain.path.length-1,k+2)];
      const x=(b.x-a.x)*dx,y=(b.y-a.y)*dy,mag=hypot(x,y);if(mag<1e-6)continue;
      const i=index(chain.path[k].x,chain.path[k].y);
      networkC[i]+=(x*x-y*y)/(mag*mag);networkS[i]+=2*x*y/(mag*mag);networkSupport[i]++;
    }
    const queue=[],distance=new Int32Array(n);distance.fill(-1);
    for(let i=0;i<n;i++)if(networkSupport[i]){
      const mag=hypot(networkC[i],networkS[i]);networkC[i]/=networkSupport[i];networkS[i]/=networkSupport[i];
      networkSupport[i]=clamp(mag/networkSupport[i],0,1);distance[i]=0;queue.push(i);
    }
    for(let head=0;head<queue.length;head++){
      const i=queue[head],x=i%w,y=(i/w)|0;
      for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
        const j=yy*w+xx;if(!networkMask[j]||distance[j]>=0)continue;
        distance[j]=distance[i]+1;networkC[j]=networkC[i];networkS[j]=networkS[i];networkSupport[j]=networkSupport[i];queue.push(j);
      }
    }
    skeletonPaths=paths;return paths;
  }
  function buildRibbons(){
    if(options.mode==='presentation'){
      diagnostics.ribbons={validSkeletonCells:0,seedCount:0,integrationSucceeded:0,integratedPieces:0,lengthRejected:0,finalBundles:0,reason:'presentation_weave_no_ribbons'};
      return [];
    }
    const cores=extractSkeleton(),output=[],stats=diagnostics.ribbons;
    if(stats.reason)return output;
    const gap=Math.max(cell*.50,spacing*(.45-.18*clamp((options.ribbonConcentration??68)/100,0,1)));
    const occupied=new SpacingIndex(gap);
    const minimum=Math.max(cell*2.5,Math.min(65,diag*.025));
    // Integrate the arc-length parameter of each actual skeleton chain.
    // Lateral lanes follow its constrained geometry inside the same source
    // mask. They do not rely on missing PCA axes or unconstrained copied offsets.
    cores.sort((a,b)=>b.lengthM-a.lengthM||b.rank-a.rank);
    stats.skeletonChainLengthsM=cores.map(chain=>chain.lengthM);
    stats.integrationStops={outsideMask:0,segment:0,spacing:0,insufficientWidth:0};
    for(const chain of cores){
      let core=chain.path.map(p=>({...p}));
      for(let pass=0;pass<10;pass++){
        const next=core.map(p=>({...p}));
        for(let k=1;k<core.length-1;k++){
          const a=core[k-1],p=core[k],b=core[k+1],q={...p,x:(a.x+2*p.x+b.x)/4,y:(a.y+2*p.y+b.y)/4};
          if(segmentClear(a,q,'network')&&segmentClear(q,b,'network'))next[k]=q;
        }
        if(next.every((p,k)=>!k||segmentClear(next[k-1],p,'network')))core=next;
      }
      const arc=[0];for(let k=1;k<core.length;k++)arc.push(arc.at(-1)+hypot((core[k].x-core[k-1].x)*dx,(core[k].y-core[k-1].y)*dy));
      const total=arc.at(-1);if(total<minimum){stats.lengthRejected++;stats.shortSkeletonChains++;continue}
      const width=Math.max(cell,Math.min(50,cell*(.8+(options.ribbonWidth??42)/30)));
      const lanes=Math.floor(width/gap),offsets=[0];
      for(let k=1;k<=lanes;k++)offsets.push(k*gap,-k*gap);
      for(const lane of offsets){
        stats.seedCount++;stats.integrationAttempts++;
        if(lane===0){
          // Retain the connected source graph itself as the central strand.
          // Chords between resampled points near a sharp mask corner can cut
          // outside the source even though the original graph edges are valid.
          // Do not replace that verified route with such shortcuts.
          occupied.add(core);stats.integrationSucceeded++;stats.integratedPieces++;
          output.push({path:core,lengthM:lengthOf(core),rank:chain.rank,kind:'ribbon',branch:'network',centralSkeleton:true});
          continue;
        }
        const points=[];let segment=0;
        for(let s=0;s<=total+nominalStep*.1;s+=nominalStep){
          const at=Math.min(s,total);
          while(segment<core.length-2&&arc[segment+1]<at)segment++;
          const a=core[segment],b=core[segment+1],t=(at-arc[segment])/Math.max(1e-9,arc[segment+1]-arc[segment]);
          const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,rank:a.rank||0};
          const vx=(b.x-a.x)*dx,vy=(b.y-a.y)*dy,mag=hypot(vx,vy);
          if(!mag)continue;
          const nx=-vy/mag,ny=vx/mag,sign=Math.sign(lane)||1;
          let available=0;
          for(let offset=cell*.18;offset<=width;offset+=cell*.18){
            const q={x:p.x+sign*nx*offset/dx,y:p.y+sign*ny*offset/dy};
            if(!segmentClear(p,q,'network'))break;available=offset;
          }
          const offset=lane;
          // Keep physical lane spacing; never squeeze several lanes into a
          // narrow source cell to manufacture a continuous bright bundle.
          if(Math.abs(offset)>available*.92){stats.integrationStops.insufficientWidth++;points.push(null);continue}
          const q={...p,x:p.x+nx*offset/dx,y:p.y+ny*offset/dy};
          const outside=!validAt(q.x,q.y,'network'),
            segmentBlocked=Boolean(points.at(-1)&&!segmentClear(points.at(-1),q,'network')),
            spacingBlocked=occupied.distance(q.x,q.y)<gap*.73;
          if(outside)stats.integrationStops.outsideMask++;
          if(segmentBlocked)stats.integrationStops.segment++;
          if(spacingBlocked)stats.integrationStops.spacing++;
          const blocked=outside||segmentBlocked||spacingBlocked;
          if(blocked){points.push(null);continue}
          points.push(q);
        }
        let chunks=[],part=[];
        const flush=()=>{if(part.length>1)chunks.push(part);part=[]};
        for(const p of points){if(p)part.push(p);else flush()}flush();
        if(chunks.length)stats.integrationSucceeded++;
        stats.integratedPieces+=chunks.length;
        for(let path of chunks){
          path=smoothPath(path,'network');const length=lengthOf(path);
          const pieceMinimum=Math.max(minimum,Math.min(90,chain.lengthM*.12));
          if(length<pieceMinimum){stats.lengthRejected++;continue}
          if(path.some((p,k)=>k%3===0&&occupied.distance(p.x,p.y)<gap*.65)){stats.spacingRejected++;continue}
          occupied.add(path);
          const rank=path.reduce((sum,p)=>sum+(p.rank||0),0)/path.length;
          output.push({path,lengthM:length,rank,kind:'ribbon',branch:'network'});
        }
      }
    }
    const ranks=output.map(line=>line.rank).sort((a,b)=>a-b);
    const contrast=ranks.length?ranks.at(-1)-ranks[0]:0;
    const trunkCut=contrast>.02?ranks[Math.floor((ranks.length-1)*.7)]:-Infinity;
    for(const line of output)line.hierarchy=line.rank>=trunkCut?'trunk':'tributary';
    stats.trunkCutLogAreaRank=Number.isFinite(trunkCut)?trunkCut:null;
    stats.trunkBundles=output.filter(line=>line.hierarchy==='trunk').length;
    stats.tributaryBundles=output.length-stats.trunkBundles;
    stats.finalBundles=output.length;stats.minimumLengthM=minimum;
    const lengths=output.map(line=>line.lengthM).sort((a,b)=>a-b),mid=lengths.length>>1;
    stats.meanLengthM=lengths.length?lengths.reduce((a,b)=>a+b,0)/lengths.length:0;
    stats.medianLengthM=lengths.length?(lengths.length%2?lengths[mid]:(lengths[mid-1]+lengths[mid])/2):0;
    stats.under50m=lengths.filter(v=>v<50).length;
    stats.integrationMethod='mask-constrained skeleton arc-length integration; lanes adapt to observed corridor width';
    stats.reason=output.length?null:!stats.validSkeletonCells?'no_supported_skeleton':!stats.seedCount&&stats.lengthRejected?'all_below_physical_length':!stats.seedCount?'no_supported_seeds':
      stats.integrationSucceeded===0?'integration_blocked_or_ambiguous':stats.lengthRejected?'all_below_physical_length':'spacing_or_length_rejection';
    return output;
  }

  return {buildLines,buildRibbons,sample,integrate,segmentClear,validAt,lengthOf,diagnostics,
    getSkeleton:()=>skeletonPaths};
}

export function buildTensorGeometryPacket(result,options={}){
  const start=performance.now(),engine=createTensorGeometry(result,options);
  const lines=engine.buildLines(),ribbons=engine.buildRibbons(),skeleton=engine.getSkeleton();
  const sections={lines,ribbons,skeleton},meta={},all=[];let points=0;
  for(const [name,items] of Object.entries(sections)){
    meta[name]=items.map(item=>{
      const entry={offset:points,count:item.path.length,branch:item.branch,rank:item.rank||0,
        lengthM:item.lengthM,wetSupport:item.wetSupport||0,hierarchy:item.hierarchy};
      all.push(item.path);points+=item.path.length;return entry;
    });
  }
  const coordinates=new Float64Array(points*2);let at=0;
  for(const path of all)for(const p of path){coordinates[at++]=p.x;coordinates[at++]=p.y}
  return {grid:result.grid,scenario:result.scenario,parameters:{...options},
    diagnostics:{...engine.diagnostics,geometryMilliseconds:performance.now()-start},meta,coordinates};
}
export function unpackTensorGeometryPacket(packet){
  const out={};
  for(const [name,entries] of Object.entries(packet.meta))out[name]=entries.map(entry=>({
    ...entry,path:Array.from({length:entry.count},(_,k)=>({
      x:packet.coordinates[(entry.offset+k)*2],y:packet.coordinates[(entry.offset+k)*2+1]
    }))
  }));
  return out;
}
