"""Cloudinary media integration (Phase 7). Works as no-op metadata store if keys unset."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.core.config import get_settings
from app.models.enums import MembershipRole
from app.models.media import AnimalMedia


class MediaError(Exception):
    def __init__(self, message: str, code: str = "MEDIA_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def cloudinary_configured() -> bool:
    s = get_settings()
    return bool(s.media_enabled and s.cloudinary_cloud_name and s.cloudinary_api_key and s.cloudinary_api_secret)


async def sign_upload(db: AsyncSession, ctx: AuthContext, *, shed_id: UUID | None, folder_suffix: str) -> dict:
    assert ctx.owner_account_id
    if shed_id:
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
    """
    assert ctx.owner_account_id
    if data.shed_id:
        await assert_shed_access(db, ctx, data.shed_id, permission_code="media.upload")
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


async def list_media(db: AsyncSession, ctx: AuthContext, bird_id: UUID | None = None) -> list[AnimalMedia]:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(AnimalMedia).where(
        AnimalMedia.owner_account_id == ctx.owner_account_id,
        AnimalMedia.is_deleted.is_(False),
    )
    if bird_id:
        stmt = stmt.where(AnimalMedia.bird_id == bird_id)
    elif ctx.membership.role == MembershipRole.farmer:
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
