"""Canonical payload hashing for lifecycle / banding idempotency (P5)."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any
from uuid import UUID


class IdempotencyConflictError(Exception):
    """Same idempotency key reused with a different canonical payload."""

    code = "IDEMPOTENCY_KEY_CONFLICT"

    def __init__(self, message: str = "Idempotency key already used with a different payload") -> None:
        super().__init__(message)
        self.message = message


def _jsonable(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return value


def canonicalize_payload(payload: dict[str, Any]) -> str:
    """Stable JSON: sorted keys, UUID/date normalized, list order preserved as given."""
    cleaned = {k: _jsonable(v) for k, v in payload.items() if v is not None}
    return json.dumps(cleaned, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def payload_hash(payload: dict[str, Any]) -> str:
    canonical = canonicalize_payload(payload)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def assert_payload_matches(stored_hash: str | None, request_hash: str) -> None:
    """NULL stored hash (legacy): accept first matching request and allow caller to backfill."""
    if stored_hash is None:
        return
    if stored_hash != request_hash:
        raise IdempotencyConflictError()


def transfer_bird_idempotency_key(batch_key: str, bird_id: UUID) -> str:
    """Per-bird lifecycle key under a shed-transfer batch idempotency key."""
    return f"{batch_key}:{bird_id}"
