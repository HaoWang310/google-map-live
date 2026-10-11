"""Extract transparent stream-network rasters from the analytical area grid.

No channels are painted or inferred from a screenshot. The source km² values
are thresholded and warped onto the EXACT grid of the existing area overlay.
Usage: python3 scripts/build_drainage_network.py /path/to/contributing_area.tif
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
WIDTH, HEIGHT = 2868, 2875
BOUNDS = (-127813.8696191665, 6596204.025752107,
          102461.98815442335, 6827041.923624865)
TRANSFORM = from_bounds(*BOUNDS, WIDTH, HEIGHT)
OUTPUT = ROOT / 'assets' / 'drainage_network'
OUTPUT.mkdir(parents=True, exist_ok=True)
THRESHOLDS = [('025', 0.25), ('1', 1.0), ('5', 5.0)]
CLASSES = [0.25, 1, 5, 25, 100]
COLORS = [(75, 169, 255, 220), (35, 152, 255, 235),
          (0, 183, 228, 245), (0, 224, 230, 255), (112, 255, 241, 255)]

with rasterio.open(SOURCE) as src:
    assert src.crs.to_epsg() == 27700
    assert (src.width, src.height) == (2801, 2801)
    assert tuple(src.bounds) == (460012.0, 110348.0, 600062.0, 250398.0)
    assert src.res == (50.0, 50.0)
    original = src.read(1)
    valid = np.isfinite(original) & (original > 0)
    area = np.full((HEIGHT, WIDTH), np.nan, dtype=np.float32)
    reproject(source=original, destination=area,
              src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
              dst_transform=TRANSFORM, dst_crs='EPSG:3857', dst_nodata=np.nan,
              resampling=Resampling.nearest)
    source_info = {
        'file_name': SOURCE.name,
        'sha256': hashlib.file_digest(SOURCE.open('rb'), 'sha256').hexdigest(),
        'crs': 'EPSG:27700', 'width': src.width, 'height': src.height,
        'bounds_m': list(src.bounds), 'cell_size_m': 50,
        'cell_area_km2': 0.0025, 'valid_cells': int(valid.sum()),
        'max_contributing_area_km2': float(original[valid].max()),
    }

valid_web = np.isfinite(area) & (area > 0)
products = []
for suffix, threshold in THRESHOLDS:
    rgba = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    mask = valid_web & (area >= threshold)
    for minimum, color in zip(CLASSES, COLORS):
        rgba[mask & (area >= minimum)] = color
    path = OUTPUT / f'network_{suffix}.webp'
    Image.fromarray(rgba).save(path, format='WEBP', lossless=True, method=6)
    assert np.all(rgba[~mask, 3] == 0)
    products.append({
        'threshold_km2': threshold, 'minimum_source_cells': round(threshold / 0.0025),
        'path': str(path.relative_to(ROOT)),
        'source_selected_cells': int((valid & (original >= threshold)).sum()),
        'display_selected_cells': int(mask.sum()), 'size_bytes': path.stat().st_size,
    })

metadata = {
    'name': 'London 70 km terrain-derived drainage network',
    'derived_product': True, 'generated_on': '2026-10-11',
    'source': source_info,
    'method': 'Select contributing-area cells A >= threshold; nearest-neighbour reprojection to the existing contributing-area overlay grid; transparent background.',
    'upstream_attribution': 'Existing repository metadata attributes the input contributing-area raster to Environment Agency LiDAR Composite DTM.',
    'provenance_limit': 'The input GeoTIFF contains geometry and values but no original DEM identifier, flow-direction raster or hydrological processing log. DEM-to-accumulation processing is not independently verified here.',
    'interpretation': 'Terrain-derived potential drainage paths; not a surveyed river network, underground drainage inventory or flood-inundation extent. Thresholds are display/analysis choices, not calibrated channel-initiation values.',
    'source_analysis_resolution_m': 50,
    'web_grid': {'crs': 'EPSG:3857', 'bounds_m': list(BOUNDS),
                 'width': WIDTH, 'height': HEIGHT, 'affine': list(TRANSFORM)[:6]},
    'registration': 'Same exact Web Mercator bounds and base grid as the existing contributing-area overlay. No screenshot margins, manual offsets, or second BNG warp.',
    'area_classes_km2': CLASSES, 'products': products,
    'sources': [
        {'name': 'EA official DTM catalogue (upstream terrain attribution)',
         'url': 'https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m'},
        {'name': 'Esri: Identifying stream networks (threshold method)',
         'url': 'https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-analyst/identifying-stream-networks.htm'},
    ],
}
(ROOT / 'assets' / 'london_drainage_network_metadata.json').write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'products': products, 'grid': metadata['web_grid']}, indent=2))
