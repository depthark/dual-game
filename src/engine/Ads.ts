/**
 * Ads — iOS only, and deliberately gentle.
 *
 * One format: a full-screen interstitial shown at a natural break — after the
 * game-over card, when the player taps TRY AGAIN or BACK TO HOME — never
 * during a run. There are no banners (they would sit on the joysticks).
 *
 * Frequency rules (all must hold):
 *   • the player has finished at least FREE_RUNS runs on this device
 *   • at least RUNS_BETWEEN runs since the last ad
 *   • at least MIN_GAP_MS since the last ad
 *   • the player has not bought Remove Ads (Store.ts)
 *
 * Privacy:
 *   • non-personalized ads only (`npa`) — no App Tracking Transparency prompt
 *   • Google's UMP consent form runs first wherever the law needs it (EEA, UK,
 *     CH); Settings shows AD PRIVACY when UMP asks for an entry point
 *   • ad content capped at "General" (family-safe); sensitive categories
 *     (dating, gambling, sexual, …) are additionally blocked in the AdMob
 *     console, and the ad unit is image-only (no video)
 *
 * Ad unit: `VITE_ADMOB_INTERSTITIAL_IOS` at build time. Without it the build
 * requests Google's test ads, so TestFlight builds never earn or risk invalid
 * traffic. The app ID lives in the Xcode build setting ADMOB_APP_ID.
 *
 * Dev: `?ads` in the browser fakes the whole thing (a 1.5 s overlay instead of
 * an ad) so the timing rules can be exercised without a device.
 */
import { Capacitor } from '@capacitor/core';
import {
  AdMob, AdmobConsentStatus, InterstitialAdPluginEvents, MaxAdContentRating
} from '@capacitor-community/admob';
import { store } from './Store';

/** Google's public demo interstitial — always fills, never pays. */
const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/4411468910';

export const FREE_RUNS    = 5;
export const RUNS_BETWEEN = 3;
export const MIN_GAP_MS   = 3 * 60 * 1000;

const RUNS_KEY    = 'dual_runs';          // finished runs, ever
const LAST_AD_KEY = 'dual_last_ad_run';   // value of dual_runs at the last ad

class Ads {
  private enabled = false;
  private ready = false;
  private loading = false;
  private fake = false;
  private lastAdAt = 0;                   // ms — per session, deliberately
  private adId = TEST_INTERSTITIAL;
  private testing = true;
  /** UMP wants a "privacy choices" entry point (Settings → AD PRIVACY). */
  privacyOptions = false;

  async init(): Promise<void> {
    if (import.meta.env.DEV && /[?&]ads\b/.test(location.search)) {
      this.fake = this.enabled = this.ready = true;
      return;
    }
    if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('AdMob')) return;
    if (store.isAdFree()) return;

    const unit = (import.meta.env.VITE_ADMOB_INTERSTITIAL_IOS as string | undefined)?.trim();
    if (unit) { this.adId = unit; this.testing = false; }

    store.subscribe(adFree => { if (adFree) this.enabled = false; });

    try {
      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      /* enum not exported by the plugin — its value is the string 'REQUIRED' */
      this.privacyOptions = String(consent.privacyOptionsRequirementStatus) === 'REQUIRED';
      if (!consent.canRequestAds) return;

      await AdMob.initialize({
        maxAdContentRating: MaxAdContentRating.General,
        initializeForTesting: this.testing
      });
      AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, () => { this.ready = false; this.loading = false; });
      this.enabled = !store.isAdFree();
      this.preload();
    } catch (e) {
      console.warn('[ads] init failed', e);
    }
  }

  /** Count a finished run (crash or quit). */
  runEnded(): void {
    localStorage.setItem(RUNS_KEY, String(this.runs() + 1));
  }

  /**
   * Call at a natural break (leaving the game-over card). Resolves when the
   * game may continue: right away, or after the ad is closed.
   */
  async breakpoint(): Promise<void> {
    if (!this.due()) return;
    localStorage.setItem(LAST_AD_KEY, String(this.runs()));
    this.lastAdAt = Date.now();
    this.ready = false;

    if (this.fake) { await this.fakeAd(); this.ready = true; return; }
    const handles: { remove(): Promise<void> }[] = [];
    try {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish).then(h => handles.push(h));
        AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish).then(h => handles.push(h));
        AdMob.showInterstitial().catch(finish);
        setTimeout(finish, 60_000);          // never strand the player
      });
    } catch (e) {
      console.warn('[ads] show failed', e);
    } finally {
      handles.forEach(h => void h.remove());
      this.preload();
    }
  }

  /** Settings → AD PRIVACY (only offered when UMP requires it). */
  async showPrivacyOptions(): Promise<void> {
    if (this.fake) return;
    try { await AdMob.showPrivacyOptionsForm(); } catch (e) { console.warn('[ads] privacy form failed', e); }
  }

  private due(): boolean {
    if (!this.enabled || !this.ready || store.isAdFree()) return false;
    const runs = this.runs();
    const lastRun = parseInt(localStorage.getItem(LAST_AD_KEY) || '0', 10);
    return runs >= FREE_RUNS
      && runs - lastRun >= RUNS_BETWEEN
      && Date.now() - this.lastAdAt >= MIN_GAP_MS;
  }

  private runs(): number {
    return parseInt(localStorage.getItem(RUNS_KEY) || '0', 10);
  }

  private preload(): void {
    if (this.fake || this.loading || this.ready || !this.enabled) return;
    this.loading = true;
    AdMob.prepareInterstitial({ adId: this.adId, isTesting: this.testing, npa: true })
      .then(() => { this.ready = true; })
      .catch(e => console.warn('[ads] load failed', e))
      .finally(() => { this.loading = false; });
  }

  private fakeAd(): Promise<void> {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.id = 'fake-ad';
      el.textContent = 'TEST AD';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;'
        + 'justify-content:center;background:#222;color:#fff;font:700 28px monospace';
      document.body.appendChild(el);
      setTimeout(() => { el.remove(); resolve(); }, 1500);
    });
  }
}

export const ads = new Ads();
