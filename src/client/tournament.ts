import type { Player } from '../game/player';
import type { AimTournament, TournamentMatch } from '../game/tournament';
import type { ClientMsg } from '../net/protocol';

type TournamentAction = Extract<ClientMsg, { t: 'tournament' }>;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Clickable duo lobby, compact live score and a bracket on Tab. */
export class TournamentPanel {
  private el: HTMLDivElement;
  private last = '';
  private notice = '';
  private noticeUntil = 0;
  onAction: (action: TournamentAction) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tournament';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.duo !== undefined) this.onAction({ t: 'tournament', action: 'duo', duo: Number(button.dataset.duo) });
      else if (button.dataset.ready !== undefined) this.onAction({ t: 'tournament', action: 'ready', ready: button.dataset.ready === 'true' });
      else if (button.dataset.again !== undefined) this.onAction({ t: 'tournament', action: 'again' });
    });
  }

  message(text: string): void {
    this.notice = text;
    this.noticeUntil = performance.now() + 4500;
  }

  update(mode: AimTournament | null, players: Player[], me: Player, time: number, tab: boolean, menu: boolean): void {
    this.el.hidden = !mode || menu;
    if (!mode || menu) return;
    const s = mode.state;
    const mine = mode.duoFor(me)?.id;
    const current = mode.current;
    const seconds = Math.max(0, Math.ceil(s.phaseEnd - time));
    const duoName = (id: number | null) => id === null ? 'TBD' : `Duo ${id + 1}`;
    const names = (id: number | null) => id === null ? 'Awaiting winner' : mode.members(id).map((p) => escape(p.name)).join(' + ');
    const member = (id: number) => {
      const p = players.find((p) => p.id === id);
      if (!p) return '';
      return `<span class="tourney-member${p.id === me.id ? ' you' : ''}">${escape(p.name)}${p.id === me.id ? ' (you)' : ''}<small>${p.isBot ? 'BOT' : s.ready.includes(p.id) ? 'READY ✓' : 'PLAYER'}</small></span>`;
    };
    const matchCard = (m: TournamentMatch) => `<div class="tourney-match${m.id === s.current && s.phase !== 'lobby' ? ' current' : ''}">
      ${m.duos.map((id, i) => `<div class="${id === m.winner && id !== null ? 'winner' : ''}${id === mine ? ' mine' : ''}"><span>${duoName(id)}<small>${names(id)}</small></span><b>${m.score[i]}</b></div>`).join('')}
    </div>`;
    const bracket = `<div class="tourney-bracket">${(['Quarterfinal', 'Semifinal', 'Final'] as const).map((stage) => `<section><h3>${stage}${stage !== 'Final' ? 's' : ''}</h3>${s.matches.filter((m) => m.stage === stage).map(matchCard).join('')}</section>`).join('')}</div>`;
    let html: string;
    if (s.phase === 'lobby') {
      const ready = s.ready.includes(me.id);
      const humans = players.filter((p) => !p.isBot).length;
      html = `<div class="tourney-overlay interactive"><div class="tourney-box">
        <div class="tourney-eyebrow">16 PLAYERS · 8 DUOS · BEST OF THREE</div>
        <h1>AIM TOURNAMENT</h1>
        <p>Pick the same duo as your friend, then both click Ready. Bots fill the empty seats.</p>
        <div class="tourney-duos">${s.duos.map((d) => `<button data-duo="${d.id}" class="tourney-duo${d.id === mine ? ' selected' : ''}" ${d.id !== mine && mode.members(d.id).every((p) => !p.isBot) ? 'disabled' : ''}>
          <b>Duo ${d.id + 1}${d.id === mine ? ' · YOUR TEAM' : ''}</b>${d.members.map(member).join('')}
          <span class="tourney-opponent">Quarterfinal vs Duo ${(d.id ^ 1) + 1}</span>
        </button>`).join('')}</div>
        <div class="tourney-footer"><span>${humans}/16 players · ${16 - humans} bots<br><small>AK-47 + Desert Eagle + armor · first to 2 wins · 90s rounds</small></span>
        <button class="tourney-ready${ready ? ' ready' : ''}" data-ready="${!ready}">${ready ? 'Ready ✓ — click to cancel' : 'Ready up'}</button></div>
        <p class="tourney-status">${s.phaseEnd ? `Everyone ready. Starting in ${seconds}s…` : 'Waiting for everyone to ready up. Invite your friend before starting.'}</p>
        <p class="tourney-notice">${performance.now() < this.noticeUntil ? escape(this.notice) : 'Teams lock when the tournament starts. The next duo plays as soon as a match finishes.'}</p>
      </div></div>`;
    } else {
      const myNext = s.matches.find((m) => m.winner === null && m.duos.includes(mine ?? -1));
      const eliminated = mine !== undefined && s.matches.some((m) => m.winner !== null && m.duos.includes(mine) && m.winner !== mine);
      const status = s.phase === 'complete' ? s.result : s.phase === 'freeze' ? `Round ${mode.round} starts in ${seconds}s` : s.phase === 'live' ? `Round ${mode.round} · ${seconds}s` : `${s.result} · next in ${seconds}s`;
      const personal = mine === undefined ? 'Spectating' : eliminated ? `Duo ${mine + 1} eliminated · spectating` : current?.duos.includes(mine) ? `Your team: Duo ${mine + 1}${me.alive ? '' : ' · spectating'}` : myNext ? `Your team: Duo ${mine + 1} · waiting for ${myNext.stage.toLowerCase()}` : `Duo ${mine + 1} · through to the next stage`;
      html = `<div class="tourney-banner"><div class="tourney-eyebrow">${current?.stage.toUpperCase()} · BEST OF THREE</div>
        <b>${duoName(current?.duos[0] ?? null)} <strong>${current?.score[0]} : ${current?.score[1]}</strong> ${duoName(current?.duos[1] ?? null)}</b>
        <span>${escape(status)}</span><small>${personal} · hold Tab for bracket</small></div>`;
      if (tab || s.phase === 'complete') html += `<div class="tourney-overlay${s.phase === 'complete' ? ' interactive' : ''}"><div class="tourney-box">
        <div class="tourney-eyebrow">AIM TOURNAMENT · EIGHT DUOS</div><h1>${s.phase === 'complete' ? escape(s.result) : 'THE BRACKET'}</h1>
        ${s.phase === 'complete' ? `<p>${names(s.champion)}</p>` : `<p>${personal}</p>`}${bracket}
        ${s.phase === 'complete' ? '<div class="tourney-footer"><span>Best of three · single elimination</span><button class="tourney-ready" data-again>New tournament — keep duos</button></div>' : '<p>Release Tab to return to the match. Mouse1 / Mouse2 switches the player you spectate.</p>'}
      </div></div>`;
    }
    if (html !== this.last) {
      this.el.innerHTML = html;
      this.last = html;
    }
  }
}
