import * as Tone from "tone";
import type { InstrumentRole } from "../../../shared/types";

export type AudioMonitorMode = "my-instrument" | "observatory-mix";

export type DrumVoice = "kick" | "snare" | "hihat" | "openhat";

export interface DrumTriggerEvent {
  voice: DrumVoice;
  velocity: number;
  time?: number;
  step: number;
  sourceRole: InstrumentRole;
}

export interface BassTriggerEvent {
  note: string;
  duration: string;
  velocity: number;
  filterCutoffHz: number;
  time?: number;
  step: number;
  sourceRole: InstrumentRole;
}

export interface PianoTriggerEvent {
  notes: string[];
  chordSymbol: string;
  duration: string;
  velocity: number;
  time?: number;
  step: number;
  sourceRole: InstrumentRole;
}

export interface LeadTriggerEvent {
  note: string;
  duration: string;
  velocity: number;
  vibratoDepth: number;
  time?: number;
  step: number;
  sourceRole: InstrumentRole;
  motifId?: string;
}

/**
 * Clean synthesis adapter contract used by `OrchestraEngine`.
 * Allows the real `Tone.js` `SynthRack` in browser runtime and a lightweight
 * `RecordingSynthAdapter` spy in `vitest` unit tests.
 */
export interface SynthAdapter {
  unlockAudio(): Promise<void>;
  isAudioUnlocked(): boolean;
  getMonitorMode(): AudioMonitorMode;
  setMonitorMode(mode: AudioMonitorMode): void;
  getLocalRole(): InstrumentRole;
  setLocalRole(role: InstrumentRole): void;
  shouldSynthesizeRole(role: InstrumentRole): boolean;
  triggerDrum(event: DrumTriggerEvent): void;
  triggerBass(event: BassTriggerEvent): void;
  triggerPiano(event: PianoTriggerEvent): void;
  triggerLead(event: LeadTriggerEvent): void;
  dispose(): void;
}

/**
 * Real `Tone.js` multi-instrument synthesis rack with a master dynamics chain:
 *   Instruments -> Tone.Compressor -> Tone.Limiter(-2) -> Tone.Destination
 *
 * Strictly adheres to Invariant #1:
 * - Zero React state or timers inside the audio synthesis rack.
 * - All note triggers are invoked directly from the engine's transport schedule callback.
 */
export class SynthRack implements SynthAdapter {
  private localRole: InstrumentRole;
  private monitorMode: AudioMonitorMode;
  private unlocked = false;
  private initialized = false;

  // Master bus chain
  private masterCompressor: Tone.Compressor | null = null;
  private masterLimiter: Tone.Limiter | null = null;

  // Drums
  private kickSynth: Tone.MembraneSynth | null = null;
  private snareNoise: Tone.NoiseSynth | null = null;
  private snareBody: Tone.MembraneSynth | null = null;
  private hihatSynth: Tone.MetalSynth | null = null;

  // Bass
  private bassSynth: Tone.MonoSynth | null = null;

  // Piano
  private pianoSynth: Tone.PolySynth | null = null;
  private pianoChorus: Tone.Chorus | null = null;
  private pianoReverb: Tone.Reverb | null = null;

  // Lead
  private leadSynth: Tone.MonoSynth | null = null;
  private leadVibrato: Tone.Vibrato | null = null;
  private leadDelay: Tone.FeedbackDelay | null = null;

  constructor(
    localRole: InstrumentRole = "drums",
    monitorMode: AudioMonitorMode = "observatory-mix"
  ) {
    this.localRole = localRole;
    this.monitorMode = monitorMode;
  }

  public async unlockAudio(): Promise<void> {
    await Tone.start();
    if (!this.initialized) {
      this.initAudioGraph();
    }
    this.unlocked = true;
  }

  public isAudioUnlocked(): boolean {
    return this.unlocked;
  }

  public getMonitorMode(): AudioMonitorMode {
    return this.monitorMode;
  }

  public setMonitorMode(mode: AudioMonitorMode): void {
    this.monitorMode = mode;
  }

  public getLocalRole(): InstrumentRole {
    return this.localRole;
  }

  public setLocalRole(role: InstrumentRole): void {
    this.localRole = role;
  }

  public shouldSynthesizeRole(role: InstrumentRole): boolean {
    if (this.monitorMode === "observatory-mix") {
      return true;
    }
    return role === this.localRole;
  }

  private initAudioGraph(): void {
    if (this.initialized) {
      return;
    }

    // Master dynamics chain: Compressor -> Limiter(-2 dB) -> Destination
    this.masterLimiter = new Tone.Limiter(-2).toDestination();
    this.masterCompressor = new Tone.Compressor({
      threshold: -18,
      ratio: 3.5,
      attack: 0.008,
      release: 0.18,
    }).connect(this.masterLimiter);

    // 1. DRUMS: Kick (MembraneSynth) + Snare (NoiseSynth + Membrane body) + Hi-Hat (MetalSynth)
    this.kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.045,
      octaves: 6,
      oscillator: { type: "sine" },
      envelope: {
        attack: 0.001,
        decay: 0.28,
        sustain: 0.01,
        release: 0.12,
      },
      volume: -4,
    }).connect(this.masterCompressor);

    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: {
        attack: 0.001,
        decay: 0.14,
        sustain: 0,
        release: 0.06,
      },
      volume: -10,
    }).connect(this.masterCompressor);

    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 3,
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.001,
        decay: 0.1,
        sustain: 0,
        release: 0.05,
      },
      volume: -12,
    }).connect(this.masterCompressor);

    this.hihatSynth = new Tone.MetalSynth({
      envelope: {
        attack: 0.001,
        decay: 0.055,
        release: 0.02,
      },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4200,
      octaves: 1.5,
      volume: -18,
    }).connect(this.masterCompressor);

    // 2. BASS: Warm low-pass filtered MonoSynth
    this.bassSynth = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: {
        Q: 2.2,
        type: "lowpass",
        rolloff: -24,
      },
      envelope: {
        attack: 0.008,
        decay: 0.22,
        sustain: 0.35,
        release: 0.15,
      },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.18,
        sustain: 0.25,
        release: 0.15,
        baseFrequency: 110,
        octaves: 2.5,
      },
      volume: -6,
    }).connect(this.masterCompressor);

    // 3. PIANO: Warm polyphonic electric-piano with stereo Chorus + Reverb
    this.pianoReverb = new Tone.Reverb({
      decay: 2.2,
      wet: 0.25,
    }).connect(this.masterCompressor);

    this.pianoChorus = new Tone.Chorus({
      frequency: 1.8,
      delayTime: 3.5,
      depth: 0.45,
      wet: 0.35,
    })
      .start()
      .connect(this.pianoReverb);

    this.pianoSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fmsine", modulationIndex: 2.2, harmonicity: 2 },
      envelope: {
        attack: 0.018,
        decay: 0.65,
        sustain: 0.35,
        release: 0.9,
      },
      volume: -10,
    }).connect(this.pianoChorus);

    // 4. LEAD: Expressive melodic synth/violin voice with vibrato + subtle delay
    this.leadDelay = new Tone.FeedbackDelay({
      delayTime: "8n.",
      feedback: 0.22,
      wet: 0.2,
    }).connect(this.masterCompressor);

    this.leadVibrato = new Tone.Vibrato({
      frequency: 5.2,
      depth: 0.12,
    }).connect(this.leadDelay);

    this.leadSynth = new Tone.MonoSynth({
      oscillator: { type: "fmsawtooth", modulationIndex: 1.8, harmonicity: 1 },
      filter: {
        Q: 1.5,
        type: "lowpass",
        rolloff: -12,
      },
      envelope: {
        attack: 0.025,
        decay: 0.25,
        sustain: 0.6,
        release: 0.35,
      },
      filterEnvelope: {
        attack: 0.03,
        decay: 0.25,
        sustain: 0.5,
        release: 0.3,
        baseFrequency: 420,
        octaves: 3,
      },
      volume: -8,
    }).connect(this.leadVibrato);

    this.initialized = true;
  }

  public triggerDrum(event: DrumTriggerEvent): void {
    if (!this.unlocked || !this.shouldSynthesizeRole(event.sourceRole)) {
      return;
    }
    const time = event.time;
    const vel = Math.max(0.05, Math.min(1, event.velocity));

    if (event.voice === "kick") {
      this.kickSynth?.triggerAttackRelease("C1", "8n", time, vel);
    } else if (event.voice === "snare") {
      this.snareNoise?.triggerAttackRelease("16n", time, vel);
      this.snareBody?.triggerAttackRelease("G2", "16n", time, vel * 0.8);
    } else if (event.voice === "openhat") {
      this.hihatSynth?.triggerAttackRelease("C6", "8n", time, vel * 0.7);
    } else {
      this.hihatSynth?.triggerAttackRelease("C6", "32n", time, vel * 0.55);
    }
  }

  public triggerBass(event: BassTriggerEvent): void {
    if (!this.unlocked || !this.shouldSynthesizeRole(event.sourceRole)) {
      return;
    }
    if (this.bassSynth) {
      this.bassSynth.filterEnvelope.baseFrequency = Math.max(
        60,
        Math.min(800, event.filterCutoffHz)
      );
      this.bassSynth.triggerAttackRelease(
        event.note,
        event.duration,
        event.time,
        Math.max(0.05, Math.min(1, event.velocity))
      );
    }
  }

  public triggerPiano(event: PianoTriggerEvent): void {
    if (!this.unlocked || !this.shouldSynthesizeRole(event.sourceRole)) {
      return;
    }
    if (this.pianoSynth && event.notes.length > 0) {
      this.pianoSynth.triggerAttackRelease(
        event.notes,
        event.duration,
        event.time,
        Math.max(0.05, Math.min(1, event.velocity))
      );
    }
  }

  public triggerLead(event: LeadTriggerEvent): void {
    if (!this.unlocked || !this.shouldSynthesizeRole(event.sourceRole)) {
      return;
    }
    if (this.leadVibrato) {
      this.leadVibrato.depth.value = Math.max(
        0,
        Math.min(0.5, event.vibratoDepth)
      );
    }
    this.leadSynth?.triggerAttackRelease(
      event.note,
      event.duration,
      event.time,
      Math.max(0.05, Math.min(1, event.velocity))
    );
  }

  public dispose(): void {
    this.kickSynth?.dispose();
    this.snareNoise?.dispose();
    this.snareBody?.dispose();
    this.hihatSynth?.dispose();
    this.bassSynth?.dispose();
    this.pianoSynth?.dispose();
    this.pianoChorus?.dispose();
    this.pianoReverb?.dispose();
    this.leadSynth?.dispose();
    this.leadVibrato?.dispose();
    this.leadDelay?.dispose();
    this.masterCompressor?.dispose();
    this.masterLimiter?.dispose();
    this.initialized = false;
  }
}

/**
 * Lightweight recording spy implementing `SynthAdapter` for deterministic
 * `vitest` unit tests without requiring Web Audio API context.
 */
export class RecordingSynthAdapter implements SynthAdapter {
  public readonly drumEvents: DrumTriggerEvent[] = [];
  public readonly bassEvents: BassTriggerEvent[] = [];
  public readonly pianoEvents: PianoTriggerEvent[] = [];
  public readonly leadEvents: LeadTriggerEvent[] = [];

  private unlocked = true;
  private localRole: InstrumentRole;
  private monitorMode: AudioMonitorMode;

  constructor(
    localRole: InstrumentRole = "drums",
    monitorMode: AudioMonitorMode = "observatory-mix"
  ) {
    this.localRole = localRole;
    this.monitorMode = monitorMode;
  }

  public async unlockAudio(): Promise<void> {
    this.unlocked = true;
  }

  public isAudioUnlocked(): boolean {
    return this.unlocked;
  }

  public getMonitorMode(): AudioMonitorMode {
    return this.monitorMode;
  }

  public setMonitorMode(mode: AudioMonitorMode): void {
    this.monitorMode = mode;
  }

  public getLocalRole(): InstrumentRole {
    return this.localRole;
  }

  public setLocalRole(role: InstrumentRole): void {
    this.localRole = role;
  }

  public shouldSynthesizeRole(role: InstrumentRole): boolean {
    if (this.monitorMode === "observatory-mix") {
      return true;
    }
    return role === this.localRole;
  }

  public triggerDrum(event: DrumTriggerEvent): void {
    if (this.shouldSynthesizeRole(event.sourceRole)) {
      this.drumEvents.push(event);
    }
  }

  public triggerBass(event: BassTriggerEvent): void {
    if (this.shouldSynthesizeRole(event.sourceRole)) {
      this.bassEvents.push(event);
    }
  }

  public triggerPiano(event: PianoTriggerEvent): void {
    if (this.shouldSynthesizeRole(event.sourceRole)) {
      this.pianoEvents.push(event);
    }
  }

  public triggerLead(event: LeadTriggerEvent): void {
    if (this.shouldSynthesizeRole(event.sourceRole)) {
      this.leadEvents.push(event);
    }
  }

  public clear(): void {
    this.drumEvents.length = 0;
    this.bassEvents.length = 0;
    this.pianoEvents.length = 0;
    this.leadEvents.length = 0;
  }

  public dispose(): void {
    this.clear();
  }
}
