/**
 * Звук: фоновая музыка из файла и синтезированные эффекты.
 *
 * Эффекты генерируются Web Audio API на лету — для них не нужны файлы
 * и, значит, лицензии. Музыка берётся из assets/music (см. CREDITS.md);
 * если файла нет, игра работает без неё.
 */

export const MUSIC_TRACKS = [
  // Заполняется после загрузки трека с открытой лицензией.
  // { src: 'assets/music/<file>.mp3', title: '...', author: '...' },
];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
    this.music = null;
    this.trackIndex = 0;
  }

  /**
   * Браузер разрешает звук только после действия пользователя,
   * поэтому контекст создаётся по первому клику или нажатию клавиши.
   */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes({ musicVolume, sfxVolume }) {
    this.musicVolume = musicVolume;
    this.sfxVolume = sfxVolume;
    if (this.music) this.music.volume = musicVolume;
    if (this.sfxGain) this.sfxGain.gain.value = sfxVolume;
  }

  startMusic() {
    if (!MUSIC_TRACKS.length) return;
    if (!this.music) {
      this.music = new Audio();
      this.music.addEventListener('ended', () => this.nextTrack());
      this.music.addEventListener('error', () => { this.music = null; });
      this.loadTrack(this.trackIndex);
    }
    this.music.volume = this.musicVolume;
    this.music.play().catch(() => {});
  }

  loadTrack(index) {
    const track = MUSIC_TRACKS[index % MUSIC_TRACKS.length];
    this.music.src = track.src;
    this.music.preservesPitch = true;
  }

  nextTrack() {
    this.trackIndex = (this.trackIndex + 1) % MUSIC_TRACKS.length;
    this.loadTrack(this.trackIndex);
    this.music.play().catch(() => {});
  }

  pauseMusic() {
    this.music?.pause();
  }

  /** Музыка ускоряется вместе со змейкой: от 1.0 до 1.25. */
  setIntensity(value) {
    if (!this.music) return;
    this.music.playbackRate = 1 + Math.min(Math.max(value, 0), 1) * 0.25;
  }

  get currentTrack() {
    return MUSIC_TRACKS.length ? MUSIC_TRACKS[this.trackIndex % MUSIC_TRACKS.length] : null;
  }

  /** Короткий тон с огибающей — основа всех эффектов. */
  tone({ freq, to = freq, duration = 0.12, type = 'square', gain = 0.25, delay = 0 }) {
    if (!this.ctx || this.sfxVolume === 0) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(this.sfxGain);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  play(name) {
    switch (name) {
      case 'eat':
        this.tone({ freq: 520, to: 880, duration: 0.09 });
        this.tone({ freq: 880, to: 1320, duration: 0.08, delay: 0.06, gain: 0.18 });
        break;
      case 'bad':
        this.tone({ freq: 300, to: 90, duration: 0.3, type: 'sawtooth', gain: 0.2 });
        break;
      case 'bonus':
        [660, 830, 990, 1320].forEach((f, i) => this.tone({
          freq: f, duration: 0.08, delay: i * 0.06, type: 'triangle', gain: 0.22,
        }));
        break;
      case 'levelUp':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({
          freq: f, duration: 0.14, delay: i * 0.1, type: 'square', gain: 0.18,
        }));
        break;
      case 'die':
        this.tone({ freq: 440, to: 55, duration: 0.7, type: 'sawtooth', gain: 0.25 });
        this.tone({ freq: 220, to: 40, duration: 0.8, type: 'square', gain: 0.15, delay: 0.05 });
        break;
      case 'click':
        this.tone({ freq: 1200, duration: 0.03, type: 'triangle', gain: 0.12 });
        break;
      case 'record':
        [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => this.tone({
          freq: f, duration: 0.12, delay: i * 0.09, type: 'square', gain: 0.16,
        }));
        break;
      default:
        break;
    }
  }
}
