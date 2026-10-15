"""Quick local latency smoke for hot endpoints."""
import asyncio
import time

from httpx import ASGITransport, AsyncClient

from app.main import app


async def main() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        t0 = time.perf_counter()
        r = await c.get("/health")
        print("health", r.status_code, int((time.perf_counter() - t0) * 1000), "ms")

        reg = {
            "email": f"perf{int(time.time())}@ex.com",
            "password": "Password1!",
            "full_name": "P",
            "organization_name": "Farm",
        }
        t0 = time.perf_counter()
        r = await c.post("/api/v1/auth/register-owner", json=reg)
        print("register", r.status_code, int((time.perf_counter() - t0) * 1000), "ms")
        tokens = r.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        me = await c.get("/api/v1/auth/me", headers=headers)
        owner = me.json()["memberships"][0]["owner_account_id"]
        headers["X-Owner-Account-Id"] = owner

        paths = [
            "/api/v1/dashboard/summary",
            "/api/v1/sheds",
            "/api/v1/flocks",
            "/api/v1/vaccines",
            "/api/v1/vaccines/scheduled-doses",
            "/api/v1/reports/compliance",
            "/api/v1/notifications",
        ]
        for path in paths:
            # warm once
            await c.get(path, headers=headers)
            times = []
            for _ in range(5):
                t0 = time.perf_counter()
                r = await c.get(path, headers=headers)
                times.append(int((time.perf_counter() - t0) * 1000))
            print(path.split("/")[-1], r.status_code, "avg", sum(times) // len(times), "ms", times)


if __name__ == "__main__":
    asyncio.run(main())
