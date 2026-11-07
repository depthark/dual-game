import Phaser from 'phaser';
import { C_BG, HI_SCORE_KEY, HI_LEVEL_KEY, CONTROL_KEY } from '../config/constants';
import { sfx } from '../engine/SoundEngine';
import { haptics } from '../engine/Haptics';
import { uiManager } from '../engine/UIManager';
import { leaderboard } from '../engine/Leaderboard';
import { store } from '../engine/Store';
import { ads } from '../engine/Ads';

/**
 * Home screen and everything reachable from it: the how-to sheet, settings,
 * and the leaderboard.
 *
 * There is deliberately NO tap-anywhere-to-start here — the screen has real
 * controls now (PLAY / HOW TO PLAY / the three icon buttons), and a global
 * pointer handler would fire underneath every one of them.
 *
 * CONTROL setting: persisted as `dual_control` and passed to GameScene as its
 * existing `advanced` flag. `advanced = true` is "TWO HANDS" (each thumb its
 * own dot), `advanced = false` is "ONE HAND" (mirrored spread/gather).
 */
/** The scene is recreated on every return home; subscribe to the store once. */
let subscribed = false;

function refreshRemoveAds(note = ''): void {
  uiManager.setRemoveAds(store.sells(), store.isAdFree(), store.price, ads.privacyOptions, note);
}

export class MenuScene extends Phaser.Scene {
  private twoHands = true;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(C_BG);

    const hiScore = parseInt(localStorage.getItem(HI_SCORE_KEY) || '0', 10);
    const hiLevel = parseInt(localStorage.getItem(HI_LEVEL_KEY) || '0', 10);

    /* default to TWO HANDS — the mode the game was designed around */
    this.twoHands = (localStorage.getItem(CONTROL_KEY) ?? '1') === '1';

    uiManager.showMenu(hiScore, hiLevel);
    uiManager.setMuteLabel(sfx.isMuted());
    uiManager.setHapticsLabel(haptics.isMuted());
    uiManager.setControlMode(this.twoHands);

    /* ---- play ---- */
    uiManager.onPlay = () => {
      sfx.init();
      sfx.play('start');
      uiManager.hideMenu();
      this.scene.start('Game', { advanced: this.twoHands });
    };

    /* ---- how-to sheet (overlays the menu, doesn't replace it) ---- */
    uiManager.onShowHowto = () => { sfx.init(); uiManager.showHowto(this.twoHands); };
    uiManager.onHideHowto = () => uiManager.hideHowto();

    /* ---- settings ---- */
    uiManager.onShowSettings = () => {
      sfx.init();
      refreshRemoveAds();
      uiManager.showSettings();
    };
    uiManager.onHideSettings = () => this.backToMenu(hiScore, hiLevel);
    uiManager.onSelectControl = (twoHands) => {
      this.twoHands = twoHands;
      localStorage.setItem(CONTROL_KEY, twoHands ? '1' : '0');
      uiManager.setControlMode(twoHands);
    };

    /* ---- remove ads (iOS) — buy / restore / ad privacy from Settings ---- */
    uiManager.onBuyRemoveAds = () => {
      refreshRemoveAds('OPENING APP STORE…');
      store.purchase().then(r => refreshRemoveAds(
        r === 'pending' ? 'WAITING FOR APPROVAL' : r === 'failed' ? 'PURCHASE FAILED' : ''));
    };
    uiManager.onRestoreRemoveAds = () => {
      refreshRemoveAds('RESTORING…');
      store.restore().then(adFree => refreshRemoveAds(adFree ? '' : 'NOTHING TO RESTORE'));
    };
    uiManager.onAdPrivacy = () => { void ads.showPrivacyOptions(); };
    if (!subscribed) { subscribed = true; store.subscribe(() => refreshRemoveAds()); }

    /* ---- leaderboard ---- */
    uiManager.onShowLeaderboard = () => this.openLeaderboard();
    uiManager.onHideLeaderboard = () => this.backToMenu(hiScore, hiLevel);
    uiManager.onNameChange = (name) => {
      leaderboard.setName(name).then(problem => this.refreshLeaderboard(problem));
    };

    /* ---- audio / haptics ---- */
    uiManager.onToggleMute = () => {
      sfx.init();                 // ensure the audio graph exists (user gesture)
      uiManager.setMuteLabel(sfx.toggleMute());
    };
    uiManager.onToggleHaptics = () => {
      const muted = haptics.toggleMute();
      uiManager.setHapticsLabel(muted);
      if (!muted) haptics.pass();  // let the player feel what they just enabled
    };
  }

  private openLeaderboard(): void {
    sfx.init();
    uiManager.showLeaderboard(leaderboard.getName(), leaderboard.isGlobal());
    this.refreshLeaderboard();
  }

  /** Shared return path for settings / leaderboard → home. */
  private backToMenu(hiScore: number, hiLevel: number): void {
    uiManager.showMenu(hiScore, hiLevel);
    uiManager.setMuteLabel(sfx.isMuted());
    uiManager.setHapticsLabel(haptics.isMuted());
    uiManager.setControlMode(this.twoHands);
  }

  /** `note` (e.g. "That name is taken") replaces the footer line once. */
  private refreshLeaderboard(note: string | null = null): void {
    leaderboard.top(20)
      .then(rows => uiManager.renderLeaderboard(rows, note ?? leaderboard.statusHint()))
      .catch(() => {
        uiManager.setLeaderboardError('Could not load leaderboard — check your connection');
      });
  }
}
