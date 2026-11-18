/* =========================================================================
   AUDIO — synthesised SFX + wind bed. No assets, no network.
   ========================================================================= */
const Audio2 = (() => {
  let ctx = null, master = null, windSrc = null, windGain = null, windFilter = null;
  let noiseBuf = null, ready = false;

  function buildNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;      // brownish
      d[i] = last * 3.2 + white * 0.25;
    }
    return buf;
  }

  function ensure() {
    if (ready) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.audio ? 0.85 : 0;
      master.connect(ctx.destination);
      noiseBuf = buildNoise();
      // wind bed
      windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuf; windSrc.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = 0.7;
      windGain = ctx.createGain(); windGain.gain.value = 0;
      windSrc.connect(windFilter).connect(windGain).connect(master);
      windSrc.start();
      ready = true;
      return true;
    } catch (e) { return false; }
  }

  function setMuted(m) {
    if (!ready) { if (!m) ensure(); return; }
    master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.08);
  }

  function noise(dur, gain, type, freq, q, decay) {
    if (!ready || !settings.audio) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1 + Math.random() * 0.15;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(freq || 1200, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, (freq || 1200) * (decay || 0.25)), t + dur);
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(f0, f1, dur, gain, type) {
    if (!ready || !settings.audio) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    ensure, setMuted,
    get ready() { return ready; },
    fire(power) {
      const v = clamp((power || 60) / 100, 0.25, 1);
      noise(0.34, 0.55 * v + 0.15, 'lowpass', 2200, 0.9, 0.06);
      tone(190 * (0.7 + v * 0.5), 42, 0.3, 0.34 * v, 'triangle');
      setTimeout(() => noise(0.5, 0.12, 'highpass', 900, 0.6, 0.3), 90);
    },
    boom(big, dmg) {
      const s = clamp((dmg || 40) / 60, 0.4, 1.6) * (big ? 1.25 : 1);
      noise(0.55 * s, 0.42 * s, 'lowpass', 900, 0.8, 0.05);
      noise(0.9 * s, 0.2 * s, 'lowpass', 240, 0.6, 0.04);
      tone(120, 26, 0.5 * s, 0.42 * s, 'sine');
      tone(78, 18, 0.8 * s, 0.22 * s, 'triangle');
    },
    crumble() { noise(0.7, 0.17, 'lowpass', 520, 0.7, 0.25); },
    roll() { noise(0.22, 0.1, 'bandpass', 340, 2.5, 0.5); },
    tick() { tone(880, 620, 0.06, 0.07, 'square'); },
    turn() { tone(520, 760, 0.12, 0.1, 'sine'); setTimeout(() => tone(780, 1040, 0.14, 0.08, 'sine'), 90); },
    hit() { tone(300, 120, 0.2, 0.18, 'sawtooth'); noise(0.16, 0.2, 'bandpass', 1400, 1.2, 0.4); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f * 1.01, 0.28, 0.13, 'sine'), i * 110)); },
    lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, f * 0.98, 0.36, 0.14, 'triangle'), i * 150)); },
    wind(amount) {
      if (!ready) return;
      const a = clamp(Math.abs(amount) / WIND_MAX, 0, 1);
      const t = ctx.currentTime;
      windGain.gain.setTargetAtTime(settings.audio ? 0.03 + a * 0.13 : 0, t, 0.6);
      windFilter.frequency.setTargetAtTime(320 + a * 900, t, 0.6);
    },
    silenceWind() { if (ready) windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4); }
  };
})();
