import { HULL_STAND, MOVE } from '../engine/pmove';
import { CollisionWorld, Trace } from '../engine/trace';
import { Vec3 } from '../engine/vec';
import type { MapData, Zone } from '../maps/types';
import { inZone } from '../maps/types';

export const NAV_STEP = 32;
/** Max height a bot will drop off a ledge (1.6 fall damage starts around 210u). */
const MAX_DROP = 200;
/** Ledges up to this high can be climbed with a jump (45u jump; duck-jump gives more). */
const MAX_JUMP_UP = 44;

export interface NavEdge {
  to: number;
  cost: number;
  jump: boolean;
}

export interface NavNode {
  id: number;
  pos: Vec3;
  edges: NavEdge[];
  /** Callout name of the area, if any. */
  area: string;
}

/**
 * Walkable grid sampled from the map geometry. Each column can hold several floor
 * levels. Only nodes reachable from a spawn are kept.
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private cells = new Map<number, number[]>();
  private tr = new Trace();

  constructor(
    readonly map: MapData,
    readonly world: CollisionWorld,
  ) {
    this.build();
  }

  private key(i: number, k: number): number {
    return (i + 2048) * 4096 + (k + 2048);
  }

  private build(): void {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let maxY = -Infinity;
    let minY = Infinity;
    for (const b of this.map.brushes) {
      minX = Math.min(minX, b.min.x);
      minZ = Math.min(minZ, b.min.z);
      maxX = Math.max(maxX, b.max.x);
      maxZ = Math.max(maxZ, b.max.z);
      maxY = Math.max(maxY, b.max.y);
      minY = Math.min(minY, b.min.y);
    }
    const { mins, maxs } = HULL_STAND;
    const raw: NavNode[] = [];
    const grid = new Map<number, number[]>();
    const top = new Vec3();
    const bottom = new Vec3();

    for (let x = Math.ceil(minX / NAV_STEP) * NAV_STEP; x <= maxX; x += NAV_STEP) {
      for (let z = Math.ceil(minZ / NAV_STEP) * NAV_STEP; z <= maxZ; z += NAV_STEP) {
        // Walk down the column finding every floor with standing room above it.
        let y = maxY + 8;
        let guard = 0;
        while (y > minY && guard++ < 128) {
          top.set(x, y, z);
          bottom.set(x, minY, z);
          const t = this.world.trace(top, bottom, mins, maxs, this.tr);
          // Step finely enough to land in low rooms: a 72u hull under an 80u ceiling has an 8u window.
          if (t.startsolid) {
            y -= 8;
            continue;
          }
          if (t.fraction >= 1) break;
          if (t.normal.y >= 0.7) {
            const pos = t.endpos.clone();
            const i = Math.round(x / NAV_STEP);
            const k = Math.round(z / NAV_STEP);
            const id = raw.length;
            raw.push({ id, pos, edges: [], area: '' });
            const key = this.key(i, k);
            const list = grid.get(key);
            if (list) list.push(id);
            else grid.set(key, [id]);
          }
          y = t.endpos.y - 1;
          // Skip down through the solid we just landed on.
          while (y > minY) {
            top.set(x, y, z);
            if (!this.world.trace(top, top, mins, maxs, this.tr).startsolid) break;
            y -= 8;
          }
        }
      }
    }

    // Link each node to floor nodes in the 8 neighbouring columns.
    const a = new Vec3();
    const b = new Vec3();
    for (const n of raw) {
      const i = Math.round(n.pos.x / NAV_STEP);
      const k = Math.round(n.pos.z / NAV_STEP);
      for (let di = -1; di <= 1; di++)
        for (let dk = -1; dk <= 1; dk++) {
          if (!di && !dk) continue;
          for (const id of grid.get(this.key(i + di, k + dk)) ?? []) {
            const m = raw[id];
            const dy = m.pos.y - n.pos.y;
            if (dy > MAX_JUMP_UP || dy < -MAX_DROP) continue;
            const jump = dy > MOVE.stepSize + 2;
            // Sweep the hull between them, lifted by the climb so steps and ramps pass.
            const lift = Math.max(MOVE.stepSize, dy + 2);
            a.copy(n.pos);
            a.y += lift;
            b.copy(m.pos);
            b.y = Math.max(m.pos.y, n.pos.y) + lift;
            if (this.world.trace(n.pos, a, mins, maxs, this.tr).fraction < 1) continue;
            if (this.world.trace(a, b, mins, maxs, this.tr).fraction < 1) continue;
            const horiz = Math.hypot(di, dk) * NAV_STEP;
            n.edges.push({ to: id, cost: horiz + Math.max(0, dy) * 2 + (jump ? 64 : 0), jump });
          }
        }
    }

    // Keep only what can be reached from a spawn.
    const keep = new Uint8Array(raw.length);
    const queue: number[] = [];
    for (const s of [...this.map.spawns.T, ...this.map.spawns.CT]) {
      const id = nearestIn(raw, grid, (k1, k2) => this.key(k1, k2), s.pos);
      if (id >= 0 && !keep[id]) {
        keep[id] = 1;
        queue.push(id);
      }
    }
    while (queue.length) {
      const id = queue.pop()!;
      for (const e of raw[id].edges) {
        if (!keep[e.to]) {
          keep[e.to] = 1;
          queue.push(e.to);
        }
      }
    }
    const remap = new Int32Array(raw.length).fill(-1);
    for (const n of raw) {
      if (!keep[n.id]) continue;
      remap[n.id] = this.nodes.length;
      this.nodes.push(n);
    }
    for (const n of this.nodes) {
      n.id = remap[n.id];
      n.edges = n.edges.filter((e) => remap[e.to] >= 0).map((e) => ({ ...e, to: remap[e.to] }));
      n.area = this.map.callouts.find((c) => inZone(c, n.pos))?.name ?? '';
      const key = this.key(Math.round(n.pos.x / NAV_STEP), Math.round(n.pos.z / NAV_STEP));
      const list = this.cells.get(key);
      if (list) list.push(n.id);
      else this.cells.set(key, [n.id]);
    }
  }

  /** Closest node to a position, preferring ones at a similar height. */
  nearest(p: Vec3): NavNode | null {
    const i0 = Math.round(p.x / NAV_STEP);
    const k0 = Math.round(p.z / NAV_STEP);
    let best: NavNode | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= 6 && !best; r++) {
      for (let i = i0 - r; i <= i0 + r; i++)
        for (let k = k0 - r; k <= k0 + r; k++) {
          if (Math.max(Math.abs(i - i0), Math.abs(k - k0)) !== r) continue;
          for (const id of this.cells.get(this.key(i, k)) ?? []) {
            const n = this.nodes[id];
            const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z) + Math.abs(n.pos.y - p.y) * 3;
            if (d < bestD) {
              bestD = d;
              best = n;
            }
          }
        }
    }
    return best;
  }

  nodesIn(z: Zone): NavNode[] {
    return this.nodes.filter((n) => inZone(z, n.pos));
  }

  /** A* from a to b. `penalty` adds extra cost per node (used to find alternative routes). */
  path(from: NavNode, to: NavNode, penalty?: Float32Array): NavNode[] | null {
    const n = this.nodes.length;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    g[from.id] = 0;
    heap.push(from.id, 0);
    const goal = to.pos;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === to.id) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of this.nodes[cur].edges) {
        const cost = g[cur] + e.cost + (penalty ? penalty[e.to] : 0);
        if (cost < g[e.to]) {
          g[e.to] = cost;
          came[e.to] = cur;
          const p = this.nodes[e.to].pos;
          heap.push(e.to, cost + Math.hypot(p.x - goal.x, p.z - goal.z));
        }
      }
    }
    if (from.id !== to.id && came[to.id] < 0) return null;
    const out: NavNode[] = [];
    for (let c = to.id; c >= 0; c = came[c]) {
      out.push(this.nodes[c]);
      if (c === from.id) break;
    }
    return out.reverse();
  }

  /** Several distinct routes between two nodes, each avoiding the ones before it. */
  routes(from: NavNode, to: NavNode, count: number): NavNode[][] {
    const penalty = new Float32Array(this.nodes.length);
    const out: NavNode[][] = [];
    for (let i = 0; i < count; i++) {
      const p = this.path(from, to, penalty);
      if (!p) break;
      // Skip near-duplicates of a route we already have.
      const dup = out.some((q) => overlap(p, q) > 0.6);
      if (!dup) out.push(p);
      for (const node of p) {
        // Penalise a corridor around the route, not just its exact nodes.
        for (const e of node.edges) penalty[e.to] += 60;
        penalty[node.id] += 120;
      }
    }
    return out;
  }

  edge(a: NavNode, b: NavNode): NavEdge | undefined {
    return a.edges.find((e) => e.to === b.id);
  }
}

function overlap(a: NavNode[], b: NavNode[]): number {
  const s = new Set(b.map((n) => n.id));
  let shared = 0;
  for (const n of a) if (s.has(n.id)) shared++;
  return shared / a.length;
}

function nearestIn(nodes: NavNode[], grid: Map<number, number[]>, key: (i: number, k: number) => number, p: Vec3): number {
  const i0 = Math.round(p.x / NAV_STEP);
  const k0 = Math.round(p.z / NAV_STEP);
  let best = -1;
  let bestD = Infinity;
  for (let i = i0 - 2; i <= i0 + 2; i++)
    for (let k = k0 - 2; k <= k0 + 2; k++)
      for (const id of grid.get(key(i, k)) ?? []) {
        const n = nodes[id];
        const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z) + Math.abs(n.pos.y - p.y) * 3;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
  return best;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
