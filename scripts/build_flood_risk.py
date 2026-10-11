"""Rebuild the London flood overview from EA's present-day risk-band WMS.

Requires numpy, Pillow and rasterio. Usage:
    python3 scripts/build_flood_risk.py /path/to/cache

The uploaded overview is a visual reference, not a georeferenced data source.
Every request uses BNG metre coordinates; the output shares the hydrology
overlay's exact Web Mercator extent. Failed requests and unknown colours abort
the build, rather than silently publishing them as areas without risk.
"""
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.cache/flood_risk'
OUTPUT = ROOT / 'assets/flood_risk'
CACHE.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
SLD = 'http://www.opengis.net/sld'
NS = {'s': SLD, 'o': 'http://www.opengis.net/ogc'}
ET.register_namespace('sld', SLD)
ET.register_namespace('ogc', NS['o'])
SOURCE_BOUNDS = (460012.0, 110348.0, 600062.0, 250398.0)
SOURCE_SIZE = 11204  # 12.5 m samples; exact existing 140.05 km BNG footprint.
NATIVE_SIZE = SOURCE_SIZE // 2
CHUNK = 2802  # Even dimensions keep each 2 x 2 aggregation on the global grid.
WEB_BOUNDS = (-127813.8696191665, 6596204.025752107,
              102461.98815442335, 6827041.923624865)
WEB_WIDTH, WEB_HEIGHT = 5736, 5750
WEB_TRANSFORM = from_bounds(*WEB_BOUNDS, WEB_WIDTH, WEB_HEIGHT)
SOURCE_TRANSFORM = from_bounds(*SOURCE_BOUNDS, NATIVE_SIZE, NATIVE_SIZE)
CENTER = (51.50733434456047, -0.12768375058439654)
RADIUS = 70000
SOURCES = {
    'rivers_sea': {
        'title': 'Risk of Flooding from Rivers and Sea',
        'catalogue': 'https://www.data.gov.uk/dataset/943d2bbb-aa08-45d1-96cb-42556cd01d94/risk-of-flooding-from-rivers-and-sea2',
        'wms': 'https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea/wms',
        'service': 'https://environment.data.gov.uk/geoservices/datasets/96ab4342-82c1-4095-87f1-0082e8d84ef1/wms',
        'layer': 'rofrs_4band', 'revision': '2026-06-18',
    },
    'surface_water': {
        'title': 'Risk of Flooding from Surface Water',
        'catalogue': 'https://www.data.gov.uk/dataset/0d6fa1f4-0c82-4c91-8667-a549e8e3ca2d/risk-of-flooding-from-surface-water3',
        'wms': 'https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water/wms',
        'service': 'https://environment.data.gov.uk/geoservices/datasets/b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e/wms',
        'layer': 'rofsw', 'revision': '2025-09-17',
    },
}
RANKS = {'Very_low': 1, 'Low': 2, 'Medium': 3, 'High': 4, 'Unavailable': 5}
PALETTE = np.array([(0, 0, 0, 0), (156, 221, 234, 255),
                    (247, 211, 89, 255), (242, 157, 56, 255),
                    (215, 55, 49, 255), (153, 156, 158, 255)], dtype=np.uint8)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(source, params):
    errors = []
    for attempt in range(4):
        base = source['wms'] if attempt % 2 == 0 else source['service']
        # A retry must not reuse a cached gateway error.
        query = dict(params)
        if attempt:
            query['_retry'] = datetime.now(timezone.utc).isoformat()
        try:
            with urlopen(base + '?' + urlencode(query), timeout=55) as response:
                return response.read()
        except Exception as error:
            errors.append(str(error))
            print('Retry', source['layer'], params.get('REQUEST'), attempt + 1,
                  str(error), flush=True)
    raise RuntimeError('; '.join(errors))


def prepare_source(key, source):
    for suffix, request, version in [('capabilities.xml', 'GetCapabilities', '1.3.0'),
                                     ('style.sld', 'GetStyles', '1.1.1')]:
        path = CACHE / f'{key}_{suffix}'
        if not path.exists():
            path.write_bytes(fetch(source, {'SERVICE': 'WMS', 'REQUEST': request,
                             'VERSION': version, 'LAYERS': source['layer']}))
    original = (CACHE / f'{key}_style.sld').read_bytes()
    root = ET.fromstring(original)
    colours = {}
    # Keep the service's exact risk_band filters, fills and scale limits.
    # Remove outline-only symbols: GeoServer may draw zero-width grey strokes
    # as one-pixel boundaries. They are NOT the Unavailable category.
    for rule in root.findall('.//s:Rule', NS):
        name = rule.findtext('s:Name', namespaces=NS)
        if name not in RANKS:
            raise ValueError(f'Unknown official risk rule: {name}')
        fill = rule.find('.//s:CssParameter[@name="fill"]', NS)
        colour = tuple(bytes.fromhex(fill.text.strip().lstrip('#')))
        colours[colour] = RANKS[name]
        for symbol in rule.findall('s:PolygonSymbolizer', NS):
            if symbol.find('s:Fill', NS) is None:
                rule.remove(symbol)
    for node in root.iter():
        node.text = node.text.strip() if node.text else None
        node.tail = None
    clean = ET.tostring(root, encoding='unicode')
    (OUTPUT / f'{key}_fill_only.sld').write_text(clean)
    (OUTPUT / f'{key}_official.sld').write_bytes(original)
    source['official_style_sha256'] = sha(original)
    source['fill_only_style_sha256'] = sha(clean.encode())
    source['capabilities_sha256'] = sha((CACHE / f'{key}_capabilities.xml').read_bytes())
    source['wms_fill_rgb_to_class'] = {str(k): v for k, v in colours.items()}
    source['catalogue_updated'] = '2026-07-06'
    return clean, colours


def decode(data, width, height, colours):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    if im.size != (width, height):
        raise ValueError(f'WMS image size {im.size}; expected {(width, height)}')
    rgba = np.asarray(im)
    classes = np.zeros((height, width), dtype=np.uint8)
    opaque = rgba[:, :, 3] == 255
    if np.any((rgba[:, :, 3] != 0) & ~opaque):
        raise ValueError('Antialiased WMS pixels: categorical decoding is ambiguous')
    for colour, rank in colours.items():
        classes[opaque & np.all(rgba[:, :, :3] == colour, axis=2)] = rank
    unknown = opaque & (classes == 0)
    if unknown.any():
        raise ValueError('Unknown WMS colours: ' + str(np.unique(rgba[unknown], axis=0)[:12]))
    return classes


def generalise(classes):
    h, w = classes.shape
    block = classes.reshape(h // 2, 2, w // 2, 2)
    known = np.where(block == 5, 0, block).max(axis=(1, 3))
    unavailable = (block == 5).any(axis=(1, 3))
    return np.where((known == 0) & unavailable, 5, known).astype(np.uint8)


PREPARED = {key: prepare_source(key, source) for key, source in SOURCES.items()}
native = {key: np.zeros((NATIVE_SIZE, NATIVE_SIZE), dtype=np.uint8) for key in SOURCES}
requests = []


def get_tile(key, y, x):
    source = SOURCES[key]
    width = min(CHUNK, SOURCE_SIZE - x)
    height = min(CHUNK, SOURCE_SIZE - y)
    bbox = [SOURCE_BOUNDS[0] + x * 12.5,
            SOURCE_BOUNDS[3] - (y + height) * 12.5,
            SOURCE_BOUNDS[0] + (x + width) * 12.5,
            SOURCE_BOUNDS[3] - y * 12.5]
    params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
              'LAYERS': source['layer'], 'STYLES': '', 'CRS': 'EPSG:27700',
              'BBOX': ','.join(str(v) for v in bbox), 'WIDTH': width, 'HEIGHT': height,
              'FORMAT': 'image/png', 'TRANSPARENT': 'TRUE',
              'FORMAT_OPTIONS': 'antialias:none', 'SLD_BODY': PREPARED[key][0]}
    path = CACHE / f'{key}_{y}_{x}.png'
    record_path = path.with_suffix('.json')
    if path.exists() and record_path.exists():
        data = path.read_bytes()
        record = json.loads(record_path.read_text())
        if record['png_sha256'] != sha(data):
            raise ValueError('Cached WMS checksum mismatch')
        if record['style_sha256'] != source['fill_only_style_sha256']:
            raise ValueError('Cached WMS style changed; use a new cache')
    else:
        data = fetch(source, params)
        # Validate before caching; an XML exception must never become a blank tile.
        decode(data, width, height, PREPARED[key][1])
        record = {'source': key, 'bbox_m': bbox, 'width': width, 'height': height,
                  'crs': 'EPSG:27700', 'sample_m': 12.5, 'png_sha256': sha(data),
                  'style_sha256': source['fill_only_style_sha256'],
                  'retrieved_utc': datetime.now(timezone.utc).isoformat()}
        path.write_bytes(data)
        record_path.write_text(json.dumps(record, indent=2))
    classes = decode(data, width, height, PREPARED[key][1])
    counts = np.bincount(classes.ravel(), minlength=6).tolist()
    record['sampled_class_counts'] = counts
    return key, y, x, generalise(classes), record


jobs = [(key, y, x) for key in SOURCES
        for y in range(0, SOURCE_SIZE, CHUNK) for x in range(0, SOURCE_SIZE, CHUNK)]
with ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(get_tile, *job) for job in jobs]
    for count, future in enumerate(as_completed(futures), 1):
        key, y, x, tile, record = future.result()
        h, w = tile.shape
        native[key][y // 2:y // 2 + h, x // 2:x // 2 + w] = tile
        requests.append(record)
        print(f'{count}/{len(jobs)} {key} ({y},{x}) {record["sampled_class_counts"]}', flush=True)

for key, grid in native.items():
    if not np.any((grid > 0) & (grid < 5)):
        raise ValueError(f'Entire official source is blank: {key}')
known = [np.where(a == 5, 0, a) for a in native.values()]
combined = np.maximum.reduce(known)
unavailable = np.logical_or.reduce([a == 5 for a in native.values()])
combined[(combined == 0) & unavailable] = 5
web = np.zeros((WEB_HEIGHT, WEB_WIDTH), dtype=np.uint8)
reproject(source=combined, destination=web, src_transform=SOURCE_TRANSFORM,
          src_crs='EPSG:27700', dst_transform=WEB_TRANSFORM, dst_crs='EPSG:3857',
          resampling=Resampling.nearest)

# Same centre, sphere and radius as makeCircleGeoJson in index.html. Mask in
# map coordinates after reprojection, not by stretching a circle from a PNG.
xs = WEB_BOUNDS[0] + (np.arange(WEB_WIDTH) + .5) * WEB_TRANSFORM.a
ys = WEB_BOUNDS[3] + (np.arange(WEB_HEIGHT) + .5) * WEB_TRANSFORM.e
lon = xs / 6378137
lat = 2 * np.arctan(np.exp(ys / 6378137)) - np.pi / 2
clat, clon = np.radians(CENTER)
hav = np.sin((lat[:, None] - clat) / 2) ** 2 + np.cos(lat[:, None]) * np.cos(clat) * np.sin((lon[None, :] - clon) / 2) ** 2
outside = 2 * 6378137 * np.arcsin(np.sqrt(hav)) > RADIUS
web[outside] = 0

# Keep compact analytical checkpoints in the cache for independent verification.
for name, grid, crs, transform in [('combined_bng', combined, 27700, SOURCE_TRANSFORM),
                                    ('combined_web', web, 3857, WEB_TRANSFORM)]:
    with rasterio.open(CACHE / f'{name}.tif', 'w', driver='GTiff', width=grid.shape[1],
                       height=grid.shape[0], count=1, dtype='uint8', crs=f'EPSG:{crs}',
                       transform=transform, compress='deflate') as dst:
        dst.write(grid, 1)

products = []
for row in range(2):
    for col in range(2):
        y, x = row * 2875, col * 2868
        tile = web[y:y + 2875, x:x + 2868]
        path = OUTPUT / f'flood_{row}-{col}.webp'
        Image.fromarray(PALETTE[tile]).save(path, format='WEBP', lossless=True, method=6)
        products.append({'path': str(path.relative_to(ROOT)), 'row': row, 'col': col,
                         'width': 2868, 'height': 2875, 'sha256': sha(path.read_bytes()),
                         'size_bytes': path.stat().st_size})

metadata = {
    'name': 'London 70 km higher published present-day flood category',
    'derived_display_product': True,
    'generated_utc': datetime.now(timezone.utc).isoformat(),
    'attribution': '© Environment Agency copyright and/or database right 2025. All rights reserved.',
    'licence': 'Open Government Licence v3.0',
    'licence_url': 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    'sources': SOURCES,
    'depth_layer': 'Present-day flooding extent / water depth > 0 m, not climate-change layers.',
    'source_request_grid': {'crs': 'EPSG:27700', 'bounds_m': SOURCE_BOUNDS,
                            'width': SOURCE_SIZE, 'height': SOURCE_SIZE, 'sample_m': 12.5},
    'method': 'Decode exact official risk-band fills with unchanged filters, no polygon outlines and no antialiasing. For each 2×2 sample block, retain the highest available band. At each 25 m cell select the higher available RoFRS/RoFSW band, then nearest-neighbour warp to the shared map grid. Unavailable is kept only when no known band is available. Transparent areas are not assigned a Very Low band.',
    'probability_interpretation': 'An ordinal display comparison only: not a union, sum, joint probability or combined annual chance. If one source is unavailable, the other source does not establish total flood risk.',
    'display_resolution_m': 25,
    'accuracy_limit': 'WMS map sampling and max aggregation are display operations, not new modelling or survey accuracy. Features below the 12.5 m sampling grid can be missed; a 25 m cell may be coloured by a smaller sampled feature. Blank is not no risk. Image pixels do not represent flood depth.',
    'classes': [
        {'code': 0, 'name': 'No published sampled band / outside study circle', 'rgba': PALETTE[0].tolist()},
        {'code': 1, 'name': 'Very low', 'annual_chance': '<0.1%', 'rgba': PALETTE[1].tolist()},
        {'code': 2, 'name': 'Low', 'annual_chance': '>=0.1% and <1%', 'rgba': PALETTE[2].tolist()},
        {'code': 3, 'name': 'Medium', 'annual_chance': '>=1% and <3.3%', 'rgba': PALETTE[3].tolist()},
        {'code': 4, 'name': 'High', 'annual_chance': '>=3.3%', 'rgba': PALETTE[4].tolist()},
        {'code': 5, 'name': 'Unavailable', 'rgba': PALETTE[5].tolist()},
    ],
    'web_grid': {'crs': 'EPSG:3857', 'bounds_m': WEB_BOUNDS,
                 'width': WEB_WIDTH, 'height': WEB_HEIGHT, 'affine': list(WEB_TRANSFORM)[:6],
                 'tiles': '2×2; each 2868×2875 pixels'},
    'registration': 'Same exact EPSG:3857 outer bounds as contributing area and terrain-derived network, twice their base width/height. Terrain requests use EPSG:3857 viewport bounds. No screenshot cropping, control-point guess, or manual offset.',
    'study_mask': {'center_lat_lon': CENTER, 'radius_m': RADIUS,
                   'method': 'Spherical distance in WGS84 map coordinates, R=6378137; same as the existing focus circle. Pixel-centre mask.'},
    'class_counts': np.bincount(web.ravel(), minlength=6).tolist(),
    'products': products,
    'wms_requests': sorted(requests, key=lambda r: (r['source'], r['bbox_m'][1], r['bbox_m'][0])),
}
(ROOT / 'assets/london_flood_risk_metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'products': products, 'class_counts': metadata['class_counts']}, indent=2), flush=True)
