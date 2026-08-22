import Phaser from 'phaser';
import { sfx } from './SoundEngine';
import { uiManager } from './UIManager';
import { HALF } from '../config/constants';

const JOYSTICK_MAX = 40;
/** Advanced mode keyboard travel per 60fps-frame (game units). */
const KEY_MOVE_SPEED = 6;

export class InputManager {
  private scene: Phaser.Scene;
  /** Advanced mode: each thumb / key set drives its own dot independently. */
  private advanced: boolean;
  private leftTouch:  Phaser.Input.Pointer | null = null;
  private rightTouch: Phaser.Input.Pointer | null = null;
  /** Last-sampled finger x (game units) for 1:1 movement tracking. */
  private leftPrevX = 0;
  private rightPrevX = 0;
  private leftKnob:   HTMLElement | null = null;
  private rightKnob:  HTMLElement | null = null;
  /** ONE HAND mode: a single pointer drives both dots, so there is one
   *  joystick rather than two. Tracked separately because it accepts a touch
   *  anywhere on screen, not just on its half. */
  private singleTouch: Phaser.Input.Pointer | null = null;
  private singleKnob:  HTMLElement | null = null;
  private keyLeft!:   Phaser.Input.Keyboard.Key;
  private keyRight!:  Phaser.Input.Keyboard.Key;
  private keyA!:      Phaser.Input.Keyboard.Key;
  private keyD!:      Phaser.Input.Keyboard.Key;
  private keySpace!:  Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene, advanced = false) {
    this.scene     = scene;
    this.advanced  = advanced;
    this.leftKnob   = document.getElementById('joystick-left-knob');
    this.rightKnob  = document.getElementById('joystick-right-knob');
    this.singleKnob = document.getElementById('joystick-single-knob');

    /* Phaser allocates only 1 touch pointer by default — add a 2nd so
       both thumbs can drive the joysticks simultaneously. */
    scene.input.addPointer(1);

    const kb       = scene.input.keyboard!;
    this.keyLeft   = kb.addKey('LEFT');
    this.keyRight  = kb.addKey('RIGHT');
    this.keyA      = kb.addKey('A');
    this.keyD      = kb.addKey('D');
    this.keySpace  = kb.addKey('SPACE');

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sfx.init();
      uiManager.stopIntroDemo();
      if (!this.advanced) {
        /* One stick: the first finger down owns it and any extra touch is
           ignored, so a stray second thumb can't fight the first. */
        if (!this.singleTouch) this.singleTouch = p;
        return;
      }
      if (p.x < HALF) {
        this.leftTouch = p;
        this.leftPrevX = p.x;
      } else {
        this.rightTouch = p;
        this.rightPrevX = p.x;
      }
    });

    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p === this.singleTouch) {
        this._setKnob(this.singleKnob, p.x - p.downX);
      } else if (p === this.leftTouch) {
        this._setKnob(this.leftKnob, p.x - p.downX);
      } else if (p === this.rightTouch) {
        this._setKnob(this.rightKnob, p.x - p.downX);
      }
    });

    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p === this.singleTouch) {
        this.singleTouch = null;
        this._resetKnob(this.singleKnob);
      } else if (p === this.leftTouch) {
        this.leftTouch = null;
        this._resetKnob(this.leftKnob);
      } else if (p === this.rightTouch) {
        this.rightTouch = null;
        this._resetKnob(this.rightKnob);
      }
    });

    scene.input.on('gameout', () => {
      this.leftTouch = this.rightTouch = this.singleTouch = null;
      this._resetKnob(this.leftKnob);
      this._resetKnob(this.rightKnob);
      this._resetKnob(this.singleKnob);
    });
  }

  private _setKnob(knob: HTMLElement | null, dx: number): void {
    if (!knob) return;
    const c = Math.max(-JOYSTICK_MAX, Math.min(JOYSTICK_MAX, dx));
    knob.style.transform = `translate(calc(-50% + ${c}px), -50%)`;
  }

  private _resetKnob(knob: HTMLElement | null): void {
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  /** Advanced mode — how far the LEFT dot should move this frame (game units),
   *  mirroring the finger's actual movement 1:1 (no momentum). Keyboard (A/D)
   *  moves at a fixed speed. `dt` is the 60fps-normalized frame delta. */
  leftMove(dt: number): number {
    if (this.keyA.isDown) return -KEY_MOVE_SPEED * dt;
    if (this.keyD.isDown) return  KEY_MOVE_SPEED * dt;
    if (!this.leftTouch) return 0;
    const dx = this.leftTouch.x - this.leftPrevX;
    this.leftPrevX = this.leftTouch.x;
    return dx;
  }

  /** Advanced mode — LEFT's counterpart for the RIGHT dot (finger or ←/→). */
  rightMove(dt: number): number {
    if (this.keyLeft.isDown)  return -KEY_MOVE_SPEED * dt;
    if (this.keyRight.isDown) return  KEY_MOVE_SPEED * dt;
    if (!this.rightTouch) return 0;
    const dx = this.rightTouch.x - this.rightPrevX;
    this.rightPrevX = this.rightTouch.x;
    return dx;
  }

  /** ONE HAND mode: combined spread / gather command
   *  (−1 = full gather, +1 = full spread).
   *
   *  One stick reads as a width slider: drag RIGHT to push the dots apart,
   *  LEFT to bring them together. The keyboard matches, so the two input
   *  methods never disagree about which way is "apart".
   *
   *  The touch is tracked from wherever the finger first landed, so the
   *  on-screen ring is an indicator — the player can drag anywhere. */
  spreadDir(): number {
    if (this.keyRight.isDown || this.keyD.isDown || this.keySpace.isDown) return  1;
    if (this.keyLeft.isDown  || this.keyA.isDown)                         return -1;
    if (!this.singleTouch) return 0;
    const dx = this.singleTouch.x - this.singleTouch.downX;
    return Math.max(-1, Math.min(1, dx / JOYSTICK_MAX));
  }

  anyPressed(): boolean {
    return this.leftTouch   !== null ||
           this.rightTouch  !== null ||
           this.singleTouch !== null ||
           this.anyKeyPressed();
  }

  /** Keyboard only — used by the game-over screen, where a pointer press
   *  belongs to the TRY AGAIN / BACK TO HOME buttons rather than the game. */
  anyKeyPressed(): boolean {
    return this.keyLeft.isDown || this.keyRight.isDown ||
           this.keyA.isDown    || this.keyD.isDown     || this.keySpace.isDown;
  }
}
