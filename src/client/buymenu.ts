import * as THREE from 'three';
import type { BuyItem } from '../game/mode';
import type { Player } from '../game/player';
import { WEAPONS, type WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';
import { buildWeaponModel } from './weaponmodel';

interface Entry {
  label: string;
  item: BuyItem;
  price: number;
}

interface Category {
  label: string;
  items: Entry[];
}

const w = (id: WeaponId): Entry => ({ label: WEAPONS[id].name, item: id, price: WEAPONS[id].price });

/** The 1.6 menu tree (so B-4-2 still works), laid out as columns. */
function tree(team: Team): Category[] {
  const T = team === 'T';
  return [
    { label: 'Pistols', items: [w('glock'), w('usp'), w('p228'), w('deagle'), T ? w('elite') : w('fiveseven')] },
    { label: 'Shotguns', items: [w('m3'), w('xm1014')] },
    { label: 'SMGs', items: [w('mp5'), T ? w('mac10') : w('tmp'), w('p90'), w('ump45')] },
    { label: 'Rifles', items: T ? [w('galil'), w('ak47'), w('scout'), w('sg552'), w('awp'), w('g3sg1')] : [w('famas'), w('m4a1'), w('scout'), w('aug'), w('awp'), w('sg550')] },
    { label: 'Machine Gun', items: [w('m249')] },
    { label: 'Primary Ammo', items: [{ label: 'Primary Ammo', item: 'primammo', price: 60 }] },
    { label: 'Secondary Ammo', items: [{ label: 'Secondary Ammo', item: 'secammo', price: 20 }] },
    {
      label: 'Equipment',
      items: [
        { label: 'Kevlar Vest', item: 'vest', price: 650 },
        { label: 'Kevlar + Helmet', item: 'vesthelm', price: 1000 },
        w('flashbang'),
        w('hegrenade'),
        w('smokegrenade'),
        ...(T ? [] : [{ label: 'Defusal Kit', item: 'defuser' as const, price: 200 }]),
      ],
    },
  ];
}

// Columns shown on screen; each is a list of [category index] from the tree.
const COLUMNS: { title: string; cats: number[] }[] = [
  { title: 'Pistols', cats: [0] },
  { title: 'Heavy', cats: [1, 4] },
  { title: 'SMGs', cats: [2] },
  { title: 'Rifles', cats: [3] },
  { title: 'Gear', cats: [7, 5, 6] },
];

let thumbs: Map<string, string> | null = null;

/** Side-on renders of every gun, made once with a throwaway renderer. */
function weaponThumbs(): Map<string, string> {
  if (thumbs) return thumbs;
  thumbs = new Map();
  const W = 200;
  const H = 72;
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return thumbs;
  }
  r.setSize(W, H);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const { group } = buildWeaponModel(id);
    // Barrel to the left, like the 1.6 buy menu art.
    group.rotation.y = Math.PI / 2;
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.x / 2, (size.y / 2) * (W / H)) * 1.1;
    cam.left = -half;
    cam.right = half;
    cam.top = half * (H / W);
    cam.bottom = -half * (H / W);
    cam.position.set(c.x, c.y, c.z + 50);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    thumbs.set(id, r.domElement.toDataURL());
    scene.remove(group);
  }
  r.dispose();
  r.forceContextLoss();
  return thumbs;
}

/** What the player already has, so owned items show as such and rebuy skips them. */
export function owns(p: Player, item: BuyItem): boolean {
  switch (item) {
    case 'vest':
      return p.armor >= 100;
    case 'vesthelm':
      return p.armor >= 100 && p.helmet;
    case 'defuser':
      return p.defuser;
    case 'primammo':
      return !p.weapons.primary || p.weapons.primary.reserve >= p.weapons.primary.def.reserve;
    case 'secammo':
      return !p.weapons.secondary || p.weapons.secondary.reserve >= p.weapons.secondary.def.reserve;
  }
  const def = WEAPONS[item];
  if (def.slot === 'grenade') return (p.grenades[item] ?? 0) >= (item === 'flashbang' ? 2 : 1);
  return p.weapons[def.slot]?.def.id === item;
}

export class BuyMenu {
  readonly el: HTMLDivElement;
  /** Set while the number-key path is inside a category. */
  private category: number | null = null;
  private player: Player | null = null;
  private cats: Category[] = [];
  onBuy: (item: BuyItem) => string | null = () => null;
  onRebuy: () => string | null = () => null;
  onClose: () => void = () => {};
  /** Actual price for this player right now (armor depends on what you already wear). */
  priceOf: (item: BuyItem, listed: number) => number = (_i, listed) => listed;
  /** Seconds of buy time left, or null for unlimited (deathmatch). */
  timeLeft: () => number | null = () => null;
  private open_ = false;
  private lastRender = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'buymenu';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-item], [data-action]');
      if (!t) return;
      if (t.dataset.item) this.buy(t.dataset.item as BuyItem);
      else if (t.dataset.action === 'rebuy') this.rebuy();
      else if (t.dataset.action === 'close') this.close();
    });
    // Capture phase so number keys never reach the weapon-slot bindings while the menu is up.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.open_) return;
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        let handled = true;
        if (m) this.choose(Number(m[2]));
        else if (e.code === 'KeyR') this.rebuy();
        else if (e.code === 'Escape' || e.code === 'KeyB') this.close();
        else handled = false;
        if (handled) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(p: Player): void {
    this.player = p;
    this.cats = tree(p.team);
    this.category = null;
    this.open_ = true;
    this.lastRender = '';
    this.el.style.display = 'flex';
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.style.display = 'none';
    this.onClose();
  }

  private choose(n: number): void {
    if (this.category === null) {
      if (n === 0) return this.close();
      if (this.cats[n - 1]) {
        const cat = this.cats[n - 1];
        // Single-item categories (ammo) buy straight away, as in 1.6.
        if (cat.items.length === 1) this.buy(cat.items[0].item);
        else this.category = n - 1;
      }
    } else {
      if (n === 0) this.category = null;
      else {
        const e = this.cats[this.category].items[n - 1];
        if (e) this.buy(e.item);
      }
    }
    this.render(true);
  }

  private buy(item: BuyItem): void {
    const err = this.onBuy(item);
    this.flash(err);
    if (!err) this.category = null;
    this.render(true);
  }

  private rebuy(): void {
    this.flash(this.onRebuy());
    this.render(true);
  }

  private flash(msg: string | null): void {
    const el = this.el.querySelector('.buy-msg');
    if (el) {
      el.textContent = msg ?? '';
      el.classList.toggle('err', !!msg);
    }
  }

  /** Called every frame while open; only touches the DOM when something visible changed. */
  update(): void {
    if (this.open_) this.render();
  }

  private render(force = false): void {
    const p = this.player;
    if (!p) return;
    const left = this.timeLeft();
    const key = `${p.money}|${p.armor}|${p.helmet}|${p.defuser}|${JSON.stringify(p.grenades)}|${p.weapons.primary?.def.id}|${p.weapons.secondary?.def.id}|${this.category}|${left === null ? '' : Math.ceil(left)}`;
    if (!force && key === this.lastRender) return;
    const msg = this.el.querySelector('.buy-msg');
    const keepMsg = msg ? { text: msg.textContent ?? '', err: msg.classList.contains('err') } : null;
    this.lastRender = key;
    const img = weaponThumbs();

    const cols = COLUMNS.map((col) => {
      const items = col.cats.flatMap((ci) =>
        this.cats[ci].items.map((e, ii) => {
          const own = owns(p, e.item);
          const price = own ? e.price : this.priceOf(e.item, e.price);
          const cant = !own && price > p.money;
          const hot = `${ci + 1}${this.cats[ci].items.length > 1 ? `-${ii + 1}` : ''}`;
          const active = this.category === ci ? ' active' : '';
          const pic = img.get(e.item) ? `<img src="${img.get(e.item)}" alt="">` : '';
          return `<button class="buy-item${own ? ' owned' : ''}${cant ? ' cant' : ''}${active}" data-item="${e.item}"><span class="hot">${hot}</span>${pic}<span class="name">${e.label}</span><span class="price">${own ? 'owned' : `$${price}`}</span></button>`;
        }),
      );
      return `<div class="buy-col"><div class="buy-col-title">${col.title}</div>${items.join('')}</div>`;
    });

    const time = left === null ? '' : `<span class="buy-time">Buy time ${Math.max(0, Math.ceil(left))}s</span>`;
    const hint = this.category === null ? 'Number keys: category, then item · 0 back' : `${this.cats[this.category].label}: pick 1-${this.cats[this.category].items.length}, 0 back`;
    this.el.innerHTML = `
      <div class="buy-panel">
        <div class="buy-head">
          <span class="buy-money">$${p.money}</span>${time}
          <span class="buy-hint">${hint}</span>
          <button class="buy-btn" data-action="rebuy">Rebuy <kbd>R</kbd></button>
          <button class="buy-btn" data-action="close">Close <kbd>B</kbd></button>
        </div>
        <div class="buy-cols">${cols.join('')}</div>
        <div class="buy-msg"></div>
      </div>`;
    if (keepMsg) this.flash(keepMsg.err ? keepMsg.text : null);
  }
}
