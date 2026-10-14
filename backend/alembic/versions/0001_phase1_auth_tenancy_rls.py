"""phase1 auth tenancy rls

Revision ID: 0001_phase1
Revises:
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_phase1"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

membership_role = postgresql.ENUM(
    "owner",
    "org_admin",
    "farmer",
    "read_only",
    name="membership_role",
    create_type=False,
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    membership_role.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "is_platform_super_admin",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "owner_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "owner_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", membership_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("owner_account_id", "user_id", name="uq_membership_owner_user"),
    )
    op.create_index("ix_owner_memberships_owner_account_id", "owner_memberships", ["owner_account_id"])
    op.create_index("ix_owner_memberships_user_id", "owner_memberships", ["user_id"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_audit_logs_owner_account_id", "audit_logs", ["owner_account_id"])
    op.create_index("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"])

    # Grants for app_user (created in docker init; ignore if missing in CI)
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
          END IF;
        END $$;
        """
    )

    # RLS — owner_accounts
    op.execute("ALTER TABLE owner_accounts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE owner_accounts FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY owner_accounts_select ON owner_accounts
          FOR SELECT TO PUBLIC
          USING (
            id::text = NULLIF(current_setting('app.current_owner_id', true), '')
            OR EXISTS (
              SELECT 1 FROM owner_memberships m
              WHERE m.owner_account_id = owner_accounts.id
                AND m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
                AND m.is_active = true
            )
            OR current_setting('app.current_role', true) = 'platform_super_admin'
            OR current_setting('app.rls_bypass', true) = 'on'
          )
        """
    )
    op.execute(
        """
        CREATE POLICY owner_accounts_insert ON owner_accounts
          FOR INSERT TO PUBLIC
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
          )
        """
    )
    op.execute(
        """
        CREATE POLICY owner_accounts_update ON owner_accounts
          FOR UPDATE TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
        """
    )

    # RLS — owner_memberships
    op.execute("ALTER TABLE owner_memberships ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE owner_memberships FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY memberships_select ON owner_memberships
          FOR SELECT TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
            OR current_setting('app.current_role', true) = 'platform_super_admin'
          )
        """
    )
    op.execute(
        """
        CREATE POLICY memberships_write ON owner_memberships
          FOR ALL TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
        """
    )

    # RLS — audit_logs
    op.execute("ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY audit_select ON audit_logs
          FOR SELECT TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
            OR current_setting('app.current_role', true) = 'platform_super_admin'
          )
        """
    )
    op.execute(
        """
        CREATE POLICY audit_insert ON audit_logs
          FOR INSERT TO PUBLIC
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id IS NULL
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
            OR actor_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
          )
        """
    )

    # users / refresh_tokens: table owner (migration role) bypasses RLS by default;
    # FORCE RLS + policies for defense in depth when using app_user.
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY users_self ON users
          FOR ALL TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
            OR current_setting('app.current_role', true) = 'platform_super_admin'
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
            OR current_setting('app.current_role', true) = 'platform_super_admin'
          )
        """
    )
    # Allow registration inserts without session user
    op.execute(
        """
        CREATE POLICY users_insert_register ON users
          FOR INSERT TO PUBLIC
          WITH CHECK (true)
        """
    )

    op.execute("ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY refresh_self ON refresh_tokens
          FOR ALL TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
          )
        """
    )
    op.execute(
        """
        CREATE POLICY refresh_insert ON refresh_tokens
          FOR INSERT TO PUBLIC
          WITH CHECK (true)
        """
    )


def downgrade() -> None:
    for table in (
        "audit_logs",
        "refresh_tokens",
        "owner_memberships",
        "owner_accounts",
        "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    op.execute("DROP TYPE IF EXISTS membership_role")
