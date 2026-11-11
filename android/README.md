# Subster companion (Android)

Reports how long each subscription app was on screen, so the web app can compare cost with use.

- Asks the server which apps belong to tracked subscriptions (`GET /api/usage`).
- Reads daily foreground minutes for those apps only, with `UsageStatsManager`.
- Uploads daily totals (`POST /api/usage`). No titles, content or credentials are read or sent.
- Syncs on demand and every 6 hours in the background (WorkManager).

## Run

1. Open this `android/` folder in Android Studio and let it sync Gradle.
2. Start the web app on your machine (`npm run dev`).
3. Run on an emulator. The default server URL `http://10.0.2.2:3000` reaches your machine.
   On a physical phone, either run `adb reverse tcp:3000 tcp:3000` and use
   `http://localhost:3000`, or enter your deployed `https://` URL.
4. Tap **Open usage access settings**, allow Subster, return, and tap **Sync now**.

Plain HTTP is allowed only for `10.0.2.2` and `localhost`; everything else must be HTTPS.

## Status

Builds with `./gradlew assembleDebug` (Gradle 8.9 wrapper, AGP 8.7, Kotlin 2.0, Compose BOM
2024.10); the debug APK lands in `app/build/outputs/apk/debug/`. It has not been run on a device
or emulator yet. Limits that are inherent to the approach: foreground time is not the same as
watching, and TV or console use is invisible to a phone.
