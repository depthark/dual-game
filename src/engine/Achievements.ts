/**
 * Game Center achievements (iOS only — a silent no-op everywhere else).
 *
 * The IDs below must match App Store Connect → Game Center → Achievements
 * (created by scripts/setup-achievements.py). Reported at the end of a run
 * rather than mid-run, so Apple's banner never covers the play field.
 *
 *   score achievements — progress bar from the device's best score, and
 *                        unlocked retroactively on launch for players whose
 *                        best already qualifies
 *   per-run achievements — 100 % only; their counters reset every run, so a
 *                        progress bar would only ever go backwards
 *
 * Game Center keeps the highest percentage ever reported, and a small local
 * cache skips re-sending what it already has.
 */
import { LEVEL_POINTS } from '../config/constants';
import { leaderboard, GameCenter } from './Leaderboard';

const CACHE_KEY = 'dual_ach';

interface ScoreAch { id: string; score: number; progress: boolean }

/** Level n starts at (n − 1) × LEVEL_POINTS. */
const SCORE_ACHIEVEMENTS: ScoreAch[] = [
  { id: 'dualmind.ach.warmup',  score: 500,              progress: true },
  { id: 'dualmind.ach.level3',  score: 2 * LEVEL_POINTS, progress: true },
  { id: 'dualmind.ach.level5',  score: 4 * LEVEL_POINTS, progress: true },
  { id: 'dualmind.ach.level7',  score: 6 * LEVEL_POINTS, progress: true },
  { id: 'dualmind.ach.level10', score: 9 * LEVEL_POINTS, progress: true },
  /* hidden in Game Center — any progress above 0 would reveal it early */
  { id: 'dualmind.ach.beyond',  score: 10 * LEVEL_POINTS, progress: false }
];

export const GHOST_HUNTER_COUNT  = 5;
export const SLOW_MOTION_COUNT   = 3;
export const RAZORS_EDGE_COUNT   = 10;
export const AMBIDEXTROUS_SCORE  = 4 * LEVEL_POINTS;   // level 5

/** What one run did — counted by GameScene. */
export interface RunStats {
  score: number;
  ghosts: number;
  bullets: number;
  nearMisses: number;
  /** TWO HANDS mode */
  twoHands: boolean;
}

class Achievements {
  private sent: Record<string, number> = {};

  init(bestScore: number): void {
    try { this.sent = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { this.sent = {}; }
    /* retroactive: credit what the stored best score already earned */
    void this.report(this.fromBest(bestScore));
  }

  /** Call once per run, after the best score was updated. */
  endRun(run: RunStats, bestScore: number): void {
    const out = this.fromBest(Math.max(bestScore, run.score));
    if (run.ghosts     >= GHOST_HUNTER_COUNT) out.push({ id: 'dualmind.ach.ghosthunter', percent: 100 });
    if (run.bullets    >= SLOW_MOTION_COUNT)  out.push({ id: 'dualmind.ach.slowmotion',  percent: 100 });
    if (run.nearMisses >= RAZORS_EDGE_COUNT)  out.push({ id: 'dualmind.ach.razorsedge',  percent: 100 });
    if (run.twoHands && run.score >= AMBIDEXTROUS_SCORE) {
      out.push({ id: 'dualmind.ach.ambidextrous', percent: 100 });
    }
    void this.report(out);
  }

  private fromBest(best: number): { id: string; percent: number }[] {
    const out: { id: string; percent: number }[] = [];
    for (const a of SCORE_ACHIEVEMENTS) {
      const pct = best >= a.score ? 100 : a.progress ? Math.floor((best / a.score) * 100) : 0;
      if (pct > 0) out.push({ id: a.id, percent: pct });
    }
    return out;
  }

  private async report(items: { id: string; percent: number }[]): Promise<void> {
    const fresh = items.filter(i => i.percent > (this.sent[i.id] ?? 0));
    if (!fresh.length) return;
    if (!(await leaderboard.gameCenterReady())) return;
    try {
      await GameCenter.reportAchievements({ achievements: fresh });
      for (const i of fresh) this.sent[i.id] = i.percent;
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.sent));
    } catch (e) {
      console.warn('[achievements] report failed', e);
    }
  }
}

export const achievements = new Achievements();
