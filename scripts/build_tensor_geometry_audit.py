"""Render actual computed streamline geometry, not generated reference imagery."""
from pathlib import Path
import json,hashlib,subprocess,tempfile,os
import numpy as np
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
root=Path(__file__).resolve().parents[1]
meta=json.loads((root/'assets/drainage_area/metadata.json').read_text())
with tempfile.TemporaryDirectory(prefix='london-streamline-') as td:
 tmp=Path(td)
 for name,asset in [('dem','dem50_log16.webp'),('area','area_log16.webp')]:
  p=root/'assets/drainage_area'/asset
  expected=meta['terrain_dem_asset']['sha256'] if name=='dem' else meta['asset_sha256']
  assert hashlib.sha256(p.read_bytes()).hexdigest()==expected
  a=np.asarray(Image.open(p).convert('RGB'))
  ((a[:,:,0].astype(np.uint16)<<8)|a[:,:,1]).astype('<u2').tofile(tmp/(name+'.bin'))
 cfg={'bounds':meta['web_grid']['bounds_m'],'width':meta['web_grid']['width'],'height':meta['web_grid']['height'],'bbox':[-.31,51.475,-.28,51.49]}
 (tmp/'config.json').write_text(json.dumps(cfg))
 env=dict(os.environ,TENSOR_GEOMETRY_FIXTURE=str(tmp/'fixture.json'))
 subprocess.run(['node',str(root/'scripts/run_tensor_audit.mjs'),str(tmp)],env=env,cwd=root,check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['node',str(root/'scripts/audit_tensor_streamlines.mjs'),str(tmp/'fixture.json'),str(tmp/'geometry.json')],cwd=root,check=True)
 data=json.loads((tmp/'geometry.json').read_text());m=data['metrics'];out=root/'diagnostics'
 w,h=m['site']['cols'],m['site']['rows'];dx,dy=m['site']['cellX'],m['site']['cellY']
 def panel(ax,lines,ribbons,title):
  ax.set_facecolor('#000000')
  for branch,color,width,alpha in [('secondary','#777fa8',.28,.48),('primary','#65bed4',.38,.74)]:
   segments=[np.array(p['path'])*[dx,-dy]+[0,h*dy] for p in lines if p['branch']==branch]
   ax.add_collection(LineCollection(segments,colors=color,linewidths=width,alpha=alpha))
  segments=[np.array(p['path'])*[dx,-dy]+[0,h*dy] for p in ribbons]
  ax.add_collection(LineCollection(segments,colors='#91e4ef',linewidths=.42,alpha=.86))
  ax.set_xlim(0,w*dx);ax.set_ylim(0,h*dy);ax.set_aspect('equal');ax.set_title(title,color='#dce8f0',fontsize=12,loc='left')
  ax.tick_params(colors='#798995',labelsize=8)
  for s in ax.spines.values():s.set_color('#24323d')
 fig,axes=plt.subplots(1,2,figsize=(16,7.3),constrained_layout=True,facecolor='#05080b')
 panel(axes[0],data['oldLines'],data['oldRibbons'],'v3.22.48 | fixed step/count placement')
 panel(axes[1],data['lines'],data['ribbons'],'v3.22.49 | adaptive bidirectional streamlines')
 fig.suptitle('London Map | Static geometry audit | identical verified tensor arrays',color='white',fontsize=15)
 fig.supxlabel('Kew: real OS Terrain 50 + contributing area, same modeled depth. No real building input in this offline sample.\nSubcell curves are display interpolation; source DEM resolution remains 50 m. Network skeleton is not validated D8 topology.',color='#a7b7c5',fontsize=9)
 fig.savefig(out/'tensor-streamlines-comparison.png',dpi=150,facecolor=fig.get_facecolor())
 Image.open(out/'tensor-streamlines-comparison.png').save(out/'tensor-streamlines-comparison.webp',lossless=True)
 fig2,ax=plt.subplots(figsize=(13,10.3),constrained_layout=True,facecolor='#000000')
 panel(ax,data['lines'],data['ribbons'],'HYDRO TENSOR FIELD | static principal / secondary axes + mask-derived network bundles')
 fig2.supxlabel('Real Kew raster inputs | geometry only | 50 m source DEM | no real building input in this offline sample',color='#9daeba',fontsize=9)
 fig2.savefig(out/'tensor-streamlines-static.png',dpi=160,facecolor=fig2.get_facecolor())
 Image.open(out/'tensor-streamlines-static.png').save(out/'tensor-streamlines-static.webp',lossless=True)
 (out/'tensor-streamlines-audit.json').write_text(json.dumps(m,indent=2)+'\n')
