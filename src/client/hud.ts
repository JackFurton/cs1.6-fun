import type { GameEvent } from '../game/events';
import type { Player } from '../game/player';
import { WEAPONS } from '../game/weapons';
import type { Settings } from './settings';

interface FeedEntry {
  el: HTMLDivElement;
  until: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class Hud {
  readonly el: HTMLDivElement;
  private fps: HTMLDivElement;
  private speed: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private health: HTMLSpanElement;
  private armor: HTMLSpanElement;
  private helmet: HTMLElement;
  private money: HTMLDivElement;
  private ammo: HTMLDivElement;
  private weaponName: HTMLDivElement;
  private feed: HTMLDivElement;
  private centerMsg: HTMLDivElement;
  private scope: HTMLDivElement;
  private damageFlash: HTMLDivElement;
  private dmgDirs: Record<'l' | 'r' | 't' | 'b', HTMLDivElement>;
  private roundScore: HTMLDivElement;
  private roundTimer: HTMLDivElement;
  private progress: HTMLDivElement;
  private icons: HTMLDivElement;
  private spectating: HTMLDivElement;
  private feedEntries: FeedEntry[] = [];
  private centerUntil = 0;
  private frames = 0;
  private lastFpsTime = performance.now();
  private hurtLevel = 0;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="scope"><div class="scope-ring"></div><i class="h"></i><i class="v"></i></div>
      <div class="damage-flash"></div>
      <div class="dmgdir l"></div><div class="dmgdir r"></div><div class="dmgdir t"></div><div class="dmgdir b"></div>
      <div class="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
      <div class="fps"></div>
      <div class="speed"></div>
      <div class="feed"></div>
      <div class="center-msg"></div>
      <div class="round-score"><span class="rs-ct">0</span><span class="rs-sep">:</span><span class="rs-t">0</span></div>
      <div class="round-timer"></div>
      <div class="progress"><div class="progress-label"></div><div class="progress-bar"><i></i></div></div>
      <div class="icons"><span class="ic-buy">$</span><span class="ic-c4">C4</span><span class="ic-kit">KIT</span></div>
      <div class="spectating"></div>
      <div class="hud-bottom">
        <div class="hp"><svg viewBox="0 0 10 10" class="icon"><path d="M3.5 0h3v3.5H10v3H6.5V10h-3V6.5H0v-3h3.5z"/></svg><span class="health">100</span></div>
        <div class="ap"><svg viewBox="0 0 10 12" class="icon"><path d="M5 0l5 2v4c0 3-2.2 5.2-5 6C2.2 11.2 0 9 0 6V2z"/></svg><b class="helmet">H</b><span class="armor">0</span></div>
        <div class="money">$800</div>
        <div class="ammo-box"><div class="weapon-name"></div><div class="ammo"></div></div>
      </div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.fps = q('.fps');
    this.speed = q('.speed');
    this.crosshair = q('.crosshair');
    this.health = q('.health');
    this.armor = q('.armor');
    this.helmet = q('.helmet');
    this.money = q('.money');
    this.ammo = q('.ammo');
    this.weaponName = q('.weapon-name');
    this.feed = q('.feed');
    this.centerMsg = q('.center-msg');
    this.scope = q('.scope');
    this.damageFlash = q('.damage-flash');
    this.roundScore = q('.round-score');
    this.roundTimer = q('.round-timer');
    this.progress = q('.progress');
    this.icons = q('.icons');
    this.spectating = q('.spectating');
    this.dmgDirs = { l: q('.dmgdir.l'), r: q('.dmgdir.r'), t: q('.dmgdir.t'), b: q('.dmgdir.b') };
    this.applySettings();
  }

  applySettings(): void {
    this.crosshair.style.setProperty('--cross', this.settings.crosshairColor);
    this.fps.style.display = this.speed.style.display = this.settings.showFps ? 'block' : 'none';
  }

  setRound(timeLeft: number | null, score: { T: number; CT: number } | null): void {
    this.roundTimer.style.display = timeLeft === null ? 'none' : 'block';
    if (timeLeft !== null) {
      const t = Math.ceil(timeLeft);
      this.roundTimer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      this.roundTimer.classList.toggle('low', t <= 10);
    }
    this.roundScore.style.display = score ? 'block' : 'none';
    if (score) {
      this.roundScore.querySelector('.rs-ct')!.textContent = String(score.CT);
      this.roundScore.querySelector('.rs-t')!.textContent = String(score.T);
    }
  }

  setProgress(label: string | null, fraction: number): void {
    this.progress.style.display = label ? 'block' : 'none';
    if (!label) return;
    this.progress.querySelector('.progress-label')!.textContent = label;
    (this.progress.querySelector('.progress-bar i') as HTMLElement).style.width = `${Math.min(100, fraction * 100)}%`;
  }

  setIcons(buy: boolean, c4: 'none' | 'carry' | 'site', kit: boolean): void {
    (this.icons.querySelector('.ic-buy') as HTMLElement).style.display = buy ? 'inline-block' : 'none';
    const c = this.icons.querySelector('.ic-c4') as HTMLElement;
    c.style.display = c4 === 'none' ? 'none' : 'inline-block';
    c.classList.toggle('site', c4 === 'site');
    (this.icons.querySelector('.ic-kit') as HTMLElement).style.display = kit ? 'inline-block' : 'none';
  }

  setSpectating(text: string | null): void {
    this.spectating.style.display = text ? 'block' : 'none';
    if (text) this.spectating.textContent = text;
  }

  /** Center-screen message like "Terrorists Win!". */
  message(text: string, seconds = 3, color = '#fff'): void {
    this.centerMsg.textContent = text;
    this.centerMsg.style.color = color;
    this.centerMsg.style.opacity = '1';
    this.centerUntil = performance.now() + seconds * 1000;
  }

  onEvent(e: GameEvent, local: Player): void {
    switch (e.type) {
      case 'kill': {
        const el = document.createElement('div');
        el.className = 'feed-entry';
        if (e.killer === local || e.victim === local) el.classList.add('mine');
        const killer = e.killer && e.killer !== e.victim ? `<span class="${e.killer.team}">${esc(e.killer.name)}</span>` : '';
        const weapon = e.weapon === 'world' ? 'world' : WEAPONS[e.weapon].name;
        const hs = e.headshot ? ' <em class="hs">HS</em>' : '';
        const wb = e.wallbang ? ' <em class="wb">WB</em>' : '';
        el.innerHTML = `${killer} <span class="wpn">[${esc(weapon)}]</span>${wb}${hs} <span class="${e.victim.team}">${esc(e.victim.name)}</span>`;
        this.feed.appendChild(el);
        this.feedEntries.push({ el, until: performance.now() + 6000 });
        while (this.feedEntries.length > 5) this.feedEntries.shift()!.el.remove();
        break;
      }
      case 'hurt':
        if (e.victim === local) {
          this.hurtLevel = Math.min(1, this.hurtLevel + e.amount / 60);
          if (e.attacker && e.attacker !== local) this.flashDirection(local, e.attacker);
        }
        break;
      case 'message':
        this.message(e.text, 2.5, e.color);
        break;
    }
  }

  private flashDirection(local: Player, attacker: Player): void {
    const dx = attacker.origin.x - local.origin.x;
    const dz = attacker.origin.z - local.origin.z;
    const ang = (Math.atan2(-dx, -dz) * 180) / Math.PI - local.yaw;
    const a = ((ang % 360) + 540) % 360 - 180;
    const key = Math.abs(a) < 45 ? 't' : Math.abs(a) > 135 ? 'b' : a > 0 ? 'l' : 'r';
    const el = this.dmgDirs[key];
    el.style.transition = 'none';
    el.style.opacity = '0.8';
    void el.offsetWidth;
    el.style.transition = 'opacity 1s';
    el.style.opacity = '0';
  }

  update(p: Player, spreadPx: number, scoped: boolean, dt: number): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps.textContent = `${Math.round((this.frames * 1000) / (now - this.lastFpsTime))} fps`;
      this.frames = 0;
      this.lastFpsTime = now;
    }
    this.speed.textContent = `${Math.round(p.move.velocity.length2d())}`;
    this.health.textContent = String(Math.max(0, p.health));
    this.health.parentElement!.classList.toggle('low', p.health <= 25);
    this.armor.textContent = String(p.armor);
    this.helmet.style.display = p.helmet ? 'inline' : 'none';
    this.money.textContent = `$${p.money}`;

    const w = p.weapon;
    if (w && w.def.clip > 0) {
      this.ammo.textContent = `${w.clip} | ${w.reserve}`;
      this.weaponName.textContent = w.def.name + (w.silenced ? ' (S)' : '') + (w.burst ? ' (burst)' : '');
    } else if (w?.def.slot === 'grenade') {
      this.ammo.textContent = String(p.grenades[w.def.id] ?? 0);
      this.weaponName.textContent = w.def.name;
    } else {
      this.ammo.textContent = '';
      this.weaponName.textContent = w?.def.name ?? '';
    }

    this.crosshair.style.setProperty('--gap', `${Math.round(3 + spreadPx)}px`);
    this.crosshair.style.display = scoped || !p.alive || w?.def.zoom?.length === 2 ? 'none' : 'block';
    this.scope.style.display = scoped ? 'block' : 'none';

    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.5);
    this.damageFlash.style.opacity = String(this.hurtLevel * 0.6);

    if (now > this.centerUntil) this.centerMsg.style.opacity = '0';
    while (this.feedEntries.length && this.feedEntries[0].until < now) this.feedEntries.shift()!.el.remove();
  }
}
