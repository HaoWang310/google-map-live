# London Map Live

Live map: https://haowang310.github.io/google-map-live/

Version 3.11.0 uses OpenStreetMap / OpenFreeMap and an independent layer list:
EA LiDAR terrain, contributing area, terrain-derived drainage network, and the
70 km study circle. The network is enabled by default and has separate opacity
and minimum contributing-area controls (0.25, 1, or 5 km²).

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
- [Esri: Identifying stream networks](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-analyst/identifying-stream-networks.htm)
- [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
