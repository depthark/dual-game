/**
 * The one-time "Full Game" unlock (iOS only).
 *
 * Levels 1–5 are free; the purchase unlocks levels 6–10 in both control
 * modes. Everywhere else — the web/PWA build, or an iOS build without the
 * native plugin — the full game is simply open: there is nothing to sell.
 *
 * Unlocked when any of these hold:
 *   • StoreKit reports the purchase (native `Store` plugin, StorePlugin.swift)
 *   • the player first installed 1.0, which shipped every level for free
 *     (decided natively from AppTransaction — see StorePlugin.swift)
 *   • the cached flag says so — StoreKit's entitlement cache works offline,
 *     but this keeps the game open even if a status call fails on launch.
 *
 * No ads, no tracking: Apple runs the purchase and the app never sees any
 * payment detail.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { HI_SCORE_KEY } from '../config/constants';

interface StoreStatus { unlocked: boolean; legacy?: boolean; price?: string }

interface StorePlugin {
  status(): Promise<StoreStatus>;
  purchase(): Promise<{ unlocked: boolean; cancelled?: boolean; pending?: boolean }>;
  restore(): Promise<StoreStatus>;
  addListener(e: 'unlockChanged', cb: (d: { unlocked: boolean }) => void): Promise<unknown>;
}

const Native = registerPlugin<StorePlugin>('Store');

/** Cached "full game is open" flag. */
const FULL_KEY = 'dual_full';
/** Set once the first 1.1+ launch has looked at legacy progress. */
const LEGACY_CHECK_KEY = 'dual_legacy_checked';

/** Highest level a player can reach without the unlock. */
export const FREE_LEVELS = 5;

export type PurchaseResult = 'unlocked' | 'cancelled' | 'pending' | 'failed';

class Store {
  private native = false;
  private full = true;
  /** Localised price from the App Store, e.g. "0,95 €". */
  price = '';
  /** Called whenever the unlock state changes (purchase, restore, family). */
  onChange?: (full: boolean) => void;

  init(): void {
    if (import.meta.env.DEV && /[?&]paywall\b/.test(location.search)) { this.fake(); return; }
    this.native = Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('Store');
    if (!this.native) { this.full = true; return; }

    /* iOS 15 has no AppTransaction: there, a player who already had a best
       score on the first launch of this version must have played 1.0. */
    const hadProgress = !localStorage.getItem(LEGACY_CHECK_KEY)
      && parseInt(localStorage.getItem(HI_SCORE_KEY) || '0', 10) > 0;
    localStorage.setItem(LEGACY_CHECK_KEY, '1');

    this.full = localStorage.getItem(FULL_KEY) === '1';
    Native.addListener('unlockChanged', d => { if (d.unlocked) this.setFull(true); });
    Native.status()
      .then(s => {
        if (s.price) this.price = s.price;
        const legacy = s.legacy ?? hadProgress;
        if (s.unlocked || legacy) this.setFull(true);
      })
      .catch(e => console.warn('[store] status failed', e));
  }

  /** Whether levels past FREE_LEVELS are playable. */
  isFull(): boolean { return this.full; }

  /** Whether this build sells anything (shows the Settings section). */
  sells(): boolean { return this.native; }

  async purchase(): Promise<PurchaseResult> {
    if (!this.native) return 'unlocked';
    try {
      const r = await Native.purchase();
      if (r.unlocked) { this.setFull(true); return 'unlocked'; }
      return r.pending ? 'pending' : r.cancelled ? 'cancelled' : 'failed';
    } catch (e) {
      console.warn('[store] purchase failed', e);
      return 'failed';
    }
  }

  /** true = the full game is open after the restore. */
  async restore(): Promise<boolean> {
    if (!this.native) return true;
    try {
      const s = await Native.restore();
      if (s.price) this.price = s.price;
      if (s.unlocked || s.legacy) this.setFull(true);
    } catch (e) {
      console.warn('[store] restore failed', e);
    }
    return this.full;
  }

  /** Dev only (`?paywall`): a locked store whose purchase succeeds after a
   *  beat — exercises the paywall and Settings row in a desktop browser. */
  private fake(): void {
    this.native = true;
    this.full = false;
    this.price = '0,95\u00a0€';
    this.purchase = async () => {
      await new Promise(r => setTimeout(r, 700));
      this.setFull(true);
      return 'unlocked';
    };
    this.restore = async () => this.full;
  }

  private setFull(full: boolean): void {
    const changed = full !== this.full;
    this.full = full;
    if (full) localStorage.setItem(FULL_KEY, '1');
    if (changed) this.onChange?.(full);
  }
}

export const store = new Store();
