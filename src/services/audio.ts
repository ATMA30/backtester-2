/**
 * Small Web Audio cue engine.
 *
 * Two fixes over the previous version:
 *  - `enabled` was public but nothing ever assigned it, so the mute button in
 *    the topbar only changed the icon (see the effect in `App.tsx`);
 *  - the `AudioContext` starts suspended until a user gesture on Chrome, and
 *    nothing resumed it, so cues were silent for the whole session if the
 *    context happened to be created before the first interaction.
 */

/** One step of a cue: a frequency and when it starts, relative to the cue. */
interface Tone {
  readonly frequency: number;
  readonly offsetSeconds: number;
}

interface CueSpec {
  readonly type: OscillatorType;
  readonly gain: number;
  readonly durationSeconds: number;
  readonly tones: readonly Tone[];
  /** Optional glide target for the first tone (used by the click). */
  readonly glideToHz?: number;
}

/** Amplitude an exponential ramp decays to; must stay above zero. */
const SILENCE = 0.001;

function sequence(frequencies: readonly number[], stepSeconds: number): Tone[] {
  return frequencies.map((frequency, i) => ({ frequency, offsetSeconds: i * stepSeconds }));
}

const CUES = {
  click: {
    type: 'sine',
    gain: 0.12,
    durationSeconds: 0.04,
    tones: [{ frequency: 800, offsetSeconds: 0 }],
    glideToHz: 400,
  },
  win: {
    type: 'triangle',
    gain: 0.15,
    durationSeconds: 0.25,
    tones: sequence([523.25, 659.25, 783.99, 1046.5], 0.08),
  },
  loss: {
    type: 'sawtooth',
    gain: 0.12,
    durationSeconds: 0.2,
    tones: sequence([400, 320, 260], 0.1),
  },
  error: {
    type: 'sawtooth',
    gain: 0.12,
    durationSeconds: 0.16,
    tones: sequence([220, 180], 0.08),
  },
} as const satisfies Record<string, CueSpec>;

type CueName = keyof typeof CUES;

class SoundEngine {
  private context: AudioContext | null = null;

  /** Mirrors `useMarketStore.soundEnabled`; wired up by an effect in `App`. */
  public enabled = true;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.context) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.context = new Ctor();
      } catch {
        return null;
      }
    }

    // Browsers create the context suspended until a user gesture; resuming from
    // inside a click-driven cue is exactly the allowed moment.
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
    return this.context;
  }

  private play(name: CueName): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const cue: CueSpec = CUES[name];
    const start = ctx.currentTime;

    for (const tone of cue.tones) {
      const at = start + tone.offsetSeconds;
      const until = at + cue.durationSeconds;

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = cue.type;
      oscillator.frequency.setValueAtTime(tone.frequency, at);
      if (cue.glideToHz !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(cue.glideToHz, until);
      }

      gain.gain.setValueAtTime(cue.gain, at);
      gain.gain.exponentialRampToValueAtTime(SILENCE, until);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      // Release the graph once the tone ends instead of leaving nodes attached.
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };

      oscillator.start(at);
      oscillator.stop(until);
    }
  }

  public playClick(): void {
    this.play('click');
  }

  public playOrderWin(): void {
    this.play('win');
  }

  public playOrderLoss(): void {
    this.play('loss');
  }

  public playError(): void {
    this.play('error');
  }
}

export const sound = new SoundEngine();
