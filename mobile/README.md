# Poultry Vaccine Tracker — Mobile UI

Expo (React Native) + Expo Router. Phase 2 screens: Sign in, Register, Dashboard, Sheds, Farmers, Account.

## How to run

### 1. Backend (port 8001)

```powershell
cd d:\learning\poultry
docker compose up -d db

cd backend
.\.venv\Scripts\activate
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

Health: http://localhost:8001/health  
Docs: http://localhost:8001/docs

### 2. Mobile

```powershell
cd d:\learning\poultry\mobile
npx expo start --port 8082
```

Press `a` for Android emulator, or scan QR with Expo Go.

### API URL (`mobile/.env`) — Expo Go fix

**Expo Go on a real phone cannot use `10.0.2.2`.** That address is Android-emulator-only.

Current Wi‑Fi IP on this PC was set to:

```
EXPO_PUBLIC_API_URL=http://192.168.50.105:8001
```

| Device | `EXPO_PUBLIC_API_URL` |
|--------|------------------------|
| Expo Go (physical phone) | `http://YOUR_PC_WIFI_IP:8001` (same Wi‑Fi) |
| Android emulator | `http://10.0.2.2:8001` |
| iOS simulator | `http://localhost:8001` |

After changing `.env`, restart Expo (`npx expo start --port 8082`) and reload the app.

If register still fails: allow Python through Windows Firewall, keep phone on same Wi‑Fi, confirm http://192.168.50.105:8001/health opens from the phone browser.

## App flow

1. **Create farm account** (owner) or **Sign in**
2. **Home** — live shed/farmer counts
3. **Sheds** — create, open detail, assign farmers
4. **Farmers** — add farmer with permissions + shed assignment
5. **Account** — switch org / sign out

Farmer login: only assigned sheds + granted permissions.
