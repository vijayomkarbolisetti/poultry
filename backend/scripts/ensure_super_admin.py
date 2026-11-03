"""Create or promote a platform super admin user.

Usage (from backend/ with venv active):
  python scripts/ensure_super_admin.py --email admin@example.com --password '...' --name 'Platform Admin'
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.user import User


async def main(email: str, password: str, full_name: str) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        await session.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
        user = await session.scalar(select(User).where(User.email == email.lower()))
        if user:
            user.is_platform_super_admin = True
            user.is_active = True
            if password:
                user.password_hash = hash_password(password)
            if full_name:
                user.full_name = full_name
            await session.commit()
            print(f"Promoted existing user to platform super admin: {user.email}")
        else:
            if not password:
                raise SystemExit("Password required when creating a new super admin")
            session.add(
                User(
                    email=email.lower(),
                    password_hash=hash_password(password),
                    full_name=full_name or "Platform Admin",
                    is_active=True,
                    is_platform_super_admin=True,
                )
            )
            await session.commit()
            print(f"Created platform super admin: {email.lower()}")
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ensure a platform super admin user exists")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", default="")
    parser.add_argument("--name", default="Platform Admin")
    args = parser.parse_args()
    asyncio.run(main(args.email, args.password, args.name))
