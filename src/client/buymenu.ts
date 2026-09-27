import type { BuyItem } from '../game/mode';
import type { Player } from '../game/player';
import { WEAPONS, type WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';

interface Entry {
  label: string;
  item?: BuyItem;
  price?: number;
  sub?: Entry[];
}

const w = (id: WeaponId): Entry => ({ label: WEAPONS[id].name, item: id, price: WEAPONS[id].price });

/** The 1.6 buy menu tree, which differs slightly per team. */
function tree(team: Team): Entry[] {
  const T = team === 'T';
  return [
    { label: 'Handgun', sub: [w('glock'), w('usp'), w('p228'), w('deagle'), T ? w('elite') : w('fiveseven')] },
    { label: 'Shotgun', sub: [w('m3'), w('xm1014')] },
    { label: 'Sub-Machine Gun', sub: [w('mp5'), T ? w('mac10') : w('tmp'), w('p90'), w('ump45')] },
    {
      label: 'Rifle',
      sub: T ? [w('galil'), w('ak47'), w('scout'), w('sg552'), w('awp'), w('g3sg1')] : [w('famas'), w('m4a1'), w('scout'), w('aug'), w('awp'), w('sg550')],
    },
    { label: 'Machine Gun', sub: [w('m249')] },
    { label: 'Primary Ammo', item: 'primammo', price: 60 },
    { label: 'Secondary Ammo', item: 'secammo', price: 20 },
    {
      label: 'Equipment',
      sub: [
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

export class BuyMenu {
  readonly el: HTMLDivElement;
  private stack: Entry[][] = [];
  private title = '';
  onBuy: (item: BuyItem) => string | null = () => null;
  onClose: () => void = () => {};
  private player: Player | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'buymenu';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    // Capture phase so number keys never reach the weapon-slot bindings while the menu is up.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        if (m) {
          e.stopPropagation();
          e.preventDefault();
          this.choose(Number(m[2]));
        } else if (e.code === 'Escape' || e.code === 'KeyB') {
          e.stopPropagation();
          e.preventDefault();
          this.close();
        }
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(p: Player): void {
    this.player = p;
    this.stack = [tree(p.team)];
    this.title = 'Buy Item';
    this.render();
  }

  close(): void {
    this.stack = [];
    this.el.style.display = 'none';
    this.onClose();
  }

  private choose(n: number): void {
    if (n === 0) {
      if (this.stack.length > 1) {
        this.stack.pop();
        this.title = 'Buy Item';
        this.render();
      } else this.close();
      return;
    }
    const list = this.stack[this.stack.length - 1];
    const entry = list[n - 1];
    if (!entry) return;
    if (entry.sub) {
      this.stack.push(entry.sub);
      this.title = entry.label;
      this.render();
      return;
    }
    if (entry.item) {
      const err = this.onBuy(entry.item);
      if (err) {
        this.flash(err);
        return;
      }
      this.close();
    }
  }

  private flash(msg: string): void {
    const el = this.el.querySelector('.buy-err');
    if (el) el.textContent = msg;
  }

  private render(): void {
    const list = this.stack[this.stack.length - 1];
    const money = this.player?.money ?? 0;
    const rows = list
      .map((e, i) => {
        const cant = e.price !== undefined && e.price > money;
        const price = e.price !== undefined ? `<span class="price">$${e.price}</span>` : '';
        return `<div class="buy-row${cant ? ' cant' : ''}"><span class="num">${i + 1}.</span> ${e.label}${price}</div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="buy-title">${this.title}</div>${rows}<div class="buy-row"><span class="num">0.</span> ${this.stack.length > 1 ? 'Back' : 'Exit'}</div><div class="buy-err"></div>`;
    this.el.style.display = 'block';
  }
}
