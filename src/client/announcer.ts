import type { Audio } from './audio';

export type AnnouncerPack = 'classic' | 'chef' | 'off';

export type Cue = 'go' | 'planted' | 'defused' | 'ctwin' | 'terwin' | 'spotted' | 'fireinhole' | 'rotate' | 'headshot' | 'multikill' | 'lastalive' | 'matchwin' | 'matchlose' | 'flashed';

/** Lines per cue; one is picked at random. Classic follows the 1.6 radio. */
const LINES: Record<Exclude<AnnouncerPack, 'off'>, Partial<Record<Cue, string[]>>> = {
  classic: {
    go: ['Go go go!', 'Move out!', "Let's go!", 'Lock and load.', 'Stick together, team.'],
    planted: ['The bomb has been planted.'],
    defused: ['Bomb has been defused.'],
    ctwin: ['Counter-Terrorists win.'],
    terwin: ['Terrorists win.'],
    spotted: ['Enemy spotted.'],
    fireinhole: ['Fire in the hole!'],
    rotate: ['Fall back!'],
    lastalive: ["You're the last one standing."],
    matchwin: ['Match won.'],
    matchlose: ['Match lost.'],
  },
  // An original over-the-top TV chef, not any real person's lines.
  chef: {
    go: ['Right! Service! Go go go!', "Come on, move it! Tonight's special is Terrorist!", "Let's cook!", "Hands on the grips, heads on a swivel. Service!"],
    planted: ["The bomb's in the oven! Thirty-five seconds!", "It's planted! Somebody get in there before it's burnt to a crisp!"],
    defused: ['Defused! Finally, someone who follows a recipe!', 'Beautiful. Absolutely beautiful defuse.'],
    ctwin: ['Counter-Terrorists win. That is how you run a kitchen!', 'CTs take it. Clean plate!'],
    terwin: ['Terrorists win! The CTs got absolutely roasted!', 'Terrorists take it. Utterly raw defending!'],
    spotted: ['Contact! Chef on the pass!', "Enemy spotted, don't just stand there!"],
    fireinhole: ["Nade out! Something's cooking!", 'Fire in the hole, extra spicy!'],
    rotate: ["Get back! You're overcooking it!"],
    headshot: ['Headshot! Perfectly seasoned!', 'Right in the dome. Chef’s kiss!', 'Now THAT is a headshot!'],
    multikill: ['Multi kill! Plates flying out the kitchen!', "You're on fire! Keep them coming!"],
    lastalive: ["It's just you now. Don't you dare burn this!", 'Last one standing. No pressure, sweetheart!'],
    matchwin: ['Match won! Michelin stars all round!'],
    matchlose: ['Match lost. Get out of my kitchen!'],
    flashed: ["You're blind! Like my old line cooks!"],
  },
};

/** Cues that map to a 1.6 radio file, used when the user's sound pack has it. */
const RADIO_FILE: Partial<Record<Cue, 'go' | 'planted' | 'defused' | 'ctwin' | 'terwin' | 'spotted' | 'fireinhole' | 'rotate'>> = {
  go: 'go',
  planted: 'planted',
  defused: 'defused',
  ctwin: 'ctwin',
  terwin: 'terwin',
  spotted: 'spotted',
  fireinhole: 'fireinhole',
  rotate: 'rotate',
};

/** Rank installed voices so we pick a natural-sounding English one when there is one. */
function voiceScore(v: SpeechSynthesisVoice, pack: AnnouncerPack): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (!v.lang.toLowerCase().startsWith('en')) return -100;
  // Edge and Windows 11 "Natural" voices, and Google's, are far less robotic than the old SAPI ones.
  if (n.includes('natural') || n.includes('neural') || n.includes('online')) s += 40;
  if (n.includes('google')) s += 25;
  if (n.includes('premium') || n.includes('enhanced') || n.includes('siri')) s += 30;
  if (pack === 'chef') {
    if (v.lang.toLowerCase() === 'en-gb' || n.includes('uk') || n.includes('british')) s += 20;
    if (/ryan|daniel|thomas|george|oliver|arthur/.test(n)) s += 10;
  } else if (/guy|david|mark|davis|tony|andrew|christopher|eric|male/.test(n)) s += 10;
  if (v.localService) s += 2;
  return s;
}

export class Announcer {
  pack: AnnouncerPack = 'classic';
  private voice: SpeechSynthesisVoice | null = null;
  private lastCue = new Map<Cue, number>();

  constructor(private audio: Audio) {
    if (typeof speechSynthesis === 'undefined') return;
    // Voices load asynchronously in Chrome; pick again whenever the list changes.
    speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice());
    this.pickVoice();
  }

  setPack(p: AnnouncerPack): void {
    this.pack = p;
    this.pickVoice();
  }

  private pickVoice(): void {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    this.voice = voices.reduce<SpeechSynthesisVoice | null>((best, v) => (!best || voiceScore(v, this.pack) > voiceScore(best, this.pack) ? v : best), null);
  }

  /** Say something for this cue, rate-limited so callouts don't pile up. */
  say(cue: Cue, minGap = 2): void {
    if (this.pack === 'off') return;
    const now = performance.now() / 1000;
    if ((this.lastCue.get(cue) ?? -10) > now - minGap) return;
    this.lastCue.set(cue, now);
    // Classic uses the real 1.6 radio wav when the user has the sound pack.
    const file = RADIO_FILE[cue];
    if (this.pack === 'classic' && file && this.audio.radioSample(file)) return;
    const lines = LINES[this.pack][cue];
    if (!lines?.length || typeof speechSynthesis === 'undefined') return;
    // Cut off the previous line for the important ones rather than queueing behind it.
    if (cue === 'planted' || cue === 'ctwin' || cue === 'terwin' || cue === 'defused') speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lines[Math.floor(Math.random() * lines.length)]);
    if (this.voice) u.voice = this.voice;
    u.rate = this.pack === 'chef' ? 1.12 : 1.05;
    u.pitch = this.pack === 'chef' ? 0.9 : 0.85;
    u.volume = Math.min(1, this.audio.volume * 1.4);
    speechSynthesis.speak(u);
  }
}
