/**
 * Leaderboard — one global board on our own Cloudflare Pages Function + D1.
 *
 * The board players see is ONE global board shared by every platform
 * (iPhone/iPad app, web, Android). The player only types a nickname; there is
 * no login screen and no account.
 *
 *   • CloudflareProvider — the global board. Talks to `functions/api/scores.ts`
 *                          (deployed with the site), backed by one D1 table.
 *                          No third-party SDK and no key in the bundle.
 *
 *   • LocalProvider      — this device only (localStorage). Used when the API
 *                          URL is blanked out, and as the fallback whenever
 *                          the global board can't be reached, so the game
 *                          never blocks on it. Every score is also always
 *                          written here.
 *
 *   • Game Center        — iOS bonus, not a board of its own in the game: when
 *                          the player is signed in, each score is also
 *                          submitted to the Game Center leaderboard so it shows
 *                          in Apple's Games app next to their friends.
 *                          App-local plugin (ios/App/App/GameCenterPlugin.swift).
 *
 * (Builds up to 1.0 used PlayFab. Its free tier is capped at 1,000 lifetime
 * player accounts, and this app creates one per device, so the board moved to
 * infrastructure the site already runs on.)
 *
 * ONE SHARED BOARD: both control setups (TWO HANDS / ONE HAND) rank together —
 * a device owns exactly one row, its best score whichever way it was played.
 * `LocalProvider.load()` folds rows from the older split Normal/Advanced
 * boards into one.
 *
 * Identity & anti-overwrite:
 *   - Every device gets one stable random UID (localStorage). That UID is the
 *     whole identity: no account, no email, no ad identifier, and the server
 *     stores no IP address. Writes are keyed by it, so a device owns exactly
 *     one row and can't touch another's.
 *   - Only a *higher* score is ever kept: max() locally, and the server upsert
 *     is `MAX(scores.score, excluded.score)`.
 *   - Nicknames are unique on the server, so nobody can take yours.
 *
 * NOTE: any client-submitted score is forgeable in principle. The Function
 * rejects values the real game can't produce (non-multiples of 10, levels
 * outside 1-10, absurd totals) — that stops casual tampering, not a
 * determined attacker.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

/** Where the global board lives. Override with VITE_LB_API (a preview
 *  deployment, `wrangler pages dev` on localhost); set it to "" or "local"
 *  for a device-only board. */
const DEFAULT_API = 'https://dual-game.pages.dev/api/scores';

const UID_KEY   = 'dual_uid';
const NAME_KEY  = 'dual_name';
const LOCAL_KEY = 'dual_lb';

/** Game Center leaderboard ID — must match App Store Connect → Game Center
 *  (Best score, sorted high → low). */
const GC_LEADERBOARD_ID = 'dualmind.highscore';

const NAME_MAX = 14;
const NAME_MIN = 3;   // also enforced by the server's rename endpoint

/**
 * Nicknames are public, so block the obvious offensive ones (App Review
 * guideline 1.2 — user-generated content needs filtering). Names are folded
 * first (case, accents, common digit/symbol swaps, separators), so "F_u.c-k"
 * and "5h1t" are caught. Unambiguous stems match anywhere in the name; short
 * words that also live inside harmless names ("Sussex", "Dickens", "Grape")
 * only match the whole name. Deliberately coarse: anything that slips through
 * is removed on request (contact on the support page).
 */
const BLOCKED_ANYWHERE = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'penis', 'vagina',
  'porn', 'nazi', 'hitler', 'nigg', 'retard', 'kurva', 'kokot', 'jebat', 'hovno'
];
const BLOCKED_WHOLE = ['sex', 'dick', 'cock', 'rape', 'fag', 'tits', 'ass', 'pica', 'debil', 'piss'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function isOffensive(name: string): boolean {
  const folded = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[013457@$!]/g, c => LEET[c]).replace(/[^a-z]/g, '');
  return BLOCKED_ANYWHERE.some(w => folded.includes(w)) || BLOCKED_WHOLE.includes(folded);
}

export interface LbRow {
  rank: number;
  name: string;
  score: number;
  you: boolean;
}

interface Provider {
  /** true if the board is shared across devices */
  readonly global: boolean;
  submit(uid: string, name: string, score: number, level: number): Promise<void>;
  setName(uid: string, name: string): Promise<void>;
  top(count: number, uid: string): Promise<LbRow[]>;
}

/* ------------------------------------------------------------------ */
/*  LOCAL PROVIDER                                                     */
/* ------------------------------------------------------------------ */

interface LocalEntry { uid: string; name: string; score: number; level: number; }
/** Shape written by the older split-board build (kept only for migration). */
interface LegacyEntry extends LocalEntry { mode?: string; }

class LocalProvider implements Provider {
  readonly global = false;

  /**
   * Reads the board, folding any rows left over from the split
   * Normal/Advanced era into one row per device: same UID → keep the higher
   * score (and the level that went with it). Runs on every load and is a
   * no-op once the stored data has no duplicate UIDs, so it needs no
   * version flag.
   */
  private load(): LocalEntry[] {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const arr = raw ? JSON.parse(raw) as LegacyEntry[] : [];

      const byUid = new Map<string, LocalEntry>();
      for (const e of arr) {
        const prev = byUid.get(e.uid);
        if (!prev) {
          byUid.set(e.uid, { uid: e.uid, name: e.name, score: e.score, level: e.level });
        } else if (e.score > prev.score) {
          prev.score = e.score;
          prev.level = e.level;
          prev.name  = e.name;
        }
      }
      return [...byUid.values()];
    } catch {
      return [];
    }
  }

  private save(entries: LocalEntry[]): void {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
  }

  async submit(uid: string, name: string, score: number, level: number): Promise<void> {
    const all = this.load();
    const existing = all.find(e => e.uid === uid);
    if (existing) {
      existing.name = name;
      /* keep only the best — never overwrite with a lower score */
      if (score > existing.score) {
        existing.score = score;
        existing.level = level;
      }
    } else {
      all.push({ uid, name, score, level });
    }
    this.save(all);
  }

  /** This device's best score on the local board (0 if none). */
  best(uid: string): number {
    return this.load().find(e => e.uid === uid)?.score ?? 0;
  }

  async setName(uid: string, name: string): Promise<void> {
    const all = this.load();
    let changed = false;
    for (const e of all) {
      if (e.uid === uid) { e.name = name; changed = true; }
    }
    if (changed) this.save(all);
  }

  async top(count: number, uid: string): Promise<LbRow[]> {
    return this.load()
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, you: e.uid === uid }));
  }
}

/* ------------------------------------------------------------------ */
/*  CLOUDFLARE PROVIDER (our Pages Function at functions/api/scores.ts)  */
/* ------------------------------------------------------------------ */

/** Thrown by setName when the nickname can't be used; message is player-facing. */
export class NameError extends Error {}

class CloudflareProvider implements Provider {
  readonly global = true;

  constructor(private readonly api: string) {}

  /** POST a score / PUT a rename; maps the server's name errors to NameError. */
  private async send(method: 'POST' | 'PUT', body: unknown): Promise<void> {
    const res = await fetch(this.api, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) return;
    const d = await res.json().catch(() => ({})) as { error?: string };
    if (d.error === 'name_taken') throw new NameError('That name is taken');
    if (d.error === 'bad_name') throw new NameError('That name is not allowed');
    throw new Error(d.error || `${method} ${res.status}`);
  }

  async submit(uid: string, name: string, score: number, level: number): Promise<void> {
    await this.send('POST', { uid, name, score, level });
  }

  async setName(uid: string, name: string): Promise<void> {
    if (name.length < NAME_MIN) throw new NameError(`Name needs at least ${NAME_MIN} characters`);
    if (isOffensive(name)) throw new NameError('That name is not allowed');
    await this.send('PUT', { uid, name });
  }

  async top(count: number, uid: string): Promise<LbRow[]> {
    const res = await fetch(`${this.api}?uid=${encodeURIComponent(uid)}&limit=${Math.min(count, 100)}`);
    if (!res.ok) throw new Error(`top ${res.status}`);
    const d = await res.json() as {
      rows?: LbRow[];
      you?: { rank: number; name: string; score: number } | null;
    };
    const rows = d.rows ?? [];
    /* player is ranked below the visible top — pin their own row at the end */
    if (d.you && !rows.some(r => r.you)) {
      rows.push({ rank: d.you.rank, name: d.you.name, score: d.you.score, you: true });
    }
    return rows;
  }
}

/* ------------------------------------------------------------------ */
/*  GAME CENTER (iOS bonus — mirrors scores to Apple's Games app)      */
/* ------------------------------------------------------------------ */

interface GameCenterPlugin {
  authenticate(): Promise<{ authenticated: boolean; playerId: string; alias: string }>;
  submitScore(o: { leaderboardId: string; score: number }): Promise<void>;
  reportAchievements(o: { achievements: { id: string; percent: number }[] }): Promise<void>;
}

/** Shared with Achievements.ts — a plugin can only be registered once. */
export const GameCenter = registerPlugin<GameCenterPlugin>('GameCenter');

/* ------------------------------------------------------------------ */
/*  FACADE                                                             */
/* ------------------------------------------------------------------ */

class Leaderboard {
  private uid = '';
  private name = '';
  private provider!: Provider;
  /** Always written; the board shown when the global board is unreachable. */
  private local = new LocalProvider();
  /** Last top() had to fall back to the local board. */
  private offline = false;
  private gameCenter = false;
  /** Resolves once the launch-time Game Center sign-in has an outcome. */
  private gcReady: Promise<boolean> = Promise.resolve(false);
  private inited = false;

  init(): void {
    if (this.inited) return;
    this.inited = true;

    this.uid = localStorage.getItem(UID_KEY) || this.genUid();
    localStorage.setItem(UID_KEY, this.uid);
    this.name = localStorage.getItem(NAME_KEY) || '';

    const env = import.meta.env.VITE_LB_API as string | undefined;
    /* `bun run dev` never touches the live board unless VITE_LB_API asks for it */
    const fallback = import.meta.env.DEV ? 'local' : DEFAULT_API;
    const api = (env === undefined ? fallback : env).trim();
    this.provider = !api || api.toLowerCase() === 'local' ? this.local : new CloudflareProvider(api);

    /* iOS app: Game Center sign-in at launch (Apple shows its own banner).
       Optional — declining it changes nothing in the game. */
    if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('GameCenter')) {
      this.gcReady = GameCenter.authenticate()
        .then(p => (this.gameCenter = p.authenticated))
        .catch(e => { console.warn('[leaderboard] Game Center sign-in failed', e); return false; });
    }
  }

  private genUid(): string {
    const c = globalThis.crypto as Crypto | undefined;
    if (c?.randomUUID) return c.randomUUID();
    return 'uid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /** Sanitize a user-entered name (trim, length cap). */
  private clean(name: string): string {
    return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  isGlobal(): boolean { return this.provider.global; }
  /** true once the player is signed in to Game Center (iOS only). */
  gameCenterReady(): Promise<boolean> { return this.gcReady; }
  getName(): string { return this.name; }

  /** Footer line under the board ('' = nothing to say). */
  statusHint(): string {
    if (!this.provider.global) return 'Scores saved on this device';
    return this.offline ? 'Offline — showing scores from this device' : '';
  }

  /** Name actually shown on the board — falls back to a UID-derived handle. */
  displayName(): string {
    return this.name || ('Player-' + this.uid.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase());
  }

  /**
   * Persist a new name and push it to the global board. Resolves to a
   * player-facing problem ("That name is taken") or null when it went through.
   */
  async setName(name: string): Promise<string | null> {
    const clean = this.clean(name);
    if (isOffensive(clean)) return 'That name is not allowed';
    this.name = clean;
    localStorage.setItem(NAME_KEY, this.name);
    await this.local.setName(this.uid, this.displayName());
    try {
      await this.provider.setName(this.uid, this.displayName());
      return null;
    } catch (e) {
      if (e instanceof NameError) return e.message;
      console.warn('[leaderboard] setName failed', e);
      return null;   // offline — it is pushed again with the next score
    }
  }

  async submit(score: number, level: number): Promise<void> {
    if (score <= 0) return;
    await this.local.submit(this.uid, this.displayName(), score, level);
    if (this.gameCenter) {
      GameCenter.submitScore({ leaderboardId: GC_LEADERBOARD_ID, score })
        .catch(e => console.warn('[leaderboard] Game Center submit failed', e));
    }
    if (this.provider === this.local) return;
    try {
      /* Send the device's best, not just this run: the server keeps the max
         anyway, and this way runs played offline (or before the global board
         existed) catch up on the next online game. */
      const best = Math.max(score, this.local.best(this.uid));
      await this.provider.submit(this.uid, this.displayName(), best, level);
    } catch (e) {
      console.warn('[leaderboard] submit failed', e);
    }
  }

  async top(count: number): Promise<LbRow[]> {
    this.offline = false;
    if (this.provider === this.local) return this.local.top(count, this.uid);
    try {
      return await this.provider.top(count, this.uid);
    } catch (e) {
      console.warn('[leaderboard] global board unavailable', e);
      this.offline = true;
      return this.local.top(count, this.uid);
    }
  }
}

export const leaderboard = new Leaderboard();
