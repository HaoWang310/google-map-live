"""Fetch the official EA DTM overview on the exact hydrology map bounds."""
import hashlib
import io
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'terrain'
OUTPUT.mkdir(exist_ok=True)
BASE = 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/'
BOUNDS = [-127813.8696191665, 6596204.025752107,
          102461.98815442335, 6827041.923624865]
PARAMS = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
          'LAYERS': 'Lidar_Composite_DTM_1m', 'STYLES': '', 'FORMAT': 'image/png',
          'TRANSPARENT': 'TRUE', 'CRS': 'EPSG:3857', 'WIDTH': '2048', 'HEIGHT': '2048',
          'BBOX': ','.join(map(str, BOUNDS))}
URL = BASE + 'wms?' + urllib.parse.urlencode(PARAMS)

def save(raw, retrieved_on):
    image = Image.open(io.BytesIO(raw))
    assert image.size == (2048, 2048), 'EA service did not return the requested image'
    image.save(OUTPUT / 'overview.webp', 'WEBP', quality=88, method=6)
    path = OUTPUT / 'overview.webp'
    metadata = {
        'name': 'EA LiDAR Composite DTM 1 m: fast London overview',
        'publisher': 'Environment Agency',
        'catalogue': 'https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m',
        'licence': 'Open Government Licence',
        'attribution': '© Environment Agency copyright and/or database right 2022.',
        'retrieved_on': retrieved_on,
        'overview_request': URL,
        'overview_grid': {'crs': 'EPSG:3857', 'bounds_m': BOUNDS, 'size': [2048, 2048]},
        'source_resolution_m': 1,
        'overview_note': 'A compressed official coloured terrain rendering for fast regional viewing, not a 1 m numerical DEM. Uses the exact contributing-area/network outer bounds.',
        'official_png_sha256': hashlib.sha256(raw).hexdigest(),
        'overview_asset': 'assets/terrain/overview.webp',
        'overview_asset_sha256': hashlib.file_digest(path.open('rb'), 'sha256').hexdigest(),
        'overview_asset_size_bytes': path.stat().st_size,
        'detail_service': BASE + 'wmts',
        'capabilities': BASE + 'wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0',
        'detail_layer': 'Lidar_Composite_DTM_1m',
        'detail_style': '',
        'tile_matrix_set': 'WebMercatorQuad',
        'tile_crs': 'EPSG:3857', 'tile_size': 256,
        'tile_matrix_order': 'TILEMATRIX=z, TILEROW=y, TILECOL=x; north-west origin, same as OSM XYZ',
        'detail_zoom_range': [8, 17],
        'display_rule': 'Load local overview on selection; load official cached tiles at zoom >=11 or outside the overview. Keep sources on deselection to reuse browser/map caches. Retain overview while detail loads; fall back to tiled official WMS if WMTS fails.',
    }
    (OUTPUT / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    return metadata

if __name__ == '__main__':
    with urllib.request.urlopen(URL, timeout=60) as response:
        raw = response.read()
    result = save(raw, datetime.now(timezone.utc).date().isoformat())
    print(json.dumps({'bytes': result['overview_asset_size_bytes'], 'date': result['retrieved_on']}))
