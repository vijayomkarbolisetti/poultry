from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.core.database import set_rls_bypass
from app.core.security import hash_password
from app.models.audit import AuditLog
from app.models.enums import MembershipRole
from app.models.membership import OwnerMembership
from app.models.permission import PERMISSION_CODES, MembershipPermission, Permission
from app.models.shed import Shed, ShedMembership
from app.models.user import User


class FarmerError(Exception):
    def __init__(self, message: str, code: str = "FARMER_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def ensure_permission_catalog(db: AsyncSession) -> None:
    await set_rls_bypass(db, True)
    existing = set(await db.scalars(select(Permission.code)))
    for code in PERMISSION_CODES:
        if code not in existing:
            db.add(Permission(code=code, description=code.replace(".", " ").title()))
    await db.flush()
    await set_rls_bypass(db, False)


async def create_farmer(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    email: str,
    password: str,
    full_name: str,
    role: MembershipRole,
    permission_codes: list[str],
    shed_ids: list[UUID],
) -> dict:
    assert ctx.owner_account_id is not None
    if role == MembershipRole.owner:
        raise FarmerError("Cannot create another owner via farmer endpoint", "INVALID_ROLE")
    if role == MembershipRole.org_admin and not permission_codes:
        # D6: org_admin starts with empty grants unless explicitly provided
        permission_codes = []

    invalid = [c for c in permission_codes if c not in PERMISSION_CODES]
    if invalid:
        raise FarmerError(f"Unknown permissions: {', '.join(invalid)}", "INVALID_PERMISSION")

    await ensure_permission_catalog(db)

    user = await db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        user = User(
            email=email.lower(),
            password_hash=hash_password(password),
            full_name=full_name,
            is_active=True,
        )
        db.add(user)
        await db.flush()
    else:
        # Existing user joining another org (D8)
        existing_mem = await db.scalar(
            select(OwnerMembership).where(
                OwnerMembership.user_id == user.id,
                OwnerMembership.owner_account_id == ctx.owner_account_id,
            )
        )
        if existing_mem and existing_mem.is_active:
            raise FarmerError("User already has an active membership in this organization", "EXISTS")

    membership = await db.scalar(
        select(OwnerMembership).where(
            OwnerMembership.user_id == user.id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
        )
    )
    if membership:
        membership.is_active = True
        membership.role = role
    else:
        membership = OwnerMembership(
            owner_account_id=ctx.owner_account_id,
            user_id=user.id,
            role=role,
            is_active=True,
        )
        db.add(membership)
        await db.flush()

    # Replace org-wide permissions
    old = await db.scalars(
        select(MembershipPermission).where(
            MembershipPermission.owner_membership_id == membership.id,
            MembershipPermission.shed_id.is_(None),
        )
    )
    for row in old:
        await db.delete(row)
    for code in permission_codes:
        db.add(
            MembershipPermission(
                owner_account_id=ctx.owner_account_id,
                owner_membership_id=membership.id,
                permission_code=code,
                shed_id=None,
            )
        )

    for shed_id in shed_ids:
        shed = await db.scalar(
            select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
        )
        if shed is None:
            raise FarmerError(f"Shed not found: {shed_id}", "SHED_NOT_FOUND")
        existing_assign = await db.scalar(
            select(ShedMembership).where(
                ShedMembership.shed_id == shed_id,
                ShedMembership.owner_membership_id == membership.id,
            )
        )
        if existing_assign:
            existing_assign.is_active = True
        else:
            db.add(
                ShedMembership(
                    owner_account_id=ctx.owner_account_id,
                    shed_id=shed_id,
                    owner_membership_id=membership.id,
                    is_manager=False,
                    is_active=True,
                )
            )

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="farmer.create",
            entity_type="owner_membership",
            entity_id=membership.id,
            after={
                "email": user.email,
                "role": role.value,
                "permissions": permission_codes,
                "shed_ids": [str(s) for s in shed_ids],
            },
        )
    )
    await db.commit()
    return await serialize_farmer(db, membership.id)


async def list_farmers(db: AsyncSession, ctx: AuthContext) -> list[dict]:
    assert ctx.owner_account_id is not None
    rows = await db.scalars(
        select(OwnerMembership)
        .where(
            OwnerMembership.owner_account_id == ctx.owner_account_id,
            OwnerMembership.role != MembershipRole.owner,
        )
        .options(selectinload(OwnerMembership.user))
        .order_by(OwnerMembership.created_at.desc())
    )
    return [await serialize_farmer(db, m.id) for m in rows]


async def get_farmer(db: AsyncSession, ctx: AuthContext, membership_id: UUID) -> dict:
    assert ctx.owner_account_id is not None
    membership = await db.scalar(
        select(OwnerMembership).where(
            OwnerMembership.id == membership_id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
        )
    )
    if membership is None or membership.role == MembershipRole.owner:
        raise FarmerError("Farmer not found", "NOT_FOUND")
    return await serialize_farmer(db, membership.id)


async def update_farmer(
    db: AsyncSession,
    ctx: AuthContext,
    membership_id: UUID,
    *,
    full_name: str | None,
    is_active: bool | None,
) -> dict:
    membership = await db.scalar(
        select(OwnerMembership)
        .where(
            OwnerMembership.id == membership_id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
        )
        .options(selectinload(OwnerMembership.user))
    )
    if membership is None or membership.role == MembershipRole.owner:
        raise FarmerError("Farmer not found", "NOT_FOUND")
    if full_name is not None:
        membership.user.full_name = full_name
    if is_active is not None:
        membership.is_active = is_active
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="farmer.update",
            entity_type="owner_membership",
            entity_id=membership.id,
            after={"full_name": membership.user.full_name, "is_active": membership.is_active},
        )
    )
    await db.commit()
    return await serialize_farmer(db, membership.id)


async def set_permissions(
    db: AsyncSession, ctx: AuthContext, membership_id: UUID, permission_codes: list[str]
) -> dict:
    invalid = [c for c in permission_codes if c not in PERMISSION_CODES]
    if invalid:
        raise FarmerError(f"Unknown permissions: {', '.join(invalid)}", "INVALID_PERMISSION")
    await ensure_permission_catalog(db)
    membership = await db.scalar(
        select(OwnerMembership).where(
            OwnerMembership.id == membership_id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
        )
    )
    if membership is None or membership.role == MembershipRole.owner:
        raise FarmerError("Membership not found", "NOT_FOUND")

    old = await db.scalars(
        select(MembershipPermission).where(
            MembershipPermission.owner_membership_id == membership.id,
            MembershipPermission.shed_id.is_(None),
        )
    )
    for row in old:
        await db.delete(row)
    for code in permission_codes:
        db.add(
            MembershipPermission(
                owner_account_id=ctx.owner_account_id,
                owner_membership_id=membership.id,
                permission_code=code,
                shed_id=None,
            )
        )
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="farmer.permissions",
            entity_type="owner_membership",
            entity_id=membership.id,
            after={"permissions": permission_codes},
        )
    )
    await db.commit()
    return await serialize_farmer(db, membership.id)


async def serialize_farmer(db: AsyncSession, membership_id: UUID) -> dict:
    membership = await db.scalar(
        select(OwnerMembership)
        .where(OwnerMembership.id == membership_id)
        .options(selectinload(OwnerMembership.user))
    )
    assert membership is not None
    perms = await db.scalars(
        select(MembershipPermission.permission_code).where(
            MembershipPermission.owner_membership_id == membership.id,
            MembershipPermission.shed_id.is_(None),
        )
    )
    sheds = await db.scalars(
        select(ShedMembership.shed_id).where(
            ShedMembership.owner_membership_id == membership.id,
            ShedMembership.is_active.is_(True),
        )
    )
    return {
        "membership_id": membership.id,
        "user_id": membership.user_id,
        "owner_account_id": membership.owner_account_id,
        "email": membership.user.email,
        "full_name": membership.user.full_name,
        "role": membership.role,
        "is_active": membership.is_active,
        "permission_codes": list(perms),
        "assigned_shed_ids": list(sheds),
        "created_at": membership.created_at,
    }


async def list_permission_catalog(db: AsyncSession) -> list[Permission]:
    await ensure_permission_catalog(db)
    await db.commit()
    rows = await db.scalars(select(Permission).order_by(Permission.code))
    return list(rows)
