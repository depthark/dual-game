import Phaser from 'phaser';
import {
  W, H, HALF, DOT_R, DOT_Y, WALL_H,
  ACCEL, FRICTION, MAX_VEL, TRAIL_LEN,
  SPEED_INITIAL, SPEED_GROWTH, MAX_COMBO_MULTI, BASE_PASS_SCORE, LEVEL_POINTS, ADVANCED_SPEED_MULT,
  C_BG, C_LEFT, C_RIGHT, HI_SCORE_KEY, HI_LEVEL_KEY, TOTAL_LEVELS,
  THEMES, FLICKER_START_SCORE, FLICKER_INTERVAL_MIN,
  FLICKER_INTERVAL_MAX, FLICKER_DURATION,
  GHOST_RADIUS, INTRO_DURATION, INTRO_SPEED_MULT,
  BULLET_RADIUS, BULLET_WALL_COUNT, BULLET_SPEED_MULT, BULLET_TRANSITION
} from '../config/constants';
import { sfx } from '../engine/SoundEngine';
import { music } from '../engine/Music';
import { haptics } from '../engine/Haptics';
import { InputManager } from '../engine/InputManager';
import { ObstaclePool } from '../engine/ObstaclePool';
import { Renderer, DeathParticle } from '../engine/Renderer';
import { uiManager } from '../engine/UIManager';
import { leaderboard } from '../engine/Leaderboard';
import { store, FREE_LEVELS } from '../engine/Store';
import { achievements } from '../engine/Achievements';

interface Dot {
  x: number;
  vx: number;
}

export class GameScene extends Phaser.Scene {
  /* player state */
  private leftDot!: Dot;
  private rightDot!: Dot;

  /* scrolling / score */
  private speed!: number;
  private dist!: number;
  private score!: number;
  private combo!: number;
  private maxCombo!: number;
  private alive!: boolean;
  private hiScore!: number;
  private hiLevel!: number;
  private newBest!: boolean;
  private shakeAmt!: number;

  /* theme tracking */
  private currentTheme!: number;
  private lastThemeTrigger!: number;

  /* flicker state */
  private flickerPhase!: number;
  private flickerTimer!: number;
  private nextFlickerAt!: number;

  /* trails */
  private leftTrail!: number[];
  private rightTrail!: number[];

  /* game mode — advanced = each thumb steers its own dot independently */
  private advanced!: boolean;

  /* intro phase */
  private introTimer!: number;
  private introActive!: boolean;

  /* ghost power-up — stacking charges */
  private ghostCharges!: number;

  /* bullet time — counts walls remaining to pass at slow speed */
  private bulletWallsLeft!: number;
  /** Current speed multiplier (smoothly transitions between targets) */
  private speedMult!: number;
  /** Target speed multiplier */
  private speedMultTarget!: number;

  /* per-run counters for the Game Center achievements */
  private runGhosts!: number;
  private runBullets!: number;
  private runNearMisses!: number;

  /* paywall — free players are held at the level-6 transition */
  private paywallOpen!: boolean;

  /* death */
  private deathParticles!: DeathParticle[];
  private deathTimer!: number;
  /** null = the run ended without a crash (declined the paywall) */
  private deadSide!: 'left' | 'right' | null;
  private goShown!: boolean;
  private retryShown!: boolean;

  /* subsystems */
  private input_!: InputManager;
  private pool!: ObstaclePool;
  private gfx!: Renderer;

  constructor() {
    super('Game');
  }

  create(data?: { advanced?: boolean }): void {
    this.advanced = !!data?.advanced;

    this.cameras.main.setBackgroundColor(C_BG);

    /* player state */
    this.leftDot  = { x: HALF / 2,        vx: 0 };
    this.rightDot = { x: HALF + HALF / 2,  vx: 0 };

    /* scrolling / score */
    this.speed = SPEED_INITIAL;
    this.dist  = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.alive = true;
    this.hiScore = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0', 10);
    this.hiLevel = parseInt(localStorage.getItem(HI_LEVEL_KEY) || '0', 10);
    this.newBest = false;
    this.shakeAmt = 0;

    /* theme tracking */
    this.currentTheme    = 0;
    this.lastThemeTrigger = 0;

    /* flicker state */
    this.flickerPhase  = 0;
    this.flickerTimer  = 0;
    this.nextFlickerAt = this._randomFlickerDelay();

    /* trails */
    this.leftTrail  = [];
    this.rightTrail = [];

    /* intro phase */
    this.introTimer  = 0;
    this.introActive = true;

    /* ghost power-up */
    this.ghostCharges = 0;

    /* bullet time */
    this.bulletWallsLeft = 0;
    this.speedMult       = INTRO_SPEED_MULT;  // start slow
    this.speedMultTarget = INTRO_SPEED_MULT;

    /* achievements + paywall */
    this.runGhosts     = 0;
    this.runBullets    = 0;
    this.runNearMisses = 0;
    this.paywallOpen   = false;

    /* death */
    this.deathParticles = [];
    this.deathTimer     = 0;
    this.deadSide       = null;
    this.goShown        = false;
    this.retryShown     = false;

    /* subsystems */
    this.input_ = new InputManager(this, this.advanced);
    this.pool   = new ObstaclePool();
    this.pool.advanced = this.advanced;
    this.pool.seed(DOT_Y - 250, this.dist);

    this.gfx = new Renderer({
      bg:     this.add.graphics(),
      walls:  this.add.graphics(),
      trails: this.add.graphics(),
      dots:   this.add.graphics(),
      fx:     this.add.graphics()
    });

    /* show HUD overlay */
    uiManager.showHUD(this.advanced);

    /* game-over card actions (re-bound each run — the scene is recreated) */
    uiManager.onRetry      = () => this.restart();
    uiManager.onBackToHome = () => this.backToHome();
    uiManager.onBuyFull       = () => this.buyFromPaywall();
    uiManager.onPaywallLater  = () => this.declinePaywall();
    /* unlocked elsewhere while the paywall is up (Ask to Buy, Family Sharing) */
    store.onChange = (full) => { if (full && this.paywallOpen) this.resumeAfterUnlock(); };

    /* start procedural background music (idempotent across restarts) */
    music.setLevel(1);
    music.start();
  }

  /* ---- helpers ---- */
  private _randomFlickerDelay(): number {
    return FLICKER_INTERVAL_MIN + Math.random() * (FLICKER_INTERVAL_MAX - FLICKER_INTERVAL_MIN);
  }

  /* ================================================================ */
  /*  UPDATE                                                          */
  /* ================================================================ */
  update(time: number, delta: number): void {
    if (!this.alive) {
      this.updateDeath(delta, time);
      return;
    }
    /* frozen behind the paywall — nothing moves until the player decides */
    if (this.paywallOpen) return;

    const dt  = delta / 16.667;

    /* -- intro timer -- */
    if (this.introActive) {
      this.introTimer += delta;
      if (this.introTimer >= INTRO_DURATION) {
        this.introActive = false;
        this.speedMultTarget = 1;
        uiManager.fadeOutIntroHint();
        uiManager.stopIntroDemo();
      }
    }

    /* -- smooth speed multiplier transition -- */
    if (this.speedMult !== this.speedMultTarget) {
      const rate = delta / BULLET_TRANSITION; // fraction of transition per frame
      if (this.speedMult < this.speedMultTarget) {
        this.speedMult = Math.min(this.speedMultTarget, this.speedMult + rate);
      } else {
        this.speedMult = Math.max(this.speedMultTarget, this.speedMult - rate);
      }
    }

    /* -- physics --
       Normal: mirrored spread/gather virtual-joystick with momentum, driven by
         the stronger thumb so a small timing skew can't desync the dots.
       Advanced: each dot tracks its own finger 1:1 (a perfect mirror of the
         finger's movement) — fully independent, no coupling, no momentum. */
    if (this.advanced) {
      this.leftDot.x  += this.input_.leftMove(dt);
      this.rightDot.x += this.input_.rightMove(dt);
      this.leftDot.vx = this.rightDot.vx = 0;
    } else {
      const accelStep = ACCEL * dt;
      const frictionStep = Math.pow(FRICTION, dt);
      const spread = this.input_.spreadDir();
      this.leftDot.vx  += -spread * accelStep;
      this.rightDot.vx +=  spread * accelStep;
      this.leftDot.vx  *= frictionStep;
      this.rightDot.vx *= frictionStep;
      this.leftDot.vx  = Phaser.Math.Clamp(this.leftDot.vx, -MAX_VEL, MAX_VEL);
      this.rightDot.vx = Phaser.Math.Clamp(this.rightDot.vx, -MAX_VEL, MAX_VEL);
      this.leftDot.x  += this.leftDot.vx * dt;
      this.rightDot.x += this.rightDot.vx * dt;
    }
    this.leftDot.x  = Phaser.Math.Clamp(this.leftDot.x, DOT_R + 2, HALF - DOT_R - 2);
    this.rightDot.x = Phaser.Math.Clamp(this.rightDot.x, HALF + DOT_R + 2, W - DOT_R - 2);

    /* -- trails -- */
    this.leftTrail.push(this.leftDot.x);
    this.rightTrail.push(this.rightDot.x);
    if (this.leftTrail.length  > TRAIL_LEN) this.leftTrail.shift();
    if (this.rightTrail.length > TRAIL_LEN) this.rightTrail.shift();

    /* -- scroll (with smooth speed multiplier) -- */
    const diffMult = this.advanced ? ADVANCED_SPEED_MULT : 1;
    const baseSpeed = (SPEED_INITIAL + Math.sqrt(this.dist) * SPEED_GROWTH) * diffMult;
    this.speed = baseSpeed * this.speedMult;
    const scroll = this.speed * dt;
    this.dist += scroll;
    /* keep the pool's level gate in sync with the displayed (score-based) level */
    this.pool.level = Math.floor(this.score / LEVEL_POINTS) + 1;
    this.pool.scroll(scroll, this.dist);

    /* -- collision & scoring -- */
    for (const o of this.pool.items) {
      const inBand = o.y > DOT_Y - WALL_H / 2 - DOT_R && o.y < DOT_Y + WALL_H / 2 + DOT_R;

      if (inBand && !o.ghostPassed) {
        const leftHit  = this.hitTest(this.leftDot.x,  o.leftGapX,  o.gapW);
        const rightHit = this.hitTest(this.rightDot.x, o.rightGapX, o.gapW);

        if (leftHit || rightHit) {
          if (this.ghostCharges > 0) {
            this.ghostCharges--;
            o.ghostPassed = true;
            uiManager.updateGhostCharges(this.ghostCharges);
          } else {
            this.die(leftHit ? 'left' : 'right');
            return;
          }
        }

        /* near-miss */
        if (this.ghostCharges === 0 && !o.nearFlag) {
          const lD   = Math.abs(this.leftDot.x  - o.leftGapX);
          const rD   = Math.abs(this.rightDot.x - o.rightGapX);
          const edge = o.gapW / 2 - DOT_R;
          if (lD > edge - 6 || rD > edge - 6) {
            o.nearFlag    = true;
            this.runNearMisses++;
            this.shakeAmt = 3;
            sfx.play('near');
          }
        }
      }

      /* -- ghost pickup -- */
      if (o.ghostX != null && o.ghostY != null && !o.ghostCollected) {
        const gr2 = (GHOST_RADIUS + DOT_R) * (GHOST_RADIUS + DOT_R);
        const ldx = this.leftDot.x  - o.ghostX;
        const ldy = DOT_Y - o.ghostY;
        const rdx = this.rightDot.x - o.ghostX;
        const rdy = DOT_Y - o.ghostY;
        if (ldx * ldx + ldy * ldy < gr2 || rdx * rdx + rdy * rdy < gr2) {
          o.ghostCollected = true;
          this.ghostCharges++;
          this.runGhosts++;
          sfx.playGhost();
          uiManager.updateGhostCharges(this.ghostCharges);
          uiManager.showGhostAlert();
        }
      }

      /* -- bullet time pickup -- */
      if (o.bulletX != null && o.bulletY != null && !o.bulletCollected) {
        const br2 = (BULLET_RADIUS + DOT_R) * (BULLET_RADIUS + DOT_R);
        const ldx = this.leftDot.x  - o.bulletX;
        const ldy = DOT_Y - o.bulletY;
        const rdx = this.rightDot.x - o.bulletX;
        const rdy = DOT_Y - o.bulletY;
        if (ldx * ldx + ldy * ldy < br2 || rdx * rdx + rdy * rdy < br2) {
          o.bulletCollected = true;
          this.runBullets++;
          this.bulletWallsLeft = BULLET_WALL_COUNT;
          this.speedMultTarget = BULLET_SPEED_MULT;
          sfx.play('bullet');
          uiManager.updateBulletWalls(this.bulletWallsLeft);
          uiManager.showBulletAlert();
        }
      }

      if (!o.passed && o.y > DOT_Y + WALL_H / 2 + DOT_R) {
        o.passed = true;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        /* score the base value multiplied by the live combo multiplier */
        const mult = Math.min(this.combo, MAX_COMBO_MULTI);
        const pts  = BASE_PASS_SCORE * mult;
        this.score += pts;
        /* floating "+N" rising between the two dots, brighter as combo climbs */
        uiManager.popupScore(pts, (this.leftDot.x + this.rightDot.x) / 2, DOT_Y - 16, mult);
        /* pitch rises with the combo for a satisfying streak feel */
        sfx.play('pass', 1 + mult * 0.035);
        haptics.pass();

        if (this.score > this.hiScore && !this.newBest) {
          this.newBest = true;
          uiManager.showNewBest();
        }

        /* bullet time consumes a wall pass; revert speed when exhausted */
        if (this.bulletWallsLeft > 0) {
          this.bulletWallsLeft--;
          uiManager.updateBulletWalls(this.bulletWallsLeft);
          if (this.bulletWallsLeft === 0) {
            this.speedMultTarget = 1;
            sfx.play('bulletEnd');
          }
        }
      }
    }

    /* -- theme transitions every 100 points -- */
    const themeIndex = Math.floor(this.score / LEVEL_POINTS);
    /* free players stop here: level 6 needs the Full Game unlock */
    if (themeIndex >= FREE_LEVELS && !store.isFull()) {
      this.openPaywall();
      return;
    }
    if (themeIndex > this.currentTheme) {
      this.currentTheme = themeIndex;
      this.gfx.setTheme(themeIndex);
      this.shakeAmt = 6;
      sfx.playLevelUp();
      music.setLevel(themeIndex + 1);

      const theme = THEMES[themeIndex % THEMES.length];
      uiManager.showBanner(theme.name, this.displayLevel());
    }

    /* -- flicker effect -- */
    if (this.score >= FLICKER_START_SCORE) {
      this.flickerTimer += delta;
      if (this.flickerPhase > 0) {
        this.flickerPhase      = Math.max(0, this.flickerPhase - delta / FLICKER_DURATION);
        this.gfx.flickering    = this.flickerPhase > 0;
      } else if (this.flickerTimer >= this.nextFlickerAt) {
        this.flickerPhase      = 1;
        this.flickerTimer      = 0;
        this.nextFlickerAt     = this._randomFlickerDelay();
        this.gfx.flickering    = true;
        if (this.score > 4 * LEVEL_POINTS) this.shakeAmt = Math.max(this.shakeAmt, 2);
      }
    }

    this.shakeAmt *= 0.85;

    /* -- draw -- */
    const sx = (Math.random() - 0.5) * this.shakeAmt;
    const sy = (Math.random() - 0.5) * this.shakeAmt;

    this.gfx.clearAll();
    this.gfx.drawBg(this.dist, time, sx, sy, this.cameras.main);
    this.gfx.drawObstacles(this.pool.items, sx, sy, time);
    this.gfx.drawGhosts(this.pool.items, sx, sy, time);
    this.gfx.drawBulletPickups(this.pool.items, sx, sy, time);
    this.gfx.drawTrails(this.leftTrail, this.rightTrail, DOT_Y, sx, sy);
    this.gfx.drawDots(this.leftDot.x, this.rightDot.x, DOT_Y, time, sx, sy, this.ghostCharges > 0);

    if (this.flickerPhase > 0) {
      this.gfx.drawFlicker(this.flickerPhase);
    }

    /* -- HUD update -- */
    uiManager.updateScore(this.score);
    uiManager.updateCombo(this.combo);
  }

  /** Player-facing level, 1-indexed and capped at TOTAL_LEVELS.
   *
   *  `currentTheme` keeps climbing forever so the palette carries on cycling
   *  past the last theme, but the level is presented as "n/TOTAL_LEVELS" and
   *  must not exceed it — an unclamped value printed "LV 11/10" on the
   *  game-over card, and the leaderboard API rejects any level outside 1-10,
   *  which silently dropped the scores of anyone past TOTAL_LEVELS * 1000. */
  private displayLevel(): number {
    return Math.min(this.currentTheme + 1, TOTAL_LEVELS);
  }

  /* ================================================================ */
  /*  COLLISION                                                       */
  /* ================================================================ */
  private hitTest(dotX: number, gapX: number, gapW: number): boolean {
    const half = gapW / 2;
    return !(dotX - DOT_R >= gapX - half && dotX + DOT_R <= gapX + half);
  }

  /* ================================================================ */
  /*  DEATH                                                           */
  /* ================================================================ */
  private die(which: 'left' | 'right'): void {
    this.endRun(which);
    sfx.play('die');
    haptics.hit();
    this.shakeAmt = 10;

    /* burst particles */
    const dot = which === 'left' ? this.leftDot : this.rightDot;
    const col = which === 'left' ? C_LEFT : C_RIGHT;
    this.deathParticles = [];
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      this.deathParticles.push({
        x: dot.x, y: DOT_Y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, color: col
      });
    }
  }

  /** Everything a finished run does, crash or not: stop the world, save the
   *  bests, submit the score, report achievements. Then updateDeath() takes
   *  over and shows the game-over card. */
  private endRun(which: 'left' | 'right' | null): void {
    this.alive    = false;
    this.deadSide = which;
    this.combo    = 0;
    this.gfx.flickering = false;
    this.flickerPhase   = 0;
    music.stop();

    /* save high score */
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      localStorage.setItem(HI_SCORE_KEY, this.score.toString());
    }

    /* save best level (1-indexed, clamped — see displayLevel) */
    const levelReached = this.displayLevel();
    if (levelReached > this.hiLevel) {
      this.hiLevel = levelReached;
      localStorage.setItem(HI_LEVEL_KEY, levelReached.toString());
    }

    /* submit to the shared leaderboard (keeps only the best, keyed by UID —
       both control setups rank on the same board) */
    leaderboard.submit(this.score, levelReached);

    achievements.endRun({
      score:      this.score,
      ghosts:     this.runGhosts,
      bullets:    this.runBullets,
      nearMisses: this.runNearMisses,
      twoHands:   this.advanced
    }, this.hiScore);
  }

  /* ================================================================ */
  /*  PAYWALL (iOS free players, level 5 → 6)                         */
  /* ================================================================ */
  private openPaywall(): void {
    if (this.paywallOpen) return;
    this.paywallOpen = true;
    music.stop();
    uiManager.updateScore(this.score);   // the frame that crossed 5000 skipped its HUD write
    uiManager.showPaywall(store.price);
  }

  private async buyFromPaywall(): Promise<void> {
    uiManager.setPaywallState(true);
    const r = await store.purchase();
    if (!this.paywallOpen) return;           // resolved via store.onChange
    if (r === 'unlocked') { this.resumeAfterUnlock(); return; }
    uiManager.setPaywallState(false,
      r === 'pending'   ? 'Waiting for approval — you can keep this run open.' :
      r === 'cancelled' ? '' :
                          'The purchase did not go through. Try again?');
  }

  /** Same run, same walls: ease back in from a standstill like the intro. */
  private resumeAfterUnlock(): void {
    this.paywallOpen = false;
    uiManager.hidePaywall();
    this.speedMult       = 0;
    this.speedMultTarget = this.bulletWallsLeft > 0 ? BULLET_SPEED_MULT : 1;
    music.start();
  }

  /** NOT NOW: the run ends here and the score counts as usual. */
  private declinePaywall(): void {
    if (!this.paywallOpen) return;
    this.paywallOpen = false;
    uiManager.hidePaywall();
    this.endRun(null);
  }

  private updateDeath(delta: number, time: number): void {
    this.deathTimer += delta;
    this.shakeAmt   *= 0.92;

    const sx = (Math.random() - 0.5) * this.shakeAmt;
    const sy = (Math.random() - 0.5) * this.shakeAmt;

    this.gfx.clearAll();
    this.gfx.drawBg(this.dist, time, sx, sy, this.cameras.main);
    this.gfx.drawObstacles(this.pool.items, sx, sy, time);

    const overlayAlpha = Math.min(0.65, this.deathTimer / 600);
    this.gfx.drawOverlay(overlayAlpha);

    /* surviving dot(s) fade — both when the run ended at the paywall */
    const fade = Math.max(0.3, 1 - this.deathTimer / 2000);
    if (this.deadSide !== 'left') {
      this.gfx.l.dots.fillStyle(C_LEFT, fade);
      this.gfx.l.dots.fillCircle(this.leftDot.x + sx, DOT_Y + sy, DOT_R);
    }
    if (this.deadSide !== 'right') {
      this.gfx.l.dots.fillStyle(C_RIGHT, fade);
      this.gfx.l.dots.fillCircle(this.rightDot.x + sx, DOT_Y + sy, DOT_R);
    }

    /* particles */
    for (const p of this.deathParticles) {
      p.x  += p.vx; p.y  += p.vy;
      p.vx *= 0.97; p.vy *= 0.97;
      p.life -= 0.012;
    }
    this.gfx.drawParticles(this.deathParticles, sx, sy);

    /* game over screen — shown once after 350ms */
    if (this.deathTimer > 350 && !this.goShown) {
      this.goShown = true;
      uiManager.showGameOver(
        this.score,
        this.hiScore,
        this.newBest,
        this.maxCombo,
        this.currentTheme
      );
    }

    /* action buttons — revealed after 1000ms */
    if (this.deathTimer > 1000 && !this.retryShown) {
      this.retryShown = true;
      uiManager.showRetry();
    }

    /* Keyboard-only restart. The pointer path is deliberately gone: the
       game-over card now has real TRY AGAIN / BACK TO HOME buttons, and a
       tap on either also registers as a Phaser pointerdown — polling
       `anyPressed()` here would restart the run instead of going home. */
    if (this.deathTimer > 1000 && this.input_.anyKeyPressed()) {
      this.restart();
    }
  }

  private restart(): void {
    uiManager.hideGameOver();
    this.scene.start('Game', { advanced: this.advanced });
  }

  private backToHome(): void {
    uiManager.hideGameOver();
    this.scene.start('Menu');
  }
}
