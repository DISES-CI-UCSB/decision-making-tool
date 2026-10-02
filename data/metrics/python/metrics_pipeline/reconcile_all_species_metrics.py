"""Reusable backfill entrypoint: reconcile all ten species metrics.

Lifecycle: thin CLI wrapper around ``backfill_threatened_species_secured.py``
that always passes ``--reconcile-all-species``. Run after ``main.py
--skip-species`` when species-goals sidecars are complete but regular metric
JSON still needs every species row validated and restamped.

Safe reuse: same flags and output-dir rules as the parent backfill; use this
entrypoint when the goal is full species-metric reconciliation rather than
metric #3 on untargeted land only. Preserves non-species rows in the
compact/verbose dual-directory flow.
"""

from __future__ import annotations

import sys

from backfill_threatened_species_secured import main


if __name__ == "__main__":
    sys.exit(main(["--reconcile-all-species", *sys.argv[1:]]))
