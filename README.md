# London Map Live

Live map: https://haowang310.github.io/google-map-live/

Version 3.12.0 uses OpenStreetMap / OpenFreeMap and an independent layer list:
EA LiDAR terrain, contributing area, EA present-day flood-risk overview,
terrain-derived drainage network, and the 70 km study circle. Flood risk and
the network are enabled by default, with separate opacity controls. The network
also has minimum contributing-area controls (0.25, 1, or 5 km²).

The flood overview is reconstructed from **Environment Agency official WMS
data**, rather than stretching the uploaded PNG. It uses the present-day
`rofrs_4band` and `rofsw` flooding-extent layers (water depth > 0 m), sampled
in EPSG:27700 at 12.5 m on the existing study footprint. Each 25 m display cell
retains the highest sampled **available published band** from the two sources.
The bands are very low (<0.1%), low (0.1–<1%), medium (1–<3.3%), and high
(≥3.3%) annual chance in each individual source. This ordinal comparison is
**not a combined annual probability**, flood depth, future climate scenario,
or a new flood model. If either source is missing, the other does not establish
the total flood risk. Blank areas must not be treated as zero risk.

WMS requests respect the official 1:50,000 maximum scale. The official SLD
filters and colours are retained during decoding; outline-only symbols are
removed to prevent grey polygon edges being mistaken for unavailable data.
Antialiasing is disabled and unknown colours or failed requests stop the build.
The display palette follows the uploaded overview's light-blue/yellow/orange/red
sequence. Original and fill-only SLD files are included beside the WebP assets.

The flood layer uses nearest-neighbour reprojection to a 5736 × 5750 Web
Mercator grid with the **exact same outer bounds** as contributing area and
the network. Four 2868 × 2875 lossless WebP tiles stay below common GPU texture
limits. Pixel centres are masked to the same 70 km centre/radius/spherical
distance used by the map's study circle. The 25 m grid is a display aggregation;
it does not increase the official model's accuracy and can miss features below
the sampling grid. Map alignment cannot remove uncertainty in the source data.

Data retrieval dates, exact WMS layers, request bounding boxes, image checksums,
styles, processing rules and projection bounds are recorded in
[`assets/london_flood_risk_metadata.json`](assets/london_flood_risk_metadata.json).
This build fetched official data on 11 October 2026, rather than claiming the
19 September retrieval date printed on the uploaded overview.

To rebuild the flood overview, install `numpy`, `rasterio` and `Pillow`, then run:

```sh
python3 scripts/build_flood_risk.py /path/to/wms-cache
```

Use a new cache to fetch a new dated snapshot. Successfully validated requests
can be reused after a temporary WMS failure; raw requests are not served by the
web app. The served layer remains available at regional zooms where the live
WMS would normally hide its polygons.

The network is extracted from the actual values in the project's analytical
`London_Drainage_70km_contributing_area_km2(2).tif`, rather than a screenshot.
The input has 2801 × 2801 cells in EPSG:27700, with a 50 m cell size and bounds
E460012–600062 / N110348–250398. The network uses the exact EPSG:3857 bounds
and 2868 × 2875 base grid already used by the contributing-area display.
Outside the selected network, the image is fully transparent. Lossless WebP
assets preserve its mask and values' colour classes.

The source analysis remains **50 m**. The existing contributing-area display's
10 m resampling does not add analytical detail. This is a terrain-derived
potential drainage network; it is not a surveyed river inventory, underground
drainage inventory, or flood-inundation extent. The thresholds are selectable
analysis/display choices, not calibrated channel-initiation thresholds.

Existing repository metadata attributes the contributing-area raster to EA
LiDAR Composite DTM. The TIFF itself does not provide the original DEM ID,
flow-direction raster, or processing log, so that upstream processing has not
been independently reproduced in this update. The extraction performed here
is reproducible from the exact input file and checksum recorded in
[`assets/london_drainage_network_metadata.json`](assets/london_drainage_network_metadata.json).

To rebuild, install `numpy`, `rasterio` and `Pillow`, then run:

```sh
python3 scripts/build_drainage_network.py /path/to/contributing_area.tif
```

Sources:

- [EA official DTM catalogue](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m)
- [EA Risk of Flooding from Rivers and Sea](https://www.data.gov.uk/dataset/943d2bbb-aa08-45d1-96cb-42556cd01d94/risk-of-flooding-from-rivers-and-sea2)
- [EA Risk of Flooding from Surface Water](https://www.data.gov.uk/dataset/0d6fa1f4-0c82-4c91-8667-a549e8e3ca2d/risk-of-flooding-from-surface-water3)
- [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
- [Esri: Identifying stream networks](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-analyst/identifying-stream-networks.htm)
- [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
