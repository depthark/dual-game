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
  - `Leaderboard` — Provider-based score board (no backend of ours, no paid API). **One global board on PlayFab** (title `1095E4`, public Title ID, client REST only) shared by every platform: invisible device login (`LoginWithCustomID` with a random per-device UID), the player only types a nickname (PlayFab display name, unique per title), score = `HighScore` statistic (column `Score`, aggregation Max) linked to the `HighScore` leaderboard via the newer `/Statistic/*` and `/Leaderboard/*` APIs (legacy client statistics are disabled for new titles). Every score is also kept in the **local** localStorage board, which is shown when PlayFab is unreachable; the device's best is re-sent on each submit so offline runs catch up. On iOS, scores are additionally mirrored to **Game Center** (`dualmind.highscore`, app-local plugin `ios/App/App/GameCenterPlugin.swift`) for Apple's Games app — Game Center is not shown in-game. Both control setups rank together; `LocalProvider.load()` folds the older split Normal/Advanced rows into one. See `.env.example`.
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

### PWA

Service worker (`public/sw.js`) uses cache-first for assets, network-first for navigation. Cache key: `dual-v1`. Manifest targets fullscreen portrait mode.

### Mobile (iOS App Store)

- **`mobile/`** — Expo shell app (portrait-locked WKWebView) that loads the game from a bundled single-file HTML asset, fully offline. `vite.mobile.config.ts` + `bun run build:mobile` produce `mobile/assets/game/index.html` (gitignored — regenerate before every native build; no PWA/service worker in this build).
- Release is Xcode-native (no EAS): `expo prebuild --platform ios --clean` → `pod install` → `xcodebuild archive` → `-exportArchive` upload with an App Store Connect API key. Full runbook: `docs/IOS_RELEASE.md`.
- Versioning law: `ios.buildNumber` (string) and `android.versionCode` (number) in `mobile/app.config.ts` are always bumped together to the same value in one commit.
- `mobile/ios/` and `mobile/android/` are generated and never committed.
