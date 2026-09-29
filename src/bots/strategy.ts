/** How the Terrorists play a round. */
export type TStrat = 'execute' | 'split' | 'fake' | 'default' | 'rush';

/** What the bots remember about a finished round. */
export interface RoundNote {
  /** Site the T bots went for, and how. */
  site: string | null;
  strat: TStrat | null;
  tWon: boolean;
  /** Where the CTs saw the attack land: the plant, or failing that where most contacts were. */
  hit: string | null;
}

type Weights<K extends string> = Partial<Record<K, number>>;

function weighted<K extends string>(w: Weights<K>, rand: () => number): K {
  const entries = Object.entries(w) as [K, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let r = rand() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function chooseTStrat(opts: { eco: boolean; pistol: boolean; ts: number; sites: number; history: RoundNote[]; rand: () => number }): TStrat {
  const { eco, pistol, ts, sites, history, rand } = opts;
  if (!sites) return 'rush';
  // No utility on an eco: either run at them together or take a slow look for a gap.
  if (eco && !pistol) return weighted({ rush: 0.55, default: 0.3, execute: 0.15 }, rand);
  const w: Weights<TStrat> = pistol ? { execute: 0.3, split: 0.25, rush: 0.25, default: 0.2 } : { execute: 0.3, split: 0.2, fake: 0.15, default: 0.25, rush: 0.1 };
  if (ts < 4) {
    delete w.fake;
    w.split = (w.split ?? 0) * 0.5;
  }
  // Whatever just lost is less likely to be run straight back; a win is worth trying again, but
  // not so often that it's a pattern.
  const last = history[history.length - 1];
  if (last?.strat && w[last.strat] !== undefined) w[last.strat]! *= last.tWon ? 1.1 : 0.4;
  const prev = history[history.length - 2];
  if (prev?.strat && prev.strat === last?.strat && w[prev.strat] !== undefined) w[prev.strat]! *= 0.5;
  return weighted(w, rand);
}

/** Pick a site, steering away from one that just went badly or has been hit twice running. */
export function chooseSite(names: string[], history: RoundNote[], rand: () => number): string {
  const w: Weights<string> = {};
  for (const n of names) w[n] = 1;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  if (last?.site && w[last.site] !== undefined) w[last.site]! *= last.tWon ? 1 : 0.55;
  if (last?.site && last.site === prev?.site && w[last.site] !== undefined) w[last.site]! *= 0.5;
  return weighted(w, rand);
}

/**
 * How many CTs each site gets. Mostly an even split, but a site the Ts keep hitting draws a
 * stack, and now and then the CTs gamble on one anyway.
 */
export function ctSetup(names: string[], cts: number, history: RoundNote[], rand: () => number): { counts: Map<string, number>; stacked: string | null } {
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  if (!names.length || !cts) return { counts, stacked: null };
  // With two sites, two hits in a row happens by chance half the time; three is a read.
  const hits = history.map((h) => h.hit);
  const streak = (n: number) => names.find((s) => hits.length >= n && hits.slice(-n).every((h) => h === s)) ?? null;
  const hot = streak(3) ?? streak(2);
  const chance = streak(3) ? 0.6 : hot ? 0.3 : 0;
  const stacked = names.length > 1 && cts >= 3 && (rand() < chance || rand() < 0.08) ? (hot ?? names[Math.floor(rand() * names.length)]) : null;
  const order = [...names].sort(() => rand() - 0.5);
  if (stacked) {
    const others = order.filter((n) => n !== stacked);
    // Everyone but one (or two, on a five-stack of three sites) plays the stacked site.
    counts.set(stacked, cts - others.length);
    for (const n of others) counts.set(n, 1);
  } else {
    for (let i = 0; i < cts; i++) counts.set(order[i % order.length], counts.get(order[i % order.length])! + 1);
  }
  return { counts, stacked };
}
