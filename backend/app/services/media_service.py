"""Cloudinary media integration (Phase 7). Works as no-op metadata store if keys unset."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.core.config import get_settings
from app.models.enums import MembershipRole
from app.models.flock import Bird, Flock
from app.models.media import AnimalMedia
from app.models.shed import Shed
from app.models.vaccination import VaccinationEvent


class MediaError(Exception):
    def __init__(self, message: str, code: str = "MEDIA_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def _tenant_shed(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> Shed:
    """Load a shed owned by the active tenant; do not leak other tenants' IDs."""
    assert ctx.owner_account_id
    shed = await db.scalar(
        select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise MediaError("Not found", "NOT_FOUND")
    return shed


async def _tenant_flock(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> Flock:
    assert ctx.owner_account_id
    flock = await db.scalar(
        select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
    )
    if flock is None:
        raise MediaError("Not found", "NOT_FOUND")
    return flock


async def _tenant_bird(db: AsyncSession, ctx: AuthContext, bird_id: UUID) -> Bird:
    assert ctx.owner_account_id
    bird = await db.scalar(
        select(Bird).where(Bird.id == bird_id, Bird.owner_account_id == ctx.owner_account_id)
    )
    if bird is None:
        raise MediaError("Not found", "NOT_FOUND")
    return bird


async def _tenant_vaccination_event(
    db: AsyncSession, ctx: AuthContext, event_id: UUID
) -> VaccinationEvent:
    assert ctx.owner_account_id
    event = await db.scalar(
        select(VaccinationEvent).where(
            VaccinationEvent.id == event_id,
            VaccinationEvent.owner_account_id == ctx.owner_account_id,
        )
    )
    if event is None:
        raise MediaError("Not found", "NOT_FOUND")
    return event


async def _validate_media_associations(db: AsyncSession, ctx: AuthContext, data) -> None:
    """Ensure shed/flock/bird/event IDs are tenant-owned, authorized, and mutually consistent."""
    assert ctx.owner_account_id

    shed: Shed | None = None
    flock: Flock | None = None
    bird: Bird | None = None
    event: VaccinationEvent | None = None

    if data.shed_id:
        shed = await _tenant_shed(db, ctx, data.shed_id)
        await assert_shed_access(db, ctx, data.shed_id, permission_code="media.upload")

    if data.flock_id:
        flock = await _tenant_flock(db, ctx, data.flock_id)

    if data.bird_id:
        bird = await _tenant_bird(db, ctx, data.bird_id)

    if data.vaccination_event_id:
        event = await _tenant_vaccination_event(db, ctx, data.vaccination_event_id)

    if flock and shed and flock.shed_id != shed.id:
        raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
    if bird and shed and bird.shed_id != shed.id:
        raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
    if bird and flock and bird.flock_id != flock.id:
        raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
    if event and shed and event.shed_id != shed.id:
        raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
    if event and flock and event.flock_id != flock.id:
        raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
    if event and bird:
        if event.shed_id != bird.shed_id or event.flock_id != bird.flock_id:
            raise MediaError("Association mismatch", "INVALID_ASSOCIATION")
        if event.bird_id is not None and event.bird_id != bird.id:
            raise MediaError("Association mismatch", "INVALID_ASSOCIATION")

    # When shed_id is omitted, still enforce shed-scoped upload permission via linked records.
    if shed is None:
        access_shed_id: UUID | None = None
        if event is not None:
            access_shed_id = event.shed_id
        elif bird is not None:
            access_shed_id = bird.shed_id
        elif flock is not None:
            access_shed_id = flock.shed_id
        if access_shed_id is not None:
            # Confirm the derived shed is still tenant-owned (defense in depth).
            await _tenant_shed(db, ctx, access_shed_id)
            await assert_shed_access(db, ctx, access_shed_id, permission_code="media.upload")


def cloudinary_configured() -> bool:
    s = get_settings()
    return bool(s.media_enabled and s.cloudinary_cloud_name and s.cloudinary_api_key and s.cloudinary_api_secret)


async def sign_upload(db: AsyncSession, ctx: AuthContext, *, shed_id: UUID | None, folder_suffix: str) -> dict:
    assert ctx.owner_account_id
    if shed_id:
        # Owner assert_shed_access short-circuits without tenancy — enforce ownership first.
        await _tenant_shed(db, ctx, shed_id)
        await assert_shed_access(db, ctx, shed_id, permission_code="media.upload")
        # Inactive sheds: signing remains allowed — media documents existing birds/events
        # (historical evidence), not new batch/bird/schedule onboarding.
    if not cloudinary_configured():
        # Dev placeholder — client can still register metadata after manual/test upload
        return {
            "enabled": False,
            "message": "Cloudinary not configured; app works without media",
            "folder": f"poultry/{ctx.owner_account_id}/{folder_suffix}",
        }
    import time

    import cloudinary
    import cloudinary.utils

    s = get_settings()
    cloudinary.config(
        cloud_name=s.cloudinary_cloud_name,
        api_key=s.cloudinary_api_key,
        api_secret=s.cloudinary_api_secret,
        secure=True,
    )
    timestamp = int(time.time())
    folder = f"poultry/{ctx.owner_account_id}/{folder_suffix}"
    params = {"timestamp": timestamp, "folder": folder}
    signature = cloudinary.utils.api_sign_request(params, s.cloudinary_api_secret)
    return {
        "enabled": True,
        "cloud_name": s.cloudinary_cloud_name,
        "api_key": s.cloudinary_api_key,
        "timestamp": timestamp,
        "folder": folder,
        "signature": signature,
    }


async def register_media(db: AsyncSession, ctx: AuthContext, data) -> AnimalMedia:
    """Register uploaded media metadata.

    Policy: uploads on inactive sheds are allowed when the caller has ``media.upload``
    and shed access. Animal media attaches to existing shed/flock/bird/vaccination
    records as historical evidence — the same catch-up family as recording vaccination
    or lifecycle events. It does not create batches, birds, or schedules.

    Association IDs (``shed_id``, ``flock_id``, ``bird_id``, ``vaccination_event_id``) must
    belong to the active tenant, pass shed authorization, and be mutually consistent.
    Cross-tenant or unknown IDs are rejected as not found without creating a row.
    """
    assert ctx.owner_account_id
    await _validate_media_associations(db, ctx, data)
    row = AnimalMedia(
        owner_account_id=ctx.owner_account_id,
        shed_id=data.shed_id,
        flock_id=data.flock_id,
        bird_id=data.bird_id,
        vaccination_event_id=data.vaccination_event_id,
        cloudinary_public_id=data.public_id,
        resource_type=data.resource_type or "image",
        format=data.format,
        version=data.version or 1,
        versions_meta=[{"version": data.version or 1, "at": datetime.now(timezone.utc).isoformat()}],
        uploaded_by_user_id=ctx.user.id,
        notes=data.notes,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_media_version(db: AsyncSession, ctx: AuthContext, media_id: UUID, data) -> AnimalMedia:
    row = await db.scalar(
        select(AnimalMedia).where(
            AnimalMedia.id == media_id,
            AnimalMedia.owner_account_id == ctx.owner_account_id,
            AnimalMedia.is_deleted.is_(False),
        )
    )
    if not row:
        raise MediaError("Not found", "NOT_FOUND")
    if row.shed_id:
        await assert_shed_access(db, ctx, row.shed_id, permission_code="media.upload")
    row.version = data.version
    row.cloudinary_public_id = data.public_id or row.cloudinary_public_id
    meta = list(row.versions_meta or [])
    meta.append({"version": data.version, "at": datetime.now(timezone.utc).isoformat()})
    row.versions_meta = meta
    await db.commit()
    await db.refresh(row)
    return row


async def list_media(
    db: AsyncSession,
    ctx: AuthContext,
    bird_id: UUID | None = None,
    vaccination_event_id: UUID | None = None,
) -> list[AnimalMedia]:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(AnimalMedia).where(
        AnimalMedia.owner_account_id == ctx.owner_account_id,
        AnimalMedia.is_deleted.is_(False),
    )
    if bird_id:
        stmt = stmt.where(AnimalMedia.bird_id == bird_id)
    if vaccination_event_id:
        stmt = stmt.where(AnimalMedia.vaccination_event_id == vaccination_event_id)
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(AnimalMedia.shed_id.in_(assigned))
    return list(await db.scalars(stmt.order_by(AnimalMedia.created_at.desc())))


async def soft_delete_media(db: AsyncSession, ctx: AuthContext, media_id: UUID) -> AnimalMedia:
    row = await db.scalar(
        select(AnimalMedia).where(
            AnimalMedia.id == media_id,
            AnimalMedia.owner_account_id == ctx.owner_account_id,
        )
    )
    if not row:
        raise MediaError("Not found", "NOT_FOUND")
    if row.shed_id:
        await assert_shed_access(db, ctx, row.shed_id, permission_code="media.upload")
    row.is_deleted = True
    row.deleted_at = datetime.now(timezone.utc)
    if cloudinary_configured():
        try:
            import cloudinary.uploader

            s = get_settings()
            import cloudinary

            cloudinary.config(
                cloud_name=s.cloudinary_cloud_name,
                api_key=s.cloudinary_api_key,
                api_secret=s.cloudinary_api_secret,
            )
            cloudinary.uploader.destroy(row.cloudinary_public_id, resource_type=row.resource_type)
        except Exception:
            pass  # D9: keep metadata audit even if remote destroy fails
    await db.commit()
    await db.refresh(row)
    return row
