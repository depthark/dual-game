/**
 * Global leaderboard — Cloudflare Pages Function backed by D1.
 *
 * Deployed automatically with the site (Pages builds `functions/` on every
 * push), so there is no separate Worker to deploy or keep alive.
 *
 * Fully anonymous. The only identity is `uid`: a random UUID the client
 * generates once and keeps in localStorage. We never see or store an email, an
 * account, an advertising identifier, or the caller's IP address.
 *
 * Anti-overwrite: `uid` is the primary key and the upsert keeps MAX(score), so
 * a device owns exactly one row and a later worse run can never lower it.
 *
 * Cheat resistance is best-effort — any client-submitted score is forgeable in
 * principle. What we can do cheaply is reject scores the real game could never
 * produce (see `validScore`), which stops casual tampering.
 *
 *   GET  /api/scores?uid=<uid>&limit=<n>  → { rows, you }
 *   POST /api/scores  { uid, name, score, level }   submit a run (upsert, max)
 *   PUT  /api/scores  { uid, name }                 rename → 409 name_taken
 *
 * Nicknames are unique (case-insensitive — they are stored upper-cased). A
 * rename that collides is refused with `name_taken` so the player can pick
 * another; a score submitted under a name someone else holds is still
 * recorded, under the device's previous name or a `PLAYER` + uid fallback,
 * because a run must never be lost over a cosmetic field.
 */

interface Env {
  DB: D1Database;
}

/* ------------------------------------------------------------------ */
/*  LIMITS                                                             */
/* ------------------------------------------------------------------ */

const NAME_MAX   = 14;
const NAME_MIN   = 3;
const TOP_MAX    = 100;
const TOP_DEFAULT = 50;

/** Every gate scores BASE_PASS_SCORE (10) x an integer combo multiplier, so a
 *  legitimate total is always a multiple of 10. */
const SCORE_STEP = 10;
/** Far beyond any human run; exists only to bound the column. */
const SCORE_MAX  = 1_000_000;
const LEVEL_MAX  = 10;

const CORS = {
  /* The iOS build runs at capacitor://localhost, so requests to this origin
     are cross-origin. The board is public and anonymous and we send no
     cookies, so a wildcard is the correct policy here rather than a risk. */
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
  });

/* ------------------------------------------------------------------ */
/*  VALIDATION                                                         */
/* ------------------------------------------------------------------ */

/** A client-generated UUID (or the pre-UUID fallback the old build wrote). */
const validUid = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);

const validScore = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) &&
  v > 0 && v <= SCORE_MAX && v % SCORE_STEP === 0;

const validLevel = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LEVEL_MAX;

/* Names are shown to other players, so they are moderated content (App Review
   guideline 1.2). We keep the character set narrow rather than trying to filter
   every possible slur: no punctuation means no URLs, no @handles, and no
   unicode lookalike tricks. Then two lists, matched on a folded form (accents
   stripped, leetspeak collapsed, separators removed): unambiguous stems are
   blocked anywhere in the name; short words that also live inside harmless
   names ("Sussex", "Dickens", "Grape", "Janus", "Spice") only as the whole name.
   Same lists as the client's `isOffensive()` in src/engine/Leaderboard.ts. */
const BLOCKED_ANYWHERE = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'penis', 'vagina',
  'porn', 'nazi', 'hitler', 'nigg', 'faggot', 'retard', 'tranny', 'chink', 'kike',
  'kurva', 'kokot', 'jebat', 'hovno'
];
const BLOCKED_WHOLE = [
  'sex', 'dick', 'cock', 'rape', 'fag', 'tits', 'ass', 'anus', 'spic', 'kys',
  'pica', 'debil', 'piss'
];

/** Lower-case a-z only, so `n1gg3r`, `F_u.c-k` and `kokót` all fold to the same
 *  form as the list entries. */
const fold = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
    .replace(/[^a-z]/g, '');

const isOffensive = (name: string): boolean => {
  const f = fold(name);
  return BLOCKED_ANYWHERE.some(w => f.includes(w)) || BLOCKED_WHOLE.includes(f);
};

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  /* Uppercase A-Z, digits and single spaces only — matches the board's type
     treatment and removes every character that could carry a payload.
     Accents are folded first so "Lukáš" becomes LUKAS rather than LUK. */
  const name = raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);

  if (!name || isOffensive(name)) return null;
  return name;
}

/** Fallback for a device whose chosen name is held by someone else. */
const fallbackName = (uid: string): string =>
  'PLAYER' + uid.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();

/** Is `name` already held by a different device? */
async function nameTaken(db: D1Database, name: string, uid: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM scores WHERE name = ? AND uid <> ? LIMIT 1')
    .bind(name, uid)
    .first<{ x: number }>();
  return !!row;
}

/* ------------------------------------------------------------------ */
/*  READ                                                               */
/* ------------------------------------------------------------------ */

interface Row { uid: string; name: string; score: number; level: number; }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid') ?? '';

  const asked = Number(url.searchParams.get('limit') ?? TOP_DEFAULT);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, TOP_MAX) : TOP_DEFAULT;

  try {
    const { results } = await env.DB
      .prepare('SELECT uid, name, score, level FROM scores ORDER BY score DESC, updated ASC LIMIT ?')
      .bind(limit)
      .all<Row>();

    const rows = (results ?? []).map((r, i) => ({
      rank:  i + 1,
      name:  r.name,
      score: r.score,
      you:   r.uid === uid
    }));

    /* If the caller didn't make the visible top N, tell them where they
       actually stand so the board still means something to them. */
    let you: { rank: number; name: string; score: number } | null = null;
    if (validUid(uid) && !rows.some(r => r.you)) {
      const mine = await env.DB
        .prepare('SELECT name, score FROM scores WHERE uid = ?')
        .bind(uid)
        .first<{ name: string; score: number }>();

      if (mine) {
        const ahead = await env.DB
          .prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ?')
          .bind(mine.score)
          .first<{ n: number }>();
        you = { rank: (ahead?.n ?? 0) + 1, name: mine.name, score: mine.score };
      }
    }

    return json({ rows, you });
  } catch (e) {
    return json({ error: 'read_failed', detail: String(e) }, 500);
  }
};

/* ------------------------------------------------------------------ */
/*  WRITE                                                              */
/* ------------------------------------------------------------------ */

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const { uid, score, level } = body;

  if (!validUid(uid))     return json({ error: 'bad_uid' }, 400);
  if (!validScore(score)) return json({ error: 'bad_score' }, 400);
  if (!validLevel(level)) return json({ error: 'bad_level' }, 400);

  try {
    /* A bad or taken name costs the player nothing but the name: keep the
       device's current one, or fall back to PLAYERxxxx for a new row. */
    let name = cleanName(body.name);
    if (!name || await nameTaken(env.DB, name, uid)) {
      const current = await env.DB
        .prepare('SELECT name FROM scores WHERE uid = ?')
        .bind(uid)
        .first<{ name: string }>();
      name = current?.name ?? fallbackName(uid);
    }

    /* One row per uid, and only ever upward: a lower score leaves the stored
       score AND its level untouched. */
    const upsert = (n: string) => env.DB
      .prepare(
        `INSERT INTO scores (uid, name, score, level, updated)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(uid) DO UPDATE SET
           name    = excluded.name,
           level   = CASE WHEN excluded.score > scores.score THEN excluded.level ELSE scores.level END,
           score   = MAX(scores.score, excluded.score),
           updated = excluded.updated`
      )
      .bind(uid, n, score, level, Date.now())
      .run();

    try {
      await upsert(name);
    } catch (e) {
      /* Lost a race for the name to another device (unique index) — the score
         still goes in, under the fallback name. */
      if (!String(e).includes('UNIQUE')) throw e;
      name = fallbackName(uid);
      await upsert(name);
    }

    return json({ ok: true, name });
  } catch (e) {
    return json({ error: 'write_failed', detail: String(e) }, 500);
  }
};

/* ------------------------------------------------------------------ */
/*  RENAME                                                             */
/* ------------------------------------------------------------------ */

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const { uid } = body;
  if (!validUid(uid)) return json({ error: 'bad_uid' }, 400);

  const name = cleanName(body.name);
  if (!name || name.replace(/ /g, '').length < NAME_MIN) return json({ error: 'bad_name' }, 400);

  try {
    if (await nameTaken(env.DB, name, uid)) return json({ error: 'name_taken' }, 409);
    /* A device with no score yet has no row: nothing to rename, and its next
       submit carries the name (checked again there). */
    await env.DB.prepare('UPDATE scores SET name = ? WHERE uid = ?').bind(name, uid).run();
    return json({ ok: true, name });
  } catch (e) {
    return json({ error: 'write_failed', detail: String(e) }, 500);
  }
};

/* Preflight for the cross-origin POST/PUT from the iOS WebView. */
export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
