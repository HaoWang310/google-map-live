"""Offline audit from repository rasters; no new terrain or network data.
Run: python scripts/build_tensor_audit.py
Requires numpy, pillow and matplotlib. Node runs the existing flood model.
"""
from pathlib import Path
import json, tempfile, subprocess, hashlib
import numpy as np
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
root=Path(__file__).resolve().parents[1]
meta=json.loads((root/'assets/drainage_area/metadata.json').read_text())
with tempfile.TemporaryDirectory(prefix='london-tensor-audit-') as td:
 tmp=Path(td)
 for name,asset in [('dem','dem50_log16.webp'),('area','area_log16.webp')]:
  p=root/'assets/drainage_area'/asset
  expected=meta['terrain_dem_asset']['sha256'] if name=='dem' else meta['asset_sha256']
  assert hashlib.sha256(p.read_bytes()).hexdigest()==expected
  rgba=np.asarray(Image.open(p).convert('RGB'))
  ((rgba[:,:,0].astype(np.uint16)<<8)|rgba[:,:,1]).astype('<u2').tofile(tmp/(name+'.bin'))
 config={'bounds':meta['web_grid']['bounds_m'],'width':meta['web_grid']['width'],
         'height':meta['web_grid']['height'],'bbox':[-.31,51.475,-.28,51.49]}
 (tmp/'config.json').write_text(json.dumps(config))
 subprocess.run(['node',str(root/'scripts/run_tensor_audit.mjs'),str(tmp)],cwd=root,check=True)
 data=json.loads((tmp/'result.json').read_text())
 out=root/'diagnostics';out.mkdir(exist_ok=True)
 fields=data['wet']['fields'];w=data['wet']['cols'];h=data['wet']['rows']
 arr=lambda name:np.asarray(fields[name]).reshape(h,w)
 terrain=np.array(data['terrain']).reshape(h,w)
 area=arr('drainageAreaKm2');valid=arr('validMask')>0
 dx=data['wet']['cellX'];dy=data['wet']['cellY']
 fig,axes=plt.subplots(2,2,figsize=(13,10),constrained_layout=True)
 extent=[0,w*dx,0,h*dy]
 titles=['A  Terrain downhill (DEM gradient)','B  Drainage network tangent (accumulation ridge)',
         'C  Tensor principal eigenaxis','D  Tensor secondary eigenaxis']
 keys=[('basePrimaryX','basePrimaryY'),('drainageX','drainageY'),('primaryX','primaryY'),('secondaryX','secondaryY')]
 colors=['#176b49','#046cb4','#973f23','#774cb3']
 for ax,title,(kx,ky),color in zip(axes.flat,titles,keys,colors):
  ax.imshow(terrain,cmap='Greys',extent=extent,alpha=.45,origin='upper')
  # Water depth is from an illustrative event run on the unchanged solver.
  dep=np.array(data['depthMm']).reshape(h,w)/1000
  ax.imshow(np.ma.masked_less(dep,.02),cmap='Blues',vmin=.02,vmax=.25,
            extent=extent,origin='upper',alpha=.35)
  if kx=='drainageX':
   ax.imshow(np.ma.masked_where(area<1,np.log10(np.maximum(area,.0025))),
             extent=extent,origin='upper',cmap='Blues',alpha=.55)
  ux,uy=arr(kx),arr(ky);segments=[]
  stride=6 if kx!='drainageX' else 2
  for y in range(0,h,stride):
   for x in range(0,w,stride):
    if not valid[y,x] or np.hypot(ux[y,x],uy[y,x])<.5:continue
    cx=(x+.5)*dx;cy=(h-y-.5)*dy;half=dx*2.1
    segments.append([(cx-ux[y,x]*half,cy+uy[y,x]*half),(cx+ux[y,x]*half,cy-uy[y,x]*half)])
  ax.add_collection(LineCollection(segments,colors=color,linewidths=.85 if kx!='drainageX' else 1.1))
  ax.set_title(title,fontsize=11,loc='left');ax.set_aspect('equal')
  ax.set_xlabel('Local east (ground m)');ax.set_ylabel('Local north (ground m)')
 fig.suptitle('London Map | Computation audit v3.22.48\nKew sample: real OS Terrain 50 + published contributing area; source resolution 50 m',fontsize=15)
 fig.supxlabel('Blue: illustrative 25 mm/h, 120 min event, unchanged flood solver. No building input in this offline sample.\nNetwork tangents are unsigned estimates; original D8 directions are unavailable. Not a 2100 forecast.',fontsize=10)
 fig.savefig(out/'tensor-continuity.png',dpi=160)
 # A compact lossless copy is tracked with the report.
 Image.open(out/'tensor-continuity.png').save(out/'tensor-continuity.webp',lossless=True)
 # Fixed sampling positions and line lengths: only actual eigenaxes change.
 fig2,axes2=plt.subplots(3,2,figsize=(12,12),constrained_layout=True)
 names={'terrainWeight':'Terrain weight','drainageWeight':'Drainage weight','avoidance':'Wetness weight'}
 for row,(key,cases) in enumerate(data['cases'].items()):
  entry=next(x for x in data['sensitivity'] if x['parameter']==key)
  for col,case in enumerate(cases):
   ax=axes2[row,col];f=case['fields']
   ux=np.array(f['primaryX']).reshape(h,w);uy=np.array(f['primaryY']).reshape(h,w)
   ax.imshow(terrain,cmap='Greys',extent=extent,alpha=.4,origin='upper')
   ax.imshow(np.ma.masked_less(dep,.02),cmap='Blues',vmin=.02,vmax=.25,extent=extent,alpha=.3,origin='upper')
   segments=[]
   for y in range(0,h,6):
    for x in range(0,w,6):
     if not valid[y,x] or np.hypot(ux[y,x],uy[y,x])<.5:continue
     cx=(x+.5)*dx;cy=(h-y-.5)*dy;half=dx*2.1
     segments.append([(cx-ux[y,x]*half,cy+uy[y,x]*half),(cx+ux[y,x]*half,cy-uy[y,x]*half)])
   ax.add_collection(LineCollection(segments,colors='#703f26',linewidths=.8))
   ax.set_title(names[key]+' '+str(entry['from'] if col==0 else entry['to']),loc='left')
   ax.set_aspect('equal');ax.set_xlabel('Local east (ground m)');ax.set_ylabel('Local north (ground m)')
 fig2.suptitle('Eigenaxis sensitivity | identical DEM, accumulation and modeled depth\nOnly the named weight changes in each row; fixed cell samples and line lengths',fontsize=13)
 fig2.supxlabel('Real Kew rasters; illustrative 25 mm/h storm; no building input. Not a future-year forecast.',fontsize=10)
 fig2.savefig(out/'tensor-weight-response.png',dpi=140)
 Image.open(out/'tensor-weight-response.png').save(out/'tensor-weight-response.webp',lossless=True)
 stats={k:v for k,v in data.items() if k not in ['terrain','depthMm','wet','dry','cases']}
 stats['dry']=data['dry']['diagnostics'];stats['wet']=data['wet']['diagnostics']
 stats['grid']=data['wet']['grid'];stats['bboxLngLat']=config['bbox']
 stats['sourceHashesVerified']=True
 (out/'tensor-continuity.json').write_text(json.dumps(stats,indent=2)+'\n')
 print(json.dumps(stats,indent=2))
