import { Vec3, angleVectors } from '../engine/vec';
import { Deathmatch } from '../game/deathmatch';
import type { Game } from '../game/game';
import type { GameMode } from '../game/mode';
import type { Player } from '../game/player';
import { BombDefusal } from '../game/rules';
import { inZone, type Team, type Zone } from '../maps/types';
import type { RadioCommand } from '../game/radio';
import { Bot, type Task } from './bot';
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

export class BotManager {
  readonly nav: NavGraph;
  readonly bots: Bot[] = [];
  readonly sites: SitePlan[] = [];
  private contacts: Contact[] = [];
  private lastPhase = '';
  private lastRound = -1;
  private rotated = new Set<string>();
  private nextStrategy = 0;
  private retakeIssued = false;
  private retakeStart = 0;
  private radioAt = new Map<Team, number>();
  /** Site the Terrorists are going for this round. */
  targetSite: SitePlan | null = null;

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
        this.radio(by, area ? `Enemy spotted, ${area}!` : 'Enemy spotted!');
      }
    }
    if (by.team === 'CT') this.maybeRotate(pos);
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
    this.contacts = [];
    this.rotated.clear();
    this.retakeIssued = false;
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

    // Terrorists pick a site and split across its approaches.
    const site = this.sites[Math.floor(g.rand() * this.sites.length)];
    this.targetSite = site;
    const ts = this.bots.filter((b) => b.p.team === 'T');
    const lurk = ts.length >= 3 && g.rand() < 0.35 ? ts[ts.length - 1] : null;
    ts.forEach((b, i) => {
      if (b === lurk) {
        const other = this.sites.find((s) => s !== site) ?? site;
        const r = other.tRoutes[0];
        const spot = r[Math.floor(r.length * 0.6)].pos.clone();
        b.task = { kind: 'go', via: null, dest: spot, then: { kind: 'hold', spot, look: other.center.pos.clone().add(new Vec3(0, EYE, 0)) } };
        return;
      }
      // Most of the team takes the main route; the rest split onto the others.
      const routeIdx = site.tRoutes.length > 1 && i >= Math.ceil(ts.length * 0.6) ? 1 + (i % (site.tRoutes.length - 1)) : 0;
      const route = site.tRoutes[routeIdx];
      const dest = pick(site.nodes, g.rand).pos.clone();
      const hold = pick(site.tHolds, g.rand);
      const onSite: Task = b.p.weapons.c4 ? { kind: 'go', via: null, dest, then: { kind: 'plant', spot: dest } } : { kind: 'go', via: null, dest, then: { kind: 'hold', spot: hold.pos, look: hold.look } };
      // Gather just short of the site, then everyone hits it together instead of trickling in.
      const stage = stagingPoint(route, site.zone);
      const spread = new Vec3((g.rand() - 0.5) * 80, 0, (g.rand() - 0.5) * 80);
      const spot = this.nav.nearest(stage.pos.clone().add(spread))?.pos.clone() ?? stage.pos.clone();
      b.task = { kind: 'stage', spot, look: site.center.pos.clone().add(new Vec3(0, EYE, 0)), then: onSite };
    });

    // Counter-Terrorists spread over the sites.
    const cts = this.bots.filter((b) => b.p.team === 'CT');
    const order = [...this.sites].sort(() => g.rand() - 0.5);
    const taken: Vec3[] = [];
    const perSite = new Map<SitePlan, number>();
    cts.forEach((b, i) => {
      const s = order[i % order.length];
      // Cover the site's entrances in turn, so two CTs on one site watch different ways in.
      const n = perSite.get(s) ?? 0;
      perSite.set(s, n + 1);
      const entrance = s.tEntrances.length ? (n + Math.floor(g.rand() * 2)) % s.tEntrances.length : 0;
      let spots = s.ctHolds.filter((h) => h.entrance === entrance && taken.every((t) => t.distanceTo(h.pos) > 180));
      if (!spots.length) spots = s.ctHolds.filter((h) => taken.every((t) => t.distanceTo(h.pos) > 180));
      const h = pick(spots.length ? spots : s.ctHolds, g.rand);
      taken.push(h.pos);
      b.task = { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() };
    });
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
      if (ts.length && !ts.some((b) => b.task.kind === 'fetch')) {
        const near = ts.reduce((a, b) => (a.p.origin.distanceTo(loose) < b.p.origin.distanceTo(loose) ? a : b));
        near.task = { kind: 'fetch', pos: loose.clone() };
      }
    }
    // Whoever picked it up heads for the site to plant.
    for (const b of this.bots) {
      if (b.p.team === 'T' && b.p.weapons.c4 && (b.task.kind === 'fetch' || b.task.kind === 'hold' || b.task.kind === 'hunt' || b.task.kind === 'idle')) {
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
      const cts = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive);
      // Kit holder (or whoever's closest) defuses, the rest clear the site.
      const defuser = cts.find((b) => b.p.defuser) ?? cts.sort((a, b) => a.p.origin.distanceTo(bomb) - b.p.origin.distanceTo(bomb))[0];
      // Group up outside the site first: one CT at a time walking into a post-plant is a free kill.
      this.retakeStart = g.time;
      for (const b of cts) {
        const then: Task = b === defuser ? { kind: 'defuse', bomb } : { kind: 'hunt', dest: pick(site.nodes, g.rand).pos.clone() };
        const inside = inZone(padZone(site.zone, 200), b.p.origin);
        const entry = site.ctEntrances.length ? site.ctEntrances.reduce((a, e) => (a.distanceTo(b.p.origin) < e.distanceTo(b.p.origin) ? a : e)) : null;
        const node = entry ? this.nav.nearest(entry.clone().add(new Vec3(0, -EYE, 0))) : null;
        b.task = inside || !node ? then : { kind: 'stage', spot: node.pos.clone(), look: bomb.clone().add(new Vec3(0, EYE, 0)), then };
      }
      for (const b of this.bots) {
        if (b.p.team !== 'T' || !b.p.alive) continue;
        const h = pick(site.tHolds, g.rand);
        b.task = { kind: 'go', via: null, dest: h.pos.clone(), then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
      }
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
    // T execute: go once the staged group has gathered, contact is made, or time is getting on.
    if (!d.bomb) {
      const staged = this.bots.filter((b) => b.p.team === 'T' && b.p.alive && b.task.kind === 'stage');
      if (staged.length) {
        const ready = staged.every((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 220);
        const contact = staged.some((b) => b.enemy && b.enemy.alive && now - b.lastSeenTime() < 1);
        const late = now - d.roundStart > 50 || d.timeLeft < 50;
        if (ready || contact || late) {
          for (const b of staged) if (b.task.kind === 'stage') b.task = b.task.then;
          const caller = staged[0];
          if (caller && this.targetSite) this.radio(caller.p, `Go go go! Hitting ${this.targetSite.zone.name}!`);
        }
      }
    }
    // Release the retake once everyone's staged, or the clock forces it.
    if (d.bomb && !d.bomb.defused) {
      const staged = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive && b.task.kind === 'stage');
      if (staged.length) {
        const ready = staged.every((b) => b.task.kind === 'stage' && b.p.origin.distanceTo(b.task.spot) < 200);
        const late = this.bombTimeLeft() < 18 || g.time - this.retakeStart > 12;
        if (ready || late) for (const b of staged) if (b.task.kind === 'stage') b.task = b.task.then;
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

  /** CTs rotate toward a site once enemies show up on its approach. */
  private maybeRotate(at: Vec3): void {
    const d = this.defusal;
    if (!d || d.bomb || d.phase !== 'live') return;
    const node = this.nav.nearest(at);
    if (!node) return;
    for (const s of this.sites) {
      if (this.rotated.has(s.zone.name) || !(s.approach.has(node.id) || inZone(padZone(s.zone, 300), at))) continue;
      const now = this.game.time;
      const seen = this.contacts.filter((c) => now - c.time < 6 && c.enemy.alive).filter((c) => {
        const n = this.nav.nearest(c.pos);
        return n && (s.approach.has(n.id) || inZone(padZone(s.zone, 300), c.pos));
      }).length;
      // One confirmed enemy on the approach is enough to start moving; waiting for two was too late.
      if (seen < 1) continue;
      this.rotated.add(s.zone.name);
      const others = this.bots.filter((b) => b.p.team === 'CT' && b.p.alive && b.task.kind === 'hold' && !inZone(padZone(s.zone, 900), b.task.spot));
      // Keep one player home on the other site if there's more than one there.
      others.forEach((b, i) => {
        if (i === others.length - 1 && others.length > 1) return;
        const h = pick(s.ctHolds, this.game.rand);
        const task: Task = { kind: 'go', via: null, dest: h.pos.clone(), then: { kind: 'hold', spot: h.pos.clone(), look: h.look.clone() } };
        b.task = task;
        this.radio(b.p, `Rotating to ${s.zone.name}!`);
      });
    }
  }
}

/** A node on the route roughly 500-800u before it enters the site, out of the defenders' sight. */
function stagingPoint(route: NavNode[], zone: Zone): NavNode {
  const enter = route.findIndex((n) => inZone(padZone(zone, 150), n.pos));
  const end = enter < 0 ? route.length - 1 : enter;
  let dist = 0;
  for (let i = end; i > 0; i--) {
    dist += route[i].pos.distanceTo(route[i - 1].pos);
    if (dist > 650) return route[i - 1];
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
