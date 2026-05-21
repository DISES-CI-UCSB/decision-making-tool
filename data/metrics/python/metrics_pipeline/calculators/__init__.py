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
"""
