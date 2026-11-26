/* GD Krillion 1.1.0 — tiny synthesized sound engine (Web Audio API).
 * No audio files: every cue is generated with oscillators and noise buffers.
 * Exposes window.GDKSfx.
 */
(() => {
  'use strict';

  let ctx = null;
  let enabled = true;

  function context() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, at, duration, type = 'square', level = 0.07, slideTo = null) {
    const c = context();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function noise(at, duration, level = 0.035, cutoff = 1400) {
    const c = context();
    if (!c) return;
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = c.createGain();
    gain.gain.value = level;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(c.currentTime + at);
  }

  // [frequency, start offset, duration, wave, level, optional glide target]
  const CUES = {
    start:  [[330, 0, .09, 'square'], [440, .09, .09, 'square'], [554, .18, .16, 'square']],
    search: [[520, 0, .07, 'sine', .045], [700, .07, .09, 'sine', .045]],
    next:   [[620, 0, .07, 'triangle', .05]],
    success:[[523, 0, .11, 'square', .06], [659, .10, .11, 'square', .06], [784, .20, .20, 'square', .065]],
    error:  [[220, 0, .13, 'sawtooth', .045], [165, .12, .18, 'sawtooth', .045]],
    results:[[523, 0, .12, 'square', .06], [659, .12, .12, 'square', .06], [784, .24, .12, 'square', .06], [1046, .36, .34, 'square', .07]],
    best:   [[1046, .55, .10, 'triangle', .06], [1318, .65, .22, 'triangle', .065]]
  };

  function play(name) {
    if (!enabled) return;
    const cue = CUES[name];
    if (!cue) return;
    if (name === 'error') noise(0, .12, .03, 1200);
    if (name === 'search') noise(0, .08, .018, 2600);
    for (const [freq, at, dur, type, level, slideTo] of cue) {
      tone(freq, at, dur, type, level, slideTo);
    }
  }

  window.GDKSfx = {
    play,
    get enabled() { return enabled; },
    set enabled(value) { enabled = !!value; }
  };
})();
