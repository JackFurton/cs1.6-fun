import type { Player } from '../game/player';
import type { Team } from '../maps/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export interface RoundResult {
  winner: Team;
  reason: 'elimination' | 'time' | 'bomb' | 'defuse' | 'nuke';
  mvp: Player | null;
}

export interface ScoreInfo {
  score: Record<Team, number> | null;
  history: RoundResult[];
  /** Rounds per half, for the divider in the history strip (0 = none). */
  half: number;
  matchOver: boolean;
}

const REASON_ICON = { elimination: '☠', time: '⌚︎', bomb: '✹', defuse: '✂', nuke: '☢' } as const;

export class Scoreboard {
  readonly el: HTMLDivElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'scoreboard';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  show(visible: boolean, players: Player[], info: ScoreInfo, title: string, local: Player): void {
    this.el.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const rounds = Math.max(1, info.history.length);
    const side = (t: Team) => {
      const list = players.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt);
      const rows = list
        .map((p) => {
          const cls = [p.alive ? '' : 'dead', p === local ? 'me' : ''].join(' ');
          const status = p.alive ? (p.weapons.c4 && local.team === 'T' ? 'Bomb' : '') : 'Dead';
          const hs = p.kills > 0 ? Math.round((p.headshots / p.kills) * 100) : 0;
          const adr = info.score ? Math.round(p.damageDealt / rounds) : '-';
          const mvp = p.mvps ? `<span class="mvp">★${p.mvps > 1 ? p.mvps : ''}</span>` : '';
          return `<tr class="${cls}"><td>${esc(p.name)} ${mvp}</td><td>${status}</td><td>${p.kills}</td><td>${p.assists}</td><td>${p.deaths}</td><td>${adr}</td><td>${hs}%</td><td>${p.isBot ? 'BOT' : '0'}</td></tr>`;
        })
        .join('');
      const name = t === 'T' ? 'Terrorists' : 'Counter-Terrorists';
      const score = info.score ? ` <span class="sb-score">${info.score[t]}</span>` : '';
      return `<table class="${t}"><thead><tr><th>${name}${score}</th><th></th><th>K</th><th>A</th><th>D</th><th>ADR</th><th>HS</th><th>Ping</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    const strip = info.history.length
      ? `<div class="sb-rounds">${info.history
          .map((r, i) => {
            const div = info.half && i === info.half ? '<span class="half"></span>' : '';
            const mvp = r.mvp ? ` MVP: ${esc(r.mvp.name)}` : '';
            return `${div}<span class="rd ${r.winner}" title="Round ${i + 1}: ${r.winner} (${r.reason})${mvp}">${REASON_ICON[r.reason]}</span>`;
          })
          .join('')}</div>`
      : '';
    const html = `<div class="sb-title">${info.matchOver ? 'Match over · ' : ''}${esc(title)}</div>${strip}${side('CT')}${side('T')}`;
    // Rebuilt every frame the board is open; skip the DOM write when nothing changed.
    if (html !== this.last) {
      this.el.innerHTML = html;
      this.last = html;
    }
  }
}
