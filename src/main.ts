import Phaser from 'phaser';
import { W, H, C_BG } from './config/constants';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { uiManager } from './engine/UIManager';
import { leaderboard } from './engine/Leaderboard';
import { store } from './engine/Store';
import { achievements } from './engine/Achievements';
import { ads } from './engine/Ads';
import { HI_SCORE_KEY } from './config/constants';

/* ---- Launch Phaser ---- */
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: C_BG,
  parent: 'game',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [MenuScene, GameScene]
});

/* dev: lets the console reach the running scenes */
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

/* ---- UI Overlay ---- */
uiManager.init();

/* ---- Leaderboard (device login happens lazily) ---- */
leaderboard.init();

/* ---- Remove Ads purchase + ads (iOS only; the web build has neither).
       Store first: ads stay off for anyone who bought Remove Ads. ---- */
store.init();
void ads.init();

/* ---- Game Center achievements — credits the stored best retroactively ---- */
achievements.init(parseInt(localStorage.getItem(HI_SCORE_KEY) || '0', 10));
