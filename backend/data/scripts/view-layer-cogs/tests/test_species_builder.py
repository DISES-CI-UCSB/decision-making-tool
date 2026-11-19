from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from species_builder import (  # noqa: E402
    APPROVED_EXCLUSIONS,
    SpeciesShard,
    SpeciesSource,
    cross_taxon_benchmark,
    load_species_catalog,
    select_species_shard,
    split_approved_exclusions,
    validate_species_shards,
)


class SpeciesCatalogTests(unittest.TestCase):
    def test_catalog_excludes_fish_and_recognizes_only_approved_missing_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            catalog = Path(directory) / "species.csv"
            catalog.write_text(
                "scientific_name,class\n"
                "Hypericum strictum,Magnoliopsida\n"
                "Paradrymonia ciliosa,Magnoliopsida\n"
                "Alouatta palliata,Mammalia\n"
                "Fish species,Actinopteri\n",
                encoding="utf-8",
            )
            expected, exclusions = split_approved_exclusions(load_species_catalog(catalog))

        self.assertEqual([item.filename for item in expected], ["Alouatta_palliata_10_MAXENT.tif"])
        self.assertEqual({item.filename for item in exclusions}, APPROVED_EXCLUSIONS)

    def test_benchmark_is_stable_and_cross_taxon(self) -> None:
        records = [
            SpeciesSource("Plant one", "Magnoliopsida", "Plant_one_10_MAXENT.tif"),
            SpeciesSource("Mammal one", "Mammalia", "Mammal_one_10_MAXENT.tif"),
            SpeciesSource("Bird one", "Aves", "Bird_one_10_MAXENT.tif"),
            SpeciesSource("Plant two", "Magnoliopsida", "Plant_two_10_MAXENT.tif"),
            SpeciesSource("Mammal two", "Mammalia", "Mammal_two_10_MAXENT.tif"),
        ]
        sample = cross_taxon_benchmark(records, 5)

        self.assertEqual(
            [item.filename for item in sample],
            [
                "Bird_one_10_MAXENT.tif",
                "Plant_one_10_MAXENT.tif",
                "Mammal_one_10_MAXENT.tif",
                "Plant_two_10_MAXENT.tif",
                "Mammal_two_10_MAXENT.tif",
            ],
        )

    def test_taxon_alphabetical_shards_are_disjoint_and_complete(self) -> None:
        records = [
            SpeciesSource("Ant species", "Magnoliopsida", "Ant_species_10_MAXENT.tif"),
            SpeciesSource("Gazania species", "Magnoliopsida", "Gazania_species_10_MAXENT.tif"),
            SpeciesSource("Mimosa species", "Magnoliopsida", "Mimosa_species_10_MAXENT.tif"),
            SpeciesSource("Solanum species", "Magnoliopsida", "Solanum_species_10_MAXENT.tif"),
            SpeciesSource("Bird species", "Aves", "Bird_species_10_MAXENT.tif"),
        ]
        shards = [
            SpeciesShard("birds", None, None),
            SpeciesShard("plants", "A", "G"),
            SpeciesShard("plants", "G", "M"),
            SpeciesShard("plants", "M", "S"),
            SpeciesShard("plants", "S", None),
        ]

        self.assertEqual(validate_species_shards(records, shards), {
            "birds-start-end": 1,
            "plants-A-G": 1,
            "plants-G-M": 1,
            "plants-M-S": 1,
            "plants-S-end": 1,
        })
        self.assertEqual(
            [item.filename for item in select_species_shard(records, SpeciesShard("plants", "G", "M"))],
            ["Gazania_species_10_MAXENT.tif"],
        )


if __name__ == "__main__":
    unittest.main()
