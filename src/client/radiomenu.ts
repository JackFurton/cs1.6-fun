import { RADIO_MENUS, type RadioCommand } from '../game/radio';

/** 1.6-style numbered radio menu on Z, X and C. The mouse stays locked; number keys pick. */
export class RadioMenuUI {
  readonly el: HTMLDivElement;
  private open: number | null = null;
  onPick: (cmd: RadioCommand) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'radiomenu';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    addEventListener(
      'keydown',
      (e) => {
        if (this.open === null) return;
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        if (!m && e.code !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        const n = m ? Number(m[2]) : 0;
        const item = n > 0 ? RADIO_MENUS[this.open].items[n - 1] : undefined;
        this.close();
        if (item) this.onPick(item.cmd);
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Pressing the same key again closes it, a different one switches menus. */
  toggle(menu: number): void {
    if (this.open === menu) return this.close();
    this.open = menu;
    const m = RADIO_MENUS[menu];
    this.el.innerHTML = `<div class="radio-title">${m.title}</div>${m.items.map((it, i) => `<div><span class="num">${i + 1}.</span> ${it.text}</div>`).join('')}<div><span class="num">0.</span> Exit</div>`;
    this.el.style.display = 'block';
  }

  close(): void {
    this.open = null;
    this.el.style.display = 'none';
  }
}
