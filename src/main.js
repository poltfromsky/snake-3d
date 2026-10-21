/**
 * Точка входа: связывает режимы партии, машину состояний, 3D-сцену, звук и экраны.
 *
 * Здесь нет логики конкретных режимов — она в src/modes/modes.js, у всех режимов
 * один интерфейс. Какие экраны куда ведут, описано в src/app/state-machine.js.
 * Экраны (рекорды, отзыв, настройки, лобби…) живут в src/ui/.
 */
import { BOT_LEVELS } from './core/bot.js';
import { BotPlayer } from './bot-player.js';
import { AchievementBook } from './achievements.js';
import { SceneRenderer } from './render/scene.js';
import { AudioManager, MUSIC_LICENSE, MUSIC_TRACKS } from './audio/audio.js';
import { Leaderboard } from './net/leaderboard.js';
import { API_BASE, APP_VERSION } from './config.js';
import { E2E, exposeForTests } from './e2e.js';
import { registerServiceWorker, setupInstall } from './pwa.js';
import {
  deviceKey, isNewPlayer, loadHistory, loadProfile, loadSettings, loadStatsStore, loadTutorial, saveSettings, saveStatsStore,
  saveTutorial, SPEED_FACTORS, TUTORIAL_OFFERS,
} from './storage.js';
import { TutorialMode } from './modes/tutorial-mode.js';
import { SwipeTracker } from './ui/swipe.js';
import { nameKey, slowerSpeed } from './core/validate.js';
import { setupDpad } from './ui/dpad.js';
import { createDpadEditor } from './ui/dpad-layout.js';
import { controlDevice } from './tutorial/steps.js';
import { StateMachine, STATES } from './app/state-machine.js';
import {
  BotDuelMode, LocalDuelMode, OnlineMode, SoloMode,
} from './modes/modes.js';
import { AchievementToasts } from './ui/achievement-toast.js';
import { renderAchievements, renderBotButtons } from './ui/achievements-screen.js';
import { $, markActive, toast } from './ui/dom.js';
import { createFeedbackScreen } from './ui/feedback-screen.js';
import { createOnlineLobby } from './ui/online-lobby.js';
import { createRecordsScreen } from './ui/records-screen.js';
import { createResultSaver } from './ui/result-saver.js';
import { duelSummary, soloSummary } from './ui/results.js';
import {
  renderCredits, renderHud, renderSnakeStatus, showScreen, showTimer,
} from './ui/screens.js';
import { createSettingsScreen } from './ui/settings-screen.js';
import { createProfileScreen } from './ui/profile-screen.js';
import { isTouchDevice, WakeLock } from './ui/device.js';
import { createFirstHints } from './ui/first-hints.js';
import { createTutorialUI } from './ui/tutorial-ui.js';
import { createStatsSync } from './net/stats-sync.js';
import { createStatsScreen } from './ui/stats-screen.js';
import { createWelcome } from './ui/welcome.js';
import { renderIcons } from './ui/icons.js';
import { createWhatsNew } from './ui/whats-new.js';

const { MENU, LOBBY, COUNTDOWN, PLAYING, PAUSED, OVER } = STATES;

const TUTORIAL_THEME = 'neon';

const ARROWS = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
};
const WASD = {
  KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
};

// Во время партии сервер шлёт снимок минимум раз в полсекунды. Если данных нет
// дольше, связь оборвалась где-то в сети (так бывает без VPN) — честно говорим об этом.
const STALL_MS = 3000;
const VPN_HINT = 'Для онлайн-игры включите VPN.';
// Пауза перед экраном итогов, чтобы игрок увидел момент столкновения.
const RESULT_DELAY_MS = 900;

// Новый ли это игрок — проверяем до того, как игра что-нибудь сохранит.
const firstVisit = isNewPlayer();
const settings = loadSettings();
const tutorial = loadTutorial();
const audio = new AudioManager();
audio.setVolumes(settings);
// В автотестах (?e2e) — обычная чёткость: телефонный экран в 2–3 раза чётче, а рисует его
// в CI программный рендер без видеокарты. На игроков это не влияет.
const renderer = new SceneRenderer($('#scene'), { maxPixelRatio: E2E ? 1 : 2 });
const leaderboard = new Leaderboard(API_BASE);
const achievements = new AchievementBook();
const achievementToasts = new AchievementToasts(
  $('#achievement-toasts'),
  (rarity) => audio.play(rarity === 'legendary' || rarity === 'mythic' ? 'achievementLegendary' : 'achievement'),
);

const wakeLock = new WakeLock();
const welcome = createWelcome();
/** Кто вошёл в профиль на этом устройстве: его ник — хозяин статистики (src/net/stats-sync.js). */
function statsOwner() {
  const profile = loadProfile();
  const name = settings.playerName;
  if (!profile || !name || profile.nameKey !== nameKey(name) || !leaderboard.enabled) return null;
  return { key: profile.nameKey, name, device: deviceKey() };
}
const statsSync = createStatsSync({
  load: loadStatsStore,
  save: saveStatsStore,
  history: loadHistory,
  owner: statsOwner,
  post: (path, body) => leaderboard.request(path, { method: 'POST', body }),
  onState: (state) => statsScreen.syncState(state),
});
// Экран создаётся сразу после синхронизации; состояние она сообщает только по ходу работы (позже).
const statsScreen = createStatsScreen({
  games: () => statsSync.games(),
  owner: statsOwner,
  sync: statsSync,
});
// Что зависит только от экрана, а не от того, как в него попали, — здесь.
const app = new StateMachine(MENU, (_from, to) => {
  // Пока идёт партия, телефон не гасит экран.
  wakeLock.set(to === PLAYING || to === COUNTDOWN);
  updateDpad();
  // Карточка обучения — только во время самого обучения (на паузе её нет).
  tutorialUI.setVisible(mode.kind === 'tutorial' && to === PLAYING);
  if (to !== PLAYING) firstHints.hide();
});
let mode = createSolo();
let replay = null; // как начать такую же партию заново (реванш)
let screen = 'menu'; // какой оверлей сейчас виден (null — только игра)
let backTo = 'menu'; // куда ведёт «Назад» с рекордов, настроек и т. п.
let installFrom = 'menu'; // откуда открыли инструкцию по установке: меню или настройки
let lastTime = performance.now();
// Итог последней дуэли: ник соперника может прийти по сети позже конца партии
// (медленный телефон, плохая связь) — тогда подписи перерисовываются.
let lastDuel = null;
/**
 * Одиночная партия для общей таблицы: скорость (если меняли посреди партии — самая медленная)
 * и сколько поворотов сделано клавиатурой, свайпами и кнопками — по ним значок у ника.
 */
let soloRun = null;
/**
 * Личная статистика текущей партии (одиночной, с ботом, онлайн): сколько шла без пауз,
 * сколько съедено яблок и бонусов. Записывается в конце партии (addGameStat).
 */
let runStats = null;
const newRunStats = () => ({ playMs: 0, apples: 0, bonuses: { slow: 0, ghost: 0, bad: 0 } });

/* ---------------- Режимы ---------------- */

function fieldConfig() {
  return { mode: settings.mode, speedFactor: SPEED_FACTORS[settings.speed] ?? 1 };
}

function createSolo() {
  return new SoloMode({ ...fieldConfig(), narrow: window.innerWidth < window.innerHeight });
}

/** Меняет текущий режим; старый освобождает ресурсы (поток бота, соединение). */
function setMode(next) {
  if (next !== mode) mode.dispose();
  mode = next;
  if (mode.kind !== 'tutorial') renderer.setInsets(0, 0);
}

/**
 * Обучение: карточка с заданием сверху и кнопки-стрелки снизу не должны закрывать поле —
 * оно рисуется в оставшейся между ними области.
 */
function fitSceneToTutorial() {
  if (mode.kind !== 'tutorial') return;
  const card = $('#tutorial-card');
  if (card.classList.contains('hidden')) return; // на паузе поле остаётся на месте
  const dpad = $('#dpad');
  const top = card.getBoundingClientRect().bottom + 8;
  // Крест внизу — поле рисуется над ним; крест сбоку или выше середины (своё расположение) — не мешает.
  const dpadTop = dpad.getBoundingClientRect().top;
  const below = !dpad.classList.contains('hidden') && dpadTop > window.innerHeight * 0.55;
  const bottom = below ? window.innerHeight - dpadTop + 8 : 0;
  renderer.setInsets(top, bottom);
}

/**
 * Тема на экране. Обучение всегда в «Неоне»: цвет яблока зависит от темы
 * (в «Закате» оно бирюзовое), а текст обучения говорит «красное яблоко».
 */
const activeTheme = () => (mode.kind === 'tutorial' ? TUTORIAL_THEME : settings.theme);

/** Пересобирает сцену и подстраивает цвета интерфейса под тему. */
function setupScene() {
  const theme = activeTheme();
  document.documentElement.dataset.theme = theme;
  const { view } = mode;
  if (view) renderer.setup(view, { ...settings, theme }, mode.myIndex);
}

function show(name) {
  screen = name;
  showScreen(name, mode);
  if (name !== 'menu') welcome.dismiss(); // карточка первого захода живёт только поверх меню
}

/** Показать экран итогов чуть позже — если за это время партия не сменилась. */
function showLater(name, then) {
  const round = mode;
  setTimeout(() => {
    if (!app.is(OVER) || mode !== round) return;
    show(name);
    then?.();
  }, RESULT_DELAY_MS);
}

/* ---------------- Ход игры ---------------- */

function beginPlaying() {
  if (!app.go(PLAYING)) return;
  show(null);
  showTimer(mode.timed);
  audio.startMusic();
  lastTime = performance.now();
  renderHud(mode, activeTheme());
}

/** Начать партию в новом режиме. create — фабрика режима, она же нужна для реванша. */
function play(create, message) {
  replay = () => play(create, message);
  setMode(create());
  runStats = ['solo', 'bot'].includes(mode.kind) ? newRunStats() : null;
  setupScene();
  beginPlaying();
  if (message) toast(message);
}

const startSolo = () => play(() => {
  saver.startRun(settings.mode); // билет партии для общей таблицы
  soloRun = { speed: settings.speed, inputs: { pc: 0, touch: 0, buttons: 0 } };
  return createSolo();
});

/** Чем играли в партии: чем сделано больше всего поворотов (без поворотов — чем обычно играют здесь). */
function soloPlatform() {
  const counts = Object.entries(soloRun?.inputs ?? {}).filter(([, n]) => n > 0);
  if (counts.length) return counts.sort((a, b) => b[1] - a[1])[0][0];
  if (!isTouchDevice()) return 'pc';
  return settings.controls === 'buttons' ? 'buttons' : 'touch';
}
const startLocalDuel = () => play(() => new LocalDuelMode(fieldConfig()), 'WASD против стрелок!');

function startBotDuel(level) {
  if (!BOT_LEVELS[level]) return;
  play(
    () => new BotDuelMode({ ...fieldConfig(), level, createBot: (id, index) => new BotPlayer(id, index) }),
    `Вы против: ${BOT_LEVELS[level].name}`,
  );
}

function pause() {
  if (!app.is(PLAYING) || !mode.canPause) return;
  app.go(PAUSED);
  audio.pauseMusic();
  show('pause');
}

function resume() {
  if (app.is(PAUSED)) beginPlaying();
}

function toMenu() {
  setMode(createSolo());
  app.go(MENU);
  audio.pauseMusic();
  setupScene();
  show('menu');
}

function rematch() {
  if (mode.restartable) replay();
  else mode.rematch(); // онлайн: голосуют оба, новый раунд начнёт сервер
}

function soloOver(reason) {
  app.go(OVER);
  audio.fadeOutMusic();
  audio.play('die');
  audio.setIntensity(0);
  renderer.shakeCamera(0.8);
  const { game } = mode;
  renderer.burst(game.head.x, game.head.y, 0xff3355, 40);

  const text = soloSummary(reason);
  $('#over-title').textContent = text.title;
  $('#over-reason').textContent = text.reason;
  $('#over-score').textContent = game.score;
  const { needsForm, isBest } = saver.finish({
    mode: settings.mode,
    speed: soloRun?.speed ?? settings.speed,
    platform: soloPlatform(),
    score: game.score,
    length: game.length,
  });
  if (mode.kind === 'solo') {
    recordGame({
      kind: 'solo',
      mode: settings.mode,
      speed: soloRun?.speed ?? settings.speed,
      score: game.score,
      length: game.length,
      end: reason,
      platform: soloPlatform(),
    });
  }
  if (isBest) setTimeout(() => audio.play('record'), 700);
  // На телефоне не ставим курсор в поле ника: выскочившая клавиатура закрыла бы итоги.
  showLater('over', () => { if (needsForm && !isTouchDevice()) $('#record-name').focus(); });
}

/** Подписи экрана итогов дуэли по последнему результату и текущим именам игроков. */
function renderDuelResult() {
  const summary = duelSummary(lastDuel.event, lastDuel.details, mode);
  $('#duel-title').textContent = summary.title;
  $('#duel-reason').textContent = summary.reason;
  $('#duel-s0').textContent = summary.left;
  $('#duel-s1').textContent = summary.right;
  return summary;
}

function duelOver(event) {
  app.go(OVER);
  audio.fadeOutMusic();
  audio.setIntensity(0);
  renderer.shakeCamera(0.8);
  lastDuel = { event, details: mode.duelResult(event) };
  const summary = renderDuelResult();
  audio.play(summary.sound);
  $('#duel-status').textContent = '';
  showLater('duel');

  // Личная статистика: только свои партии — с ботом и онлайн (за одной клавиатурой «я» нет).
  if (['bot', 'online'].includes(mode.kind)) {
    const me = mode.myIndex;
    const { winner, reason } = event;
    recordGame({
      kind: mode.kind,
      level: mode.kind === 'bot' ? mode.level : undefined,
      mode: mode.view?.opts?.mode ?? settings.mode,
      speed: mode.kind === 'bot' ? settings.speed : undefined,
      score: lastDuel.details.scores?.[me] ?? 0,
      result: winner === null || winner === undefined ? 'draw' : winner === me ? 'win' : 'loss',
      end: lastDuel.details.deaths?.[me] || (['time', 'headOn'].includes(reason) ? reason : null),
    });
  }

  // Победа над ботом — достижения (каждое только в первый раз).
  if (mode.kind === 'bot' && summary.iWon) {
    const fresh = achievements.recordBotWin(mode.level);
    if (fresh.length) {
      setTimeout(() => fresh.forEach((a) => achievementToasts.show(a)), RESULT_DELAY_MS + 200);
      renderBotButtons(achievements);
    }
  }
}

/* ---------------- Обучение ---------------- */

/** Чем управляет игрок — от этого зависят тексты подсказок. */
const device = () => controlDevice({ touch: isTouchDevice(), controls: settings.controls });

function startTutorial() {
  tutorial.shown = true;
  saveTutorial(tutorial);
  play(() => new TutorialMode({
    // «Вверх по экрану» на повёрнутом поле — другое направление поля.
    screenUp: () => renderer.toFieldDirection('UP'),
  }));
  tutorialUI.render(mode, device());
  tutorialUI.setVisible(true);
}

function finishTutorial() {
  tutorial.done = true;
  // Гниль и бонусы уже объяснены в обучении — в первых партиях о них не напоминаем.
  Object.assign(tutorial.hints, { bad: true, slow: true });
  saveTutorial(tutorial);
  tutorialUI.setBanner(false);
  app.go(OVER);
  audio.play('record');
  show('tutorial-done');
  const fresh = achievements.award('first-steps');
  if (fresh.length) setTimeout(() => fresh.forEach((a) => achievementToasts.show(a)), 400);
}

/**
 * Перед игрой: если обучение не пройдено — первые TUTORIAL_OFFERS раз предлагаем его.
 * Дальше не навязываем, остаётся плашка в меню.
 */
let pendingStart = null;
function requestStart(start) {
  if (!tutorial.done && tutorial.offers < TUTORIAL_OFFERS) {
    tutorial.offers += 1;
    saveTutorial(tutorial);
    pendingStart = start;
    openFromMenu('tutorial-offer');
    return;
  }
  start();
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'tutorialStep':
        audio.play('levelUp');
        tutorialUI.render(mode, device());
        break;
      case 'tutorialGo':
        tutorialUI.render(mode, device()); // убрать «Понятно»
        break;
      case 'tutorialRetry':
        tutorialUI.render(mode, device()); // змейка снова ждёт «Понятно»
        tutorialUI.notice('Змейка разбилась — попробуем этот шаг ещё раз.');
        break;
      case 'tutorialBad':
        tutorialUI.notice('Это была гниль: змейка укоротилась. Обойдите её!');
        break;
      case 'tutorialDone':
        finishTutorial();
        break;
      case 'eat':
        if (runStats && (e.player === undefined || e.player === mode.myIndex)) {
          if (e.kind === 'apple') runStats.apples += 1;
          else if (e.kind in runStats.bonuses) runStats.bonuses[e.kind] += 1;
        }
        renderer.burstAt(e.kind, e.x, e.y);
        if (e.kind === 'apple') audio.play('eat');
        else if (e.kind === 'bad') { audio.play('bad'); renderer.shakeCamera(0.3); }
        else { audio.play('bonus'); toast(e.kind === 'slow' ? 'Замедление!' : 'Призрак!'); }
        break;
      case 'levelUp':
        audio.play('levelUp');
        toast(`Уровень ${e.level}`);
        firstHints.levelUp();
        break;
      case 'gameOver':
        if (mode.isDuel) duelOver(e);
        else soloOver(e.reason);
        break;
      default:
        break;
    }
  }
}

/** Партия закончилась — в личную статистику (src/core/stats.js); с профилем — и на все его устройства. */
function recordGame(entry) {
  const run = runStats ?? newRunStats();
  statsSync.record({
    at: Date.now(), durationMs: Math.round(run.playMs), apples: run.apples, bonuses: run.bonuses, ...entry,
  });
  runStats = null;
}

function frame(now) {
  const dt = Math.min(now - lastTime, 250);
  lastTime = now;

  if (app.is(PLAYING) && runStats) runStats.playMs += dt;
  if (app.is(PLAYING)) {
    handleEvents(mode.update(dt));
    // Подсказки первых партий: что-то новое впервые появилось на поле.
    if (app.is(PLAYING) && ['solo', 'bot', 'local'].includes(mode.kind)) firstHints.check(mode.view);
    if (mode.kind === 'online' && mode.isStalled(STALL_MS)) {
      connectionLost();
      requestAnimationFrame(frame);
      return;
    }
    const intensity = mode.intensity();
    if (intensity !== null && app.is(PLAYING)) audio.setIntensity(intensity);
  }
  if (app.is(PLAYING, COUNTDOWN)) renderHud(mode, activeTheme());

  const { view } = mode; // у онлайна вида нет, пока не пришёл первый снимок
  if (view && mode.needsSetup) {
    setupScene();
    mode.needsSetup = false;
  }
  if (view) renderer.render(view, mode.myIndex);
  renderSnakeStatus(view && app.is(PLAYING) ? mode.hud() : null, renderer.headScreen);
  requestAnimationFrame(frame);
}

/* ---------------- Онлайн ---------------- */

const lobby = createOnlineLobby({
  apiBase: API_BASE,
  settings,
  onJoined: (connection, joined) => {
    setMode(new OnlineMode({ connection, slot: joined.slot, names: joined.names }));
    mode.introduce(settings.playerName);
  },
  onMessage: handleNetMessage,
  onClose: (connection) => { if (mode.connection === connection) connectionLost(); },
});

function openOnline() {
  if (mode.kind === 'online') {
    setMode(createSolo());
    setupScene();
  }
  app.go(LOBBY);
  lobby.reset();
  show('online');
}

/** Связь с сервером пропала: выходим из комнаты и объясняем, что делать. */
function connectionLost() {
  if (mode.kind !== 'online') return;
  openOnline();
  lobby.status(`Связь с сервером прервалась. ${VPN_HINT}`, true);
  audio.pauseMusic();
}

/** Как зовут соперника в онлайне: его ник или «Друг». */
const opponentName = () => mode.playerName(1 - mode.myIndex);

function countdownTick(n) {
  toast(n > 0 ? String(n) : 'Вперёд!');
  audio.play(n > 0 ? 'click' : 'levelUp');
}

/** Сообщения сервера; режим переводит их в действия (протокол — src/core/room.js). */
function handleNetMessage(msg, connection) {
  if (mode.kind !== 'online' || mode.connection !== connection) return;
  const action = mode.receive(msg);
  switch (action?.type) {
    case 'events':
      if (action.events.length) handleEvents(action.events);
      break;
    case 'round':
      runStats = newRunStats(); // онлайн-раунд (и реванш) — новая партия в статистике
      app.go(COUNTDOWN);
      show(null);
      audio.startMusic();
      break;
    case 'countdown':
      countdownTick(action.n);
      break;
    case 'go':
      countdownTick(0);
      beginPlaying();
      break;
    case 'names':
      if (app.is(OVER) && lastDuel) renderDuelResult();
      break;
    case 'rematch':
      $('#duel-status').textContent = action.mine ? 'Ждём ответа соперника…' : `${opponentName()} хочет реванш!`;
      break;
    case 'opponent':
      // Второй игрок подключился — партию запустит сам сервер.
      if (!action.connected && !app.is(LOBBY)) {
        toast(`${opponentName()} вышел из игры`);
        toMenu();
      }
      break;
    case 'error':
      lobby.status(action.text, true);
      break;
    default:
      break;
  }
}

/* ---------------- Экраны ---------------- */

const records = createRecordsScreen({ settings, leaderboard });
const saver = createResultSaver({
  settings,
  leaderboard,
  onChangeNick: () => {
    backTo = 'over';
    settingsScreen.render();
    show('settings');
  },
});
const feedback = createFeedbackScreen({ leaderboard, version: APP_VERSION, settings });
const profileScreen = createProfileScreen({
  settings,
  leaderboard,
  statsBrief: () => statsScreen.brief(),
  achievementsSummary: () => {
    const list = achievements.list();
    return { open: list.filter((a) => a.unlockedAt).length, total: list.length };
  },
  // Вошли, вышли или создали профиль: ник мог смениться — обновим поле ника и подписи.
  onChange: () => {
    settingsScreen.render();
    updateProfileButton();
    statsSync.ownerChanged(); // вошли — статистика профиля синхронизируется, вышли — убирается с устройства
  },
});
/** Откуда открыли профиль: туда и ведёт «Назад» (меню или настройки). */
let profileFrom = 'menu';

/** Кнопка профиля в меню: «Профиль · ник», если вошли, иначе приглашение войти. */
function updateProfileButton() {
  $('#btn-profile-label').textContent = profileScreen.menuLabel();
}
const tutorialUI = createTutorialUI({
  onNext: () => { if (mode.kind === 'tutorial') mode.next(); },
  onSkip: () => toMenu(),
  onLayout: fitSceneToTutorial,
});
const firstHints = createFirstHints({ seen: tutorial.hints, save: () => saveTutorial(tutorial) });

const settingsScreen = createSettingsScreen({
  settings,
  audio,
  profileSummary: () => profileScreen.summary(),
  hooks: {
    onSpeed: (factor) => {
      mode.setSpeedFactor(factor);
      // Скорость сменили посреди партии — в общей таблице она будет на самой медленной из двух.
      if (soloRun && mode.kind === 'solo') soloRun.speed = slowerSpeed(soloRun.speed, settings.speed);
    },
    // Тема меняется только в меню, чтобы не сбрасывать текущую партию.
    onTheme: () => { if (app.is(MENU)) setupScene(); },
    onCamera: (value) => { renderer.cameraMode = value; },
    onControls: () => updateDpad(),
  },
});

function openFromMenu(name) {
  backTo = 'menu';
  show(name);
}

$('#mode-select').addEventListener('click', (e) => {
  const value = e.target.closest('button')?.dataset.mode;
  if (!value) return;
  settings.mode = value;
  saveSettings(settings);
  markActive($('#mode-select'), 'mode', value);
  setMode(createSolo());
  setupScene();
});

/* ---------------- Управление ---------------- */

/** dir — направление на экране; если поле повёрнуто под экран телефона, сцена переводит его в направление на поле. */
/** input — чем повернули (для значка у ника в общей таблице): клавиатура, свайп или кнопки. */
function steer(device, dir, input = device === 'touch' ? 'touch' : 'pc') {
  if (!app.is(PLAYING)) return;
  mode.steer(device, renderer.toFieldDirection(dir));
  if (soloRun && mode.kind === 'solo') soloRun.inputs[input] += 1;
}

const isTyping = (target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (isTyping(e.target)) return;
  const arrow = ARROWS[e.code];
  const wasd = WASD[e.code];
  if ((arrow || wasd) && app.is(PLAYING)) {
    e.preventDefault();
    steer(wasd ? 'wasd' : 'arrows', wasd ?? arrow);
    return;
  }
  const inMenu = app.is(MENU) && screen === 'menu';
  if (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP') {
    if (app.is(PLAYING)) pause();
    else if (app.is(PAUSED)) resume();
    else if (inMenu && e.code === 'Space') requestStart(startSolo);
    else return;
    e.preventDefault();
  }
  if (e.code === 'Enter' && inMenu) requestStart(startSolo);
});

// Свайпы: поворот срабатывает, как только палец явно повёл в сторону, не дожидаясь, пока
// его отпустят; косые движения и лёгкий увод пальца поворотом не считаются, «вверх, потом
// вправо» делается одним движением (правила — src/ui/swipe.js).
const swipe = new SwipeTracker();
let swipePointer = null;
const canvas = $('#scene');
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  swipePointer = e.pointerId;
  swipe.begin(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== swipePointer || !app.is(PLAYING)) return;
  const dir = swipe.move(e.clientX, e.clientY);
  if (dir) steer('touch', dir);
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => {
    if (e.pointerId !== swipePointer) return;
    swipePointer = null;
    swipe.end();
  });
}

// Кнопки-стрелки на экране (настройка «Управление → Кнопки на экране»).
function updateDpad() {
  const visible = (settings.controls === 'buttons' && isTouchDevice() && app.is(PLAYING, COUNTDOWN))
    || screen === 'dpad-layout';
  $('#dpad').classList.toggle('hidden', !visible);
  if (!visible) dpadControl.release();
  fitSceneToTutorial();
}
const dpadControl = setupDpad($('#dpad'), (dir) => {
  audio.unlock();
  steer('touch', dir, 'buttons');
});
const dpadEditor = createDpadEditor({ root: $('#dpad'), settings, save: saveSettings });

// Повернули телефон в меню — поле на фоне тоже разворачивается (вертикальное ↔ горизонтальное).
window.addEventListener('resize', () => {
  if (!app.is(MENU) || mode.kind !== 'solo') return;
  const narrow = window.innerWidth < window.innerHeight;
  if (narrow === mode.game.opts.height > mode.game.opts.width) return;
  setMode(createSolo());
  setupScene();
});

// Свернули вкладку — ставим паузу, чтобы змейка не разбилась без игрока.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
  // Вернулись в игру — подтянуть партии, сыгранные за это время на других устройствах профиля.
  else if (statsOwner()) statsSync.syncNow();
});

// Закрыли вкладку посреди онлайн-партии — сразу выходим из комнаты, друг узнает об этом.
window.addEventListener('beforeunload', () => {
  if (mode.kind === 'online') mode.dispose();
});

$('#btn-pause').addEventListener('click', pause);

const ACTIONS = {
  // Из меню — с вопросом про обучение; «Ещё раз» после партии — сразу.
  play: () => (screen === 'menu' ? requestStart(startSolo) : startSolo()),
  local: () => requestStart(startLocalDuel),
  bot: (e) => {
    const level = e.target.closest('[data-level]')?.dataset.level;
    requestStart(() => startBotDuel(level));
  },
  tutorial: startTutorial,
  'play-anyway': () => (pendingStart ?? startSolo)(),
  online: openOnline,
  'create-room': () => lobby.create(),
  'copy-link': () => lobby.copyLink(),
  rematch,
  leave: toMenu,
  resume,
  menu: toMenu,
  achievements: () => {
    renderAchievements(achievements);
    openFromMenu('achievements');
  },
  records: () => {
    records.render(settings.mode);
    openFromMenu('records');
  },
  feedback: () => {
    feedback.open();
    openFromMenu('feedback');
    feedback.focus();
  },
  settings: () => {
    backTo = app.is(PAUSED) ? 'pause' : 'menu';
    settingsScreen.render();
    show('settings');
  },
  profile: () => {
    profileFrom = screen === 'settings' ? 'settings' : 'menu';
    profileScreen.render();
    show('profile');
  },
  'profile-back': () => {
    // Пока показан код восстановления, уходить нельзя: он больше не покажется.
    if (profileScreen.showingCode) {
      $('#profile-state').textContent = 'Сначала сохраните код восстановления и отметьте это.';
      return;
    }
    updateProfileButton();
    if (profileFrom === 'settings') settingsScreen.render();
    show(profileFrom);
  },
  stats: () => {
    show('stats'); // сначала показать: ширину графика берём у видимого экрана
    statsScreen.render();
    $('#screen-stats').scrollTop = 0;
  },
  'stats-back': () => {
    statsScreen.hideTip();
    profileScreen.render();
    show('profile');
  },
  'profile-achievements': () => {
    renderAchievements(achievements);
    backTo = 'profile';
    show('achievements');
  },
  install: (e) => {
    installFrom = e.target.closest('.screen')?.id.replace('screen-', '') || 'menu';
    installer.install();
  },
  'install-back': () => {
    if (installFrom === 'menu') toMenu();
    else show(installFrom);
  },
  'welcome-later': () => {}, // карточка уже закрыта общим обработчиком; плашка в меню остаётся
  'dpad-layout': () => {
    show('dpad-layout');
    updateDpad();
    dpadEditor.open();
  },
  'dpad-done': () => {
    dpadEditor.close();
    show('settings');
    updateDpad();
  },
  'dpad-reset': () => dpadEditor.reset(),
  'whats-new': () => whatsNew.showHistory(),
  update: () => updater.applyUpdate(),
  'check-update': () => whatsNew.checkForUpdate(() => updater.checkNow()),
  back: () => {
    if (backTo === 'menu') toMenu();
    else show(backTo);
    if (backTo === 'over') saver.refreshName();
    // Ник могли поменять в настройках — подпись кнопки профиля в меню тоже, и хозяина статистики.
    updateProfileButton();
    statsSync.ownerChanged();
  },
};

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!Object.hasOwn(ACTIONS, action ?? '')) return;
  welcome.dismiss();
  audio.unlock();
  audio.play('click');
  ACTIONS[action](e);
});

/* ---------------- Старт ---------------- */

// На маленьком экране «Как играть» свёрнут: меню помещается почти без прокрутки.
if (window.matchMedia('(max-width: 520px), (max-height: 700px)').matches) $('.howto').open = false;

// Игра как приложение: установка и обновления (src/pwa.js, sw.js).
const installer = setupInstall({
  setVisible: (visible) => document.querySelectorAll('.install-btn').forEach((b) => b.classList.toggle('hidden', !visible)),
  showHelp: (kind) => {
    document.querySelectorAll('#screen-install [data-kind]').forEach((ol) => ol.classList.toggle('hidden', ol.dataset.kind !== kind));
    show('install');
  },
});
const whatsNew = createWhatsNew({ version: APP_VERSION, open: (name) => openFromMenu(name) });
const updater = registerServiceWorker({
  onUpdateReady: () => whatsNew.onUpdateReady(),
  // Локально service worker нужен только автотестам, при обычной разработке он не включается.
  enabled: E2E || !['localhost', '127.0.0.1'].includes(window.location.hostname),
});

renderIcons();
renderBotButtons(achievements);
// Рекорды, которые раньше не ушли в общую таблицу (не было сети), — отправляем сейчас.
saver.flushPending();
// Только с ?e2e в адресе: доступ для браузерных автотестов (см. src/e2e.js).
exposeForTests({
  get kind() { return mode.kind; },
  get state() { return app.state; },
  get game() { return mode.game; },
  get headScreen() { return renderer.headScreen; }, // точка головы на экране — для проверки таймера статусов
  get turn() { return renderer.turn; },
  get theme() { return document.documentElement.dataset.theme; },
  get fieldInsets() { return renderer.insets; },
  get cameraPosition() { return renderer.camera.position.toArray(); },
  get tutorialStep() { return mode.kind === 'tutorial' ? mode.index : null; },
  // Как будто в фоне скачалась новая версия (сам service worker в тестах не подменить).
  simulateUpdateReady: () => whatsNew.onUpdateReady(),
});
markActive($('#mode-select'), 'mode', settings.mode);
updateProfileButton();
// Общая таблица и отзывы появляются, только когда подключена база.
for (const el of document.querySelectorAll('.online-only')) {
  el.classList.toggle('hidden', !leaderboard.enabled);
}
renderCredits(MUSIC_TRACKS, MUSIC_LICENSE);
setupScene();
show('menu');

tutorialUI.setBanner(!tutorial.done);

// Пришли по ссылке друга: сразу подключаемся к его комнате (обучение не навязываем).
const invited = new URLSearchParams(window.location.search).get('room');
if (invited) {
  history.replaceState(null, '', window.location.pathname);
  openOnline();
  lobby.joinInvite(invited);
} else if (firstVisit) {
  // Совсем новый игрок: сначала смотрит, куда попал. Через пару секунд — карточка с предложением
  // обучения и подсветка главных кнопок. Запоминаем, что показали: при следующем заходе в меню
  // остаётся только плашка «Вы ещё не прошли обучение».
  tutorial.shown = true;
  saveTutorial(tutorial);
  welcome.start(() => screen === 'menu' && app.is(MENU));
}
// Игра обновилась с прошлого раза — один раз показать, что нового (только поверх меню).
whatsNew.afterStart({ canShow: () => !invited && app.is(MENU) && screen === 'menu', returning: !firstVisit });

// Вошли в профиль раньше — статистика профиля: отправить накопленное, подтянуть с других устройств.
if (statsOwner()) statsSync.syncNow();

requestAnimationFrame(frame);
