/**
 * Музыка заставки: синтезируется Web Audio API на лету, без файлов и лицензий.
 * Тихий «хоровой» аккорд с реверберацией медленно сменяется по кругу (D – Bm – G – A),
 * сверху редкие колокольчики, снизу низкий гул. Нарастает за ~1,5 с, при stop() плавно гаснет.
 *
 *   const music = startSplashMusic({ volume: 0.5 });
 *   if (!music.playing) music.resume();   // браузер не дал звук без нажатия — включить по кнопке
 *   music.stop();
 */

const CHORD_SECONDS = 3.2;
const LOOKAHEAD = 20; // секунд музыки, расписанных заранее
// Ноты аккордов (MIDI): ре мажор → си минор → соль мажор → ля мажор, спокойно и «возвышенно».
const CHORDS = [
  [50, 57, 62, 66, 69],
  [47, 54, 59, 62, 66],
  [43, 50, 55, 59, 62],
  [45, 52, 57, 61, 64],
];
const BELLS = [74, 78, 81, 86, 83, 81, 78, 76];

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Импульс реверберации: затухающий стереошум — «большой зал» без файла. */
function makeImpulse(ctx, seconds = 3.4) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
  }
  return buffer;
}

/**
 * @param {{ volume?: number }} [options] громкость 0…1 (например, громкость музыки из настроек игры)
 * @returns {{ playing: boolean, resume: () => Promise<boolean>, stop: (fadeMs?: number) => void }}
 */
export function startSplashMusic({ volume = 0.5 } = {}) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const silent = { playing: false, resume: async () => false, stop() {} };
  if (!Ctx || volume <= 0) return silent;

  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  const dry = ctx.createGain();
  dry.gain.value = 0.45;
  const tone = ctx.createBiquadFilter(); // мягкий верх — звук «дышит», а не режет
  tone.type = 'lowpass';
  tone.frequency.value = 2200;
  tone.Q.value = 0.4;
  tone.connect(dry).connect(master);
  tone.connect(reverb).connect(wet).connect(master);
  master.connect(ctx.destination);

  const level = 0.55 * volume;
  let stopped = false;
  let timer = 0;
  let chordIndex = 0;

  /** Голос пэда: два слегка расстроенных треугольника и синус октавой ниже — «хор». */
  function padVoice(freq, start, length, gainValue) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gainValue, start + 1.4);
    g.gain.setValueAtTime(gainValue, start + length - 0.2);
    g.gain.linearRampToValueAtTime(0, start + length + 1.6);
    g.connect(tone);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.6 + Math.random();
    const depth = ctx.createGain();
    depth.gain.value = freq * 0.0035;
    vibrato.connect(depth);
    for (const [type, mult, detune] of [['triangle', 1, -7], ['triangle', 1, 7], ['sine', 0.5, 0]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      o.detune.value = detune;
      depth.connect(o.frequency);
      o.connect(g);
      o.start(start);
      o.stop(start + length + 1.8);
    }
    vibrato.start(start);
    vibrato.stop(start + length + 1.8);
  }

  /** Колокольчик: синус с обертоном и быстрым затуханием, уходит в реверберацию. */
  function bell(freq, start) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.12, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 2.6);
    g.connect(tone);
    for (const mult of [1, 2.76]) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mult;
      o.connect(g);
      o.start(start);
      o.stop(start + 2.7);
    }
  }

  function drone(start) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.18, start + 2);
    g.connect(tone);
    const o = ctx.createOscillator();
    o.frequency.value = hz(38);
    o.connect(g);
    o.start(start);
    return { g, o };
  }

  function scheduleChord(start) {
    const notes = CHORDS[chordIndex % CHORDS.length];
    notes.forEach((n, i) => padVoice(hz(n), start, CHORD_SECONDS, i === 0 ? 0.16 : 0.11));
    // Два колокольчика на аккорд: один сразу, второй в середине.
    bell(hz(BELLS[(chordIndex * 2) % BELLS.length]), start + 0.15);
    bell(hz(BELLS[(chordIndex * 2 + 1) % BELLS.length]), start + CHORD_SECONDS / 2);
    chordIndex += 1;
  }

  // Аккорды ставятся по часам звука заранее, на LOOKAHEAD секунд вперёд: таймеры страницы
  // браузер притормаживает, и без запаса музыка обрывалась после пары аккордов.
  let nextChord = 0;
  function scheduleAhead() {
    if (stopped) return;
    while (nextChord < ctx.currentTime + LOOKAHEAD) {
      scheduleChord(nextChord);
      nextChord += CHORD_SECONDS;
    }
    timer = setTimeout(scheduleAhead, 1000);
  }

  let low = null;
  function begin() {
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.5);
    low = drone(ctx.currentTime);
    nextChord = ctx.currentTime + 0.05;
    scheduleAhead();
  }

  const handle = {
    playing: false,
    async resume() {
      if (stopped) return false;
      try {
        await ctx.resume();
      } catch {
        return false;
      }
      if (!stopped && ctx.state === 'running' && !handle.playing) {
        handle.playing = true;
        begin();
      }
      return handle.playing;
    },
    stop(fadeMs = 700) {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      low?.o.stop(now + fadeMs / 1000 + 0.05);
      setTimeout(() => ctx.close().catch(() => {}), fadeMs + 200);
    },
  };
  // Браузер обычно разрешает звук только после действия пользователя: тогда контекст «спит»,
  // и заставка покажет кнопку включения звука.
  if (ctx.state === 'running') {
    handle.playing = true;
    begin();
  } else {
    handle.resume();
  }
  return handle;
}
