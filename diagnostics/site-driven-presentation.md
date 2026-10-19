# v3.27.0 — site-derived tensor presentation and 2D Wool drawing

The former STEP04 presentation ignored the current tensor and advected a regular grid through six hard-coded vortices. STEP05 used eight fixed elliptical districts and four independent Bezier arteries. Both templates have been removed from the active rendering paths.

STEP04 now smooths the current parcel's doubled-angle eigenfield, then integrates both direction families. The source tensor, terrain, water and masks are never modified. Seed coordinates are geographic and independent of camera zoom. Smoothing is a display operation, not a new physical water-flow calculation.

STEP05 partitions the current site, selects connected main routes from the resulting graph using tensor and wetness costs, applies a shared elastic deformation, and subdivides non-overlapping districts. Wetness creates local negative space. Rounded junction strokes and parallel bundle strands render the final 2D morphology; these display-only strokes are explicitly separate from the topology and are not counted as extra roads or loops. Analysis mode and flood solver are unchanged. STEP05 locks camera pitch to zero and restores the prior pitch limit on exit.

Verification: synthetic fixtures with the same outline and changed DEM/water produce different tensor coordinates and Wool geometry. Dry/wet fixtures also differ. Camera changes do not change presentation coordinates. Inputs remain unchanged. Irregular parcel clipping, hierarchy, topology generation, automatic handoff, layer isolation, camera mode, and version/cache checks pass. Offline SVG renders of generated geometry were inspected.

Limit: no live-browser visual acceptance on the user's selected London parcel was performed in this environment. This is a site-driven design visualization, not certified road engineering or a pixel-identical reproduction of the reference artwork.
