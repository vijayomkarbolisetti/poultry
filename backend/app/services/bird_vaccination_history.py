"""Load vaccination history for a bird profile / PDF report.

Includes:
- Individual events tagged with this bird_id
- Attributable flock/cohort population events (bird_id IS NULL) when coverage
  was large enough to cover every banded bird that already existed in the flock

Does not invent vaccination for birds added after a population recording, and does
not attribute ambiguous partial population coverage to every bird.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.models.flock import Bird
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import VaccineDefinition
from app.schemas.flock import BirdProfileVaccinationEventOut


def _event_out(
    ev: VaccinationEvent,
    vaccine_name: str | None,
    *,
    coverage_scope: str,
) -> BirdProfileVaccinationEventOut:
    return BirdProfileVaccinationEventOut(
        id=ev.id,
        vaccine_definition_id=ev.vaccine_definition_id,
        vaccine_name=vaccine_name,
        administration_date=ev.administration_date,
        birds_covered=ev.birds_covered,
        lot_number=ev.lot_number,
        product_expiry=ev.product_expiry,
        manufacturer_or_brand=ev.manufacturer_or_brand,
        vaccine_type_or_strain=ev.vaccine_type_or_strain,
        dose_amount=ev.dose_amount,
        route=ev.route,
        timing_status=ev.timing_status,
        verification_status=ev.verification_status,
        notes=ev.notes,
        scheduled_dose_id=ev.scheduled_dose_id,
        created_at=ev.created_at,
        coverage_scope=coverage_scope,  # type: ignore[arg-type]
    )


async def load_bird_vaccination_history(
    db: AsyncSession,
    ctx: AuthContext,
    bird: Bird,
    *,
    limit: int | None = 200,
    ascending: bool = False,
) -> list[BirdProfileVaccinationEventOut]:
    """Return individual + attributable cohort vaccination events for ``bird``."""
    assert ctx.owner_account_id is not None

    order = (
        (VaccinationEvent.administration_date.asc(), VaccinationEvent.created_at.asc())
        if ascending
        else (VaccinationEvent.administration_date.desc(), VaccinationEvent.created_at.desc())
    )

    individual_rows = list(
        await db.execute(
            select(VaccinationEvent, VaccineDefinition.name)
            .outerjoin(
                VaccineDefinition,
                VaccineDefinition.id == VaccinationEvent.vaccine_definition_id,
            )
            .where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.bird_id == bird.id,
                VaccinationEvent.is_void.is_(False),
            )
            .order_by(*order)
        )
    )
    out: list[BirdProfileVaccinationEventOut] = [
        _event_out(ev, name, coverage_scope="individual") for ev, name in individual_rows
    ]
    seen = {row.id for row in out}

    cohort_rows = list(
        await db.execute(
            select(VaccinationEvent, VaccineDefinition.name)
            .outerjoin(
                VaccineDefinition,
                VaccineDefinition.id == VaccinationEvent.vaccine_definition_id,
            )
            .where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.flock_id == bird.flock_id,
                VaccinationEvent.bird_id.is_(None),
                VaccinationEvent.is_void.is_(False),
                VaccinationEvent.created_at >= bird.created_at,
            )
            .order_by(*order)
        )
    )
    if not cohort_rows:
        return out[:limit] if limit is not None else out

    # Banded birds that already existed in this flock at each event time.
    flock_banded = list(
        await db.scalars(
            select(Bird).where(
                Bird.owner_account_id == ctx.owner_account_id,
                Bird.flock_id == bird.flock_id,
                Bird.band_id.is_not(None),
            )
        )
    )

    for ev, name in cohort_rows:
        if ev.id in seen:
            continue
        existed = sum(1 for b in flock_banded if b.created_at <= ev.created_at)
        # Ambiguous partial population coverage — do not invent per-bird history.
        if existed <= 0 or int(ev.birds_covered or 0) < existed:
            continue
        out.append(_event_out(ev, name, coverage_scope="cohort"))
        seen.add(ev.id)

    out.sort(
        key=lambda e: (e.administration_date, e.created_at),
        reverse=not ascending,
    )
    if limit is not None:
        return out[:limit]
    return out
