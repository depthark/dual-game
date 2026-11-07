# AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.

## Build & Dev Commands

```bash
bun install          # Install dependencies
bun run dev          # Start Vite dev server on port 3000 (auto-opens browser)
bun run build        # Production build to dist/
bun run build:mobile # Single-file game bundle for the native shell → mobile/assets/game/index.html
bun run preview      # Preview production build locally
```

No test runner or linter is configured. TypeScript checking uses `strict: true` in tsconfig.json (noEmit — Vite handles transpilation).

## Architecture

**DUAL** is a Phaser 3 reflex arcade game (TypeScript, Vite, PWA). Two dots navigate through endless scrolling gates in their own lanes. Each dot is steered independently by its own thumb joystick — there is no auto-movement and no mirrored physics.

### Source Layout

- **`src/main.ts`** — Phaser game bootstrap (400×640 FIT viewport) + service worker registration
- **`src/config/constants.ts`** — All tunable game parameters: dimensions, physics, difficulty curves, 10 color themes, scoring, power-ups
- **`src/engine/`** — Isolated subsystems:
  - `InputManager` — Two-thumb virtual joysticks. Left half of screen drives `leftDir()`, right half drives `rightDir()` (each −1..+1). Calls `scene.input.addPointer(1)` so both touches track at once. Updates the `#joystick-*-knob` DOM elements in real time. Keyboard fallback (arrows/A/D/Space) maps to spread/gather across both dots.
  - `ObstaclePool` — Object-pooled obstacle spawning with procedural difficulty scaling (gap width, spacing, speed all tighten over distance). Spawns ghost and bullet-time pickups in the open space below selected walls.
  - `Renderer` — Layered Phaser Graphics drawing (bg → walls → trails → dots → fx). Handles themed backgrounds, portal gate effects, flicker/glitch, glow trails, death particles.
  - `SoundEngine` — Web Audio synth singleton (procedural sounds, no audio files). Global `sfx` instance, fails silently.
  - `UIManager` — Owns the HTML overlay (`#ui-inner`, fixed 400×640 virtual canvas scaled via CSS `svi`/`svb`). Switches between menu / how-to sheet / settings / HUD / leaderboard / game-over views, drives the intro demo class on `#game-hud`, renders the bullet-walls and ghost-charges indicators, and spawns floating "+N" score popups (`#score-popups`) on each gate pass. Screens are wired to scenes through `on*` callbacks (`onPlay`, `onShowSettings`, `onRetry`, `onBackToHome`, …) rather than the scenes touching the DOM.
  - `Leaderboard` — Provider-based score board. Defaults to the **global** `CloudflareProvider`, which talks to our own Pages Function (`functions/api/scores.ts`) backed by D1 — no third-party SDK, no key in the bundle. `POST` submits a score, `PUT` renames (server-side uniqueness + profanity check, surfaced to the player as `NameError`). Every score is also kept in the localStorage `LocalProvider`, shown when the network is unavailable (`statusHint()` drives the "Offline —" note); the device's best is re-sent on each submit so offline runs catch up. **One shared board** — both control setups rank together, one row per device UID, only the max score kept (locally via `max()`, on the server via `MAX(scores.score, excluded.score)`). On iOS, scores are additionally mirrored to **Game Center** (`dualmind.highscore`, app-local plugin `ios/App/App/GameCenterPlugin.swift`) for Apple's Games app — Game Center is not shown in-game. `LocalProvider.load()` folds rows from the older split Normal/Advanced boards into one. Override the endpoint with `VITE_LB_API`; see `.env.example`. *(Builds up to 1.0 used PlayFab; its free tier is capped at 1,000 lifetime player accounts, so it was replaced.)*
  - `Achievements` — Game Center achievements (iOS only). Ten IDs `dualmind.ach.*`, created in App Store Connect by `scripts/setup-achievements.py`. Score/level ones carry a progress bar from the device best and unlock retroactively on launch; per-run ones (ghosts, bullet time, near misses, TWO HANDS) report 100% only. Reported at the end of a run, never mid-run. Uses the `GameCenter` plugin exported from `Leaderboard`.
  - `Store` — the one-time **Full Game** unlock (`com.lukaschylik.dualmind.fullgame`, non-consumable, $0.95/€0.95/25 Kč, created by `scripts/setup-full-game.py`). Levels 1–5 free; at the level-6 transition `GameScene` freezes the run under the paywall (UNLOCK resumes the same run, NOT NOW ends it via `endRun(null)`). Native side is `ios/App/App/StorePlugin.swift` (StoreKit 2). Players whose first install was 1.0 (build ≤ 9, production `AppTransaction` only) keep everything free. Web/Android: always full. `?paywall` fakes a locked store in dev.
  - `Haptics` — Capacitor haptics natively, `navigator.vibrate` on the web. Player-mutable from Settings → AUDIO → HAPTICS (`dual_haptics_muted`), separate from sound because the silent switch can't mute a haptic.
- **`src/scenes/`** — Phaser scenes:
  - `MenuScene` — Home screen (top icon bar, wordmark, BEST/LVL pill, PLAY) plus everything reachable from it: the how-to bottom sheet, settings, and the leaderboard. There is deliberately **no tap-anywhere-to-start** — the screen has real controls, and a global pointer handler would fire underneath every one of them.
  - `GameScene` — Main loop: physics → trails → scrolling → collision → theme transitions → flicker effects → rendering. Manages intro speed ramp, bullet-time speed transitions, and the death sequence with burst particles and restart.

### Key Patterns

- **CONTROL setting (two modes, one flag)**: persisted as `dual_control` and threaded through the engine as GameScene's existing `advanced` boolean. **TWO HANDS** (`advanced = true`, labelled HARDER) uses `InputManager.leftMove()/rightMove()` — each thumb drives its own dot 1:1. **ONE HAND** (`advanced = false`) uses `spreadDir()` — mirrored spread/gather, where a single thumb drives both dots. The internal flag keeps the `advanced` name because it threads through GameScene / InputManager / ObstaclePool / `ADVANCED_SPEED_MULT`; only the player-facing labels differ.
- **Independent dot control**: Each dot's velocity is driven by its own joystick (`leftDir()` / `rightDir()`). Each dot is clamped to its own lane and collides independently against that lane's gate.
- **No auto-movement**: Dots stay still when both thumbs are lifted (friction decays residual velocity). There is no auto-spread fallback and no "pause spreading inside a gate" rule.
- **Progressive difficulty**: Speed, gap width, spacing, and gap offset all scale with `sqrt(distance)` (constants define min/max curves).
- **Intro phase**: First `INTRO_DURATION` (2.4s) uses `INTRO_SPEED_MULT` (0.5×) to ease the player in without feeling sluggish. The `#game-hud` carries an `intro-demo` class during this window so the joystick knobs auto-animate left-right as a control hint; the class is removed when the player first touches a joystick or when the timer expires.
- **Theme cycling**: 10 themes rotate every `LEVEL_POINTS` (1000) points with screen shake. Flicker effects activate at score `FLICKER_START_SCORE` (1500+).
- **Combo scoring**: Each gate scores `BASE_PASS_SCORE` (10) × the live combo multiplier (consecutive passes, capped at `MAX_COMBO_MULTI` = 10×), so a ×2 gate is worth double a ×1 gate. Near-misses (within 6px) trigger audio but don't break combo. (`LEVEL_POINTS` is 100× the base so the gates-per-level pacing is unchanged.)
- **Power-ups**:
  - **Ghost** (white concentric circle) — stacks; each charge phases through the next wall.
  - **Bullet time** (green dot) — only spawns from the displayed level `BULLET_MIN_LEVEL` (5) onward, since the early game is already slow. Slows scroll to `BULLET_SPEED_MULT` (0.5×) for `BULLET_WALL_COUNT` (2) wall passes, then ramps back to full speed over `BULLET_TRANSITION` (400ms). The HUD timer shows the *remaining wall count*, not seconds. (`ObstaclePool.level` is fed the live score-based level by `GameScene`.)
- **No external assets**: All sounds are synthesized via Web Audio. Icons are inline SVG / CSS shapes.

### Joystick UI

Two fixed rings sit at the bottom of the play area inside `#game-hud`:

- `#joystick-left` (cyan, centered ~(90, 590)) ↔ left dot
- `#joystick-right` (magenta, centered ~(310, 590)) ↔ right dot
- `.joystick-knob` is the inner indicator. Its `transform: translate(...)` is rewritten by `InputManager` on each pointer move; horizontal displacement is clamped to ±`JOYSTICK_MAX` (40px in game units) which also defines the input saturation point.
- During the intro window the `.intro-demo` ancestor class drives a CSS `joystick-demo-knob` keyframe animation on the knobs to demonstrate the gesture.

### Leaderboard backend (Cloudflare)

- **`functions/api/scores.ts`** — Pages Function serving `GET /api/scores` (top N + the caller's rank if they fall outside it) and `POST /api/scores` (upsert). Deploys automatically with the site on every push; there is no separate Worker.
- **`migrations/0001_init.sql`** — the single `scores` table (`uid` PK, `name`, `score`, `level`, `updated`). Apply with `wrangler d1 execute dual-scores --remote --file=migrations/0001_init.sql`.
- **`wrangler.toml`** — binds the `dual-scores` D1 database as `DB`. `database_id` is account-scoped, not a secret.
- **Anonymity is a design constraint**: the only identity is a client-generated random UUID. No accounts, no email, no IDFA, and the Function deliberately does not log IP addresses. Changing this means changing `public/privacy/index.html` and the App Store privacy declaration together.
- **Validation** lives server-side in `scores.ts`: names are uppercased and stripped to `[A-Z0-9 ]` (which also defeats markup and URL injection) then run through a leetspeak-normalised profanity list; scores must be positive multiples of `BASE_PASS_SCORE` (10); levels must be 1–10. Any client-submitted score is forgeable in principle — this stops casual tampering, not a determined attacker.
- **CORS is `*` on purpose** — the iOS build runs at `capacitor://localhost`, so its requests are cross-origin. The board is public and anonymous and sends no cookies.

### PWA

Service worker (`public/sw.js`) uses cache-first for assets, network-first for navigation. Cache key: `dual-v1`. Manifest targets fullscreen portrait mode.

### Mobile (iOS App Store)

- **The shipped App Store app** ("DUAL Mind", `com.lukaschylik.dualmind`) is the **Capacitor** project in `ios/App` — built and uploaded by `scripts/publish-testflight.sh`. Its app-local plugins (`GameCenterPlugin.swift`, `StorePlugin.swift`, registered in `MainViewController.swift`) exist only there, so achievements and the Full Game purchase only work in that build. Version 1.0 = builds ≤ 9 (all levels free); 1.1 starts at build 10.

- **`mobile/`** — Expo shell app (portrait-locked WKWebView) that loads the game from a bundled single-file HTML asset, fully offline. `vite.mobile.config.ts` + `bun run build:mobile` produce `mobile/assets/game/index.html` (gitignored — regenerate before every native build; no PWA/service worker in this build).
- Release is Xcode-native (no EAS): `expo prebuild --platform ios --clean` → `pod install` → `xcodebuild archive` → `-exportArchive` upload with an App Store Connect API key. Full runbook: `docs/IOS_RELEASE.md`.
- Versioning law: `ios.buildNumber` (string) and `android.versionCode` (number) in `mobile/app.config.ts` are always bumped together to the same value in one commit.
- `mobile/ios/` and `mobile/android/` are generated and never committed.
