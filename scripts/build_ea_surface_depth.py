"""Create georeferenced official EA flood-depth reference rasters for London.

Official EA Flood Map for Planning / Surface Water Spatial Planning Depths,
future climate 2070s Upper End (2061–2125), 0.1% AEP.
Not the return period of a user-entered 100 mm/2h rainfall event.
No water is synthesized; unknown colours abort data publication.
"""
from __future__ import annotations
import hashlib, io, json, sys, xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from datetime import datetime, timezone
import numpy as np
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT=Path(__file__).resolve().parents[1]
ASSET=ROOT/"assets/flood_risk"
CACHE=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/".cache/ea_depth"
CACHE.mkdir(parents=True,exist_ok=True)
ASSET.mkdir(parents=True,exist_ok=True)
MANIFEST=json.loads((ASSET/"ea_depth_wms_capabilities.json").read_text())
SRC=MANIFEST["sources"]["climate_2070_upper"]
SOURCE_URL=SRC["url"]
LAYER_NAME="Surface_Water_Spatial_Planning_1in1000_Depths_CCP1"
LAYERS={x["name"]:x for x in SRC["layers"]}
if LAYER_NAME not in LAYERS:raise RuntimeError("official WMS layer missing")
RULES=LAYERS[LAYER_NAME].get("official_depth_rules",[])
DEPTH_LABELS=["<150mm","150-300mm","300-600mm","600-900mm","900-1200mm",
              "1200-2300mm",">2300mm"]
if [r["literal_filters"][0] for r in RULES]!=DEPTH_LABELS:
    raise RuntimeError("EA depth class labels changed: "+repr(RULES))
COLOURS={tuple(bytes.fromhex(r["fills"][0].lstrip("#"))):i+1 for i,r in enumerate(RULES)}
if len(COLOURS)!=7:raise RuntimeError("EA official depth colours not unique")
SOURCE_BOUNDS=(460012.,110348.,600062.,250398.)
SOURCE_SIZE=5602
TILE_SOURCE=2801
WEB_BOUNDS=(-127813.8696191665,6596204.025752107,102461.98815442335,6827041.923624865)
WEB_WIDTH,WEB_HEIGHT=5736,5750
WEB_TRANSFORM=from_bounds(*WEB_BOUNDS,WEB_WIDTH,WEB_HEIGHT)
SOURCE_TRANSFORM=from_bounds(*SOURCE_BOUNDS,SOURCE_SIZE,SOURCE_SIZE)
PALETTE=np.array([(0,0,0,0),(22,131,211,255),(28,113,204,255),
    (27,92,179,255),(21,76,153,255),(22,59,124,255),
    (20,44,102,255),(12,30,75,255)],dtype=np.uint8)

def fetch(url,query):
    errors=[]
    for k in range(4):
        try:
            query={**query}
            if k:query["_retry"]=str(k)+"_"+datetime.now(timezone.utc).isoformat()
            req=Request(url+"?"+urlencode(query),headers={"User-Agent":"LondonMapEAOfficialDepth/3.22.27"})
            with urlopen(req,timeout=90) as response:return response.read()
        except Exception as e:
            errors.append(str(e));print("Retry",k,errors[-1],flush=True)
    raise RuntimeError("Unable to fetch official EA WMS: "+"; ".join(errors))
raw_style=fetch(SOURCE_URL,{"SERVICE":"WMS","VERSION":"1.1.1","REQUEST":"GetStyles","LAYERS":LAYER_NAME})
root=ET.fromstring(raw_style)
SLD="{http://www.opengis.net/sld}"
for rule in root.iter():
    if rule.tag!=SLD+"Rule":continue
    for symbol in list(rule):
        if symbol.tag==SLD+"PolygonSymbolizer":
            for el in list(symbol):
                if el.tag==SLD+"Stroke":symbol.remove(el)
style=ET.tostring(root,encoding="unicode")
(ASSET/"ea_depth_0p1_2070upper_official.sld").write_bytes(raw_style)

def get_tile(row,col):
    y=row*TILE_SOURCE;x=col*TILE_SOURCE
    w=min(TILE_SOURCE,SOURCE_SIZE-x);h=min(TILE_SOURCE,SOURCE_SIZE-y)
    bb=[SOURCE_BOUNDS[0]+x*(SOURCE_BOUNDS[2]-SOURCE_BOUNDS[0])/SOURCE_SIZE,
        SOURCE_BOUNDS[3]-(y+h)*(SOURCE_BOUNDS[3]-SOURCE_BOUNDS[1])/SOURCE_SIZE,
        SOURCE_BOUNDS[0]+(x+w)*(SOURCE_BOUNDS[2]-SOURCE_BOUNDS[0])/SOURCE_SIZE,
        SOURCE_BOUNDS[3]-y*(SOURCE_BOUNDS[3]-SOURCE_BOUNDS[1])/SOURCE_SIZE]
    q={"SERVICE":"WMS","REQUEST":"GetMap","VERSION":"1.3.0","LAYERS":LAYER_NAME,
       "STYLES":"","CRS":"EPSG:27700","BBOX":",".join(map(str,bb)),
       "WIDTH":w,"HEIGHT":h,"FORMAT":"image/png","TRANSPARENT":"TRUE",
       "FORMAT_OPTIONS":"antialias:none","SLD_BODY":style}
    filename=CACHE/f"depth_{row}_{col}.png"
    if not filename.exists():
        data=fetch(SOURCE_URL,q)
        image=Image.open(io.BytesIO(data)).convert("RGBA")
        if image.size!=(w,h):raise RuntimeError("Official WMS unexpected tile dimensions")
        filename.write_bytes(data)
    rgba=np.asarray(Image.open(filename).convert("RGBA"))
    cls=np.zeros((h,w),dtype=np.uint8)
    for color,rank in COLOURS.items():
        cls[(rgba[:,:,3]>0)&np.all(rgba[:,:,:3]==color,axis=2)]=rank
    unknown=(rgba[:,:,3]>0)&(cls==0)
    n=int(unknown.sum())
    if n:raise RuntimeError("Unrecognised official WMS colour pixels "+str(n)+" in "+str(filename))
    print("EA official depth tile",row,col,"flood cells",int((cls>0).sum()),flush=True)
    return row,col,cls

native=np.zeros((SOURCE_SIZE,SOURCE_SIZE),dtype=np.uint8)
with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(get_tile,row,col) for row in range(2) for col in range(2)]
    for future in as_completed(futures):
        r,c,data=future.result()
        native[r*TILE_SOURCE:(r+1)*TILE_SOURCE,c*TILE_SOURCE:(c+1)*TILE_SOURCE]=data
if not np.any(native):raise RuntimeError("EA WMS returned no mapped depth cells")

web=np.zeros((WEB_HEIGHT,WEB_WIDTH),dtype=np.uint8)
reproject(source=native,destination=web,src_transform=SOURCE_TRANSFORM,
          src_crs="EPSG:27700",dst_transform=WEB_TRANSFORM,dst_crs="EPSG:3857",
          src_nodata=0,dst_nodata=0,resampling=Resampling.nearest)
if not np.any(web):raise RuntimeError("EA depth georeferencing lost all cells")
products=[]
for row in range(2):
    for col in range(2):
        y=row*2875;x=col*2868
        dest=ASSET/f"ea_depth_cc_0p1_{row}-{col}.webp"
        Image.fromarray(PALETTE[web[y:y+2875,x:x+2868]]).save(dest,format="WEBP",lossless=True,method=5)
        products.append({"path":str(dest.relative_to(ROOT)),"row":row,"col":col,
            "width":2868,"height":2875,"size_bytes":dest.stat().st_size,
            "sha256":hashlib.sha256(dest.read_bytes()).hexdigest()})
metadata={"source_type":"ea_official_surface_water_depth","not_simulation":True,
    "aep":0.1,"aep_percent":0.1,"epoch":"2070s Upper End (2061-2125)",
    "climate_scenario":"UKCP18 RCP 8.5, 2070s Upper End",
    "source_url":"https://www.data.gov.uk/dataset/ff48e392-ab66-49fa-b6dc-3dc72485a6db/flood-map-for-planning-surface-water-spatial-planning-depths-climate-change",
    "wms_url":SOURCE_URL,"layer":LAYER_NAME,
    "generated_utc":datetime.now(timezone.utc).isoformat(),
    "attribution":"© Environment Agency copyright and/or database right 2025. All rights reserved.",
    "web_grid":{"crs":"EPSG:3857","bounds_m":list(WEB_BOUNDS),"width":WEB_WIDTH,"height":WEB_HEIGHT},
    "class_limits_m":[[0,0.15],[0.15,0.30],[0.30,0.60],[0.60,0.90],
                      [0.90,1.20],[1.20,2.30],[2.30,None]],
    "depth_categories":DEPTH_LABELS,
    "class_counts":np.bincount(web.ravel(),minlength=8).tolist(),
    "products":products,
    "interpretation":"Official EA 0.1% AEP climate change depth classes and extent. NOT a calibration to a user-defined 100 mm/2h storm and NOT an annual 2100 flood forecast."}
(ASSET/"ea_depth_cc_0p1_metadata.json").write_text(json.dumps(metadata,indent=2)+"\n")
print("EA depth reference built",metadata["class_counts"],flush=True)
