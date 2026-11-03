"""Validation helpers for bird sale (buyer name / mobile)."""

from __future__ import annotations

import re

_MOBILE_RE = re.compile(r"^\+?\d{10,15}$")


def normalize_buyer_name(raw: str | None) -> str:
    name = (raw or "").strip()
    if not name:
        raise ValueError("Person name is required")
    if len(name) > 120:
        raise ValueError("Person name must be at most 120 characters")
    return name


def normalize_buyer_mobile(raw: str | None) -> str:
    cleaned = re.sub(r"[\s\-().]", "", (raw or "").strip())
    if not cleaned:
        raise ValueError("Person mobile number is required")
    if not _MOBILE_RE.fullmatch(cleaned):
        raise ValueError("Enter a valid mobile number (10–15 digits, optional leading +)")
    return cleaned
