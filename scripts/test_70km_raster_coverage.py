"""QA of London 70-km raw numerical terrain and catchment coverage.
Run: python scripts/test_70km_raster_coverage.py (numpy + Pillow).
Checks all cell centres in the actual geographical 70-km study circle.
A coloured LiDAR preview is deliberately NOT substituted for numerical DEM.
"""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
hydro=json.loads((ROOT/'assets/drainage_area/metadata.json').read_text())
site=json.loads((ROOT/'assets/london_70km_terrain_metadata.json').read_text())
depth=json.loads((ROOT/'assets/flood_risk/ea_depth_cc_0p1_metadata.json').read_text())
grid=hydro['web_grid']
width,height=grid['width'],grid['height']
west,south,east,north=grid['bounds_m']
assert [west,south,east,north]==depth['web_grid']['bounds_m']
assert depth['web_grid']['width']==2*width and depth['web_grid']['height']==2*height
assert hydro['terrain_dem_asset']['source_resolution_m']==50
for name,expected in [
    ('assets/drainage_area/area_log16.webp',hydro['asset_sha256']),
    ('assets/drainage_area/dem50_log16.webp',hydro['terrain_dem_asset']['sha256'])
]:
    digest=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    assert digest==expected, f'Asset checksum mismatch: {name}'

def raster16(path):
    with Image.open(ROOT/path) as img:
        arr=np.asarray(img.convert('RGB'),dtype=np.uint16)
    assert arr.shape[:2]==(height,width)
    return (arr[:,:,0]<<8)|arr[:,:,1]

dem=raster16('assets/drainage_area/dem50_log16.webp')
upstream=raster16('assets/drainage_area/area_log16.webp')
cx,cy=site['centre_wgs84']['longitude'],site['centre_wgs84']['latitude']
radius=site['radius_m']
R=6378137.0
lon=np.degrees((west+(np.arange(width)+.5)*(east-west)/width)/R)
y=(north-(np.arange(height)+.5)*(north-south)/height)
lat=np.degrees(np.arctan(np.sinh(y/R)))
lat0=math.radians(cy)
dlat=(np.radians(lat)-lat0)[:,None]
dlon=(np.radians(lon-cx))[None,:]
aa=np.sin(dlat/2)**2+np.cos(np.radians(lat))[:,None]*math.cos(lat0)*np.sin(dlon/2)**2
inside=(2*R*np.arctan2(np.sqrt(aa),np.sqrt(np.maximum(0,1-aa))))<=radius
missingDEM=inside&(dem==0)
missingArea=inside&(upstream==0)
validDEM=int(np.count_nonzero(inside&(~missingDEM)))
validArea=int(np.count_nonzero(inside&(~missingArea)))
summary={'circle_cells':int(np.count_nonzero(inside)),
    'valid_dem_cells':validDEM,'missing_dem_cells':int(np.count_nonzero(missingDEM)),
    'valid_upstream_cells':validArea,'missing_upstream_cells':int(np.count_nonzero(missingArea)),
    'source_native_resolution_m':50,'grid_crs':'EPSG:3857'}
print(json.dumps(summary,indent=2))
for label,missing in [('DEM',missingDEM),('upstream contributing area',missingArea)]:
    if np.any(missing):
        iy,ix=np.argwhere(missing)[0]
        raise AssertionError(f'{label} missing within 70km radius near lon={lon[ix]:.6f},lat={lat[iy]:.6f}')
print('PASS: numerical DEM and catchment data cover every sampled cell centre inside the full 70km circle')
