import type { Vec3 } from '../engine/vec';
import type { WeaponId } from '../game/weapons';
import { PACK_ROOT, SOUND_FILES } from './soundpack';

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
  volume = 0.6;
  private radioEnabled = true;
  /** Decoded files from the user's sound pack, by path. */
  private samples = new Map<string, AudioBuffer>();
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private listener = { x: 0, y: 0, z: 0 };
  private nukeSources: AudioScheduledSourceNode[] = [];
  private strategicClip: AudioBuffer | null = null;
  private readonly strategicData = fetch('audio/strategic-launch-detected.mp3')
    .then((r) => r.ok ? r.arrayBuffer() : null).catch(() => null);
  /** How roomy the map sounds: 0 open desert, 1 big hall. */
  roominess = 0.5;

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

    // Shared reverb: a synthetic impulse (decaying stereo noise) gives shots and steps a space to live in.
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * (0.6 + this.roominess * 1.2));
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.5) * (i < 200 ? i / 200 : 1);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    void this.loadPack();
    void this.strategicData.then(async (data) => {
      if (data) this.strategicClip = await ctx.decodeAudioData(data);
    }).catch(() => { /* Speech synthesis remains available if decoding fails. */ });
  }

  /** Loads any 1.6 sound files the user dropped into public/sounds/cstrike/. */
  private async loadPack(): Promise<void> {
    let files: string[] = [];
    try {
      const res = await fetch('sounds/manifest.json');
      if (res.ok) files = await res.json();
    } catch {
      return;
    }
    const wanted = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === 'string') wanted.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(SOUND_FILES);
    const have = new Set(files);
    await Promise.all(
      [...wanted].map(async (path) => {
        const rel = (PACK_ROOT + path).replace(/^sounds\//, '').toLowerCase();
        if (!have.has(rel)) return;
        try {
          const buf = await (await fetch(PACK_ROOT + path)).arrayBuffer();
          this.samples.set(path, await this.ctx!.decodeAudioData(buf));
        } catch {
          // A file that won't decode just falls back to synthesis.
        }
      }),
    );
    if (this.samples.size) console.info(`sound pack: ${this.samples.size} files loaded`);
  }

  /** Plays one of `paths` if the pack has it; returns false so the caller can synthesize instead. */
  private sample(paths: string[] | undefined, pos: Vec3 | null, gain: number, ref = 250, delay = 0): boolean {
    if (!paths || !this.ctx) return false;
    const have = paths.filter((p) => this.samples.has(p));
    if (!have.length) return false;
    const dest = this.out(pos, gain, ref);
    if (!dest) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.samples.get(have[Math.floor(Math.random() * have.length)])!;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    src.connect(dest);
    src.start(this.ctx.currentTime + delay);
    return true;
  }

  hasPack(): boolean {
    return this.samples.size > 0;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.listener = { x, y, z };
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
      // A little room on your own gun too.
      const wet = ctx.createGain();
      wet.gain.value = 0.12 * (0.5 + this.roominess);
      g.connect(wet).connect(this.reverbSend);
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
    // Air eats the highs: far sounds are duller, and more of what you hear is the reverb.
    const l = this.listener;
    const dist = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, 20000 * Math.exp(-dist / 1400));
    g.connect(lp).connect(p).connect(this.master);
    const wet = ctx.createGain();
    wet.gain.value = Math.min(0.6, 0.12 + dist / 5000) * (0.5 + this.roominess);
    lp.connect(wet).connect(this.reverbSend);
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
    if (this.sample(silenced ? SOUND_FILES.silenced[weapon] : SOUND_FILES.gun[weapon], pos, silenced ? 0.6 : 0.9, silenced ? 150 : 500)) return;
    const dest = this.out(pos, silenced ? 0.35 : v.gain, silenced ? 120 : 400);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    if (silenced) {
      this.noiseBurst(dest, t, 0.09, 'bandpass', 900, 1.2, 0.8);
      this.tone(dest, t, 0.05, 400, 120, 0.3);
      return;
    }
    // Everything goes through a soft clipper, which is most of what makes a synthesized shot sound
    // like a gunshot instead of a burst of static.
    const drive = this.ctx!.createWaveShaper();
    drive.curve = this.driveCurve();
    drive.connect(dest);
    // Crack: very short bright transient.
    this.noiseBurst(drive, t, 0.025, 'highpass', v.crack * 1.4, 0.7, 1.4, 0.0005);
    // Blast: filtered noise with a fast attack, the body of the report.
    this.noiseBurst(drive, t, v.len * 0.55, 'bandpass', v.crack * 0.55, 0.6, 1.3, 0.001);
    // Thump: pitch-dropping sine, felt more than heard.
    this.tone(drive, t, v.len * 0.7, v.body * 2.2, v.body * 0.45, 1.3);
    this.tone(drive, t, 0.04, v.body * 6, v.body * 3, 0.4, 'triangle');
    // Mechanism: a small metallic tick a moment later, the bolt cycling.
    this.noiseBurst(dest, t + 0.035, 0.03, 'bandpass', 3800, 6, 0.12);
    // Low rumble tail.
    this.noiseBurst(dest, t + 0.02, v.len * 2.2, 'lowpass', 380, 0.5, 0.3, 0.015);
  }

  private drive?: Float32Array<ArrayBuffer>;
  private driveCurve(): Float32Array<ArrayBuffer> {
    if (this.drive) return this.drive;
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 2.6) / Math.tanh(2.6);
    }
    return (this.drive = c);
  }

  step(pos: Vec3 | null, tex: string, land: boolean): void {
    const surface = tex.startsWith('metal') || tex.startsWith('container') ? 'metal' : tex.startsWith('crate') || tex === 'wood' || tex === 'door' ? 'wood' : tex === 'tile' ? 'tile' : tex === 'snow' || tex.startsWith('ice') ? 'snow' : tex === 'sand' || tex === 'dirt' || tex === 'grass' ? 'dirt' : 'concrete';
    if (this.sample(SOUND_FILES.step[surface], pos, land ? 0.9 : 0.6, 180)) return;
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
    if (Math.random() < 0.4 && this.sample(SOUND_FILES.ric, pos, 0.35, 120)) return;
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
    const h = SOUND_FILES.hit;
    if (this.sample(headshot ? (helmet ? h.helmet : h.headshot) : helmet ? h.kevlar : h.flesh, pos, 0.8, 200)) return;
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
    const k = SOUND_FILES.knife;
    if (this.sample(hit === 'player' ? k.hit : hit === 'wall' ? k.wall : k.slash, pos, 0.7, 150)) return;
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
    if (this.sample(SOUND_FILES.c4.beep, pos, 0.7, 600)) return;
    const dest = this.out(pos, gain, 600);
    if (!dest) return;
    this.tone(dest, this.ctx!.currentTime, 0.12, freq, freq, 0.6, 'square');
  }

  explosion(pos: Vec3 | null, big = false): void {
    if (this.sample(big ? SOUND_FILES.c4.explode : SOUND_FILES.he, pos, 1.2, big ? 2000 : 700)) return;
    const dest = this.out(pos, big ? 2 : 1.3, big ? 2000 : 700);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(dest, t, big ? 2.5 : 1.2, 'lowpass', big ? 500 : 900, 0.7, 1, 0.005);
    this.tone(dest, t, big ? 1.5 : 0.7, 90, 25, 1);
  }

  strategicAlert(): boolean {
    if (!this.ctx || !this.strategicClip) return false;
    const dest = this.out(null, 1);
    if (!dest) return false;
    const source = this.ctx.createBufferSource();
    source.buffer = this.strategicClip;
    source.connect(dest);
    source.start();
    return true;
  }

  /** Air rushing past the incoming missile, building toward impact. */
  nukeLaunch(seconds: number): void {
    this.stopNukeWarning();
    const dest = this.out(null, 0.35);
    if (!dest || seconds <= 0) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const rush = ctx.createBufferSource();
    rush.buffer = this.noise;
    rush.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(6500, t + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.005, t);
    gain.gain.exponentialRampToValueAtTime(1, t + seconds);
    rush.connect(filter).connect(gain).connect(dest);
    rush.start(t);
    rush.stop(t + seconds);
    this.nukeSources = [rush];
  }

  stopNukeWarning(): void {
    for (const source of this.nukeSources) {
      source.stop();
      source.disconnect();
    }
    this.nukeSources = [];
  }

  nukeImpact(): void {
    this.stopNukeWarning();
    const dest = this.out(null, 1.2);
    if (!dest) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.noiseBurst(dest, t, 1, 'lowpass', 2200, 0.7, 1, 0.005);
    this.tone(dest, t, 4, 110, 18, 1.2);
    this.tone(dest, t + 0.1, 3, 52, 24, 0.7, 'triangle');
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 7);
    rumble.connect(filter).connect(gain).connect(dest);
    rumble.start(t);
    rumble.stop(t + 7);
  }

  hiss(pos: Vec3 | null): void {
    if (this.sample(SOUND_FILES.smoke, pos, 0.7, 300)) return;
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
  /** Plays a radio wav from the pack if present (1.6's own radio lines). */
  radioSample(key: keyof typeof SOUND_FILES.radio): boolean {
    return this.sample(SOUND_FILES.radio[key], null, 0.8);
  }

  sampleFor(key: 'flash' | 'bounce' | 'zoom' | 'empty' | 'draw' | 'plant' | 'defuse', pos: Vec3 | null): boolean {
    const f = SOUND_FILES;
    const paths = key === 'plant' ? f.c4.plant : key === 'defuse' ? f.c4.defuse : f[key];
    return this.sample(paths, pos, 0.7, 250);
  }

  radio(text: string): void {
    if (!this.radioEnabled || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    u.pitch = 0.8;
    u.volume = Math.min(1, this.volume * 1.2);
    speechSynthesis.speak(u);
  }
}
