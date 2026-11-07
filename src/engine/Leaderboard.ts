/**
 * Leaderboard — ultra-simple, no backend of our own, no paid API.
 *
 * Three interchangeable providers behind one facade:
 *
 *   • GameCenterProvider — iOS app (Capacitor native shell). The GLOBAL board,
 *                       backed by Apple Game Center: free, no account of ours,
 *                       the player's Game Center alias is their name. Talks to
 *                       the app-local `GameCenter` plugin
 *                       (ios/App/App/GameCenterPlugin.swift). If the player
 *                       isn't / won't sign in to Game Center, the facade falls
 *                       back to the local board — the game never blocks on it.
 *
 *   • LocalProvider   — web default. Stores the board in localStorage. Zero
 *                       setup, zero cost, fully offline. Per-device only.
 *
 *   • PlayFabProvider — opt-in global board. Activated by setting the public
 *                       Title ID in `VITE_PLAYFAB_TITLE_ID`. Uses PlayFab's
 *                       *client* REST API only (the Title ID is public — there
 *                       is NO secret key in the bundle and NO server of ours).
 *                       PlayFab's free tier covers anonymous device login +
 *                       leaderboards, so there is no paid API involved.
 *
 * ONE SHARED BOARD: both control setups (TWO HANDS / ONE HAND) rank on the same
 * leaderboard — a device owns exactly one row, its best score whichever way it
 * was played. This replaced the earlier split Normal/Advanced boards; the
 * migration in `LocalProvider.load()` folds any pre-split rows together.
 *
 * Identity & anti-overwrite ("aby si ľudia neprepisovali skóre"):
 *   - Every device gets one stable UID (localStorage). All writes are keyed by
 *     that UID, so a device owns exactly one row — no duplicates.
 *   - Only a *higher* score is ever kept. Locally we max() on submit; on
 *     PlayFab the statistic must be configured with aggregation = Maximum so
 *     the server itself rejects any lower value.
 *
 * NOTE: a fully cheat-proof board needs server-side validation (PlayFab
 * CloudScript / a real backend). That is out of scope by request — this is the
 * "aspoň trochu secure" tier: stable identity + server-side max aggregation.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

/** The single PlayFab statistic backing the board.
 *  (The old split board also wrote `HighScoreAdv`; that statistic is no longer
 *  read or written — see `.env.example` if you need to reconcile old scores.) */
const STAT_NAME = 'HighScore';

const UID_KEY   = 'dual_uid';
const NAME_KEY  = 'dual_name';
const LOCAL_KEY = 'dual_lb';

/** Game Center leaderboard ID — must match App Store Connect → Game Center
 *  (Best score, sorted high → low). */
const GC_LEADERBOARD_ID = 'dualmind.highscore';

const NAME_MAX = 14;
const NAME_MIN = 3;   // PlayFab display-name minimum

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
/*  PLAYFAB PROVIDER (client REST only — public Title ID, no secrets)  */
/* ------------------------------------------------------------------ */

interface Session { ticket: string; id: string; }

class PlayFabProvider implements Provider {
  readonly global = true;
  private readonly base: string;
  private readonly titleId: string;
  private session: Promise<Session> | null = null;

  constructor(titleId: string) {
    this.titleId = titleId;
    this.base = `https://${titleId}.playfabapi.com`;
  }

  private async post(path: string, body: unknown, auth?: string): Promise<any> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { 'X-Authorization': auth } : {})
      },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.errorMessage || `PlayFab ${path} ${res.status}`);
    return json.data;
  }

  /** Anonymous, device-based login — cached for the session. */
  private login(uid: string): Promise<Session> {
    if (!this.session) {
      this.session = this.post('/Client/LoginWithCustomID', {
        TitleId: this.titleId,
        CustomId: uid,
        CreateAccount: true
      })
        .then(d => ({ ticket: d.SessionTicket as string, id: d.PlayFabId as string }))
        .catch(e => { this.session = null; throw e; });
    }
    return this.session;
  }

  private async pushName(name: string, ticket: string): Promise<void> {
    if (!name || name.length < NAME_MIN) return;
    try {
      await this.post('/Client/UpdateUserTitleDisplayName', { DisplayName: name }, ticket);
    } catch {
      /* name may be rejected (taken / invalid) — keep the score regardless */
    }
  }

  async submit(uid: string, name: string, score: number, _level: number): Promise<void> {
    const s = await this.login(uid);
    await this.pushName(name, s.ticket);
    /* Server keeps the max when the statistic's aggregation = Maximum. */
    await this.post('/Client/UpdatePlayerStatistics', {
      Statistics: [{ StatisticName: STAT_NAME, Value: score }]
    }, s.ticket);
  }

  async setName(uid: string, name: string): Promise<void> {
    const s = await this.login(uid);
    await this.pushName(name, s.ticket);
  }

  async top(count: number, uid: string): Promise<LbRow[]> {
    const s = await this.login(uid);
    const d = await this.post('/Client/GetLeaderboard', {
      StatisticName: STAT_NAME,
      StartPosition: 0,
      MaxResultsCount: Math.min(count, 100)
    }, s.ticket);
    const rows = (d?.Leaderboard ?? []) as any[];
    return rows.map(e => ({
      rank: (e.Position ?? 0) + 1,
      name: e.DisplayName || 'Anonymous',
      score: e.StatValue ?? 0,
      you: e.PlayFabId === s.id
    }));
  }
}

/* ------------------------------------------------------------------ */
/*  GAME CENTER PROVIDER (iOS native shell only)                       */
/* ------------------------------------------------------------------ */

interface GcRow { rank: number; alias: string; score: number; you: boolean; }
interface GcPlayer { authenticated: boolean; playerId: string; alias: string; }

interface GameCenterPlugin {
  authenticate(): Promise<GcPlayer>;
  submitScore(o: { leaderboardId: string; score: number }): Promise<void>;
  loadTop(o: { leaderboardId: string; count: number }): Promise<{ entries: GcRow[]; local?: GcRow }>;
}

const GameCenter = registerPlugin<GameCenterPlugin>('GameCenter');

class GameCenterProvider implements Provider {
  readonly global = true;

  async submit(_uid: string, _name: string, score: number, _level: number): Promise<void> {
    /* Game Center keeps the player's best (leaderboard type = Best score). */
    await GameCenter.submitScore({ leaderboardId: GC_LEADERBOARD_ID, score });
  }

  /** The name is the player's Game Center alias — nothing to push. */
  async setName(): Promise<void> {}

  async top(count: number): Promise<LbRow[]> {
    const { entries, local } = await GameCenter.loadTop({ leaderboardId: GC_LEADERBOARD_ID, count });
    const rows = entries.map(e => ({ rank: e.rank, name: e.alias, score: e.score, you: e.you }));
    /* player is ranked below the visible top — pin their own row at the end */
    if (local && !rows.some(r => r.you)) {
      rows.push({ rank: local.rank, name: local.alias, score: local.score, you: true });
    }
    return rows;
  }
}

/* ------------------------------------------------------------------ */
/*  FACADE                                                             */
/* ------------------------------------------------------------------ */

class Leaderboard {
  private uid = '';
  private name = '';
  private provider!: Provider;
  /** Always kept: the fallback board, and the offline copy of every score. */
  private local = new LocalProvider();
  private gcAlias = '';
  private inited = false;

  init(): void {
    if (this.inited) return;
    this.inited = true;

    this.uid = localStorage.getItem(UID_KEY) || this.genUid();
    localStorage.setItem(UID_KEY, this.uid);
    this.name = localStorage.getItem(NAME_KEY) || '';

    const titleId = (import.meta.env.VITE_PLAYFAB_TITLE_ID as string | undefined)?.trim();
    this.provider = titleId ? new PlayFabProvider(titleId) : this.local;

    /* iOS app: sign in to Game Center at launch (Apple shows its own banner /
       sign-in sheet). Until — or unless — that succeeds, the local board is
       used, so a declined or offline sign-in never blocks the game. */
    if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('GameCenter')) {
      GameCenter.authenticate()
        .then(p => {
          if (!p.authenticated) return;
          this.gcAlias = p.alias;
          this.provider = new GameCenterProvider();
          this.onChange?.();
        })
        .catch(e => console.warn('[leaderboard] Game Center sign-in failed', e));
    }
  }

  /** Fired when the active board switches (e.g. Game Center sign-in landed). */
  onChange?: () => void;

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

  /** Footer line under the board ('' = nothing to say). */
  statusHint(): string {
    if (this.provider.global) return '';
    return Capacitor.getPlatform() === 'ios'
      ? 'Sign in to Game Center to rank globally'
      : 'Scores saved on this device';
  }
  /** Game Center owns the name (the player's alias) — not editable in-game. */
  isNameEditable(): boolean { return !(this.provider instanceof GameCenterProvider); }
  getName(): string { return this.isNameEditable() ? this.name : this.gcAlias; }

  /** Name actually shown on the board — falls back to a UID-derived handle. */
  displayName(): string {
    return this.name || ('Player-' + this.uid.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase());
  }

  /** Persist a new name and propagate it to existing entries (all modes). */
  async setName(name: string): Promise<void> {
    this.name = this.clean(name);
    localStorage.setItem(NAME_KEY, this.name);
    try {
      await this.provider.setName(this.uid, this.displayName());
    } catch (e) {
      console.warn('[leaderboard] setName failed', e);
    }
  }

  async submit(score: number, level: number): Promise<void> {
    if (score <= 0) return;
    try {
      if (this.provider !== this.local) {
        /* local copy too, so the board survives a later Game Center sign-out */
        await this.local.submit(this.uid, this.displayName(), score, level);
      }
      await this.provider.submit(this.uid, this.displayName(), score, level);
    } catch (e) {
      console.warn('[leaderboard] submit failed', e);
    }
  }

  async top(count: number): Promise<LbRow[]> {
    const p = this.provider;
    if (!(p instanceof GameCenterProvider)) return p.top(count, this.uid);
    try {
      return await p.top(count);
    } catch (e) {
      /* offline / Game Center hiccup — show this device's scores instead */
      console.warn('[leaderboard] Game Center load failed', e);
      return this.local.top(count, this.uid);
    }
  }
}

export const leaderboard = new Leaderboard();
