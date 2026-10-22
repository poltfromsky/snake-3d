/**
 * Музыка вступления (заставка → обложка). Синтезируется Web Audio API на лету — без файлов и лицензий.
 * Настроение — медленная электроника в духе «slowed»-треков: 102 удара в минуту, ре минор,
 * пэд Dm – B♭ – F – C, эхо-«щипок», глубокий бас.
 *
 * Сценарий: INTRO_BARS тактов вступления (пэд постепенно открывается, к концу — нарастающий шум),
 * затем «дроп» ровно на границе такта: удар, тарелка и бит половинного размера — в этот момент
 * заставка резко сменяется обложкой. Дальше бит идёт по кругу, пока игрок не нажмёт на змейку.
 *
 *   const music = startIntroMusic({ volume: 0.5 });
 *   music.whenDrop(() => showCover());   // вызовется ровно в момент дропа (по часам звука)
 *   music.stop(800);
 */

export const BPM = 102;
export const INTRO_BARS = 6;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const LOOKAHEAD = 30; // секунд музыки, расписанных заранее: таймеры страницы бывают неточны и отстают от часов звука

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Аккорды пэда (MIDI) и корни баса. Вступление подводит к дропу на ре минор.
const CHORD = {
  Dm: { pad: [57, 60, 62, 65], root: 38 },
  Bb: { pad: [57, 58, 62, 65], root: 34 },
  F: { pad: [57, 60, 64, 65], root: 41 },
  C: { pad: [55, 60, 62, 64], root: 36 },
};
const INTRO = ['Dm', 'Bb', 'F', 'C', 'Bb', 'C'];
const LOOP = ['Dm', 'Bb', 'F', 'C'];
// «Щипок» с эхом: [доля такта в ударах, нота]. Мелодия из звуков аккорда, по-разному в каждом такте.
const PLUCK = {
  Dm: [[0, 74], [1.5, 77], [3, 81], [3.5, 79]],
  Bb: [[0, 74], [1.5, 77], [3, 82], [3.5, 81]],
  F: [[0, 72], [1.5, 76], [3, 81], [3.5, 77]],
  C: [[0, 72], [1.5, 74], [3, 79], [3.5, 76]],
};

function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Импульс реверберации: затухающий стереошум — «большой зал» без файла. */
function impulse(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

/**
 * @param {{ volume?: number }} [options] громкость 0…1 (громкость музыки из настроек игры)
 * @returns {{ playing: boolean, dropAt: number, whenDrop: (cb: () => void) => void, stop: (fadeMs?: number) => void }}
 */
export function startIntroMusic({ volume = 0.5 } = {}) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) {
    return { playing: false, dropAt: 0, whenDrop: (cb) => setTimeout(cb, INTRO_BARS * BAR * 1000), stop() {} };
  }
  const ctx = new Ctx();
  ctx.resume?.();
  const t0 = ctx.currentTime + 0.12;
  const dropAt = t0 + INTRO_BARS * BAR;

  // Общая шина: пэд и щипки — через реверберацию и эхо, всё — через мягкий компрессор.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(Math.min(1, volume) * 0.9, t0 + 1.2);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.25;
  glue.connect(master).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.2);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.5;
  reverb.connect(reverbOut).connect(glue);

  // Эхо на 3/8 такта с затуханием — главный «эффект» трека.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = BEAT * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2600;
  delay.connect(echoTone).connect(feedback).connect(delay);
  echoTone.connect(glue);
  echoTone.connect(reverb);

  // Пэд: фильтр медленно открывается за вступление; «пульс» громкости под бит после дропа.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.Q.value = 0.7;
  padFilter.frequency.setValueAtTime(500, t0);
  padFilter.frequency.exponentialRampToValueAtTime(2400, dropAt - 0.05);
  padFilter.frequency.setValueAtTime(3200, dropAt);
  const padBus = ctx.createGain();
  padBus.gain.value = 0.5;
  padFilter.connect(padBus);
  padBus.connect(glue);
  padBus.connect(reverb);

  const bassBus = ctx.createGain();
  bassBus.gain.value = 0.9;
  bassBus.connect(glue);
  const drumBus = ctx.createGain();
  drumBus.gain.value = 0.85;
  drumBus.connect(glue);
  const noise = noiseBuffer(ctx, 2);

  function pad(name, start, length) {
    for (const n of CHORD[name].pad) {
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n);
        o.detune.value = detune;
        const g = ctx.createGain();
        // Длинное перекрытие соседних аккордов — пэд переливается без провалов на стыке.
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.05, start + 0.6);
        g.gain.setValueAtTime(0.05, start + length);
        g.gain.linearRampToValueAtTime(0, start + length + 0.9);
        o.connect(g).connect(padFilter);
        o.start(start);
        o.stop(start + length + 1);
      }
    }
  }

  function pluck(name, barStart, level) {
    for (const [beat, n] of PLUCK[name]) {
      const start = barStart + beat * BEAT;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(level, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      o.connect(g);
      g.connect(glue);
      g.connect(delay);
      o.start(start);
      o.stop(start + 0.5);
    }
  }

  function sub(name, start, length, level) {
    const o = ctx.createOscillator();
    o.frequency.value = hz(CHORD[name].root);
    const g = ctx.createGain();
    // Как и пэд — с перекрытием соседних тактов, чтобы гул не проседал на стыке.
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + 0.4);
    g.gain.setValueAtTime(level, start + length);
    g.gain.linearRampToValueAtTime(0, start + length + 0.45);
    o.connect(g).connect(bassBus);
    o.start(start);
    o.stop(start + length + 0.5);
  }

  /** Бас после дропа: синкопа на 1, «и» второй доли, 3-й доле; с лёгким перегрузом. */
  function bassline(name, barStart) {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 420;
    shaper.connect(tone).connect(bassBus);
    for (const [beat, len] of [[0, 1.3], [1.5, 0.9], [2.5, 1.4]]) {
      const start = barStart + beat * BEAT;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(CHORD[name].root);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.32, start + 0.02);
      g.gain.setValueAtTime(0.32, start + len * BEAT - 0.06);
      g.gain.linearRampToValueAtTime(0, start + len * BEAT);
      o.connect(g).connect(shaper);
      o.start(start);
      o.stop(start + len * BEAT + 0.05);
    }
  }

  function kick(start, level = 1) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, start);
    o.frequency.exponentialRampToValueAtTime(42, start + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    o.connect(g).connect(drumBus);
    o.start(start);
    o.stop(start + 0.55);
    // Пэд и бас «приседают» под бочку — бит качает.
    for (const bus of [padBus, bassBus]) {
      const base = bus === padBus ? 0.5 : 0.9;
      bus.gain.setValueAtTime(base * 0.35, start);
      bus.gain.linearRampToValueAtTime(base, start + BEAT * 0.8);
    }
  }

  function noiseHit(start, { type, freq, q = 0.8, decay, level, toReverb = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + decay);
    src.connect(f).connect(g).connect(drumBus);
    if (toReverb) {
      const send = ctx.createGain();
      send.gain.value = toReverb;
      g.connect(send).connect(reverb);
    }
    src.start(start);
    src.stop(start + decay + 0.05);
  }

  function clap(start) {
    for (const [dt, lvl] of [[0, 0.5], [0.012, 0.45], [0.025, 0.6]]) {
      noiseHit(start + dt, { type: 'bandpass', freq: 1500, q: 1.1, decay: 0.22, level: lvl, toReverb: 0.9 });
    }
    const o = ctx.createOscillator();
    o.frequency.value = 185;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    o.connect(g).connect(drumBus);
    o.start(start);
    o.stop(start + 0.15);
  }

  function drums(barStart) {
    kick(barStart);
    kick(barStart + 1.5 * BEAT, 0.8);
    clap(barStart + 2 * BEAT);
    for (let i = 0; i < 8; i += 1) {
      const start = barStart + i * BEAT * 0.5;
      const open = i === 7;
      noiseHit(start, {
        type: 'highpass', freq: 7500, decay: open ? 0.28 : 0.05, level: open ? 0.16 : (i % 2 ? 0.08 : 0.13),
      });
    }
  }

  /** Нарастание перед дропом: шум с поднимающимся фильтром и громкостью, обрывается ровно на дропе. */
  function riser(start, end) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, start);
    f.frequency.exponentialRampToValueAtTime(7000, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.32, end - 0.02);
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(f).connect(g);
    g.connect(glue);
    g.connect(reverb);
    src.start(start);
    src.stop(end + 0.01);
  }

  /** Удар на дропе — под вспышку и смену кадра. */
  function impact(start) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, start);
    o.frequency.exponentialRampToValueAtTime(34, start + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 1.6);
    o.connect(g).connect(drumBus);
    o.start(start);
    o.stop(start + 1.7);
    noiseHit(start, { type: 'highpass', freq: 4500, decay: 1.8, level: 0.35, toReverb: 0.6 });
  }

  // Вступление расписываем целиком сразу: оно короткое, а момент дропа должен быть точным.
  INTRO.forEach((name, i) => {
    const start = t0 + i * BAR;
    pad(name, start, BAR);
    sub(name, start, BAR, i < 2 ? 0.18 : 0.26);
    if (i >= 2) pluck(name, start, i < 4 ? 0.06 : 0.09);
  });
  riser(t0 + (INTRO_BARS - 2) * BAR, dropAt);
  impact(dropAt);

  let stopped = false;
  let bar = 0;
  let timer = 0;
  function scheduleLoop(until = ctx.currentTime + LOOKAHEAD) {
    if (stopped) return;
    while (dropAt + bar * BAR < until) {
      const start = dropAt + bar * BAR;
      const name = LOOP[bar % LOOP.length];
      pad(name, start, BAR);
      bassline(name, start);
      pluck(name, start, 0.1);
      drums(start);
      bar += 1;
    }
    timer = setTimeout(scheduleLoop, 500);
  }
  // Первые 16 тактов бита (~38 с) — сразу вместе со вступлением: дроп и бит звучат ровно, даже если таймер страницы опоздает.
  scheduleLoop(dropAt + 16 * BAR);

  return {
    playing: true,
    dropAt,
    /** Вызвать cb в момент дропа: по часам звука, а не по таймеру с момента запуска. */
    whenDrop(cb) {
      const wait = () => {
        if (stopped) return;
        // Звук слышен с задержкой вывода — картинку меняем, когда дроп действительно звучит.
        const latency = ctx.outputLatency || ctx.baseLatency || 0;
        const left = dropAt + latency - ctx.currentTime;
        if (left <= 0.012) cb();
        else setTimeout(wait, Math.min(250, Math.max(0, (left - 0.01) * 1000)));
      };
      wait();
    },
    stop(fadeMs = 800) {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      setTimeout(() => ctx.close().catch(() => {}), fadeMs + 250);
    },
  };
}
