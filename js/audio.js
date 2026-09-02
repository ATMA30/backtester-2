// ========================================================
//  AUDIO — Web Audio FX Sound Synthesizer
//  Zero external dependencies, synthesized realistic trading sounds
// ========================================================

let _audioCtx = null;
let soundEnabled = true;

function _getAudioCtx() {
  if (!_audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) _audioCtx = new AudioContext();
  }
  if (_audioCtx && _audioCtx.state === "suspended") {
    _audioCtx.resume();
  }
  return _audioCtx;
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById("btn-sound");
  if (btn) {
    btn.classList.toggle("active", soundEnabled);
    btn.title = soundEnabled ? "Son activé" : "Son coupé";
  }
  showToast(soundEnabled ? "Sons activés 🔊" : "Sons désactivés 🔇", "info", 1500);
}

function playSound(type) {
  if (!soundEnabled) return;
  const ctx = _getAudioCtx();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (type === "order") {
    // Crisp ascending double blip for buy/sell order execution
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.08); // A5

    osc2.frequency.setValueAtTime(880.0, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.16); // D6

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.09);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.22);

  } else if (type === "tp") {
    // Joyful melodic tri-tone chime for Take Profit hit
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => { // C5, E5, G5, C6
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + i * 0.06;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.36);
    });

  } else if (type === "sl") {
    // Subdued descending minor tone for Stop Loss hit
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(329.63, now); // E4
    osc.frequency.exponentialRampToValueAtTime(220.0, now + 0.25); // A3

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.28);

  } else if (type === "tick") {
    // Ultra subtle woodblock click for replay ticks
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.02);

    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.025);

  } else if (type === "snap") {
    // Camera shutter sound for snapshot
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }
}
