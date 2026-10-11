"""Encode the actual 50 m contributing-area raster for smooth browser display.

Usage: python scripts/build_drainage_display.py /path/to/contributing_area.tif
The compact image is a lossless 16-bit log-value preview, not a new analysis.
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
MIN_AREA, MAX_AREA = 0.0025, 8192.0
with rasterio.open(SOURCE) as src:
    assert src.crs.to_epsg() == 27700
    assert (src.width, src.height) == (2801, 2801)
    assert tuple(src.bounds) == (460012.0, 110348.0, 600062.0, 250398.0)
    assert src.res == (50.0, 50.0)
    area = np.full((HEIGHT, WIDTH), np.nan, dtype=np.float32)
    reproject(source=src.read(1), destination=area,
              src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
              dst_transform=from_bounds(*BOUNDS, WIDTH, HEIGHT),
              dst_crs='EPSG:3857', dst_nodata=np.nan,
              resampling=Resampling.nearest)

valid = np.isfinite(area) & (area > 0)
code = np.zeros(area.shape, dtype=np.uint16)
normal = np.clip(np.log(np.maximum(area[valid], MIN_AREA) / MIN_AREA) /
                 np.log(MAX_AREA / MIN_AREA), 0, 1)
code[valid] = 1 + np.round(normal * 65534).astype(np.uint16)
rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
rgb[:, :, 0] = code >> 8
rgb[:, :, 1] = code & 255
output = ROOT / 'assets' / 'drainage_area'
output.mkdir(exist_ok=True)
image_path = output / 'area_log16.webp'
Image.fromarray(rgb).save(image_path, 'WEBP', lossless=True, method=6, exact=True)
decoded = np.array(Image.open(image_path))
assert np.array_equal(decoded, rgb), 'Value encoding must be lossless'
metadata = {
    'name': 'London contributing area: full 50 m source preview',
    'generated_on': '2026-10-11',
    'source_file': SOURCE.name,
    'source_sha256': hashlib.file_digest(SOURCE.open('rb'), 'sha256').hexdigest(),
    'source_analysis_resolution_m': 50,
    'units': 'km² upstream contributing area',
    'web_grid': {'crs': 'EPSG:3857', 'bounds_m': list(BOUNDS),
                 'width': WIDTH, 'height': HEIGHT},
    'asset': 'assets/drainage_area/area_log16.webp',
    'asset_sha256': hashlib.file_digest(image_path.open('rb'), 'sha256').hexdigest(),
    'asset_size_bytes': image_path.stat().st_size,
    'encoding': {'code': 'R * 256 + G; 0 = NoData',
                 'minimum_area_km2': MIN_AREA, 'maximum_area_km2': MAX_AREA,
                 'decode': '0.0025 * exp((code - 1) / 65534 * log(8192 / 0.0025))'},
    'reprojection': 'Nearest neighbour onto the exact existing hydrology EPSG:3857 grid; no hand offsets.',
    'display': 'Viewport-only 512 px XYZ tiles, z8–18. Clamped cubic interpolation of log area, continuous yellow-to-red palette, original NoData and 70 km mask. This interpolation is visual only; source analysis remains 50 m.',
    'provenance': 'Existing project metadata attributes the analytical raster to EA LiDAR DTM. The TIFF has no original DEM ID, flow-direction raster or complete processing log; upstream analysis is not independently reproduced.',
}
(output / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'bytes': image_path.stat().st_size, 'valid_cells': int(valid.sum()),
                  'size': [WIDTH, HEIGHT]}, indent=2))
