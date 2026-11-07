/**
 * The one-time "Remove Ads" purchase (iOS only).
 *
 * Every level is free for everyone. Free players see a gentle interstitial
 * ad now and then (see Ads.ts); this purchase turns ads off for good. The
 * App Store product (`com.lukaschylik.dualmind.fullgame`) launched in 1.1 as
 * "Full Game", which unlocked levels 6–10 — owners of it are simply ad-free
 * now, since StoreKit reports the same entitlement.
 *
 * Everywhere else — the web/PWA build, or an iOS build without the native
 * plugin — there are no ads and nothing to sell.
 *
 * Ad-free when either holds:
 *   • StoreKit reports the purchase (native `Store` plugin, StorePlugin.swift)
 *   • the cached flag says so — StoreKit's entitlement cache works offline,
 *     but this keeps ads off even if a status call fails on launch.
 *
 * Apple runs the purchase; the app never sees any payment detail.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface StoreStatus { unlocked: boolean; price?: string }

interface StorePlugin {
  status(): Promise<StoreStatus>;
  purchase(): Promise<{ unlocked: boolean; cancelled?: boolean; pending?: boolean }>;
  restore(): Promise<StoreStatus>;
  addListener(e: 'unlockChanged', cb: (d: { unlocked: boolean }) => void): Promise<unknown>;
}

const Native = registerPlugin<StorePlugin>('Store');

/** Cached "ads removed" flag (key kept from 1.1, when it meant "full game"). */
const AD_FREE_KEY = 'dual_full';

export type PurchaseResult = 'unlocked' | 'cancelled' | 'pending' | 'failed';

type Listener = (adFree: boolean) => void;

class Store {
  private native = false;
  private adFree = true;
  private listeners: Listener[] = [];
  /** Localised price from the App Store, e.g. "0,95 €". */
  price = '';

  init(): void {
    if (import.meta.env.DEV && /[?&]ads\b/.test(location.search)) { this.fake(); return; }
    this.native = Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('Store');
    if (!this.native) { this.adFree = true; return; }

    this.adFree = localStorage.getItem(AD_FREE_KEY) === '1';
    Native.addListener('unlockChanged', d => { if (d.unlocked) this.setAdFree(true); });
    Native.status()
      .then(s => {
        if (s.price) this.price = s.price;
        if (s.unlocked) this.setAdFree(true);
      })
      .catch(e => console.warn('[store] status failed', e));
  }

  /** true = no ads (purchased, or a build that never shows ads). */
  isAdFree(): boolean { return this.adFree; }

  /** Whether this build sells anything (shows the Settings section). */
  sells(): boolean { return this.native; }

  /** Called whenever the purchase state changes (buy, restore, family). */
  subscribe(fn: Listener): void { this.listeners.push(fn); }

  async purchase(): Promise<PurchaseResult> {
    if (!this.native) return 'unlocked';
    try {
      const r = await Native.purchase();
      if (r.unlocked) { this.setAdFree(true); return 'unlocked'; }
      return r.pending ? 'pending' : r.cancelled ? 'cancelled' : 'failed';
    } catch (e) {
      console.warn('[store] purchase failed', e);
      return 'failed';
    }
  }

  /** true = ads are off after the restore. */
  async restore(): Promise<boolean> {
    if (!this.native) return true;
    try {
      const s = await Native.restore();
      if (s.price) this.price = s.price;
      if (s.unlocked) this.setAdFree(true);
    } catch (e) {
      console.warn('[store] restore failed', e);
    }
    return this.adFree;
  }

  /** Dev only (`?ads`): a store that sells Remove Ads; the fake purchase
   *  succeeds after a beat. Pairs with the fake ad in Ads.ts. */
  private fake(): void {
    this.native = true;
    this.adFree = false;
    this.price = '0,95 €';
    this.purchase = async () => {
      await new Promise(r => setTimeout(r, 700));
      this.setAdFree(true);
      return 'unlocked';
    };
    this.restore = async () => this.adFree;
  }

  private setAdFree(adFree: boolean): void {
    const changed = adFree !== this.adFree;
    this.adFree = adFree;
    if (adFree) localStorage.setItem(AD_FREE_KEY, '1');
    if (changed) this.listeners.forEach(fn => fn(adFree));
  }
}

export const store = new Store();
