import { Vec3, angleVectors } from '../engine/vec';
import { Deathmatch } from '../game/deathmatch';
import type { Game } from '../game/game';
import type { GameMode } from '../game/mode';
import type { Player } from '../game/player';
import { BombDefusal } from '../game/rules';
import { inZone, type Team, type Zone } from '../maps/types';
import type { RadioCommand } from '../game/radio';
import { Bot, type Task } from './bot';
import { along, findLineup, type Lineup } from './lineups';
import { chooseSite, chooseTStrat, ctSetup, shuffle, type RoundNote, type TStrat } from './strategy';
import { solveThrow, type GrenadeId } from '../game/grenades';
import { botBuy } from './buy';
import { NavGraph, type NavNode } from './nav';
import { SKILLS, type Difficulty } from './skill';

interface Spot {
  pos: Vec3;
  look: Vec3;
  /** Which entrance it watches. */
  entrance: number;
}

export interface SitePlan {
  zone: Zone;
  nodes: NavNode[];
  center: NavNode;
  /** Distinct T approaches, spawn to site. */
  tRoutes: NavNode[][];
  /** Where each T approach enters the site, and a point a little outside it to watch. */
  tEntrances: Vec3[];
  ctEntrances: Vec3[];
  ctHolds: Spot[];
  tHolds: Spot[];
  /** Nav nodes on the back half of the T approaches: enemies here are coming for this site. */
  approach: Set<number>;
}

interface Contact {
  pos: Vec3;
  time: number;
  enemy: Player;
}

const EYE = 60;

/** An execute's utility, handed out: a first guess at the go, and who's flashing which way in. */
interface UtilityPlan {
  release: number;
  flashers: Bot[];
  entrance: Vec3 | null;
}

export class BotManager {
  readonly nav: NavGraph;
  readonly bots: Bot[] = [];
  readonly sites: SitePlan[] = [];
  private contacts: Contact[] = [];
  private lastPhase = '';
  private lastRound = -1;
  /** CTs sent to each site this round, so rotations can come in waves as more shows up. */
  private rotated = new Map<string, number>();
  private nextStrategy = 0;
  private retakeIssued = false;
  private retakeStart = 0;
  private radioAt = new Map<Team, number>();
  /** Site the Terrorists are going for this round. */
  targetSite: SitePlan | null = null;
  /** T execute timeline: gather at the staging spots (not before `notBefore`), throw utility, then go on the flash. */
  private exec: { phase: 'gather' | 'plan' | 'util'; release: number; notBefore: number; plan?: Generator<void, UtilityPlan>; flash?: UtilityPlan & { since: number } } | null = null;
  /** What the bots remember of earlier rounds, and how the Ts are playing this one. */
  private notes: RoundNote[] = [];
  private strat: TStrat | null = null;
  /** Pin the T strategy instead of choosing one (tests, debugging). */
  forceStrat: TStrat | null = null;
  /** Time-weighted contacts near each site, as each side saw them this round. */
  private heat = { T: new Map<string, number>(), CT: new Map<string, number>() };
  private plantSite: string | null = null;
  /** Default: bots out taking map control, and when the call comes. */
  private callAt: number | null = null;
  private defaults = new Map<Bot, Task>();
  /** Fake: a pair making noise at the other site before the real hit. */
  private fake: { site: SitePlan; bots: Bot[]; plan?: Generator<void, UtilityPlan>; release?: number; done: boolean } | null = null;
  /** A CT out for an early look: walk up, flash, peek, fall back. */
  private info: { bot: Bot; task: Task; pre: Vec3; peek: Vec3; flashAt: Vec3; stage: 'pre' | 'flash'; since: number; home: Spot } | null = null;
  private lastHolds: Vec3[] = [];
  /** Orders that go out after a beat, dropped if the bot's been told something else meanwhile. */
  private pendingTasks: { at: number; b: Bot; task: Task; expect: Task }[] = [];
  private ctAlive = new Set<Player>();
  private reacted = new Map<Bot, number>();
  /** Retake: set once the CTs are grouped; the entry waits for their flashes to pop. */
  private retakeRelease: number | null = null;

  constructor(
    readonly game: Game,
    readonly mode: GameMode,
    difficulty: Difficulty,
  ) {
    this.nav = new NavGraph(game.map, game.world);
    for (const p of game.players) if (p.isBot) this.bots.push(new Bot(p, this, SKILLS[difficulty]));
    if (mode instanceof BombDefusal) this.planSites();
  }

  addBot(p: Player, difficulty: Difficulty): void {
    this.bots.push(new Bot(p, this, SKILLS[difficulty]));
  }

  removeBot(p: Player): void {
    const i = this.bots.findIndex((b) => b.p === p);
    if (i >= 0) this.bots.splice(i, 1);
  }

  setDifficulty(d: Difficulty): void {
    for (const b of this.bots) b.skill = SKILLS[d];
  }

  private get defusal(): BombDefusal | null {
    return this.mode instanceof BombDefusal ? this.mode : null;
  }

  // ---------------------------------------------------------------- map analysis

  private planSites(): void {
    const map = this.game.map;
    const tSpawn = this.nav.nearest(map.spawns.T[0].pos)!;
    const ctSpawn = this.nav.nearest(map.spawns.CT[0].pos)!;
    for (const zone of map.bombsites) {
      const nodes = this.nav.nodesIn(zone);
      if (!nodes.length) continue;
      const cx = (zone.min.x + zone.max.x) / 2;
      const cz = (zone.min.z + zone.max.z) / 2;
      const center = nodes.reduce((a, b) => (Math.hypot(a.pos.x - cx, a.pos.z - cz) < Math.hypot(b.pos.x - cx, b.pos.z - cz) ? a : b));
      // Routes that cut through the other team's spawn aren't real approaches.
      const through = (r: NavNode[], team: 'T' | 'CT') => r.some((n) => map.buyzones[team].some((z) => inZone(z, n.pos)));
      let tRoutes = this.nav.routes(tSpawn, center, 5).filter((r) => !through(r, 'CT'));
      if (!tRoutes.length) tRoutes = [this.nav.path(tSpawn, center)!];
      let ctRoutes = this.nav.routes(ctSpawn, center, 3).filter((r) => !through(r, 'T'));
      if (!ctRoutes.length) ctRoutes = [this.nav.path(ctSpawn, center)!];
      const approach = new Set<number>();
      for (const r of tRoutes) for (let i = Math.floor(r.length * 0.45); i < r.length; i++) for (const e of [r[i].id, ...r[i].edges.map((x) => x.to)]) approach.add(e);
      const plan: SitePlan = { zone, nodes, center, tRoutes, tEntrances: entrances(tRoutes, zone), ctEntrances: entrances(ctRoutes, zone), ctHolds: [], tHolds: [], approach };
      // Points far down the T approaches: a CT hold that can be seen from there loses long AK duels.
      const far: Vec3[] = [];
      for (const r of tRoutes)
        r.forEach((n, i) => {
          const d = n.pos.distanceTo(center.pos);
          if (i % 4 === 0 && d > 1300 && d < 3200) far.push(n.pos.clone().add(new Vec3(0, EYE, 0)));
        });
      plan.ctHolds = this.holdSpots(plan, plan.tEntrances, far);
      plan.tHolds = this.holdSpots(plan, plan.ctEntrances);
      this.sites.push(plan);
    }
  }

  /** Spots in and around a site that can see at least one entrance from a safe-ish distance. */
  private holdSpots(site: SitePlan, watch: Vec3[], avoid: Vec3[] = []): Spot[] {
    const z = site.zone;
    const margin = 350;
    const near = this.nav.nodes.filter((n) => n.pos.x > z.min.x - margin && n.pos.x < z.max.x + margin && n.pos.z > z.min.z - margin && n.pos.z < z.max.z + margin);
    const out: Spot[] = [];
    const w = this.game.world;
    // Sample rather than test every node; plenty of candidates either way.
    const step = Math.max(1, Math.floor(near.length / 250));
    for (let i = 0; i < near.length; i += step) {
      const n = near[i];
      // Nodes with missing neighbours sit against cover.
      if (n.edges.length > 7) continue;
      const eye = n.pos.clone().add(new Vec3(0, EYE, 0));
      for (let ei = 0; ei < watch.length; ei++) {
        const e = watch[ei];
        const d = Math.hypot(e.x - n.pos.x, e.z - n.pos.z);
        if (d < 350 || d > 2200) continue;
        if (w.visible(eye, e)) out.push({ pos: n.pos.clone(), look: e.clone(), entrance: ei });
      }
    }
    if (!out.length) out.push({ pos: site.center.pos.clone(), look: watch[0]?.clone() ?? site.center.pos.clone().add(new Vec3(0, EYE, 0)), entrance: 0 });
    if (!avoid.length) return out;
    // Prefer close angles that only open up once the enemy is nearly on site.
    const safe = out.filter((s) => {
      const eye = s.pos.clone().add(new Vec3(0, EYE, 0));
      return s.look.distanceTo(eye) < 1300 && !avoid.some((a) => w.visible(eye, a));
    });
    return safe.length >= 3 ? safe : out;
  }

  // ---------------------------------------------------------------- queries used by bots

  siteAt(p: Vec3): string | null {
    return this.defusal?.siteAt(p) ?? null;
  }

  bombTimeLeft(): number {
    const b = this.defusal?.bomb;
    return b ? b.explodeAt - this.game.time : Infinity;
  }

  smokeBlocks(a: Vec3, b: Vec3): boolean {
    return this.game.grenades.smokeBlocks(a, b);
  }

  /** The site this bot's team is pushing, and the first entrance on its route, for utility. */
  siteEntranceFor(p: Player): { site: SitePlan; entrance: Vec3 } | null {
    const s = this.targetSite;
    if (!s || p.team !== 'T' || !s.tEntrances.length) return null;
    const e = s.tEntrances.reduce((a, b) => (a.distanceTo(p.origin) < b.distanceTo(p.origin) ? a : b));
    return { site: s, entrance: e };
  }

  /** Recent contacts a CT could smoke off: enemies seen on the approach to the site it holds. */
  pushingContact(p: Player): Vec3 | null {
    const now = this.game.time;
    const recent = this.contacts.filter((c) => c.enemy.team !== p.team && now - c.time < 3 && c.enemy.alive);
    if (recent.length < 2) return null;
    const c = recent.reduce((a, b) => (a.pos.distanceTo(p.origin) < b.pos.distanceTo(p.origin) ? a : b));
    const d = c.pos.distanceTo(p.origin);
    return d > 500 && d < 1600 ? c.pos.clone() : null;
  }

  /** A teammate-reported enemy that's out of this bot's sight but in grenade range. */
  grenadeTarget(p: Player): Vec3 | null {
    const now = this.game.time;
    for (const c of this.contacts) {
      if (c.enemy.team === p.team || now - c.time > 2 || !c.enemy.alive) continue;
      const d = c.pos.distanceTo(p.origin);
      if (d > 450 && d < 1300) return c.pos.clone();
    }
    return null;
  }

  private lineups = new Map<string, Lineup | null>();
  /** Lineup searches run so far, so planners can spread fresh ones over several ticks. */
  private lineupSearches = 0;

  /** Lineups are cached by where the thrower stands (its nav node) and the target, like a learned spot. */
  lineup(id: GrenadeId, eye: Vec3, target: Vec3): Lineup | null {
    const node = this.nav.nearest(eye.clone().add(new Vec3(0, -64, 0)));
    const key = `${id}:${node?.id ?? 'x'}:${Math.round(target.x / 32)}:${Math.round(target.z / 32)}`;
    if (!this.lineups.has(key)) {
      this.lineups.set(key, findLineup(this.game.world, id, eye, target));
      this.lineupSearches++;
    }
    return this.lineups.get(key)!;
  }

  randomNode(): NavNode {
    return this.nav.nodes[Math.floor(this.game.rand() * this.nav.nodes.length)];
  }

  /** A bot saw (or heard, at a fuzzed position) an enemy: share it with the team. */
  report(by: Player, enemy: Player, heardAt?: Vec3): void {
    const now = this.game.time;
    const pos = heardAt ?? enemy.origin;
    const known = this.contacts.find((c) => c.enemy === enemy);
    if (known) {
      known.pos.copy(pos);
      known.time = now;
    } else {
      this.contacts.push({ pos: pos.clone(), time: now, enemy });
      // Only call out real threats, not a speck at the far end of a sightline.
      if (!heardAt && enemy.origin.distanceTo(by.origin) < 2000) {
        const area = this.nav.nearest(enemy.origin)?.area;
        const what = enemy.weapons.c4 ? 'Bomb carrier spotted' : 'Enemy spotted';
        this.radio(by, area ? `${what}, ${area}!` : `${what}!`);
      }
    }
    const site = this.sites.find((s) => inZone(padZone(s.zone, 1000), pos));
    if (site) this.heat[by.team].set(site.zone.name, (this.heat[by.team].get(site.zone.name) ?? 0) + 1);
    if (by.team === 'CT') this.maybeRotate(pos, enemy.weapons.c4 && !heardAt ? 3 : 1);
  }

  /** Recent enemy position a teammate reported close to this bot, to look toward. */
  threatNear(p: Player): Vec3 | null {
    const now = this.game.time;
    let best: Contact | null = null;
    let bestD = 1500;
    for (const c of this.contacts) {
      if (c.enemy.team === p.team || now - c.time > 3 || !c.enemy.alive) continue;
      const d = c.pos.distanceTo(p.origin);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? best.pos.clone().add(new Vec3(0, EYE, 0)) : null;
  }

  private radio(p: Player, text: string): void {
    const now = this.game.time;
    if ((this.radioAt.get(p.team) ?? -10) > now - 6) return;
    this.radioAt.set(p.team, now);
    this.game.emit({ type: 'radio', player: p, text });
  }

  // ---------------------------------------------------------------- strategy

  update(dt: number): void {
    const d = this.defusal;
    for (let i = this.pendingRadio.length - 1; i >= 0; i--) {
      const r = this.pendingRadio[i];
      if (this.game.time < r.at) continue;
      this.pendingRadio.splice(i, 1);
      if (r.p.alive) this.game.emit({ type: 'radio', player: r.p, text: r.text });
    }
    if (this.mode instanceof Deathmatch) {
      for (const b of this.bots) {
        if (!b.p.alive) continue;
        if (b.task.kind !== 'hunt') {
          b.onSpawn();
          b.task = { kind: 'hunt', dest: null };
          if (!b.p.weapons.primary) this.mode.buy(b.p, this.game.rand() < 0.15 ? 'awp' : b.p.team === 'T' ? 'ak47' : 'm4a1');
        }
      }
    } else if (d) {
      const key = `${d.round}:${d.phase}`;
      if (key !== this.lastPhase) {
        this.lastPhase = key;
        if (d.phase === 'freeze' && d.round !== this.lastRound) {
          this.lastRound = d.round;
          this.roundStart(d);
        }
      }
      if (d.phase === 'live' && this.game.time >= this.nextStrategy) {
        this.nextStrategy = this.game.time + 0.25;
        this.midRound(d);
      }
    }
    for (const b of this.bots) if (b.p.alive) b.update(dt);
  }

  private roundStart(d: BombDefusal): void {
    const g = this.game;
    if (this.strat) {
      let hit = this.plantSite;
      if (!hit) {
        let best = 0;
        for (const [k, v] of this.heat.CT) if (v > best) [best, hit] = [v, k];
      }
      this.notes.push({ site: this.targetSite?.zone.name ?? null, strat: this.strat, tWon: d.lastWinner === 'T', hit });
      if (this.notes.length > 10) this.notes.shift();
    }
    this.contacts = [];
    this.rotated.clear();
    this.retakeIssued = false;
    this.retakeRelease = null;
    this.exec = null;
    this.strat = null;
    this.heat.T.clear();
    this.heat.CT.clear();
    this.plantSite = null;
    this.callAt = null;
    this.defaults.clear();
    this.fake = null;
    this.info = null;
    this.pendingTasks = [];
    this.ctAlive.clear();
    this.reacted.clear();
    for (const b of this.bots) b.onSpawn();

    // Shopping, as a team.
    for (const team of ['T', 'CT'] as const) {
      const mates = g.players.filter((p) => p.team === team);
      const avg = mates.reduce((a, p) => a + p.money, 0) / Math.max(1, mates.length);
      const pistolRound = d.round === 1 || (d.cfg.halftime > 0 && d.round === d.cfg.halftime + 1);
      const teamEco = avg < (team === 'T' ? 3000 : 3600);
      for (const b of this.bots) {
        if (b.p.team !== team) continue;
        const teamHasAwp = mates.some((p) => p.weapons.primary?.def.id === 'awp');
        botBuy(b.p, this.mode, { pistolRound, teamEco, lossStreak: d.lossStreak[team], teamHasAwp, rand: g.rand });
      }
    }

    if (!this.sites.length) {
      for (const b of this.bots) b.task = { kind: 'hunt', dest: null };
      return;
    }

    this.planT(d);
    this.planCT();
  }

  private onSiteTask(b: Bot, site: SitePlan): Task {
    const g = this.game;
    const dest = pick(site.nodes, g.rand).pos.clone();
    if (b.p.weapons.c4) return { kind: 'go', via: null, dest, then: { kind: 'plant', spot: dest } };
    const hold = pick(site.tHolds, g.rand);
    return { kind: 'go', via: null, dest, then: { kind: 'hold', spot: hold.pos, look: hold.look } };
  }

  /** Gather just short of the site, then everyone hits it together instead of trickling in. */
  private stageTask(b: Bot, site: SitePlan, route: NavNode[], then: Task = this.onSiteTask(b, site)): Task {
    const g = this.game;
    const stage = stagingPoint(route, site.zone, 550 + g.rand() * 350);
    const spread = new Vec3((g.rand() - 0.5) * 80, 0, (g.rand() - 0.5) * 80);
    const spot = this.nav.nearest(stage.pos.clone().add(spread))?.pos.clone() ?? stage.pos.clone();
    return { kind: 'stage', spot, look: site.center.pos.clone().add(new Vec3(0, EYE, 0)), then };
  }

  /** Routes into a site that come in through different entrances, main one first. */
  private distinctRoutes(site: SitePlan): NavNode[][] {
    const out: NavNode[][] = [];
    const ins: Vec3[] = [];
    for (const r of site.tRoutes) {
      const i = r.findIndex((n) => inZone(site.zone, n.pos));
      const at = r[Math.max(0, i)].pos;
      if (ins.every((p) => p.distanceTo(at) > 400)) {
        out.push(r);
        ins.push(at);
      }
    }
    return out;
  }

  private planT(d: BombDefusal): void {
    const g = this.game;
    // The bomb carrier goes first so it always lands in the main group.
    const ts = this.bots.filter((b) => b.p.team === 'T').sort((a, b) => Number(!!b.p.weapons.c4) - Number(!!a.p.weapons.c4));
    const pistol = d.round === 1 || (d.cfg.halftime > 0 && d.round === d.cfg.halftime + 1);
    const eco = ts.filter((b) => b.p.weapons.primary).length < ts.length / 2;
    const strat = this.forceStrat ?? chooseTStrat({ eco, pistol, ts: ts.length, sites: this.sites.length, history: this.notes, rand: g.rand });
    this.strat = strat;
    const name = chooseSite(this.sites.map((x) => x.zone.name), this.notes, g.rand);
    const site = this.sites.find((s) => s.zone.name === name)!;
    this.targetSite = site;
    const live = d.phaseEnd;
    const routes = this.distinctRoutes(site);
    // Not always the same way in: the main route most of the time, another now and then.
    const main = routes.length > 1 && g.rand() < 0.35 ? routes[1] : routes[0];
    const other = routes.find((r) => r !== main) ?? main;
    const caller = ts[0];

    switch (strat) {
      case 'rush':
        ts.forEach((b, i) => {
          const r = i < Math.ceil(ts.length * 0.7) ? main : other;
          const onSite = this.onSiteTask(b, site);
          // Straight down the route with no stop: the via point keeps them on it.
          const task: Task = { kind: 'go', via: r[Math.floor(r.length * 0.6)].pos.clone(), dest: (onSite as { dest: Vec3 }).dest, then: (onSite as { then: Task }).then };
          if (b.p.weapons.c4 && ts.length > 1) {
            // Carrier trails the pack by a second or so.
            b.task = { kind: 'hold', spot: b.p.origin.clone(), look: site.center.pos.clone().add(new Vec3(0, EYE, 0)) };
            this.pendingTasks.push({ at: live + 1 + g.rand() * 0.8, b, task, expect: b.task });
          } else b.task = task;
        });
        if (caller) this.later(live - g.time + 0.5, caller.p, `Rush ${site.zone.name}, don't stop!`);
        return;
      case 'default': {
        // Spread out and take map control, then call a site on what we learn.
        const pairs = shuffle(this.sites.flatMap((s) => this.distinctRoutes(s).slice(0, 2).map((r) => ({ s, r }))), g.rand);
        ts.forEach((b, i) => {
          const { s, r } = pairs[i % pairs.length];
          const spot = stagingPoint(r, s.zone, 1100 + g.rand() * 500).pos.clone();
          const look = stagingPoint(r, s.zone, 500).pos.clone().add(new Vec3(0, EYE, 0));
          const hold: Task = { kind: 'hold', spot, look };
          b.task = { kind: 'go', via: null, dest: spot, then: hold };
          this.defaults.set(b, hold);
        });
        this.callAt = live + 15 + g.rand() * 18;
        return;
      }
      case 'fake': {
        const fakeSite = this.sites.find((s) => s !== site);
        const fakers = fakeSite ? ts.filter((b) => !b.p.weapons.c4).slice(-2) : [];
        if (fakeSite && fakers.length === 2) {
          const fr = this.distinctRoutes(fakeSite)[0];
          for (const b of fakers) b.task = this.stageTask(b, fakeSite, fr, { kind: 'hunt', dest: null });
          this.fake = { site: fakeSite, bots: fakers, done: false };
        }
        for (const b of ts) if (!fakers.includes(b)) b.task = this.stageTask(b, site, main);
        this.exec = { phase: 'gather', release: 0, notBefore: this.fake ? Infinity : live };
        return;
      }
      case 'split':
        // Two groups through two entrances, meeting on site. Needs two ways in, else it's an execute.
        if (routes.length > 1) {
          ts.forEach((b, i) => (b.task = this.stageTask(b, site, i < Math.ceil(ts.length / 2) ? main : other)));
          this.exec = { phase: 'gather', release: 0, notBefore: live + 5 + g.rand() * 15 };
          return;
        }
        this.strat = 'execute';
        this.planExecute(ts, site, main, live);
        return;
      case 'execute':
        this.planExecute(ts, site, main, live);
    }
  }

  private planExecute(ts: Bot[], site: SitePlan, main: NavNode[], live: number): void {
    const g = this.game;
    const lurk = ts.length >= 4 && g.rand() < 0.35 ? ts[ts.length - 1] : null;
    for (const b of ts) {
      if (b === lurk) {
        const lurkSite = this.sites.find((s) => s !== site) ?? site;
        const r = pick(this.distinctRoutes(lurkSite), g.rand);
        const spot = r[Math.floor(r.length * (0.5 + g.rand() * 0.2))].pos.clone();
        b.task = { kind: 'go', via: null, dest: spot, then: { kind: 'hold', spot, look: lurkSite.center.pos.clone().add(new Vec3(0, EYE, 0)) } };
      } else b.task = this.stageTask(b, site, main);
    }
    // Some rounds hit fast, some wait out the CTs.
    this.exec = { phase: 'gather', release: 0, notBefore: live + g.rand() * 25 };
  }

  private planCT(): void {
    const g = this.game;
    const cts = shuffle(this.bots.filter((b) => b.p.team === 'CT'), g.rand);
    const { counts, stacked } = ctSetup(this.sites.map((s) => s.zone.name), cts.length, this.notes, g.rand);
    const taken: Vec3[] = [];
    const perSite = new Map<SitePlan, number>();
    const assigned: { b: Bot; s: SitePlan; h: Spot }[] = [];
    let i = 0;
    for (const s of this.sites) {
      for (let k = 0; k < (counts.get(s.zone.name) ?? 0) && i < cts.length; k++) {
        const b = cts[i++];
        // Cover the site's entrances in turn, so two CTs on one site watch different ways in.
        const n = perSite.get(s) ?? 0;
        perSite.set(s, n + 1);
        const entrance = s.tEntrances.length ? (n + Math.floor(g.rand() * 2)) % s.tEntrances.length : 0;
        const free = (h: Spot) => taken.every((t) => t.distanceTo(h.pos) > 180);
        // Somewhere other than last round's spots: the Ts remember where they died too.
        const fresh = (h: Spot) => this.lastHolds.every((t) => t.distanceTo(h.pos) > 200);
        const tiers = [
          s.ctHolds.filter((h) => h.entrance === entrance && free(h) && fresh(h)),
          s.ctHolds.filter((h) => free(h) && fresh(h)),
          s.ctHolds.filter((h) => h.entrance === entrance && free(h)),
          s.ctHolds.filter(free),
          s.ctHolds,
        ];
        const h = pick(tiers.find((t) => t.length)!, g.rand);
        taken.push(h.pos);
        b.task = { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() };
        assigned.push({ b, s, h });
      }
    }
    this.lastHolds = taken;
    if (stacked && assigned[0]) this.later(3 + g.rand() * 3, assigned[0].b.p, `Stacking ${stacked} this round.`);

    // Now and then someone takes an early look down a T route, flashing their way in.
    const peekers = assigned.filter((a) => (perSite.get(a.s) ?? 0) >= 2);
    if (peekers.length && g.rand() < 0.35) {
      const { b, s, h } = pick(peekers, g.rand);
      const r = pick(this.distinctRoutes(s), g.rand);
      const dist = 700 + g.rand() * 300;
      const pre = stagingPoint(r, s.zone, dist - 280).pos.clone();
      const task: Task = { kind: 'hold', spot: pre, look: stagingPoint(r, s.zone, dist).pos.clone().add(new Vec3(0, EYE, 0)) };
      b.task = { kind: 'go', via: null, dest: pre, then: task };
      this.info = { bot: b, task, pre, peek: stagingPoint(r, s.zone, dist).pos.clone(), flashAt: stagingPoint(r, s.zone, dist + 450).pos.clone(), stage: 'pre', since: 0, home: h };
    }
  }

  /** Unarmed bots go for guns lying nearby: fy_ spawns, or a dead player's rifle. */
  private grabWeapons(maxDist: number): void {
    const claimed = new Set(this.bots.map((b) => (b.task.kind === 'grab' ? b.task.pos : null)).filter(Boolean));
    for (const b of this.bots) {
      const p = b.p;
      if (!p.alive || p.weapons.primary || b.enemy || !['hunt', 'idle', 'hold', 'go'].includes(b.task.kind)) continue;
      let best: Vec3 | null = null;
      let bestD = maxDist;
      for (const d of this.game.dropped) {
        if (d.state.def.slot !== 'primary' || claimed.has(d.pos) || this.game.time < d.pickupAt) continue;
        const dist = d.pos.distanceTo(p.origin);
        if (dist < bestD) {
          bestD = dist;
          best = d.pos;
        }
      }
      if (best) {
        claimed.add(best);
        b.task = { kind: 'grab', pos: best, then: b.task };
      }
    }
  }

  private pendingRadio: { at: number; p: Player; text: string }[] = [];

  /** Radio reply after a delay in game time, so it stays deterministic in headless sims. */
  private later(secs: number, p: Player, text: string): void {
    this.pendingRadio.push({ at: this.game.time + secs, p, text });
  }

  /** A human used the radio: teammate bots react like a cooperative 1.6 team would. */
  command(from: Player, cmd: RadioCommand): void {
    const g = this.game;
    const mates = this.bots.filter((b) => b.p.alive && b.p.team === from.team && b.p !== from);
    if (!mates.length) return;
    const byDist = [...mates].sort((a, b) => a.p.origin.distanceTo(from.origin) - b.p.origin.distanceTo(from.origin));
    const follow = (b: Bot, secs = 45) => (b.task = { kind: 'follow', leader: from, until: g.time + secs });
    const ack = (b: Bot | undefined, text = 'Affirmative.') => {
      if (!b) return;
      // A beat before answering, like someone keying the mic.
      this.later(0.5 + g.rand() * 0.7, b.p, text);
    };
    const site = (name: string) => this.sites.find((s) => s.zone.name === name);
    const sendTo = (s: SitePlan, bots: Bot[]) => {
      for (const b of bots) {
        if (from.team === 'T') {
          const dest = pick(s.nodes, g.rand).pos.clone();
          b.task = b.p.weapons.c4 ? { kind: 'go', via: null, dest, then: { kind: 'plant', spot: dest } } : { kind: 'go', via: null, dest, then: { kind: 'hunt', dest: null } };
        } else {
          const h = pick(s.ctHolds, g.rand);
          b.task = { kind: 'go', via: null, dest: h.pos.clone(), then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
        }
      }
      if (from.team === 'T') this.targetSite = s;
    };

    switch (cmd) {
      case 'coverme':
      case 'needbackup':
      case 'takingfire':
        for (const b of byDist.slice(0, cmd === 'coverme' ? 1 : 2)) follow(b, 25);
        ack(byDist[0], cmd === 'coverme' ? 'Affirmative.' : 'On my way!');
        break;
      case 'followme':
        for (const b of byDist.slice(0, 2)) follow(b);
        ack(byDist[0]);
        break;
      case 'regroup':
      case 'sticktogether':
        for (const b of mates) follow(b);
        ack(byDist[0]);
        break;
      case 'holdpos':
      case 'getinpos':
        for (const b of byDist.slice(0, cmd === 'holdpos' ? 2 : mates.length)) {
          const f = new Vec3();
          angleVectors(b.p.yaw, 0, f);
          b.task = { kind: 'hold', spot: b.p.origin.clone(), look: b.p.eye().addScaled(f, 400) };
        }
        ack(byDist[0], "I'm in position.");
        break;
      case 'takepoint':
        if (byDist[0]) byDist[0].task = { kind: 'hunt', dest: from.eye().clone() };
        ack(byDist[0]);
        break;
      case 'gogogo':
      case 'stormfront':
        if (from.team === 'T' && this.targetSite) sendTo(this.targetSite, mates);
        else for (const b of mates) b.task = { kind: 'hunt', dest: null };
        ack(byDist[0], 'Roger that.');
        break;
      case 'goa':
      case 'gob': {
        const s = site(cmd === 'goa' ? 'A' : 'B');
        if (s) sendTo(s, mates);
        ack(byDist[0], `Going ${cmd === 'goa' ? 'A' : 'B'}.`);
        break;
      }
      case 'fallback': {
        const spawn = g.map.spawns[from.team][0].pos;
        for (const b of mates) b.task = { kind: 'go', via: null, dest: spawn.clone(), then: { kind: 'hunt', dest: null } };
        ack(byDist[0]);
        break;
      }
      case 'reportin':
        mates.slice(0, 3).forEach((b, i) => this.later(0.6 + i * 0.7, b.p, b.enemy && b.enemy.alive ? 'Enemy spotted.' : 'Reporting in.'));
        break;
      case 'enemyspotted': {
        // Mark whatever you're looking at as a contact for the team.
        const f = new Vec3();
        angleVectors(from.yaw, from.pitch, f);
        const eye = from.eye();
        const hit = g.world.trace(eye, eye.clone().addScaled(f, 3000));
        const at = hit.endpos.clone();
        for (const e of g.players) if (e.alive && e.team !== from.team && e.origin.distanceTo(at) < 600) this.report(from, e, e.origin);
        break;
      }
    }
  }

  private midRound(d: BombDefusal): void {
    const g = this.game;
    const now = g.time;
    this.grabWeapons(this.sites.length ? 450 : 3000);
    this.contacts = this.contacts.filter((c) => now - c.time < 10 && c.enemy.alive);

    // Bomb on the ground: nearest living T bot goes to get it.
    const loose = d.looseC4;
    if (loose && !d.bomb) {
      const ts = this.bots.filter((b) => b.p.team === 'T' && b.p.alive);
      // Track where it ends up: a dropped bomb is still falling (or sliding) when it's first seen.
      const fetcher = ts.find((b) => b.task.kind === 'fetch');
      if (fetcher?.task.kind === 'fetch') fetcher.task.pos.copy(loose);
      else if (ts.length) {
        const near = ts.reduce((a, b) => (a.p.origin.distanceTo(loose) < b.p.origin.distanceTo(loose) ? a : b));
        near.task = { kind: 'fetch', pos: loose.clone() };
      }
    }
    // Whoever picked it up heads for the site to plant.
    for (const b of this.bots) {
      if (b.p.team === 'T' && b.p.weapons.c4 && !this.defaults.has(b) && (b.task.kind === 'fetch' || b.task.kind === 'hold' || b.task.kind === 'hunt' || b.task.kind === 'idle')) {
        const site = this.targetSite ?? this.sites[0];
        if (!site) continue;
        const dest = pick(site.nodes, g.rand).pos.clone();
        b.task = { kind: 'go', via: null, dest, then: { kind: 'plant', spot: dest } };
      }
    }

    // Planted: CTs retake and defuse, Ts fall back to post-plant spots.
    if (d.bomb && !this.retakeIssued) {
      this.retakeIssued = true;
      const bomb = d.bomb.pos.clone();
      const site = this.sites.find((s) => inZone(s.zone, bomb)) ?? this.sites[0];
      this.plantSite = site.zone.name;
      this.pendingTasks = [];
      this.info = null;
      const cts = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive);
      // Kit holder (or whoever's closest) defuses, the rest clear the site.
      const defuser = cts.find((b) => b.p.defuser) ?? cts.sort((a, b) => a.p.origin.distanceTo(bomb) - b.p.origin.distanceTo(bomb))[0];
      // Group up outside the site first: one CT at a time walking into a post-plant is a free kill.
      this.retakeStart = g.time;
      cts.forEach((b, i) => {
        const then: Task = b === defuser ? { kind: 'defuse', bomb } : { kind: 'hunt', dest: pick(site.nodes, g.rand).pos.clone() };
        const inside = inZone(padZone(site.zone, 200), b.p.origin);
        // Come from two sides when there are enough of us and the second way in isn't much longer.
        const ways = [...site.ctEntrances].sort((a, e) => a.distanceTo(b.p.origin) - e.distanceTo(b.p.origin));
        const second = ways[1] && i % 2 === 1 && cts.length >= 3 && ways[1].distanceTo(b.p.origin) < ways[0].distanceTo(b.p.origin) * 1.7;
        const entry = (second ? ways[1] : ways[0]) ?? null;
        const node = entry ? this.nav.nearest(entry.clone().add(new Vec3(0, -EYE, 0))) : null;
        b.task = inside || !node ? then : { kind: 'stage', spot: node.pos.clone(), look: bomb.clone().add(new Vec3(0, EYE, 0)), then };
      });
      for (const b of this.bots) {
        if (b.p.team !== 'T' || !b.p.alive) continue;
        const h = pick(site.tHolds, g.rand);
        b.task = { kind: 'go', via: null, dest: h.pos.clone(), then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
      }
    }
    for (let i = this.pendingTasks.length - 1; i >= 0; i--) {
      const o = this.pendingTasks[i];
      if (now < o.at) continue;
      this.pendingTasks.splice(i, 1);
      if (o.b.p.alive && o.b.task === o.expect) o.b.task = o.task;
    }
    // A CT going down tells the others where the Ts are.
    for (const p of g.players) {
      if (p.team !== 'CT') continue;
      if (p.alive) this.ctAlive.add(p);
      else if (this.ctAlive.delete(p) && !d.bomb) this.maybeRotate(p.origin, 2);
    }
    if (!d.bomb) {
      this.defaultCall(d);
      this.runFake(d);
      this.runInfo();
      this.reposition();
    }
    // A lone CT who sees two or more coming backs off toward the CT side and plays for the retake,
    // instead of dying 1v3 on a site nobody else is holding.
    if (!d.bomb) {
      for (const b of this.bots) {
        if (b.p.team !== 'CT' || !b.p.alive || b.fellBack || b.task.kind !== 'hold' || b.visibleCount < 2) continue;
        const mates = this.bots.filter((o) => o !== b && o.p.alive && o.p.team === 'CT' && o.p.origin.distanceTo(b.p.origin) < 700).length;
        if (mates >= b.visibleCount - 1) continue;
        const site = this.sites.find((s) => inZone(padZone(s.zone, 600), b.p.origin));
        if (!site || !site.ctEntrances.length) continue;
        const back = site.ctEntrances.reduce((a, e) => (a.distanceTo(b.p.origin) < e.distanceTo(b.p.origin) ? a : e));
        const node = this.nav.nearest(back.clone().add(new Vec3(0, -EYE, 0)));
        if (!node) continue;
        b.fellBack = true;
        b.task = { kind: 'go', via: null, dest: node.pos.clone(), then: { kind: 'hold', spot: node.pos.clone(), look: site.center.pos.clone().add(new Vec3(0, EYE, 0)) } };
        this.radio(b.p, 'Falling back!');
      }
    }
    // T execute: gather, then utility, then everyone goes as the flashes pop. Close contact at
    // the stage skips straight to the go, since waiting on lineups while getting shot is how you
    // lose a round. A fight on the way there, or a long duel from the stage, is just that bot's fight.
    if (!d.bomb && this.exec) {
      const staged = this.bots.filter((b) => b.p.team === 'T' && b.p.alive && b.task.kind === 'stage' && !this.fake?.bots.includes(b));
      const contact = staged.some((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 500 && b.enemy && b.enemy.alive && b.enemy.origin.distanceTo(b.p.origin) < 1000 && now - b.lastSeenTime() < 1);
      const go = () => {
        for (const b of staged) {
          if (b.task.kind !== 'stage') continue;
          // The bomb goes in second, behind someone who can take the first fight.
          if (b.p.weapons.c4 && staged.length > 1) this.pendingTasks.push({ at: now + 0.8 + g.rand() * 0.6, b, task: b.task.then, expect: b.task });
          else b.task = b.task.then;
        }
        const caller = staged.find((b) => !b.p.weapons.c4) ?? staged[0];
        if (caller && this.targetSite) this.radio(caller.p, `Go go go! Hitting ${this.targetSite.zone.name}!`);
        this.exec = null;
      };
      if (!staged.length) this.exec = null;
      else if (contact) go();
      else if (this.exec.phase === 'gather') {
        const ready = staged.every((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 220);
        const late = now - d.roundStart > 50 || d.timeLeft < 50;
        if ((ready && now >= this.exec.notBefore) || late) this.exec = { phase: 'plan', release: 0, notBefore: 0, plan: this.executeUtility(staged, this.targetSite) };
      }
      if (this.exec?.phase === 'plan') {
        const r = this.exec.plan!.next();
        if (r.done) this.exec = { phase: 'util', release: r.value.release, notBefore: 0, flash: { ...r.value, since: now } };
      }
      if (this.exec?.phase === 'util' && now >= this.releaseTime(this.exec.release, this.exec.flash!, staged)) go();
    }
    // Release the retake once everyone's staged (or the clock forces it), flashing the site first.
    if (d.bomb && !d.bomb.defused) {
      const staged = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive && b.task.kind === 'stage');
      if (staged.length) {
        const ready = staged.every((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 200);
        const late = this.bombTimeLeft() < 18 || g.time - this.retakeStart > 12;
        if (this.retakeRelease === null && (ready || late)) {
          const flashers = late && this.bombTimeLeft() < 12 ? [] : staged.filter((b) => (b.p.grenades.flashbang ?? 0) > 0).slice(0, 2);
          flashers.forEach((b, i) => b.plans.push({ id: 'flashbang', target: d.bomb!.pos.clone(), at: now + i * 0.3 }));
          this.retakeRelease = flashers.length ? now + 0.3 * flashers.length + 1.1 : now;
          if (flashers.length) this.radio(flashers[0].p, 'Flashing in, go on the pop!');
        }
        if (this.retakeRelease !== null && now >= this.retakeRelease) for (const b of staged) if (b.task.kind === 'stage') b.task = b.task.then;
      }
    }
    // Once the Ts are all dead, every CT goes for the bomb.
    if (d.bomb && !g.players.some((p) => p.team === 'T' && p.alive)) {
      for (const b of this.bots) if (b.p.team === 'CT' && b.p.alive && b.task.kind !== 'defuse') b.task = { kind: 'defuse', bomb: d.bomb.pos.clone() };
    }
    // Late round with no plant: Ts stop waiting and go.
    if (!d.bomb && d.timeLeft < 25) {
      for (const b of this.bots) if (b.p.team === 'T' && b.task.kind === 'hold') b.task = { kind: 'hunt', dest: this.targetSite?.center.pos.clone() ?? null };
    }
    // The last CT alive hunts instead of waiting to be executed.
    const ctsAlive = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive);
    if (ctsAlive.length === 1 && !g.players.some((p) => !p.isBot && p.team === 'CT' && p.alive) && ctsAlive[0].task.kind === 'hold' && d.timeLeft < 40) {
      ctsAlive[0].task = { kind: 'hunt', dest: null };
    }
  }

  /** Default: once the map's been felt out, commit to whichever site showed fewer CTs. */
  private defaultCall(d: BombDefusal): void {
    const g = this.game;
    if (this.callAt === null) return;
    const out = [...this.defaults].filter(([b, t]) => b.p.alive && (b.task === t || (b.task.kind === 'go' && b.task.then === t)));
    // Losing someone early forces the call.
    const lost = this.bots.some((b) => b.p.team === 'T' && !b.p.alive);
    if (g.time < this.callAt && !(lost && g.time > d.roundStart + 8)) return;
    this.callAt = null;
    this.defaults.clear();
    if (!out.length) return;
    const seen = (s: SitePlan) => (this.heat.T.get(s.zone.name) ?? 0) + g.rand() * 3;
    const site = [...this.sites].sort((a, b) => seen(a) - seen(b))[0];
    this.targetSite = site;
    const routes = this.distinctRoutes(site);
    for (const [b] of out) {
      const r = routes.reduce((a, x) => (stagingPoint(a, site.zone).pos.distanceTo(b.p.origin) < stagingPoint(x, site.zone).pos.distanceTo(b.p.origin) ? a : x));
      b.task = this.stageTask(b, site, r);
    }
    this.exec = { phase: 'gather', release: 0, notBefore: g.time };
    this.radio(out[0][0].p, `${site.zone.name} looks light, everyone ${site.zone.name}!`);
  }

  /** Fake: the pair throws their utility at the other site and shows up there, then the real hit waits for the rotation. */
  private runFake(d: BombDefusal): void {
    const f = this.fake;
    if (!f || f.done) return;
    const g = this.game;
    const now = g.time;
    const fakers = f.bots.filter((b) => b.p.alive && b.task.kind === 'stage');
    const give = () => {
      f.done = true;
      if (this.exec) this.exec.notBefore = now + 3 + g.rand() * 4;
    };
    if (!fakers.length) return give();
    if (!f.plan && f.release === undefined) {
      const ready = fakers.every((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 220);
      if (ready || now - d.roundStart > 40) f.plan = this.executeUtility(fakers, f.site);
    }
    if (f.plan) {
      const r = f.plan.next();
      if (r.done) {
        f.plan = undefined;
        f.release = r.value.release;
      }
    }
    if (f.release !== undefined && now >= f.release) {
      // Step into the entrance so they get seen, then peel off toward the real site.
      const entrance = f.site.tEntrances.reduce((a, e) => (a.distanceTo(fakers[0].p.origin) < e.distanceTo(fakers[0].p.origin) ? a : e));
      const spot = this.nav.nearest(entrance.clone().add(new Vec3(0, -EYE, 0)))?.pos ?? entrance;
      const join: Task = { kind: 'go', via: null, dest: (this.targetSite ?? f.site).center.pos.clone(), then: { kind: 'hunt', dest: null } };
      for (const b of fakers) b.task = { kind: 'go', via: null, dest: spot.clone(), then: { kind: 'hold', spot: spot.clone(), look: f.site.center.pos.clone().add(new Vec3(0, EYE, 0)), until: now + 4 + g.rand() * 3, then: join } };
      give();
    }
  }

  /** CT info peek: flash out from behind cover, swing, have a look, get back to site. */
  private runInfo(): void {
    const inf = this.info;
    if (!inf) return;
    const g = this.game;
    const b = inf.bot;
    const onTask = b.task === inf.task || (b.task.kind === 'go' && b.task.then === inf.task);
    if (!b.p.alive || !onTask) {
      this.info = null;
      return;
    }
    if (inf.stage === 'pre') {
      if (b.p.origin.distanceTo(inf.pre) > 120) return;
      inf.stage = 'flash';
      inf.since = g.time;
      if ((b.p.grenades.flashbang ?? 0) > 0) b.plans.push({ id: 'flashbang', target: inf.flashAt, at: g.time });
      return;
    }
    const thrown = b.lastThrow.id === 'flashbang' && b.lastThrow.time >= inf.since;
    if (!(thrown && g.time - b.lastThrow.time > 0.9) && g.time - inf.since < 4) return;
    const h = inf.home;
    const home: Task = { kind: 'go', via: null, dest: h.pos.clone(), quiet: true, then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
    b.task = { kind: 'go', via: null, dest: inf.peek.clone(), then: { kind: 'hold', spot: inf.peek.clone(), look: inf.flashAt.clone().add(new Vec3(0, EYE, 0)), until: g.time + 3 + g.rand() * 4, then: home } };
    this.info = null;
  }

  /** A CT who just fought from a spot often moves off it: the Ts know exactly where it is now. */
  private reposition(): void {
    const g = this.game;
    const now = g.time;
    for (const b of this.bots) {
      const t = b.task;
      if (b.p.team !== 'CT' || !b.p.alive || t.kind !== 'hold' || t.until !== undefined) continue;
      const last = b.lastSeenTime();
      if (now - last < 1.5 || now - last > 3 || this.reacted.get(b) === last) continue;
      this.reacted.set(b, last);
      if (g.rand() < 0.5 || b.p.origin.distanceTo(t.spot) > 100) continue;
      const site = this.sites.find((s) => inZone(padZone(s.zone, 700), t.spot));
      const alts = site?.ctHolds.filter((h) => h.pos.distanceTo(t.spot) > 250 && h.pos.distanceTo(t.spot) < 900) ?? [];
      if (!alts.length) continue;
      const h = pick(alts, g.rand);
      b.task = { kind: 'go', via: null, dest: h.pos.clone(), quiet: true, then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
    }
  }

  /**
   * Hand out the execute's utility and return when the entry should go. Smokes cut the lines
   * from the holds that watch the entrance we're using (and the CT rotation into the site), an
   * HE goes into the hold cluster, flashes pop over the site once the smokes have bloomed, and
   * the entry is timed to come round the corner as the flashes go off. Runs over a few ticks,
   * one fresh lineup search per tick, so the execute doesn't hitch the frame it starts on.
   */
  private *executeUtility(staged: Bot[], site: SitePlan | null): Generator<void, UtilityPlan> {
    if (!site || !site.tEntrances.length) return { release: this.game.time, flashers: [], entrance: null };
    const w = this.game.world;
    const centroid = staged.reduce((a, b) => a.add(b.p.origin), new Vec3()).scale(1 / staged.length);
    const entrance = site.tEntrances.reduce((a, e) => (a.distanceTo(centroid) < e.distanceTo(centroid) ? a : e));
    const entranceGround = this.nav.nearest(entrance.clone().add(new Vec3(0, -EYE, 0)))?.pos ?? entrance;

    // Cross smokes: the holds that can see this entrance from a distance, blocked partway along.
    const watchers = site.ctHolds.filter((h) => h.pos.distanceTo(entranceGround) > 500 && w.visible(h.pos.clone().add(new Vec3(0, EYE, 0)), entrance));
    const smokes: Vec3[] = [];
    for (const h of watchers) {
      const spot = this.nav.nearest(along(entranceGround, h.pos, 320))?.pos;
      if (spot && smokes.every((s) => s.distanceTo(spot) > 320)) smokes.push(spot);
      if (smokes.length >= 4) break;
    }
    if (site.ctEntrances.length) {
      const ct = site.ctEntrances.reduce((a, e) => (a.distanceTo(entrance) > e.distanceTo(entrance) ? a : e));
      const spot = this.nav.nearest(ct.clone().add(new Vec3(0, -EYE, 0)))?.pos;
      if (spot && smokes.every((s) => s.distanceTo(spot) > 320)) smokes.push(spot);
    }

    const has = (b: Bot, id: GrenadeId) => (b.p.grenades[id] ?? 0) > 0;
    const used = new Set<Bot>();
    // The bomb carrier keeps his hands free if anyone else can throw.
    const throwers = (id: GrenadeId) => [...staged].sort((a, b) => Number(!!a.p.weapons.c4) - Number(!!b.p.weapons.c4)).filter((b) => has(b, id));
    // Only hand a throw to someone who actually has a lineup for it from where they stand.
    const canThrow = (b: Bot, id: GrenadeId, target: Vec3) => b.p.alive && !!solveThrow(b.p.eye(), target) && !!this.lineup(id, b.p.eye(), target);
    const picks: { b: Bot; id: GrenadeId; target: Vec3 }[] = [];
    let searched = this.lineupSearches;
    for (const target of smokes) {
      if (picks.length >= 2) break;
      for (const b of throwers('smokegrenade')) {
        if (used.has(b)) continue;
        const ok = canThrow(b, 'smokegrenade', target);
        if (this.lineupSearches !== searched) {
          searched = this.lineupSearches;
          yield;
        }
        if (!ok) continue;
        used.add(b);
        picks.push({ b, id: 'smokegrenade', target });
        break;
      }
    }
    const smoked = picks.length;
    // An HE into the hold cluster, or failing that into whichever single hold someone can reach.
    const heTargets = watchers.length ? [watchers.reduce((a, h) => a.add(h.pos), new Vec3()).scale(1 / watchers.length), ...watchers.slice(0, 3).map((h) => h.pos)] : [];
    heSearch: for (const target of heTargets) {
      for (const b of [...throwers('hegrenade')].sort((a, b) => Number(used.has(a)) - Number(used.has(b)))) {
        const ok = canThrow(b, 'hegrenade', target);
        if (this.lineupSearches !== searched) {
          searched = this.lineupSearches;
          yield;
        }
        if (!ok) continue;
        picks.push({ b, id: 'hegrenade', target });
        used.add(b);
        break heSearch;
      }
    }
    const now = this.game.time;
    let t = now;
    for (const x of picks) {
      if (!x.b.p.alive) continue;
      x.b.plans.push({ id: x.id, target: x.target, at: t });
      t += 0.35;
    }
    // Flashes once the smokes are up (they take ~1.5s to land and bloom).
    let flashAt = smoked ? now + 1.8 : t;
    let flashes = 0;
    const flashers: Bot[] = [];
    // Whoever has the least to do throws them; a smoker can follow up with a flash.
    for (const b of throwers('flashbang').sort((a, b) => a.plans.length - b.plans.length)) {
      if (flashes >= 2) break;
      if (!b.p.alive) continue;
      b.plans.push({ id: 'flashbang', target: site.center.pos.clone(), at: flashAt });
      flashers.push(b);
      flashAt += 0.35;
      flashes++;
    }
    const caller = staged[0];
    if (caller && (smoked || flashes)) this.radio(caller.p, `${smoked ? 'Smokes out' : 'Flash out'} on ${site.zone.name}, go on the pop!`);
    // A first guess for the go; with flashes out, releaseTime() times it off the real throws.
    const release = flashes ? flashAt - 0.35 + 0.5 + 1.1 : smoked ? now + 2.5 : now;
    return { release, flashers, entrance };
  }

  /**
   * When the entry goes: once every flash is out of someone's hand, early enough that the
   * nearest player reaches the corner just after they pop (1.5s fuse) and not into them.
   */
  private releaseTime(guess: number, plan: UtilityPlan & { since: number }, staged: Bot[]): number {
    const now = this.game.time;
    if (!plan.flashers.length || !plan.entrance) return guess;
    const thrown: number[] = [];
    for (const b of plan.flashers) {
      if (b.lastThrow.id === 'flashbang' && b.lastThrow.time >= plan.since) thrown.push(b.lastThrow.time);
      // Still to throw (unless they died or it's taking far too long).
      else if (b.p.alive && (b.p.grenades.flashbang ?? 0) > 0 && now < plan.since + 6) return Infinity;
    }
    if (!thrown.length) return now;
    const lead = Math.min(...staged.map((b) => b.p.origin.distanceTo(plan.entrance!))) / 250;
    return Math.max(...thrown) + 1.5 - lead + 0.15;
  }

  /**
   * CTs rotate toward a site as the Ts show themselves on its approach: one confirmed enemy moves
   * one player, more contacts move more, a teammate dying there counts double and the bomb
   * carrier sends everyone. They go one after another, not in a pack, and walk in at the end.
   */
  private maybeRotate(at: Vec3, weight = 1): void {
    const d = this.defusal;
    if (!d || d.bomb || d.phase !== 'live') return;
    const node = this.nav.nearest(at);
    if (!node) return;
    const g = this.game;
    const now = g.time;
    for (const s of this.sites) {
      const near = (p: Vec3) => {
        const n = this.nav.nearest(p);
        return (n && s.approach.has(n.id)) || inZone(padZone(s.zone, 300), p);
      };
      if (!near(at)) continue;
      const seen = this.contacts.filter((c) => now - c.time < 6 && c.enemy.alive && near(c.pos)).length;
      if (seen < 1 && weight < 2) continue;
      const want = Math.max(seen, 1) + weight - 1;
      const sent = this.rotated.get(s.zone.name) ?? 0;
      const others = this.bots
        .filter((b) => b.p.team === 'CT' && b.p.alive && b.task.kind === 'hold' && b.task.until === undefined && !inZone(padZone(s.zone, 900), b.task.spot) && !this.pendingTasks.some((o) => o.b === b))
        .sort((a, b) => a.p.origin.distanceTo(s.center.pos) - b.p.origin.distanceTo(s.center.pos));
      // Someone stays home unless it's clearly all coming here.
      const keep = others.length > 1 && weight < 3 ? 1 : 0;
      const n = Math.min(others.length - keep, want - sent);
      if (n <= 0) continue;
      this.rotated.set(s.zone.name, sent + n);
      others.slice(0, n).forEach((b, i) => {
        const h = pick(s.ctHolds, g.rand);
        const task: Task = { kind: 'go', via: null, dest: h.pos.clone(), quiet: true, then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
        this.pendingTasks.push({ at: now + 0.2 + i * 0.9 + g.rand() * 0.8, b, task, expect: b.task });
        if (i === 0) this.radio(b.p, `Rotating to ${s.zone.name}!`);
      });
    }
  }
}

/** A node on the route about `dist` before it enters the site (out of the defenders' sight at the default). */
function stagingPoint(route: NavNode[], zone: Zone, dist = 650): NavNode {
  const enter = route.findIndex((n) => inZone(padZone(zone, 150), n.pos));
  const end = enter < 0 ? route.length - 1 : enter;
  let walked = 0;
  for (let i = end; i > 0; i--) {
    walked += route[i].pos.distanceTo(route[i - 1].pos);
    if (walked > dist) return route[i - 1];
  }
  return route[Math.floor(route.length / 2)];
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

function padZone(z: Zone, pad: number): Zone {
  return { name: z.name, min: z.min.clone().add(new Vec3(-pad, -pad, -pad)), max: z.max.clone().add(new Vec3(pad, pad, pad)) };
}

/** For each route, a point just outside where it enters the zone, at eye height. */
function entrances(routes: NavNode[][], zone: Zone): Vec3[] {
  const out: Vec3[] = [];
  for (const r of routes) {
    const i = r.findIndex((n) => inZone(zone, n.pos));
    if (i < 0) continue;
    const j = Math.max(0, i - 6);
    const p = r[j].pos.clone().add(new Vec3(0, EYE, 0));
    if (out.every((q) => q.distanceTo(p) > 250)) out.push(p);
  }
  return out;
}
