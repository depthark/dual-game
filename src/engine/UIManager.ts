import { THEMES, TOTAL_LEVELS, MAX_COMBO_MULTI } from '../config/constants';
import type { LbRow } from './Leaderboard';

/* Virtual canvas size — matches Phaser's 400×640 space */
const VW = 400;
const VH = 640;

class UIManager {
  private inner!: HTMLElement;

  /* menu */
  private menuUI!: HTMLElement;
  private menuBest!: HTMLElement;
  private menuLvl!: HTMLElement;

  /* game hud */
  private gameHUD!: HTMLElement;
  private hudScore!: HTMLElement;
  private hudCombo!: HTMLElement;
  private hudBestBanner!: HTMLElement;
  /* intro hint */
  private introHint!: HTMLElement;
  private introLabel!: HTMLElement;

  /* floating score popups */
  private scorePopups!: HTMLElement;

  /* power-up indicators */
  private hudGhost!: HTMLElement;
  private hudGhostCount!: HTMLElement;
  private hudBullet!: HTMLElement;
  private hudBulletTimer!: HTMLElement;

  /* theme banner */
  private gameBanner!: HTMLElement;
  private bannerTheme!: HTMLElement;
  private bannerLevel!: HTMLElement;
  private bannerTimer?: ReturnType<typeof setTimeout>;

  /* power-up pickup alerts */
  private ghostAlert!: HTMLElement;
  private ghostTimer?: ReturnType<typeof setTimeout>;
  private bulletAlert!: HTMLElement;
  private bulletTimer?: ReturnType<typeof setTimeout>;

  /* per-frame change-detection caches — skip DOM writes when unchanged */
  private lastScore = -1;
  private lastCombo = -1;

  /* leaderboard */
  private leaderboardUI!: HTMLElement;
  private lbScope!: HTMLElement;
  private lbNameInput!: HTMLInputElement;
  private lbList!: HTMLElement;
  private lbStatus!: HTMLElement;
  private lbBack!: HTMLElement;

  /* menu chrome */
  private menuLeaderboardBtn!: HTMLElement;
  private menuMuteBtn!: HTMLElement;
  private menuSettingsBtn!: HTMLElement;
  private menuPlayBtn!: HTMLElement;
  private menuHowtoBtn!: HTMLElement;
  private menuStats!: HTMLElement;
  private menuFooterMode!: HTMLElement;

  /* how-to sheet */
  private howtoUI!: HTMLElement;
  private howtoScrim!: HTMLElement;
  private howtoGotIt!: HTMLElement;

  /* settings */
  private settingsUI!: HTMLElement;
  private ctrlTwo!: HTMLElement;
  private ctrlOne!: HTMLElement;
  private setSound!: HTMLElement;
  private setHaptics!: HTMLElement;
  private settingsBack!: HTMLElement;

  /* navigation + settings callbacks (wired by the menu scene) */
  onShowLeaderboard?: () => void;
  onHideLeaderboard?: () => void;
  onNameChange?: (name: string) => void;
  onToggleMute?: () => void;
  onToggleHaptics?: () => void;
  onPlay?: () => void;
  onShowHowto?: () => void;
  onHideHowto?: () => void;
  onShowSettings?: () => void;
  onHideSettings?: () => void;
  /** true = TWO HANDS (advanced), false = ONE HAND */
  onSelectControl?: (twoHands: boolean) => void;
  /* game-over actions (wired by the game scene) */
  onRetry?: () => void;
  onBackToHome?: () => void;

  /* game over */
  private gameoverUI!: HTMLElement;
  private goTitle!: HTMLElement;
  private goScore!: HTMLElement;
  private goBest!: HTMLElement;
  private goCombo!: HTMLElement;
  private goLevel!: HTMLElement;
  private goActions!: HTMLElement;
  private goRetry!: HTMLElement;
  private goHome!: HTMLElement;

  init(): void {
    this.inner         = document.getElementById('ui-inner')!;
    this.menuUI        = document.getElementById('menu-ui')!;
    this.menuBest      = document.getElementById('menu-best')!;
    this.menuLvl       = document.getElementById('menu-lvl')!;
    this.gameHUD       = document.getElementById('game-hud')!;
    this.hudScore      = document.getElementById('hud-score')!;
    this.hudCombo      = document.getElementById('hud-combo')!;
    this.hudBestBanner = document.getElementById('hud-best-banner')!;
    this.introHint     = document.getElementById('intro-hint')!;
    this.introLabel    = document.getElementById('intro-label')!;
    this.scorePopups   = document.getElementById('score-popups')!;
    this.hudGhost      = document.getElementById('hud-ghost')!;
    this.hudGhostCount = document.getElementById('hud-ghost-count')!;
    this.hudBullet     = document.getElementById('hud-bullet')!;
    this.hudBulletTimer = document.getElementById('hud-bullet-timer')!;
    this.gameBanner    = document.getElementById('game-banner')!;
    this.bannerTheme   = document.getElementById('banner-theme')!;
    this.bannerLevel   = document.getElementById('banner-level')!;
    this.ghostAlert    = document.getElementById('ghost-alert')!;
    this.bulletAlert   = document.getElementById('bullet-alert')!;
    this.leaderboardUI = document.getElementById('leaderboard-ui')!;
    this.lbScope       = document.getElementById('lb-scope')!;
    this.lbNameInput   = document.getElementById('lb-name-input') as HTMLInputElement;
    this.lbList        = document.getElementById('lb-list')!;
    this.lbStatus      = document.getElementById('lb-status')!;
    this.lbBack        = document.getElementById('lb-back')!;
    this.menuLeaderboardBtn = document.getElementById('menu-leaderboard-btn')!;
    this.menuMuteBtn     = document.getElementById('menu-mute-btn')!;
    this.menuSettingsBtn = document.getElementById('menu-settings-btn')!;
    this.menuPlayBtn     = document.getElementById('menu-play-btn')!;
    this.menuHowtoBtn    = document.getElementById('menu-howto-btn')!;
    this.menuStats       = document.getElementById('menu-stats')!;
    this.menuFooterMode  = document.getElementById('menu-footer-mode')!;
    this.howtoUI       = document.getElementById('howto-ui')!;
    this.howtoScrim    = document.getElementById('howto-scrim')!;
    this.howtoGotIt    = document.getElementById('howto-got-it')!;
    this.settingsUI    = document.getElementById('settings-ui')!;
    this.ctrlTwo       = document.getElementById('ctrl-two')!;
    this.ctrlOne       = document.getElementById('ctrl-one')!;
    this.setSound      = document.getElementById('set-sound')!;
    this.setHaptics    = document.getElementById('set-haptics')!;
    this.settingsBack  = document.getElementById('settings-back')!;
    this.gameoverUI    = document.getElementById('gameover-ui')!;
    this.goTitle       = document.getElementById('go-title')!;
    this.goScore       = document.getElementById('go-score')!;
    this.goBest        = document.getElementById('go-best')!;
    this.goCombo       = document.getElementById('go-combo')!;
    this.goLevel       = document.getElementById('go-level')!;
    this.goActions     = document.getElementById('go-actions')!;
    this.goRetry       = document.getElementById('go-retry')!;
    this.goHome        = document.getElementById('go-home')!;

    /* menu navigation */
    this.menuPlayBtn.addEventListener('click', () => this.onPlay?.());
    this.menuHowtoBtn.addEventListener('click', () => this.onShowHowto?.());
    this.menuSettingsBtn.addEventListener('click', () => this.onShowSettings?.());
    this.menuLeaderboardBtn.addEventListener('click', () => this.onShowLeaderboard?.());
    this.menuMuteBtn.addEventListener('click', () => this.onToggleMute?.());
    this.lbBack.addEventListener('click', () => this.onHideLeaderboard?.());

    /* how-to sheet — tapping the scrim dismisses it, same as GOT IT */
    this.howtoGotIt.addEventListener('click', () => this.onHideHowto?.());
    this.howtoScrim.addEventListener('click', () => this.onHideHowto?.());

    /* settings */
    this.ctrlTwo.addEventListener('click', () => this.onSelectControl?.(true));
    this.ctrlOne.addEventListener('click', () => this.onSelectControl?.(false));
    this.setSound.addEventListener('click', () => this.onToggleMute?.());
    this.setHaptics.addEventListener('click', () => this.onToggleHaptics?.());
    this.settingsBack.addEventListener('click', () => this.onHideSettings?.());

    /* game over */
    this.goRetry.addEventListener('click', () => this.onRetry?.());
    this.goHome.addEventListener('click', () => this.onBackToHome?.());
    /* commit name on Enter / blur */
    this.lbNameInput.addEventListener('change', () => {
      this.onNameChange?.(this.lbNameInput.value);
    });
    this.lbNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.lbNameInput.blur();
      e.stopPropagation();   // don't let Phaser's keyboard see typing
    });

    this.updateScale();
  }

  updateScale(): void {
    /* Scale is handled entirely by CSS using svi/svb viewport units.
       No JS needed — kept as no-op for call-site compatibility. */
  }

  private hideAll(): void {
    this.menuUI.classList.add('ui-hidden');
    this.gameHUD.classList.add('ui-hidden');
    this.introHint.classList.add('ui-hidden');
    this.introHint.classList.remove('intro-fading');
    this.gameBanner.classList.add('ui-hidden');
    this.ghostAlert.classList.add('ui-hidden');
    this.bulletAlert.classList.add('ui-hidden');
    this.leaderboardUI.classList.add('ui-hidden');
    this.settingsUI.classList.add('ui-hidden');
    this.howtoUI.classList.add('ui-hidden');
    this.gameoverUI.classList.add('ui-hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  MENU                                                               */
  /* ------------------------------------------------------------------ */

  showMenu(hiScore: number, hiLevel: number): void {
    this.hideAll();
    this.menuBest.textContent = hiScore > 0 ? 'BEST\u00a0' + hiScore : '';
    this.menuLvl.textContent  = hiLevel > 0 ? '\u00b7\u00a0LVL\u00a0' + hiLevel + '/' + TOTAL_LEVELS : '';
    /* keep the pill's footprint but hide it until there's something to show,
       so the centre stack doesn't jump between first and later sessions */
    this.menuStats.classList.toggle('is-empty', hiScore <= 0);
    this.menuUI.classList.remove('ui-hidden');
  }

  hideMenu(): void {
    this.menuUI.classList.add('ui-hidden');
  }

  /** Sound state, reflected on both the home icon and the settings toggle. */
  setMuteLabel(muted: boolean): void {
    this.menuMuteBtn.classList.toggle('is-muted', muted);
    this.setSound.classList.toggle('is-on', !muted);
  }

  setHapticsLabel(muted: boolean): void {
    this.setHaptics.classList.toggle('is-on', !muted);
  }

  /** Footer line on the home screen + the settings radio selection. */
  setControlMode(twoHands: boolean): void {
    this.menuFooterMode.textContent = twoHands ? 'TWO HANDS' : 'ONE HAND';
    this.ctrlTwo.classList.toggle('is-active', twoHands);
    this.ctrlOne.classList.toggle('is-active', !twoHands);
  }

  /* ------------------------------------------------------------------ */
  /*  HOW TO PLAY SHEET                                                  */
  /*  Layered over the menu \u2014 the menu stays visible behind the scrim.   */
  /* ------------------------------------------------------------------ */

  /** `twoHands` selects which CONTROLS rows the sheet shows — the gesture
   *  differs between the modes, so showing both would be noise. */
  showHowto(twoHands = true): void {
    this.howtoUI.classList.toggle('mode-one-hand', !twoHands);
    this.howtoUI.classList.remove('ui-hidden');
  }

  hideHowto(): void {
    this.howtoUI.classList.add('ui-hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  SETTINGS                                                           */
  /* ------------------------------------------------------------------ */

  showSettings(): void {
    this.hideAll();
    this.settingsUI.classList.remove('ui-hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  GAME HUD                                                           */
  /* ------------------------------------------------------------------ */

  showHUD(advanced = false): void {
    this.hideAll();
    this.hudScore.textContent        = '0';
    this.hudCombo.style.opacity      = '0';
    this.hudBestBanner.style.opacity = '0';
    this.hudGhost.classList.add('ui-hidden');
    this.hudBullet.classList.add('ui-hidden');
    this.gameHUD.classList.remove('ui-hidden');
    this.gameHUD.classList.add('intro-demo');
    /* advanced mode: each thumb its own dot — change the hint + demo motion */
    this.gameHUD.classList.toggle('mode-advanced', advanced);
    this.introLabel.textContent = advanced
      ? 'EACH THUMB → ITS OWN DOT'
      : 'SLIDE ← GATHER · SPREAD →';
    this.introHint.classList.remove('ui-hidden', 'intro-fading');
    /* clear any leftover popups from a previous run */
    this.scorePopups.textContent = '';
    /* reset change-detection caches so the first per-frame update writes */
    this.lastScore = -1;
    this.lastCombo = -1;
  }

  /**
   * Spawn a floating "+N" at (x, y) in the 400×640 virtual space. It rises and
   * fades on its own, then removes itself. Colour brightens with the combo.
   */
  popupScore(points: number, x: number, y: number, mult: number): void {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = '+' + points;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.fontSize = (18 + Math.min(mult, 10)) + 'px';
    el.style.color =
      mult >= 8 ? '#ffcc00' :
      mult >= 4 ? '#ffe08a' :
      mult >= 2 ? '#fff4c2' : '#ffffff';
    el.addEventListener('animationend', () => el.remove());
    this.scorePopups.appendChild(el);
  }

  stopIntroDemo(): void {
    this.gameHUD.classList.remove('intro-demo');
  }

  updateScore(score: number): void {
    if (score === this.lastScore) return;
    this.lastScore = score;
    this.hudScore.textContent = score.toString();
  }

  updateCombo(combo: number): void {
    if (combo === this.lastCombo) return;
    this.lastCombo = combo;
    if (combo > 1) {
      this.hudCombo.textContent   = '\u00d7' + Math.min(combo, MAX_COMBO_MULTI);
      this.hudCombo.style.opacity = '0.8';
    } else {
      this.hudCombo.style.opacity = '0';
    }
  }

  showNewBest(): void {
    this.hudBestBanner.style.opacity = '1';
  }

  fadeOutIntroHint(): void {
    this.introHint.classList.add('intro-fading');
    setTimeout(() => {
      this.introHint.classList.add('ui-hidden');
    }, 600);
  }

  hideIntroHint(): void {
    this.introHint.classList.add('ui-hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  GHOST CHARGES                                                       */
  /* ------------------------------------------------------------------ */

  updateGhostCharges(charges: number): void {
    if (charges > 0) {
      this.hudGhostCount.textContent = charges.toString();
      this.hudGhost.classList.remove('ui-hidden');
    } else {
      this.hudGhost.classList.add('ui-hidden');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  BULLET TIME                                                         */
  /* ------------------------------------------------------------------ */

  updateBulletWalls(wallsLeft: number): void {
    if (wallsLeft > 0) {
      this.hudBulletTimer.textContent = wallsLeft.toString();
      this.hudBullet.classList.remove('ui-hidden');
    } else {
      this.hudBullet.classList.add('ui-hidden');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  THEME BANNER                                                       */
  /* ------------------------------------------------------------------ */

  showBanner(themeName: string, level: number): void {
    this.bannerTheme.textContent = themeName.toUpperCase();
    this.bannerLevel.textContent = 'LEVEL\u00a0' + level;
    /* re-trigger CSS animation */
    this.gameBanner.classList.remove('ui-hidden', 'ui-banner-anim');
    void this.gameBanner.offsetWidth;
    this.gameBanner.classList.add('ui-banner-anim');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.gameBanner.classList.add('ui-hidden');
    }, 2200);
  }

  /* ------------------------------------------------------------------ */
  /*  POWER-UP PICKUP ALERTS                                             */
  /*  Both ride the same 2s slide-up + fade keyframe.                    */
  /* ------------------------------------------------------------------ */

  showGhostAlert(): void {
    this.ghostAlert.classList.remove('ui-hidden', 'ui-pickup-alert-anim');
    void this.ghostAlert.offsetWidth;
    this.ghostAlert.classList.add('ui-pickup-alert-anim');
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    this.ghostTimer = setTimeout(() => {
      this.ghostAlert.classList.add('ui-hidden');
    }, 2000);
  }

  showBulletAlert(): void {
    this.bulletAlert.classList.remove('ui-hidden', 'ui-pickup-alert-anim');
    void this.bulletAlert.offsetWidth;
    this.bulletAlert.classList.add('ui-pickup-alert-anim');
    if (this.bulletTimer) clearTimeout(this.bulletTimer);
    this.bulletTimer = setTimeout(() => {
      this.bulletAlert.classList.add('ui-hidden');
    }, 2000);
  }

  /* ------------------------------------------------------------------ */
  /*  LEADERBOARD                                                         */
  /* ------------------------------------------------------------------ */

  showLeaderboard(name: string, global: boolean): void {
    this.hideAll();
    this.lbNameInput.value = name;
    this.lbScope.textContent = global ? 'GLOBAL' : 'THIS DEVICE';   // corrected on render
    this.lbList.innerHTML = '';
    this.lbStatus.textContent = 'Loading…';
    this.leaderboardUI.classList.remove('ui-hidden');
  }

  renderLeaderboard(rows: LbRow[], hint: string): void {
    this.lbList.innerHTML = '';

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'No scores yet — be the first!';
      this.lbList.appendChild(empty);
      this.lbStatus.textContent = hint;
      return;
    }

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'lb-row' + (r.you ? ' lb-you' : '');

      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = r.rank.toString();

      const nm = document.createElement('span');
      nm.className = 'lb-name';
      nm.textContent = r.name;

      const sc = document.createElement('span');
      sc.className = 'lb-score';
      sc.textContent = r.score.toString();

      row.append(rank, nm, sc);
      this.lbList.appendChild(row);
    }

    /* Player-facing copy only — no developer/setup hints (they showed up in
       App Store screenshots once). */
    this.lbStatus.textContent = hint;
  }

  setLeaderboardError(msg: string): void {
    this.lbList.innerHTML = '';
    this.lbStatus.textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /*  GAME OVER                                                          */
  /* ------------------------------------------------------------------ */

  showGameOver(
    score: number,
    hiScore: number,
    isNewBest: boolean,
    maxCombo: number,
    currentTheme: number
  ): void {
    this.goScore.textContent = score.toString();

    /* each stat row renders as "LABEL <spacer> value" (flex space-between) */
    const setRow = (el: HTMLElement, key: string, value: string) => {
      el.innerHTML = '';
      const k = document.createElement('span');
      k.className = 'go-k';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'go-v';
      v.textContent = value;
      el.append(k, v);
    };

    setRow(this.goBest, isNewBest ? 'NEW BEST' : 'BEST', hiScore.toString());
    this.goBest.classList.toggle('ui-new-best', isNewBest);

    if (maxCombo > 2) {
      setRow(this.goCombo, 'MAX COMBO', '\u00d7' + Math.min(maxCombo, MAX_COMBO_MULTI));
      this.goCombo.style.display = '';
    } else {
      this.goCombo.style.display = 'none';
    }

    if (currentTheme > 0) {
      const tName = THEMES[currentTheme % THEMES.length].name.toUpperCase();
      setRow(this.goLevel, tName, 'LV\u00a0' + (currentTheme + 1) + '/' + TOTAL_LEVELS);
      this.goLevel.style.display = '';
    } else {
      this.goLevel.style.display = 'none';
    }

    /* staggered fade-in */
    const seq = [this.goTitle, this.goScore, this.goBest, this.goCombo, this.goLevel];
    seq.forEach(el => {
      el.style.opacity = '0';
      el.classList.remove('ui-fadein');
    });

    /* buttons stay hidden until showRetry() — a mistap in the first second
       after dying would otherwise restart the run instantly */
    this.goActions.style.visibility = 'hidden';
    this.gameoverUI.classList.remove('ui-hidden');

    const delays = [0, 80, 160, 240, 320];
    seq.forEach((el, i) => {
      if (el.style.display === 'none') return;
      setTimeout(() => {
        void el.offsetWidth;
        el.classList.add('ui-fadein');
      }, delays[i]);
    });
  }

  showRetry(): void {
    this.goActions.style.visibility = '';
  }

  hideGameOver(): void {
    this.gameoverUI.classList.add('ui-hidden');
    this.goActions.style.visibility = 'hidden';
  }
}

export const uiManager = new UIManager();
