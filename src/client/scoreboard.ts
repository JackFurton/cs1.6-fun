import type { Player } from '../game/player';
import type { Team } from '../maps/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class Scoreboard {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'scoreboard';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  show(visible: boolean, players: Player[], score: Record<Team, number> | null, title: string, local: Player): void {
    this.el.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const side = (t: Team) => {
      const list = players.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const rows = list
        .map((p) => {
          const cls = [p.alive ? '' : 'dead', p === local ? 'me' : ''].join(' ');
          const status = p.alive ? (p.weapons.c4 && local.team === 'T' ? 'Bomb' : '') : 'Dead';
          return `<tr class="${cls}"><td>${esc(p.name)}</td><td>${status}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.isBot ? 'BOT' : '0'}</td></tr>`;
        })
        .join('');
      const name = t === 'T' ? 'Terrorists' : 'Counter-Terrorists';
      return `<table class="${t}"><thead><tr><th>${name}${score ? ` <span class="sb-score">${score[t]}</span>` : ''}</th><th></th><th>Score</th><th>Deaths</th><th>Latency</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    this.el.innerHTML = `<div class="sb-title">${esc(title)}</div>${side('CT')}${side('T')}`;
  }
}
