import type { Vec3 } from '../engine/vec';
import type { WeaponId } from '../game/weapons';

interface ShotVoice {
  /** Low body frequency of the report. */
  body: number;
  /** Filter centre of the noise crack. */
  crack: number;
  len: number;
  gain: number;
}

const SHOT: Partial<Record<WeaponId, ShotVoice>> = {
  glock: { body: 180, crack: 2600, len: 0.18, gain: 0.7 },
  usp: { body: 150, crack: 2200, len: 0.2, gain: 0.8 },
  p228: { body: 160, crack: 2400, len: 0.2, gain: 0.8 },
  deagle: { body: 90, crack: 1500, len: 0.35, gain: 1.1 },
  fiveseven: { body: 170, crack: 2800, len: 0.18, gain: 0.7 },
  elite: { body: 170, crack: 2500, len: 0.18, gain: 0.75 },
  m3: { body: 70, crack: 1100, len: 0.5, gain: 1.2 },
  xm1014: { body: 75, crack: 1200, len: 0.4, gain: 1.1 },
  mac10: { body: 150, crack: 2600, len: 0.12, gain: 0.7 },
  tmp: { body: 200, crack: 3000, len: 0.08, gain: 0.35 },
  mp5: { body: 140, crack: 2400, len: 0.13, gain: 0.75 },
  ump45: { body: 120, crack: 2000, len: 0.15, gain: 0.8 },
  p90: { body: 150, crack: 2700, len: 0.12, gain: 0.75 },
  galil: { body: 110, crack: 2000, len: 0.2, gain: 0.95 },
  famas: { body: 115, crack: 2100, len: 0.2, gain: 0.95 },
  ak47: { body: 85, crack: 1700, len: 0.25, gain: 1.05 },
  m4a1: { body: 100, crack: 2000, len: 0.22, gain: 0.95 },
  sg552: { body: 105, crack: 2100, len: 0.22, gain: 0.95 },
  aug: { body: 105, crack: 2100, len: 0.22, gain: 0.95 },
  scout: { body: 90, crack: 1800, len: 0.4, gain: 1.05 },
  awp: { body: 55, crack: 1200, len: 0.7, gain: 1.4 },
  g3sg1: { body: 80, crack: 1700, len: 0.3, gain: 1.05 },
  sg550: { body: 85, crack: 1800, len: 0.3, gain: 1.0 },
  m249: { body: 90, crack: 1800, len: 0.22, gain: 1.0 },
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private volume = 0.6;
  private radioEnabled = true;

  /** Browsers only allow audio after a user gesture, so this is called from the play button. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Output node for a sound: panned in 3D, or straight to master for the local player. */
  private out(pos: Vec3 | null, gain: number, refDistance = 250): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (!pos) {
      g.connect(this.master);
      return g;
    }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = 1.1;
    p.maxDistance = 8000;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    g.connect(p).connect(this.master);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, len: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, len + 0.05);
  }

  private tone(dest: AudioNode, t: number, len: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  shot(weapon: WeaponId, silenced: boolean, pos: Vec3 | null): void {
    const v = SHOT[weapon];
    if (!v) return;
    const dest = this.out(pos, silenced ? 0.35 : v.gain, silenced ? 120 : 400);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    if (silenced) {
      this.noiseBurst(dest, t, 0.09, 'bandpass', 900, 1.2, 0.8);
      this.tone(dest, t, 0.05, 400, 120, 0.3);
      return;
    }
    this.noiseBurst(dest, t, v.len * 0.5, 'bandpass', v.crack, 0.8, 1);
    this.noiseBurst(dest, t, v.len, 'lowpass', v.crack * 0.5, 0.7, 0.9);
    this.tone(dest, t, v.len * 0.8, v.body * 1.8, v.body * 0.5, 0.9);
    // Distant echo tail.
    this.noiseBurst(dest, t + 0.03, v.len * 2, 'lowpass', 600, 0.5, 0.25, 0.02);
  }

  step(pos: Vec3 | null, tex: string, land: boolean): void {
    const dest = this.out(pos, land ? 0.7 : 0.45, 180);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    const metal = tex.startsWith('metal') || tex.startsWith('container');
    const wood = tex.startsWith('crate') || tex === 'wood' || tex === 'door';
    if (metal) {
      this.noiseBurst(dest, t, 0.12, 'bandpass', 2400, 4, 0.8);
      this.tone(dest, t, 0.15, 520 + Math.random() * 80, 480, 0.12, 'triangle');
    } else if (wood) {
      this.noiseBurst(dest, t, 0.1, 'bandpass', 700, 2, 0.9);
      this.tone(dest, t, 0.08, 180, 120, 0.3);
    } else {
      this.noiseBurst(dest, t, 0.09, 'bandpass', 1200 + Math.random() * 400, 1.5, 0.7);
      this.noiseBurst(dest, t, 0.07, 'lowpass', 400, 1, 0.5);
    }
  }

  impact(pos: Vec3, tex: string): void {
    const dest = this.out(pos, 0.25, 100);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    if (tex.startsWith('metal') || tex.startsWith('container')) {
      if (Math.random() < 0.3) this.tone(dest, t, 0.25, 2800 + Math.random() * 800, 1200, 0.2, 'sine');
      this.noiseBurst(dest, t, 0.06, 'highpass', 3000, 1, 0.8);
    } else {
      this.noiseBurst(dest, t, 0.06, 'bandpass', 1500, 1, 0.8);
    }
  }

  hit(pos: Vec3 | null, headshot: boolean, helmet: boolean): void {
    const dest = this.out(pos, 0.6, 200);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    if (headshot && helmet) {
      // The 1.6 helmet "tink".
      this.tone(dest, t, 0.3, 3200, 3000, 0.4, 'triangle');
      this.tone(dest, t, 0.2, 4700, 4500, 0.2, 'sine');
    }
    this.noiseBurst(dest, t, 0.12, 'lowpass', 700, 1, 1);
    this.tone(dest, t, 0.1, 160, 70, 0.5);
  }

  click(pos: Vec3 | null, freq = 2500, gain = 0.3, delay = 0): void {
    const dest = this.out(pos, gain, 100);
    if (!dest) return;
    const t = this.ctx!.currentTime + delay;
    this.noiseBurst(dest, t, 0.03, 'bandpass', freq, 3, 1);
    this.tone(dest, t, 0.03, freq * 0.4, freq * 0.3, 0.3, 'square');
  }

  reload(pos: Vec3 | null, duration: number, shell: boolean): void {
    if (shell) {
      this.click(pos, 1800, 0.3, duration * 0.4);
      return;
    }
    this.click(pos, 1500, 0.35, duration * 0.2);
    this.click(pos, 1900, 0.4, duration * 0.55);
    this.click(pos, 2600, 0.45, duration * 0.8);
  }

  swoosh(pos: Vec3 | null, hit: 'none' | 'wall' | 'player'): void {
    const dest = this.out(pos, 0.5, 150);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f).connect(g).connect(dest);
    src.start(t, 0, 0.25);
    if (hit === 'wall') this.tone(dest, t + 0.08, 0.2, 3000, 2500, 0.3, 'triangle');
    if (hit === 'player') this.noiseBurst(dest, t + 0.06, 0.12, 'lowpass', 600, 1, 1);
  }

  beep(pos: Vec3 | null, freq = 1850, gain = 0.5): void {
    const dest = this.out(pos, gain, 600);
    if (!dest) return;
    this.tone(dest, this.ctx!.currentTime, 0.12, freq, freq, 0.6, 'square');
  }

  explosion(pos: Vec3 | null, big = false): void {
    const dest = this.out(pos, big ? 2 : 1.3, big ? 2000 : 700);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(dest, t, big ? 2.5 : 1.2, 'lowpass', big ? 500 : 900, 0.7, 1, 0.005);
    this.tone(dest, t, big ? 1.5 : 0.7, 90, 25, 1);
  }

  hiss(pos: Vec3 | null): void {
    const dest = this.out(pos, 0.5, 300);
    if (!dest) return;
    this.noiseBurst(dest, this.ctx!.currentTime, 2.5, 'highpass', 2500, 0.5, 0.6, 0.05);
  }

  /** The post-flash ear ring. */
  ring(strength: number): void {
    const dest = this.out(null, 0.25 * strength);
    if (!dest) return;
    this.tone(dest, this.ctx!.currentTime, 2.5 * strength + 0.5, 3200, 3100, 0.4, 'sine');
  }

  ui(freq = 900): void {
    const dest = this.out(null, 0.2);
    if (!dest) return;
    this.tone(dest, this.ctx!.currentTime, 0.06, freq, freq, 0.4, 'square');
  }

  setRadio(on: boolean): void {
    this.radioEnabled = on;
  }

  /** Radio lines via the browser's speech synth, standing in for 1.6's radio wavs. */
  radio(text: string): void {
    if (!this.radioEnabled || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    u.pitch = 0.8;
    u.volume = Math.min(1, this.volume * 1.2);
    speechSynthesis.speak(u);
  }
}
