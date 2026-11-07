# Releasing to TestFlight

Headless, ASC-API-key auth — same shape as ActiveGotchi's proven pipeline
(`~/Projects/activegotchi/.claude/skills/publish-testflight/SKILL.md`), adapted
for Capacitor (SPM, not CocoaPods; no embedded watch app; single target `App`).

## One-time setup (before the first run)

1. ~~Create the app record in App Store Connect~~ — **done.** App Store
   listing name is **"DUAL: One Mind"** (App Store name, `com.lukaschylik.dual`
   and plain "DUAL Mind" were both already taken — Apple's name check
   appears to normalize case/spacing, so "DUAL Mind" and "DualMind" collided
   as the same reserved string). Bundle ID `com.lukaschylik.dualmind`.
   App Store Connect app id **`6802384935`**:
   https://appstoreconnect.apple.com/apps/6802384935/distribution

   Note the App Store *listing* name ("DUAL: One Mind") is independent from
   the on-device home-screen label — `CFBundleDisplayName` /
   Android `app_name` / Capacitor `appName` all stay the shorter **"DUAL
   Mind"** (set in `capacitor.config.ts`, `Info.plist`, `strings.xml`), which
   is what actually shows under the icon. No code change needed if the App
   Store name changes again later — it's entered directly in App Store
   Connect, not derived from the repo.

   The original `com.lukaschylik.dual` Bundle ID is still registered but
   orphaned/unused — harmless to leave, or delete it in App Store Connect →
   Certificates, Identifiers & Profiles if you want to tidy up.
   **This step is manual no matter what** — the App Store Connect API
   explicitly forbids `CREATE` on the `apps` resource for any key role,
   Admin included (`POST /v1/apps` → 403 `FORBIDDEN_ERROR`, "Allowed
   operations are: GET_COLLECTION, GET_INSTANCE, UPDATE"). Everything else
   about app setup (Bundle ID registration, TestFlight builds, metadata
   updates) is scriptable via the API; a brand-new app listing is not.
2. **Confirm the Apple Developer Team.** `ios/App/App.xcodeproj` is already
   set to `DEVELOPMENT_TEAM = D37259WW5B` (same team as ActiveGotchi). If DUAL
   actually lives under a different team/account, update both occurrences in
   `ios/App/App.xcodeproj/project.pbxproj` and pass that team via
   `DEVELOPMENT_TEAM=<id>` to the script.
3. **App Store Connect API key.** Reusing the existing key at
   `~/.appstoreconnect/private_keys/AuthKey_N2C8T6U533.p8` works only if it's
   scoped at the team level (or explicitly to DUAL) in App Store Connect →
   Users and Access → Integrations → your key → check its Access. If it's
   scoped to ActiveGotchi only, generate a new key there instead — Apple
   allows exactly one download of the `.p8`, so save it immediately.
4. **Network access for the first archive.** This project's iOS deps resolve
   via Swift Package Manager (not committed, unlike CocoaPods' `Pods/`), so
   the first `xcodebuild archive` needs internet to fetch the Capacitor
   xcframework packages from GitHub releases.
5. A shared scheme (`ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`)
   is already committed so `xcodebuild -scheme App` resolves headlessly
   without ever opening Xcode. If you *do* open the project in Xcode first,
   don't let it silently switch this to a private/user scheme.

## Running a release

```bash
ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_N2C8T6U533.p8 \
ASC_KEY_ID=N2C8T6U533 \
ASC_ISSUER_ID=d564f5ce-e33b-4ad7-8f5c-b9c7e137ebaa \
bun run release:testflight
```

(Or `./scripts/publish-testflight.sh` directly with the same env vars.)

The script: green-gate build → bump `CURRENT_PROJECT_VERSION` → `cap sync ios`
→ `xcodebuild archive` (ASC key, not Xcode's Apple-ID session — that session
has a history of silently vanishing mid-release on this pipeline) → verify
frameworks + bundle version → `xcodebuild -exportArchive` upload.

No secrets are hardcoded — `ASC_KEY_PATH`/`ASC_KEY_ID`/`ASC_ISSUER_ID` are
required env vars, and the script exits early with a clear message if any are
missing. `DEVELOPMENT_TEAM` and `BUILD_NUMBER` are optional overrides.

Success looks like `Progress 100%: Upload succeeded.` at the end of the log.
The build number bump lands in `project.pbxproj` — commit it after a
successful upload so the repo and App Store Connect stay in sync.

## App icons & splash screens

Source art lives in `assets/*.svg` (the same dot/gate mark as the PWA icons
in `public/icons/`, just re-composed per file):

- `icon-only.svg` — flattened icon (iOS + Android legacy), opaque, no
  pre-rounded corners (the OS applies its own mask)
- `icon-foreground.svg` / `icon-background.svg` — Android adaptive-icon
  layers (foreground is transparent, content kept inside the safe zone)
- `splash.svg` / `splash-dark.svg` — native launch screen, full-bleed on the
  exact game background color (`#05050a`) so there's no flash before the
  WebView takes over. Identical for light/dark since the game has no light
  theme.

Regenerate everything with `bun run assets:generate` (wraps
`@capacitor/assets`, a devDependency). It rewrites the Xcode asset catalog
(`AppIcon.appiconset`, `Splash.imageset`) and every Android mipmap/drawable
density directly — re-run `cap sync` isn't needed for this, but a fresh
archive/upload is, since an already-uploaded TestFlight build's icon can't
be changed after the fact.

## What this does NOT cover

- **Android** — not part of this pipeline; see `package.json`'s `cap:android`
  for local dev only.

## Leaderboard backends

**PlayFab (the in-game global board).** Title `1095E4` ("My Game" in the
PlayFab Game Manager, Development mode — free up to 1,000 lifetime players,
then Pay-as-you-go). Setup is listed in `.env.example`. Client-only REST; no
secret key ships in the app.

**Game Center (iOS bonus).** Scores are mirrored to Apple's Games app; nothing
in-game reads it.

- App Store Connect → DUAL: One Mind → Game Center: leaderboard **"High Score"**,
  ID **`dualmind.highscore`** (Best score, sorted high → low, integer), ASC id
  `f89293f7-b83d-40b0-a6ab-a7ec8b5995b2`. Game Center is enabled on version 1.0.
- Native side: `ios/App/App/GameCenterPlugin.swift` (app-local Capacitor plugin,
  JS name `GameCenter`), registered in `MainViewController.swift` (the
  storyboard root). Entitlement `com.apple.developer.game-center` in
  `App.entitlements`.
- **First release:** the leaderboard version has to go into the same review
  submission as the app version. Until the app is live, Game Center data is
  sandbox-only.

## App Store screenshots

iPhone 6.7" (1320×2868), iPhone 6.5" (1242×2688) and iPad 13" (2064×2752) sets
are uploaded in App Store Connect. They are real captures of the web build at
those viewports (the 400×640 canvas letterboxed exactly as on device).
