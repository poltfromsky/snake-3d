import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioManager } from '../src/audio/audio.js';

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
