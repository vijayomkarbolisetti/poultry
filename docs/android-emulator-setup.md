# Android emulator on Windows (for this app)

You need **Android Studio** so Expo can open an emulator. This PC did not have an Android SDK yet.

## 1. Install Android Studio

```powershell
winget install Google.AndroidStudio --accept-package-agreements --accept-source-agreements
```

Or download: https://developer.android.com/studio

## 2. First launch setup

1. Open **Android Studio**
2. More Actions → **SDK Manager**
3. Install:
   - Android SDK Platform (API 35 or 34)
   - Android SDK Platform-Tools
   - Android Emulator
4. More Actions → **Virtual Device Manager** → **Create Device**
5. Pick a phone (e.g. Medium Phone) → system image **API 34+** → Finish
6. Click **Play** to start the emulator

**Disk space note:** the AVD userdata partition needs ~6–12 GB free on the drive that hosts `~/.android/avd`. If C: is full, move the `.avd` folder to `D:\Android\avd\` and update `Medium_Phone_API_37.0.ini` `path=` to match.

## 3. Environment variables (PowerShell profile or System env)

```powershell
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$androidPaths = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator"
if ($machinePath -notlike "*platform-tools*") {
  [System.Environment]::SetEnvironmentVariable("Path", "$machinePath;$androidPaths", "User")
}
```

Close and reopen the terminal after this.

## 4. Point the app at the emulator API

`mobile/.env` must be:

```
EXPO_PUBLIC_API_URL=http://10.0.2.2:8001
```

(`10.0.2.2` = your PC from inside the Android emulator)

## 5. Run

```powershell
# Terminal 1 — API
cd d:\learning\poultry\backend
.\.venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8001

# Terminal 2 — start emulator first from Android Studio, then:
cd d:\learning\poultry\mobile
npx expo start --port 8083
```

Press **`a`** in the Expo terminal to open the app on the emulator.

Check: `adb devices` should list `emulator-5554`.
