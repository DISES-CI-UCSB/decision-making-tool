from summary_metadata import resolve_summary_csv_url


def test_land_summary_csv_url_is_preserved():
    url = (
        "https://example.test/solutions/nacional/"
        "ESTR30%2BEsp30_IHEH_summary.csv"
    )

    assert resolve_summary_csv_url(url) == url


def test_marine_json_resolves_declared_sibling_and_preserves_pluses():
    resolved = resolve_summary_csv_url(
        "https://example.test/solutions/marine/marine_run.json",
        metadata_document={
            "coverage_summary": {
                "summary_file": "Ecos30+Mang 30+RUNAP_HHM_summary.csv",
            },
        },
    )

    assert resolved == (
        "https://example.test/solutions/marine/"
        "Ecos30+Mang%2030+RUNAP_HHM_summary.csv"
    )
