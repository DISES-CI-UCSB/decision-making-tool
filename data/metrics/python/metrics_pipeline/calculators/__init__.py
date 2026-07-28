"""Metric calculator modules for the Tier 1 pipeline.

Each sub-module exposes pure Python functions — one per named metric — that
accept pre-loaded raster data and return a raw float value.  All I/O
(downloading layers, reading TIFs) lives in the calling code (main.py); the
functions here are testable without touching the filesystem or the network.

Modules
-------
area              — #17 National Contribution, #18 Priority Area (Selected)
ecosystem_coverage — #4, #30, #31, #32, #36 (ecosystem overlap metrics)
social_governance  — #59, #60 (territory/governance overlap metrics)
carbon            — #5, #39, #41, #43 (carbon/biomass weighted-sum metrics)
water             — #6, #44 (water regulation overlap metrics)
land_cover        — #9, #51, #52/#53, #54 (coberturas.tif CORINE Level 1 land-cover metrics)
protected_areas   — #63, #64, #66 (protected area overlap and percent metrics)
marine_ecosystems — #35, #36, #37 (categorical marine ecosystem coverage)
species           — #3, #21, #22, #23, #24, #25, #26, #28 (species range
                    overlap; processed via SpeciesAccumulator across all scopes)
comparison        — #70, #71, #72 (pairwise deferred: requires two solution rasters)
"""
