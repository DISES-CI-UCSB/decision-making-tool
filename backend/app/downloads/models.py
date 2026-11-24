from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SignedUrlRequest(BaseModel):
    object_name: str = Field(
        min_length=1,
        max_length=1024,
        description="GCS object key, which is the published blob pathname.",
    )
    expires_in_seconds: int | None = Field(
        default=None,
        ge=60,
        le=604_800,
        description=(
            "Asks for a shorter link life. The service's configured life is the upper bound, "
            "so a longer request gets the configured life."
        ),
    )


class SignedUrlResponse(BaseModel):
    url: str
    expires_at: str
    object_name: str
    method: Literal["GET"] = "GET"
