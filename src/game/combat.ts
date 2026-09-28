import type { Brush } from '../engine/brush';
import { penetrationFactor } from '../engine/materials';
import { Trace } from '../engine/trace';
import { Vec3, angleVectors } from '../engine/vec';
import type { Game } from './game';
import { isGrenade } from './grenades';
import { HITGROUP_MULT, type HitGroup } from './hitbox';
import type { Player, WeaponState } from './player';
import { WEAPONS, type Kick, type Slot, type WeaponDef, type WeaponId } from './weapons';

const tr = new Trace();
const bulletFilter = (b: Brush) => !b.clip;

/** Movement state used for both spread and recoil. */
function moveState(p: Player, threshold: number): 'air' | 'move' | 'duck' | 'stand' {
  if (!p.move.onGround) return 'air';
  if (p.move.velocity.length2d() > threshold) return 'move';
  if (p.move.ducked) return 'duck';
  return 'stand';
}

export function currentSpread(p: Player, w: WeaponState): number {
  const def = w.def;
  const [base, mult] = def.spread[moveState(p, def.spread.moveSpeed)];
  let spread: number;
  switch (def.accuracy.kind) {
    case 'shots': {
      const a = def.accuracy;
      const acc = w.shotsFired === 0 ? a.first : Math.min(a.max, Math.pow(w.shotsFired, a.exp) / a.div + a.offset);
      spread = base + mult * acc;
      break;
    }
    case 'time':
      spread = base * (1 - w.accuracy);
      break;
    default:
      spread = base;
  }
  if (def.unscopedSpread && w.zoom === 0) spread += def.unscopedSpread;
  // The AWP punishes any movement even below the "moving" threshold.
  if (def.id === 'awp' && p.move.onGround && p.move.velocity.length2d() > 10 && p.move.velocity.length2d() <= def.spread.moveSpeed) spread = Math.max(spread, 0.1);
  if (w.burst && def.id === 'glock') spread = Math.max(spread, 0.05);
  return spread;
}

function kickBack(g: Game, p: Player, w: WeaponState, kick: Kick): void {
  const [upBase, latBase, upMod, latMod, upMax, latMax, dirChange] = kick;
  let up: number;
  let lat: number;
  if (w.shotsFired === 1) {
    up = upBase;
    lat = latBase;
  } else {
    up = upBase + w.shotsFired * upMod;
    lat = latBase + w.shotsFired * latMod;
  }
  p.punchPitch = Math.min(upMax, p.punchPitch + up);
  if (w.kickDir === 1) p.punchYaw = Math.min(latMax, p.punchYaw + lat);
  else p.punchYaw = Math.max(-latMax, p.punchYaw - lat);
  if (Math.floor(g.rand() * (dirChange + 1)) === 0) w.kickDir = -w.kickDir;
}

/** PM_DropPunchAngle from 1.6. */
export function decayPunch(p: Player, dt: number): void {
  let len = Math.hypot(p.punchPitch, p.punchYaw);
  if (len === 0) return;
  const nx = p.punchPitch / len;
  const ny = p.punchYaw / len;
  len = Math.max(0, len - (10 + len * 0.5) * dt);
  p.punchPitch = nx * len;
  p.punchYaw = ny * len;
}

export function switchWeapon(g: Game, p: Player, slot: Slot): void {
  if (slot === p.active || !p.weapons[slot]) return;
  const cur = p.weapon;
  if (cur) {
    cur.zoom = 0;
    cur.resumeZoom = 0;
    cur.reloading = false;
    cur.burstLeft = 0;
  }
  p.lastSlot = p.active;
  p.active = slot;
  const w = p.weapon!;
  p.nextAttack = g.time + w.def.deploy;
  p.deployedAt = g.time;
  w.delayFire = true;
  g.emit({ type: 'draw', player: p, weapon: w.def.id });
}

function startReload(g: Game, p: Player, w: WeaponState): void {
  if (w.reloading || w.def.clip <= 0 || w.clip >= w.def.clip || w.reserve <= 0) return;
  w.reloading = true;
  w.zoom = 0;
  w.resumeZoom = 0;
  w.reloadEnd = g.time + w.def.reload;
  w.shotsFired = 0;
  p.nextAttack = Math.max(p.nextAttack, w.reloadEnd);
  g.emit({ type: 'reload', player: p, weapon: w.def.id });
}

function finishReload(g: Game, p: Player, w: WeaponState): void {
  if (w.def.shellReload) {
    w.clip++;
    w.reserve--;
    if (w.clip < w.def.clip && w.reserve > 0) {
      w.reloadEnd = g.time + w.def.shellReload;
      p.nextAttack = w.reloadEnd;
      g.emit({ type: 'reload', player: p, weapon: w.def.id });
      return;
    }
  } else {
    const n = Math.min(w.def.clip - w.clip, w.reserve);
    w.clip += n;
    w.reserve -= n;
  }
  w.reloading = false;
}

/** Per-tick weapon handling for one player. */
export function updateWeapon(g: Game, p: Player, dt: number): void {
  decayPunch(p, dt);
  const w = p.weapon;
  if (!w) return;
  // Freeze time: the trigger does nothing, but release handling below still runs.
  const c = g.rules.canAttack && !g.rules.canAttack(p) ? { ...p.cmd, attack: false, attack2: false } : p.cmd;
  const def = w.def;

  if (w.reloading && g.time >= w.reloadEnd) finishReload(g, p, w);
  if (w.resumeZoom && g.time >= p.nextAttack) {
    w.zoom = w.resumeZoom;
    w.resumeZoom = 0;
  }
  if (def.accuracy.kind === 'time' && g.time - w.lastFire > 0.5) w.accuracy = def.accuracy.max;

  // Queued burst rounds fire on their own schedule.
  if (w.burstLeft > 0 && g.time >= p.nextAttack) {
    fire(g, p, w);
    w.burstLeft--;
    p.nextAttack = g.time + (w.burstLeft > 0 ? (def.id === 'glock' ? 0.05 : 0.075) : 0.5);
    return;
  }

  if (c.attack2 && !p.attack2Held) altFire(g, p, w);
  p.attack2Held = c.attack2;

  if (c.reload) startReload(g, p, w);

  if (c.attack) {
    if (def.slot === 'knife') {
      if (g.time >= p.nextAttack) knifeAttack(g, p, false);
    } else if (def.slot === 'grenade') {
      if (g.time >= p.nextAttack && (p.grenades[def.id] ?? 0) > 0) w.pinPulled = true;
    } else if (def.slot === 'c4') {
      // Planting is handled by the game rules.
    } else if (def.shellReload && w.reloading && w.clip > 0) {
      // Firing interrupts a shotgun reload between shells.
      w.reloading = false;
      p.nextAttack = g.time;
    } else if (w.clip === 0) {
      if (!w.delayFire) {
        g.emit({ type: 'empty', player: p });
        startReload(g, p, w);
      }
    } else if (g.time >= p.nextAttack && (def.auto || !w.delayFire) && !w.reloading) {
      if (w.burst) {
        w.burstLeft = 2;
        fire(g, p, w);
        p.nextAttack = g.time + (def.id === 'glock' ? 0.05 : 0.075);
      } else {
        fire(g, p, w);
      }
    }
    w.delayFire = true;
  } else {
    if (w.pinPulled && isGrenade(def.id)) {
      w.pinPulled = false;
      g.grenades.throw(p, def.id);
      p.nextAttack = g.time + 0.5;
      g.afterThrow(p);
      return;
    }
    if (w.delayFire) {
      w.delayFire = false;
      w.shotsFired = Math.min(w.shotsFired, 15);
      w.decreaseShotsAt = g.time + 0.4;
      if (w.clip === 0) startReload(g, p, w);
    }
    if (w.shotsFired > 0 && g.time > w.decreaseShotsAt) {
      w.decreaseShotsAt = g.time + 0.0225;
      w.shotsFired--;
    }
  }
}

function altFire(g: Game, p: Player, w: WeaponState): void {
  const def = w.def;
  if (def.slot === 'knife') {
    if (g.time >= p.nextAttack) knifeAttack(g, p, true);
    return;
  }
  if (g.time < p.nextAttack - 0.001 && def.alt !== 'zoom') return;
  switch (def.alt) {
    case 'zoom':
      if (w.reloading) return;
      w.zoom = (w.zoom + 1) % ((def.zoom?.length ?? 0) + 1);
      w.resumeZoom = 0;
      p.nextAttack = Math.max(p.nextAttack, g.time + 0.3);
      g.emit({ type: 'zoom', player: p });
      break;
    case 'silencer':
      w.silenced = !w.silenced;
      p.nextAttack = g.time + (def.id === 'm4a1' ? 2 : 3.1);
      g.emit({ type: 'silencer', player: p, on: w.silenced });
      break;
    case 'burst':
      w.burst = !w.burst;
      g.emit({ type: 'message', text: w.burst ? 'Switched to Burst-Fire mode' : def.id === 'glock' ? 'Switched to Semi-Automatic' : 'Switched to Full-Auto' });
      break;
  }
}

function fire(g: Game, p: Player, w: WeaponState): void {
  const def = w.def;
  const spread = currentSpread(p, w);

  if (def.accuracy.kind === 'time' && w.lastFire > 0) {
    const a = def.accuracy;
    w.accuracy -= (a.recover - (g.time - w.lastFire)) * a.penalty;
    w.accuracy = Math.max(a.min, Math.min(a.max, w.accuracy));
  }
  w.shotsFired++;
  w.lastFire = g.time;
  w.clip--;
  p.nextAttack = g.time + def.cycle;

  const eye = p.eye();
  const fwd = new Vec3();
  const right = new Vec3();
  const up = new Vec3();
  angleVectors(p.yaw + p.punchYaw, p.pitch + p.punchPitch, fwd, right, up);

  const pellets = def.pellets ?? 1;
  let damage = def.damage;
  if (def.id === 'm4a1' && w.silenced) damage = 33;
  let lastEnd = eye;
  for (let i = 0; i < pellets; i++) {
    const x = g.rand() - 0.5 + (g.rand() - 0.5);
    const y = g.rand() - 0.5 + (g.rand() - 0.5);
    const dir = fwd.clone().addScaled(right, x * spread).addScaled(up, y * spread);
    dir.normalize();
    lastEnd = fireBullet(g, p, eye, dir, def, damage, pellets > 1 ? 0 : def.penetration);
  }
  g.emit({ type: 'shot', player: p, weapon: def.id, silenced: w.silenced, origin: eye, end: lastEnd });
  const loud = w.silenced ? def.loudness * 0.25 : def.loudness;
  p.lastNoise = { time: g.time, radius: loud };

  if (def.kick) kickBack(g, p, w, def.kick[moveState(p, 5)]);
  else if (def.punch) p.punchPitch += def.punch * (def.pellets ? 0.5 + g.rand() * 0.5 : 1);

  if (def.zoom && w.zoom > 0 && (def.id === 'awp' || def.id === 'scout')) {
    w.resumeZoom = w.zoom;
    w.zoom = 0;
  }
}

/** Traces one bullet through players and thin walls. Returns where it finally stopped. */
function fireBullet(g: Game, shooter: Player, start: Vec3, dir: Vec3, def: WeaponDef, damage: number, penetration: number): Vec3 {
  let from = start.clone();
  let traveled = 0;
  let pen = penetration;
  let wallbang = false;
  const hitPlayers = new Set<Player>([shooter]);
  let end = from.clone();

  for (let hop = 0; hop < 5; hop++) {
    const remaining = def.range - traveled;
    if (remaining <= 0) break;
    const to = from.clone().addScaled(dir, remaining);
    g.world.trace(from, to, undefined, undefined, tr, bulletFilter);
    const wallDist = tr.fraction * remaining;
    const hitNormal = tr.normal.clone();
    const hitBrush = tr.brush;
    const startSolid = tr.startsolid;

    const body = g.nearestBodyHit(from, dir, wallDist, hitPlayers);
    if (body) {
      const at = from.clone().addScaled(dir, body.dist);
      const dmg = damage * Math.pow(def.rangeModifier, (traveled + body.dist) / 500);
      g.damage(body.player, shooter, dmg, body.group, def.id, dir, wallbang);
      g.emit({ type: 'blood', pos: at, dir: dir.clone() });
      hitPlayers.add(body.player);
      end = at;
      // Only big calibres keep going through a body.
      if (def.penetration < 39 || def.pellets) return end;
      damage *= 0.75;
    }

    if (tr.fraction >= 1) return from.clone().addScaled(dir, remaining);
    end = tr.endpos.clone();
    if (!startSolid) g.emit({ type: 'impact', pos: end.clone(), normal: hitNormal, tex: hitBrush?.tex ?? '' });
    if (pen <= 0 || !hitBrush) return end;

    // Convex brush, so the exit is the nearest back-facing plane along the ray.
    let exit = Infinity;
    for (const pl of hitBrush.planes) {
      const dn = pl.normal.dot(dir);
      if (dn <= 1e-6) continue;
      const t = (pl.dist - pl.normal.dot(end)) / dn;
      if (t < exit) exit = t;
    }
    const factor = hitBrush.penetration ?? penetrationFactor(hitBrush.tex);
    if (!isFinite(exit) || exit > pen * factor) return end;
    pen -= exit / factor;
    damage *= factor >= 1 ? 0.75 : 0.5;
    wallbang = true;
    traveled += wallDist + exit;
    from = end.clone().addScaled(dir, exit + 0.5);
    g.emit({ type: 'impact', pos: from.clone(), normal: dir.clone(), tex: hitBrush.tex });
  }
  return end;
}

function knifeAttack(g: Game, p: Player, stab: boolean): void {
  const range = stab ? 32 : 48;
  const eye = p.eye();
  const fwd = new Vec3();
  const right = new Vec3();
  const up = new Vec3();
  angleVectors(p.yaw, p.pitch, fwd, right, up);
  p.nextAttack = g.time + (stab ? 1.1 : 0.4);

  // A fan of rays stands in for 1.6's hull trace so the knife isn't pixel-precise.
  const offsets = [
    [0, 0],
    [6, 0],
    [-6, 0],
    [0, 6],
    [0, -6],
  ];
  let hitWall = false;
  for (const [ox, oy] of offsets) {
    const dir = fwd.clone().scale(range).addScaled(right, ox).addScaled(up, oy);
    const len = dir.normalize();
    g.world.trace(eye, eye.clone().addScaled(dir, len), undefined, undefined, tr, bulletFilter);
    const wallDist = tr.fraction * len;
    const body = g.nearestBodyHit(eye, dir, wallDist, new Set([p]));
    if (body) {
      // Backstab if we're behind the victim.
      const vf = new Vec3();
      angleVectors(body.player.yaw, 0, vf);
      const toVictim = body.player.origin.clone().sub(p.origin);
      toVictim.y = 0;
      toVictim.normalize();
      const back = vf.dot(toVictim) > 0.5;
      let dmg = stab ? 65 : 15;
      if (back) dmg *= 3;
      g.damage(body.player, p, dmg, body.group === 'head' && !stab ? 'chest' : body.group, 'knife', dir, false);
      g.emit({ type: 'blood', pos: eye.clone().addScaled(dir, body.dist), dir });
      g.emit({ type: 'knife', player: p, hit: 'player', stab });
      return;
    }
    if (tr.fraction < 1) hitWall = true;
  }
  g.emit({ type: 'knife', player: p, hit: hitWall ? 'wall' : 'none', stab });
}

export function armorAbsorb(damage: number, armor: number, armorPen: number): { health: number; armor: number } {
  let dealt = damage * armorPen;
  let armorLoss = (damage - dealt) * 0.5;
  if (armorLoss > armor) {
    armorLoss = armor;
    dealt = damage - armorLoss * 2;
  }
  return { health: dealt, armor: armorLoss };
}

export function applyHitGroup(damage: number, group: HitGroup | null): number {
  return group ? damage * HITGROUP_MULT[group] : damage;
}

export function weaponDef(id: WeaponId | 'world'): WeaponDef | null {
  return id === 'world' ? null : WEAPONS[id];
}
