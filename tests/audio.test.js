import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioManager, preferAmbientAudio } from '../src/audio/audio.js';

/** Музыка-заглушка: то, что игре нужно от <audio>. */
function fakeMusic(volume = 0.5) {
  return { paused: false, volume, pause() { this.paused = true; } };
}

test('музыка плавно затихает и ставится на паузу, громкость потом возвращается', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const audio = new AudioManager();
  audio.music = fakeMusic(0.5);
  audio.musicVolume = 0.5;

  audio.fadeOutMusic(400);
  t.mock.timers.tick(200);
  assert.ok(audio.music.volume < 0.5 && audio.music.volume > 0, 'на полпути тише, но ещё слышно');
  assert.equal(audio.music.paused, false);

  t.mock.timers.tick(300);
  assert.equal(audio.music.paused, true, 'к концу затухания музыка остановлена');
  assert.equal(audio.music.volume, 0.5, 'громкость вернулась — следующая партия зазвучит как обычно');
});

test('если музыки нет или она на паузе, затухание ничего не делает', () => {
  const audio = new AudioManager();
  audio.fadeOutMusic();
  audio.music = { ...fakeMusic(), paused: true };
  audio.fadeOutMusic();
  assert.equal(audio.fadeTimer, null);
});

test('пауза или новая музыка отменяет затухание и возвращает громкость', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const audio = new AudioManager();
  audio.music = fakeMusic(0.5);
  audio.musicVolume = 0.5;
  audio.fadeOutMusic(400);
  t.mock.timers.tick(100);
  audio.pauseMusic();
  assert.equal(audio.fadeTimer, null);
  assert.equal(audio.music.volume, 0.5);
});

/** <audio> для startMusic: считает запуски, громкость — как у браузера. */
class FakeAudio {
  constructor() { this.paused = true; this.volume = 1; this.plays = 0; }

  addEventListener() {}

  play() { this.paused = false; this.plays += 1; return Promise.resolve(); }

  pause() { this.paused = true; }
}

// В Node нет <audio> — подставляем свою заглушку на все тесты ниже.
globalThis.Audio = FakeAudio;

/** Web Audio-заглушка: узлы громкости и источник из <audio>. */
function fakeContext() {
  const node = () => ({ gain: { value: 1 }, connect(next) { return next; } });
  return {
    state: 'running', destination: {}, resume() {}, createGain: node, createMediaElementSource: node,
  };
}

test('«Музыка» на нуле — музыка вовсе не запускается; вернули громкость посреди партии — играет', () => {
  const audio = new AudioManager();
  audio.setVolumes({ musicVolume: 0, sfxVolume: 0 });
  audio.startMusic();
  assert.equal(audio.music, null, 'при нуле даже не создаётся');
  audio.setVolumes({ musicVolume: 0.4, sfxVolume: 0 });
  assert.equal(audio.music, null, 'громкость без партии музыку не включает');
  audio.musicVolume = 0.4;
  audio.startMusic();
  assert.equal(audio.music.paused, false);
  audio.setVolumes({ musicVolume: 0, sfxVolume: 0 });
  assert.equal(audio.music.paused, true, 'на нуле — пауза, а не тихое проигрывание');
  audio.setVolumes({ musicVolume: 0.3, sfxVolume: 0 });
  assert.equal(audio.music.paused, false, 'партия идёт — музыка вернулась');
  audio.pauseMusic();
  audio.setVolumes({ musicVolume: 0.6, sfxVolume: 0 });
  assert.equal(audio.music.paused, true, 'на паузе громкость музыку не включает');
});

test('музыка идёт через Web Audio: громкость меняет узел, а <audio> всегда на полной (iPhone её не меняет)', () => {
  const audio = new AudioManager();
  audio.ctx = fakeContext();
  audio.sfxGain = audio.ctx.createGain();
  audio.musicVolume = 0.5;
  audio.startMusic();
  assert.ok(audio.musicGain, 'музыка подключена к Web Audio');
  assert.equal(audio.music.volume, 1);
  assert.equal(audio.musicGain.gain.value, 0.5);
  audio.setVolumes({ musicVolume: 0.2, sfxVolume: 0.7 });
  assert.equal(audio.musicGain.gain.value, 0.2);
  assert.equal(audio.music.volume, 1, '<audio> не трогаем');
});

test('затухание через Web Audio: узел громкости к концу на нуле, музыка на паузе, громкость вернулась', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const audio = new AudioManager();
  audio.ctx = fakeContext();
  audio.musicVolume = 0.5;
  audio.startMusic();
  audio.fadeOutMusic(400);
  t.mock.timers.tick(200);
  assert.ok(audio.musicGain.gain.value < 0.5 && audio.musicGain.gain.value > 0);
  t.mock.timers.tick(300);
  assert.equal(audio.music.paused, true);
  assert.equal(audio.musicGain.gain.value, 0.5);
  assert.equal(audio.music.volume, 1);
});

test('iPhone: беззвучный режим глушит игру — тип звука «ambient»; без audioSession ничего не ломается', () => {
  const nav = { audioSession: { type: 'auto' } };
  preferAmbientAudio(nav);
  assert.equal(nav.audioSession.type, 'ambient');
  assert.doesNotThrow(() => preferAmbientAudio({}));
  assert.doesNotThrow(() => preferAmbientAudio(undefined));
  const broken = { audioSession: { get type() { return 'auto'; }, set type(v) { throw new Error(v); } } };
  assert.doesNotThrow(() => preferAmbientAudio(broken));
});

test('через Web Audio темп музыки не меняется (на iPhone это рвало звук); без него — ускоряется', () => {
  const audio = new AudioManager();
  audio.musicVolume = 0.5;
  audio.startMusic();
  audio.setIntensity(1);
  assert.equal(audio.music.playbackRate, 1.25, 'обычный <audio> ускоряется вместе со змейкой');
  const routed = new AudioManager();
  routed.ctx = fakeContext();
  routed.musicVolume = 0.5;
  routed.startMusic();
  routed.music.playbackRate = 1;
  routed.setIntensity(1);
  assert.equal(routed.music.playbackRate, 1);
});
