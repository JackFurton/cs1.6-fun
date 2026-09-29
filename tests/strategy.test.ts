import { expect, test } from 'vitest';
import { chooseSite, chooseTStrat, ctSetup, type RoundNote } from '../src/bots/strategy';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const note = (site: string, tWon: boolean, strat: RoundNote['strat'] = 'execute'): RoundNote => ({ site, strat, tWon, hit: site });

test('CTs stack a site the Ts have hit three rounds running, and usually split otherwise', () => {
  const rand = rng(3);
  let stackedB = 0;
  let stackedCold = 0;
  for (let i = 0; i < 400; i++) {
    const hot = ctSetup(['A', 'B'], 5, [note('B', true), note('B', true), note('B', true)], rand);
    if (hot.stacked === 'B') {
      stackedB++;
      expect(hot.counts.get('B')).toBe(4);
    }
    if (ctSetup(['A', 'B'], 5, [note('A', true), note('B', true)], rand).stacked) stackedCold++;
  }
  expect(stackedB / 400).toBeGreaterThan(0.5);
  expect(stackedCold / 400).toBeLessThan(0.15);
});

test('Ts back off a site and a strategy that just lost', () => {
  const rand = rng(5);
  let sameSite = 0;
  let sameStrat = 0;
  const lost = [note('A', false, 'rush')];
  for (let i = 0; i < 1000; i++) {
    if (chooseSite(['A', 'B'], lost, rand) === 'A') sameSite++;
    if (chooseTStrat({ eco: false, pistol: false, ts: 5, sites: 2, history: lost, rand }) === 'rush') sameStrat++;
  }
  expect(sameSite / 1000).toBeLessThan(0.45);
  expect(sameStrat / 1000).toBeLessThan(0.08);
});

test('an eco never fakes or splits', () => {
  const rand = rng(9);
  for (let i = 0; i < 300; i++) expect(['rush', 'default', 'execute']).toContain(chooseTStrat({ eco: true, pistol: false, ts: 5, sites: 2, history: [], rand }));
});
