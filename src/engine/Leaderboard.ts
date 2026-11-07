/**
 * Leaderboard — no backend of our own, no paid API.
 *
 * The board players see is ONE global board on PlayFab, shared by every
 * platform (iPhone/iPad app, web, Android). The player only types a nickname;
 * there is no login screen.
 *
 *   • PlayFabProvider — the global board. Anonymous, invisible device login
 *                       (Client/LoginWithCustomID keyed by a random per-device
 *                       UID), nickname = PlayFab title display name, score =
 *                       the `HighScore` statistic (aggregation Max) feeding the
 *                       linked `HighScore` leaderboard. Uses PlayFab's newer
 *                       Statistics/Leaderboards ("Progression") APIs — titles
 *                       created after 2024 can't use the legacy Client
 *                       statistics endpoints (they fail with
 *                       ProductDisabledForTitle). Client REST only: the Title
 *                       ID is public, there is NO secret key in the bundle.
 *
 *   • LocalProvider   — this device only (localStorage). Used when no Title ID
 *                       is configured, and as the fallback whenever PlayFab
 *                       can't be reached, so the game never blocks on it.
 *                       Every score is also always written here.
 *
 *   • Game Center     — iOS bonus, not a board of its own in the game: when the
 *                       player is signed in, each score is also submitted to the
 *                       Game Center leaderboard so it shows in Apple's Games app
 *                       next to their friends. App-local plugin
 *                       (ios/App/App/GameCenterPlugin.swift).
 *
 * ONE SHARED BOARD: both control setups (TWO HANDS / ONE HAND) rank together —
 * a device owns exactly one row, its best score whichever way it was played.
 * `LocalProvider.load()` folds rows from the older split Normal/Advanced
 * boards into one.
 *
 * Identity & anti-overwrite ("aby si ľudia neprepisovali skóre"):
 *   - Every device gets one stable random UID (localStorage); all writes are
 *     keyed by it, so a device owns exactly one row and can't touch another's.
 *   - Only a *higher* score is ever kept: max() locally, and the PlayFab
 *     statistic column aggregates with Max, so the server keeps the best.
 *   - PlayFab enforces unique display names, so nobody can take your nickname.
 *
 * NOTE: a fully cheat-proof board needs server-side validation (PlayFab
 * CloudScript / a real backend). Out of scope by request — a determined
 * player can still post a fake score from their own device.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

/** PlayFab title (public — it ships in every client, it is not a secret).
 *  Override with VITE_PLAYFAB_TITLE_ID; set it to "local" for a device-only board. */
const DEFAULT_PLAYFAB_TITLE_ID = '1095E4';

/** PlayFab statistic + linked leaderboard (both named `HighScore`; the stat
 *  has one column, "Score", aggregation Max). */
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
/*  PLAYFAB PROVIDER (client REST only — public Title ID, no secrets)  */
/* ------------------------------------------------------------------ */

interface EntityKey { Id: string; Type: string; }
interface Session { ticket: string; token: string; entity: EntityKey; }

class PlayFabError extends Error {
  constructor(readonly code: string, msg: string, readonly status: number) { super(msg); }
}

/** Thrown by setName when the nickname can't be used; message is player-facing. */
export class NameError extends Error {}

class PlayFabProvider implements Provider {
  readonly global = true;
  private readonly base: string;
  private readonly titleId: string;
  private session: Promise<Session> | null = null;
  /** Name already pushed this session — avoids a profile write per run. */
  private pushedName = '';

  constructor(titleId: string) {
    this.titleId = titleId;
    this.base = `https://${titleId}.playfabapi.com`;
  }

  private async post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PlayFabError(json?.error ?? '', json?.errorMessage || `PlayFab ${path} ${res.status}`, res.status);
    }
    return json.data;
  }

  /** Anonymous, device-based login — cached for the app session. */
  private login(uid: string): Promise<Session> {
    if (!this.session) {
      this.session = this.post('/Client/LoginWithCustomID', {
        TitleId: this.titleId,
        CustomId: uid,
        CreateAccount: true
      })
        .then(d => ({
          ticket: d.SessionTicket as string,
          token: d.EntityToken.EntityToken as string,
          entity: { Id: d.EntityToken.Entity.Id as string, Type: d.EntityToken.Entity.Type as string }
        }))
        .catch(e => { this.session = null; throw e; });
    }
    return this.session;
  }

  /** Run an authed call; one re-login if the session/token expired (24h). */
  private async withSession<T>(uid: string, fn: (s: Session) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.login(uid));
    } catch (e) {
      if (!(e instanceof PlayFabError) || e.status !== 401) throw e;
      this.session = null;
      this.pushedName = '';
      return fn(await this.login(uid));
    }
  }

  private async pushName(name: string, s: Session): Promise<void> {
    if (name === this.pushedName) return;
    if (name.length < NAME_MIN) throw new NameError(`Name needs at least ${NAME_MIN} characters`);
    try {
      await this.post('/Client/UpdateUserTitleDisplayName', { DisplayName: name }, { 'X-Authorization': s.ticket });
      this.pushedName = name;
    } catch (e) {
      if (e instanceof PlayFabError && e.code === 'NameNotAvailable') throw new NameError('That name is taken');
      if (e instanceof PlayFabError && e.status === 400) throw new NameError('That name is not allowed');
      throw e;
    }
  }

  async submit(uid: string, name: string, score: number, _level: number): Promise<void> {
    await this.withSession(uid, async s => {
      /* the name is cosmetic — never lose the score over it */
      await this.pushName(name, s).catch(() => {});
      /* the statistic's Score column aggregates with Max: lower values are ignored */
      await this.post('/Statistic/UpdateStatistics', {
        Entity: s.entity,
        Statistics: [{ Name: STAT_NAME, Scores: [String(score)] }]
      }, { 'X-EntityToken': s.token });
    });
  }

  async setName(uid: string, name: string): Promise<void> {
    await this.withSession(uid, s => this.pushName(name, s));
  }

  async top(count: number, uid: string): Promise<LbRow[]> {
    return this.withSession(uid, async s => {
      const auth = { 'X-EntityToken': s.token };
      const toRow = (e: any): LbRow => ({
        rank: e.Rank ?? 0,
        name: e.DisplayName || 'Anonymous',
        score: parseInt(e.Scores?.[0] ?? '0', 10) || 0,
        you: e.Entity?.Id === s.entity.Id
      });

      const d = await this.post('/Leaderboard/GetLeaderboard', {
        LeaderboardName: STAT_NAME,
        StartingPosition: 1,
        PageSize: Math.min(count, 100)
      }, auth);
      const rows = ((d?.Rankings ?? []) as any[]).map(toRow);

      /* player is ranked below the visible top — pin their own row at the end */
      if (!rows.some(r => r.you)) {
        const me = await this.post('/Leaderboard/GetLeaderboardAroundEntity', {
          LeaderboardName: STAT_NAME,
          Entity: s.entity,
          MaxSurroundingEntries: 1
        }, auth).catch(() => null);
        const mine = ((me?.Rankings ?? []) as any[]).map(toRow).find(r => r.you);
        if (mine) rows.push(mine);
      }
      return rows;
    });
  }
}

/* ------------------------------------------------------------------ */
/*  GAME CENTER (iOS bonus — mirrors scores to Apple's Games app)      */
/* ------------------------------------------------------------------ */

interface GameCenterPlugin {
  authenticate(): Promise<{ authenticated: boolean; playerId: string; alias: string }>;
  submitScore(o: { leaderboardId: string; score: number }): Promise<void>;
}

const GameCenter = registerPlugin<GameCenterPlugin>('GameCenter');

/* ------------------------------------------------------------------ */
/*  FACADE                                                             */
/* ------------------------------------------------------------------ */

class Leaderboard {
  private uid = '';
  private name = '';
  private provider!: Provider;
  /** Always written; the board shown when PlayFab is unreachable. */
  private local = new LocalProvider();
  /** Last top() had to fall back to the local board. */
  private offline = false;
  private gameCenter = false;
  private inited = false;

  init(): void {
    if (this.inited) return;
    this.inited = true;

    this.uid = localStorage.getItem(UID_KEY) || this.genUid();
    localStorage.setItem(UID_KEY, this.uid);
    this.name = localStorage.getItem(NAME_KEY) || '';

    const env = (import.meta.env.VITE_PLAYFAB_TITLE_ID as string | undefined)?.trim();
    const titleId = env || DEFAULT_PLAYFAB_TITLE_ID;
    this.provider = titleId.toLowerCase() === 'local' ? this.local : new PlayFabProvider(titleId);

    /* iOS app: Game Center sign-in at launch (Apple shows its own banner).
       Optional — declining it changes nothing in the game. */
    if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('GameCenter')) {
      GameCenter.authenticate()
        .then(p => { this.gameCenter = p.authenticated; })
        .catch(e => console.warn('[leaderboard] Game Center sign-in failed', e));
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
    this.name = this.clean(name);
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
