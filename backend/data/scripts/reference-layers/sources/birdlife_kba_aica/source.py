"""Blocked BirdLife KBA provenance; not approved for redistribution."""

# BirdLife's Terms of Service prohibit public reposting or redistribution
# without written permission. Keep this adapter out of every default build and
# upload path until permission is documented and a deliberate approval
# mechanism is implemented.
ASSETS: tuple[dict[str, object], ...] = ()

BLOCKED_SOURCE = {
    "id": "kba_aica",
    "title": "KBA / AICA",
    "organization": "BirdLife International",
    "source_url": "https://datazone.birdlife.org/about-our-science/ibas",
    "source_updated_at": "2026-03",
    "description": (
        "102 confirmed KBAs in Colombia triggered exclusively by birds, "
        "as of March 2026."
    ),
    "redistribution_status": "written_permission_required",
}
