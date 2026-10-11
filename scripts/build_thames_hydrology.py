"""Build one authoritative 50 m Thames hydrology field for London.

Pipeline
--------
1. Download OS Terrain 50 OpenData for a southern-England domain that fully contains
   the Thames upstream catchment feeding London.
2. Mosaic the native 50 m DTM in British National Grid (EPSG:27700).
3. Hydrologically condition the DEM and derive D8 flow directions with PyFlwDir
   (Wang & Liu depression filling / flat resolution).
4. Compute upstream contributing area once on the complete upstream domain.
5. Validate the Thames accumulation near NRFA station 39001 (Kingston; 9,948 km²).
6. Reproject only the London 70 km display footprint to the existing EPSG:3857 grid
   and encode it losslessly for the browser.

The browser uses this ONE encoded accumulation raster for both:
- Contributing Area
- Terrain-derived Drainage Network (dynamic threshold only)

No separate network raster is generated.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import sys
import zipfile
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import reproject, Resampling
import pyflwdir

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "assets" / "drainage_area"
WORK = Path(os.environ.get("HYDRO_WORKDIR", ROOT / ".hydro-work"))
DOWNLOADS = WORK / "downloads"
EXTRACTED = WORK / "terrain50"

API_BASE = "https://api.os.uk/downloads/v1"

# 100 km National Grid squares covering the full Thames catchment and a generous buffer:
# west/east 300–600 km; south/north 100–300 km in EPSG:27700.
TERRAIN_AREAS = ["SO", "SP", "ST", "SU", "TL", "TQ"]

# Complete analysis domain (not the final London display crop).
ANALYSIS_BOUNDS = (300000.0, 100000.0, 600000.0, 300000.0)  # left,bottom,right,top
CELL = 50.0
NODATA = -9999.0
ANALYSIS_WIDTH = int((ANALYSIS_BOUNDS[2] - ANALYSIS_BOUNDS[0]) / CELL)
ANALYSIS_HEIGHT = int((ANALYSIS_BOUNDS[3] - ANALYSIS_BOUNDS[1]) / CELL)
ANALYSIS_TRANSFORM = from_origin(ANALYSIS_BOUNDS[0], ANALYSIS_BOUNDS[3], CELL, CELL)

# Existing exact London Web Mercator display grid shared with the map and all hydrology layers.
DISPLAY_BOUNDS_3857 = (
    -127813.8696191665,
    6596204.025752107,
    102461.98815442335,
    6827041.923624865,
)
DISPLAY_WIDTH = 2868
DISPLAY_HEIGHT = 2875
DISPLAY_TRANSFORM = from_bounds(*DISPLAY_BOUNDS_3857, DISPLAY_WIDTH, DISPLAY_HEIGHT)

MIN_AREA = 0.0025
MAX_AREA = 20000.0

# Independent external validation point.
NRFA_KINGSTON = {
    "station": "39001",
    "name": "Thames at Kingston",
    "easting": 517700.0,
    "northing": 169800.0,
    "catchment_area_km2": 9948.0,
    "source": "https://nrfa.ceh.ac.uk/data/station/info/39001",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def get_json(session: requests.Session, url: str, **kwargs):
    r = session.get(url, timeout=60, **kwargs)
    r.raise_for_status()
    return r.json()


def find_terrain_product(session: requests.Session) -> dict:
    products = get_json(session, f"{API_BASE}/products", params={"expanded": "true"})
    candidates = [
        p for p in products
        if "terrain 50" in (p.get("name") or "").lower()
        or (p.get("id") or "").lower() == "terrain50"
    ]
    if not candidates:
        names = [p.get("name") for p in products]
        raise RuntimeError("OS Terrain 50 not found in Downloads API. Products: " + repr(names))
    return candidates[0]


def choose_grid_download(downloads: list[dict], area: str) -> dict:
    def score(d: dict) -> int:
        fmt = (d.get("format") or "").lower()
        sub = (d.get("subformat") or "").lower()
        name = (d.get("fileName") or "").lower()
        s = 0
        if "ascii" in fmt: s += 20
        if "grid" in fmt: s += 12
        if "ascii" in sub: s += 15
        if "grid" in sub: s += 10
        if "gagg" in name: s += 15
        if "grid" in name: s += 8
        if name.endswith(".zip"): s += 2
        if "contour" in fmt or "contour" in sub or "contour" in name: s -= 50
        return s

    ranked = sorted(downloads, key=score, reverse=True)
    if not ranked or score(ranked[0]) <= 0:
        raise RuntimeError(f"No Terrain 50 ASCII grid download found for {area}: {downloads!r}")
    return ranked[0]


def download_file(session: requests.Session, info: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    expected_md5 = (info.get("md5") or "").lower()
    if path.exists() and path.stat().st_size > 0:
        if expected_md5:
            import hashlib as _hashlib
            got = _hashlib.md5(path.read_bytes()).hexdigest()
            if got == expected_md5:
                print(f"reuse {path.name}")
                return
        elif info.get("size") and path.stat().st_size == int(info["size"]):
            print(f"reuse {path.name}")
            return

    print(f"download {info.get('fileName')} ({info.get('size', 'unknown')} bytes)")
    with session.get(info["url"], stream=True, timeout=(30, 300), allow_redirects=True) as r:
        r.raise_for_status()
        with path.open("wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                if chunk:
                    f.write(chunk)

    if expected_md5:
        import hashlib as _hashlib
        got = _hashlib.md5(path.read_bytes()).hexdigest()
        if got != expected_md5:
            raise RuntimeError(f"MD5 mismatch for {path.name}: {got} != {expected_md5}")


def extract_recursive(zip_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    queue = [zip_path]
    seen = set()
    while queue:
        z = queue.pop(0)
        key = (str(z.resolve()), z.stat().st_size)
        if key in seen:
            continue
        seen.add(key)
        target = dest / z.stem
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(z) as archive:
            archive.extractall(target)
        for inner in target.rglob("*.zip"):
            queue.append(inner)


def read_ascii(path: Path):
    header = {}
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for _ in range(6):
            line = f.readline()
            if not line:
                raise RuntimeError(f"Incomplete ASCII header: {path}")
            k, v = line.strip().split(None, 1)
            header[k.lower()] = float(v)
        text = f.read()
    ncols, nrows = int(header["ncols"]), int(header["nrows"])
    cell = float(header["cellsize"])
    arr = np.fromstring(text, sep=" ", dtype=np.float32)
    if arr.size != ncols * nrows:
        raise RuntimeError(f"Unexpected data count in {path}: {arr.size} != {ncols*nrows}")
    arr = arr.reshape(nrows, ncols)
    nodata = header.get("nodata_value")
    if nodata is not None:
        arr[arr == nodata] = np.nan
    return header, arr


def build_dem(asc_files: list[Path]) -> tuple[np.ndarray, dict]:
    dem = np.full((ANALYSIS_HEIGHT, ANALYSIS_WIDTH), NODATA, dtype=np.float32)
    used = 0
    for idx, path in enumerate(asc_files, 1):
        header, arr = read_ascii(path)
        cell = float(header["cellsize"])
        if abs(cell - CELL) > 1e-6:
            continue
        x0 = float(header.get("xllcorner", header.get("xllcenter", np.nan)))
        y0 = float(header.get("yllcorner", header.get("yllcenter", np.nan)))
        if not np.isfinite(x0) or not np.isfinite(y0):
            raise RuntimeError(f"Missing BNG origin in {path}")

        # If a centre header is supplied convert it to the lower-left corner.
        if "xllcenter" in header: x0 -= cell / 2
        if "yllcenter" in header: y0 -= cell / 2
        x1 = x0 + arr.shape[1] * cell
        y1 = y0 + arr.shape[0] * cell

        left, bottom, right, top = ANALYSIS_BOUNDS
        if x1 <= left or x0 >= right or y1 <= bottom or y0 >= top:
            continue

        col0 = int(round((x0 - left) / CELL))
        row0 = int(round((top - y1) / CELL))
        row1, col1 = row0 + arr.shape[0], col0 + arr.shape[1]

        # Clip defensive edge overlaps.
        sr0=max(0,-row0); sc0=max(0,-col0)
        sr1=arr.shape[0]-max(0,row1-ANALYSIS_HEIGHT)
        sc1=arr.shape[1]-max(0,col1-ANALYSIS_WIDTH)
        dr0=max(0,row0); dc0=max(0,col0)
        dr1=dr0+(sr1-sr0); dc1=dc0+(sc1-sc0)
        if dr0>=dr1 or dc0>=dc1:
            continue
        block=arr[sr0:sr1,sc0:sc1]
        valid=np.isfinite(block)
        dest=dem[dr0:dr1,dc0:dc1]
        dest[valid]=block[valid]
        used += 1
        if idx % 50 == 0:
            print(f"mosaic {idx}/{len(asc_files)}")

    valid = dem != NODATA
    stats = {
        "tiles_used": used,
        "valid_cells": int(valid.sum()),
        "valid_fraction": float(valid.mean()),
        "min_elevation_m": float(dem[valid].min()) if valid.any() else None,
        "max_elevation_m": float(dem[valid].max()) if valid.any() else None,
    }
    if stats["valid_fraction"] < 0.45:
        raise RuntimeError(f"Terrain mosaic coverage unexpectedly low: {stats}")
    return dem, stats


def sample_max_near(array: np.ndarray, easting: float, northing: float, radius_m: float = 1500.0):
    col = int((easting - ANALYSIS_BOUNDS[0]) / CELL)
    row = int((ANALYSIS_BOUNDS[3] - northing) / CELL)
    r = max(1, int(math.ceil(radius_m / CELL)))
    r0=max(0,row-r); r1=min(array.shape[0],row+r+1)
    c0=max(0,col-r); c1=min(array.shape[1],col+r+1)
    window=array[r0:r1,c0:c1]
    if not np.isfinite(window).any():
        return float("nan"), None
    flat=int(np.nanargmax(window))
    wr,wc=np.unravel_index(flat,window.shape)
    rr,cc=r0+wr,c0+wc
    return float(window[wr,wc]), {
        "row": int(rr), "col": int(cc),
        "easting": ANALYSIS_BOUNDS[0] + (cc + 0.5) * CELL,
        "northing": ANALYSIS_BOUNDS[3] - (rr + 0.5) * CELL,
    }


def encode_display(area3857: np.ndarray) -> tuple[Path, dict]:
    valid = np.isfinite(area3857) & (area3857 > 0)
    code = np.zeros(area3857.shape, dtype=np.uint16)
    normal = np.clip(
        np.log(np.maximum(area3857[valid], MIN_AREA) / MIN_AREA)
        / np.log(MAX_AREA / MIN_AREA),
        0, 1,
    )
    code[valid] = 1 + np.round(normal * 65534).astype(np.uint16)
    rgb = np.zeros((DISPLAY_HEIGHT, DISPLAY_WIDTH, 3), dtype=np.uint8)
    rgb[:, :, 0] = code >> 8
    rgb[:, :, 1] = code & 255

    OUTDIR.mkdir(parents=True, exist_ok=True)
    path = OUTDIR / "area_log16.webp"
    Image.fromarray(rgb).save(path, "WEBP", lossless=True, method=6, exact=True)
    decoded = np.array(Image.open(path))
    if not np.array_equal(decoded, rgb):
        raise RuntimeError("Lossless hydrology encoding verification failed")
    return path, {
        "display_valid_cells": int(valid.sum()),
        "display_min_km2": float(np.nanmin(area3857[valid])) if valid.any() else None,
        "display_max_km2": float(np.nanmax(area3857[valid])) if valid.any() else None,
    }


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    if EXTRACTED.exists():
        shutil.rmtree(EXTRACTED)
    EXTRACTED.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers["User-Agent"] = "google-map-live hydrology builder / academic urban design"

    product = find_terrain_product(session)
    print("Terrain product:", product.get("id"), product.get("name"), product.get("version"))

    # Terrain 50 is currently supplied as a national GB grid download.
    # Query the catalogue once (without an area filter) because some releases do not
    # expose 100 km square area filters even though the API schema lists them.
    downloads_url = product.get("downloadsUrl") or f"{API_BASE}/products/{product['id']}/downloads"
    all_downloads = get_json(session, downloads_url)
    print("Terrain download catalogue:", json.dumps([
        {k:d.get(k) for k in ("fileName","area","format","subformat","size")}
        for d in all_downloads
    ], indent=2))

    terrain_downloads = []
    gb = [d for d in all_downloads if (d.get("area") or "").upper() == "GB"]
    if gb:
        info = choose_grid_download(gb, "GB")
        terrain_downloads.append({
            "area": "GB",
            "fileName": info.get("fileName"),
            "format": info.get("format"),
            "subformat": info.get("subformat"),
            "size": info.get("size"),
            "md5": info.get("md5"),
            "url": info.get("url"),
        })
        local = DOWNLOADS / info["fileName"]
        download_file(session, info, local)
        extract_recursive(local, EXTRACTED / "GB")
    else:
        # Backward-compatible path for releases that expose individual 100 km squares.
        for area in TERRAIN_AREAS:
            candidates=[d for d in all_downloads if (d.get("area") or "").upper()==area]
            if not candidates:
                raise RuntimeError(f"No Terrain 50 download for {area}; catalogue={all_downloads!r}")
            info=choose_grid_download(candidates,area)
            terrain_downloads.append({
                "area": area,
                "fileName": info.get("fileName"),
                "format": info.get("format"),
                "subformat": info.get("subformat"),
                "size": info.get("size"),
                "md5": info.get("md5"),
                "url": info.get("url"),
            })
            local=DOWNLOADS/f"{area}_{info['fileName']}"
            download_file(session,info,local)
            extract_recursive(local,EXTRACTED/area)

    asc_files = sorted(EXTRACTED.rglob("*.asc"))
    print("ASCII tiles found:", len(asc_files))
    if not asc_files:
        raise RuntimeError("No OS Terrain 50 ASCII grids were extracted")

    dem, dem_stats = build_dem(asc_files)
    print("DEM stats:", json.dumps(dem_stats, indent=2))

    # Standard hydrological conditioning + D8 routing.
    print("Deriving hydrologically conditioned D8 flow directions...")
    flw = pyflwdir.from_dem(
        data=dem,
        nodata=NODATA,
        transform=ANALYSIS_TRANSFORM,
        latlon=False,
        outlets="edge",
    )
    print("Computing upstream area...")
    upstream = flw.upstream_area(unit="km2").astype(np.float32)
    upstream[dem == NODATA] = np.nan

    kingston_value, kingston_cell = sample_max_near(
        upstream, NRFA_KINGSTON["easting"], NRFA_KINGSTON["northing"], radius_m=1500
    )
    expected = NRFA_KINGSTON["catchment_area_km2"]
    error_pct = abs(kingston_value - expected) / expected * 100
    print(f"Kingston validation: model={kingston_value:.1f} km², NRFA={expected:.1f} km², error={error_pct:.1f}%")

    # Do not publish a clearly clipped/misrouted field. This protects the live map from
    # repeating the previous 70 km-window accumulation error.
    if not np.isfinite(kingston_value) or error_pct > 25:
        raise RuntimeError(
            f"Kingston validation failed: {kingston_value:.1f} vs {expected:.1f} km² "
            f"({error_pct:.1f}% error). Existing live hydrology is left unchanged."
        )

    print("Cropping/reprojecting accumulated area to London display grid...")
    area3857 = np.full((DISPLAY_HEIGHT, DISPLAY_WIDTH), np.nan, dtype=np.float32)
    reproject(
        source=upstream,
        destination=area3857,
        src_transform=ANALYSIS_TRANSFORM,
        src_crs="EPSG:27700",
        src_nodata=np.nan,
        dst_transform=DISPLAY_TRANSFORM,
        dst_crs="EPSG:3857",
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )

    image_path, display_stats = encode_display(area3857)

    metadata = {
        "name": "London 70 km shared Thames contributing-area field",
        "generated_on": "2026-10-11",
        "derived_product": True,
        "purpose": [
            "Contributing Area: evaluate upstream runoff-contributing scale",
            "Terrain-derived Drainage Network: dynamically threshold the same accumulation field",
        ],
        "source_dem": {
            "product": product.get("name"),
            "product_id": product.get("id"),
            "product_version": product.get("version"),
            "publisher": "Ordnance Survey",
            "licence": "Open Government Licence",
            "resolution_m": 50,
            "crs": "EPSG:27700",
            "downloads_api": API_BASE,
            "areas": TERRAIN_AREAS,
            "downloads": terrain_downloads,
        },
        "analysis": {
            "upstream_domain_crs": "EPSG:27700",
            "upstream_domain_bounds_m": list(ANALYSIS_BOUNDS),
            "upstream_domain_size": [ANALYSIS_WIDTH, ANALYSIS_HEIGHT],
            "cell_size_m": CELL,
            "cell_area_km2": CELL * CELL / 1_000_000,
            "hydrological_conditioning": "PyFlwDir from_dem: Wang & Liu depression filling / flat resolution with D8 flow directions; valid edge cells are outlets.",
            "flow_direction": "D8",
            "flow_accumulation": "upstream area in km² computed once on the complete upstream analysis domain before the London crop",
            "mosaic_stats": dem_stats,
        },
        "validation": {
            "reference": NRFA_KINGSTON,
            "search_radius_m": 1500,
            "model_km2": kingston_value,
            "model_cell": kingston_cell,
            "absolute_error_km2": abs(kingston_value - expected),
            "relative_error_percent": error_pct,
            "publish_gate_percent": 25,
            "passed": True,
        },
        "web_grid": {
            "crs": "EPSG:3857",
            "bounds_m": list(DISPLAY_BOUNDS_3857),
            "width": DISPLAY_WIDTH,
            "height": DISPLAY_HEIGHT,
            "display_mask": "70 km radius around Charing Cross is applied by the shared browser worker",
        },
        "asset": "assets/drainage_area/area_log16.webp",
        "asset_sha256": sha256(image_path),
        "asset_size_bytes": image_path.stat().st_size,
        "encoding": {
            "code": "R * 256 + G; 0 = NoData",
            "minimum_area_km2": MIN_AREA,
            "maximum_area_km2": MAX_AREA,
            "decode": "0.0025 * exp((code - 1) / 65534 * log(20000 / 0.0025))",
        },
        "display": {
            "area_layer": "B-spline visual resampling of the stored 50 m accumulation field; display smoothing does not increase analytical resolution.",
            "network_layer": "Dynamic browser threshold A >= user-selected minimum contributing area using the SAME encoded 50 m field; no independent network raster.",
            **display_stats,
        },
        "provenance_note": "The hydrology solve occurs before the London 70 km crop so upstream contributions from the full Thames catchment are retained.",
        "references": [
            {
                "name": "OS Terrain 50",
                "url": "https://www.ordnancesurvey.co.uk/products/os-terrain-50",
            },
            {
                "name": "PyFlwDir from_dem",
                "url": "https://deltares.github.io/pyflwdir/latest/_generated/pyflwdir.from_dem.html",
            },
            {
                "name": "NRFA 39001 Thames at Kingston",
                "url": NRFA_KINGSTON["source"],
            },
        ],
    }
    (OUTDIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "asset": str(image_path.relative_to(ROOT)),
        "bytes": image_path.stat().st_size,
        "kingston_model_km2": round(kingston_value, 2),
        "kingston_error_percent": round(error_pct, 2),
        **display_stats,
    }, indent=2))


if __name__ == "__main__":
    main()
