"""Safety contracts for display-only reference assets."""

from __future__ import annotations

import ast
import runpy
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
APPROVED_SOURCE_PATHS = (
    SCRIPT_DIR / "sources/ant_zrc/source.py",
    SCRIPT_DIR / "sources/mads_distincion/source.py",
    SCRIPT_DIR / "sources/mads_ley2/source.py",
    SCRIPT_DIR / "sources/colombia_outline/source.py",
)


class ReferenceAssetPolicyTest(unittest.TestCase):
    def test_default_assets_exclude_redistribution_blocked_kba(self) -> None:
        approved_assets = tuple(
            asset
            for source_path in APPROVED_SOURCE_PATHS
            for asset in runpy.run_path(str(source_path))["ASSETS"]
        )
        blocked_assets = runpy.run_path(
            str(SCRIPT_DIR / "sources/birdlife_kba_aica/source.py")
        )["ASSETS"]

        self.assertEqual(
            {asset["id"] for asset in approved_assets},
            {
                "zonas_reserva_campesina_constituida",
                "ramsar",
                "biosphere_reserves",
                "reservas_forestales_ley_2_1959",
                "colombia_outline_visual",
            },
        )
        self.assertEqual(blocked_assets, ())
        self.assertNotIn(
            "birdlife_kba_aica",
            (SCRIPT_DIR / "main.py").read_text(encoding="utf-8"),
        )

    def test_approved_assets_remain_at_v0_1_0(self) -> None:
        pipeline_tree = ast.parse(
            (SCRIPT_DIR / "helpers/pipeline.py").read_text(encoding="utf-8")
        )
        version = next(
            node.value.value
            for node in pipeline_tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "VERSION"
                for target in node.targets
            )
            and isinstance(node.value, ast.Constant)
        )
        self.assertEqual(version, "v0.1.0")


if __name__ == "__main__":
    unittest.main()
