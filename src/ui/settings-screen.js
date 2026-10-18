/** Экран «Настройки»: ник, громкость, скорость, тема, камера, управление. Всё сохраняется сразу. */
import { saveSettings, SPEED_FACTORS } from '../storage.js';
import { $, markActive } from './dom.js';
import { bindNameInput } from './nickname.js';

/**
 * @param {object} deps
 * @param {object} deps.settings настройки (меняются на месте)
 * @param {import('../audio/audio.js').AudioManager} deps.audio
 * @param {{onSpeed(f: number): void, onTheme(): void, onCamera(v: string): void, onControls(v: string): void}} deps.hooks
 */
export function createSettingsScreen({ settings, audio, hooks }) {
  const nameField = bindNameInput($('#set-name'), settings);

  function render() {
    nameField.refresh();
    $('#set-music').value = settings.musicVolume;
    $('#set-sfx').value = settings.sfxVolume;
    markActive($('#set-speed'), 'value', settings.speed);
    markActive($('#set-theme'), 'value', settings.theme);
    markActive($('#set-camera'), 'value', settings.camera);
    markActive($('#set-controls'), 'value', settings.controls);
    markActive($('#set-autosubmit'), 'value', settings.autoSubmit);
  }

  function bindSegmented(id, key, onChange) {
    $(id).addEventListener('click', (e) => {
      const value = e.target.closest('button')?.dataset.value;
      if (!value) return;
      settings[key] = value;
      saveSettings(settings);
      markActive($(id), 'value', value);
      onChange(value);
    });
  }

  bindSegmented('#set-speed', 'speed', (v) => hooks.onSpeed(SPEED_FACTORS[v]));
  bindSegmented('#set-theme', 'theme', () => hooks.onTheme());
  bindSegmented('#set-camera', 'camera', (v) => hooks.onCamera(v));
  bindSegmented('#set-controls', 'controls', (v) => hooks.onControls(v));
  bindSegmented('#set-autosubmit', 'autoSubmit', () => {});

  for (const [id, key] of [['#set-music', 'musicVolume'], ['#set-sfx', 'sfxVolume']]) {
    $(id).addEventListener('input', (e) => {
      settings[key] = Number(e.target.value);
      audio.setVolumes(settings);
      saveSettings(settings);
    });
  }
  $('#set-sfx').addEventListener('change', () => audio.play('eat'));

  return { render };
}
