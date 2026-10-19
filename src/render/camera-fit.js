/**
 * Как поставить камеру, чтобы поле занимало экран: расстояние, угол обзора,
 * туман и поворот поля на четверть оборота. Чистая математика без Three.js —
 * проверяется юнит-тестами на экранах любых размеров (tests/camera-fit.test.js).
 *
 * Поворот: если поле вытянуто поперёк экрана (дуэль 26×16 на вертикальном
 * телефоне), камера поворачивается на 90°, и длинная сторона поля идёт вдоль
 * длинной стороны экрана. Поле крупнее вдвое, а логика игры ничего не знает:
 * повороты игрока переводятся из «экранных» направлений в направления поля.
 */

// Мировые направления поля: x — вправо, z — вниз (как y в логике игры).
const BACK = Object.freeze({
  0: { x: 0, z: 1 }, // без поворота: низ экрана — нижний край поля
  1: { x: -1, z: 0 }, // верх экрана — правый край поля: старт игрока 1 (слева) внизу экрана
  [-1]: { x: 1, z: 0 }, // верх экрана — левый край: так своя змейка у игрока 2 тоже внизу
});

// Наклонная камера: высота и отступ назад относительно расстояния (~55°).
const ANGLED_HEIGHT = 1.02;
const ANGLED_BACK = 0.62;
// Туман только на дальнем фоне: поле до самого дальнего угла остаётся ярким.
const FOG_MARGIN = 2;
const FOG_DEPTH = 32;

/**
 * Нужен ли поворот на четверть оборота и в какую сторону.
 * @param {number} aspect ширина экрана / высота
 * @param {{width: number, height: number}} field размер поля в клетках
 * @param {number} focusIndex чья змейка в центре внимания (0 или 1)
 * @returns {0|1|-1}
 */
export function quarterTurn(aspect, { width, height }, focusIndex = 0) {
  const screenTall = aspect < 1;
  const fieldTall = height > width;
  if (width === height || screenTall === fieldTall) return 0;
  return focusIndex === 1 ? -1 : 1;
}

/** Угол обзора по вертикали: на узком экране шире, чтобы поле не казалось далёким. */
export function fovFor(aspect) {
  return aspect < 1 ? 62 : 45;
}

/**
 * Раскладка камеры для поля и экрана.
 * @returns {{turn: 0|1|-1, fov: number, distance: number, back: {x: number, z: number},
 *   up: {x: number, z: number}, fogNear: number, fogFar: number}}
 *   back — куда от центра поля отступает камера (низ экрана), up — верх экрана для камеры сверху.
 */
export function cameraLayout({
  aspect, field, focusIndex = 0, mode = 'angled',
}) {
  const turn = quarterTurn(aspect, field, focusIndex);
  const fov = fovFor(aspect);
  // Повёрнутое поле: по вертикали экрана идёт его ширина.
  const across = turn ? field.height : field.width; // по горизонтали экрана
  const along = turn ? field.width : field.height; // по вертикали экрана
  const tanHalf = Math.tan((fov / 2) * (Math.PI / 180));
  const fitVertical = (along + 2) / 2 / tanHalf;
  const fitHorizontal = (across + 2) / 2 / tanHalf / aspect;
  const distance = Math.max(fitVertical, fitHorizontal);

  const back = BACK[turn];
  const up = { x: -back.x, z: -back.z };
  // Расстояние от камеры до центра поля и до его дальнего угла.
  const toCenter = mode === 'top' ? distance : Math.hypot(distance * ANGLED_HEIGHT, distance * ANGLED_BACK);
  const fogNear = toCenter + FOG_MARGIN;
  return {
    turn, fov, distance, back, up, fogNear, fogFar: fogNear + FOG_DEPTH,
    angledHeight: ANGLED_HEIGHT, angledBack: ANGLED_BACK,
  };
}

const SCREEN_TO_FIELD = {
  // turn 1: верх экрана — вправо по полю, право экрана — вниз по полю.
  1: { UP: 'RIGHT', RIGHT: 'DOWN', DOWN: 'LEFT', LEFT: 'UP' },
  // turn -1: верх экрана — влево по полю, право экрана — вверх по полю.
  [-1]: { UP: 'LEFT', RIGHT: 'UP', DOWN: 'RIGHT', LEFT: 'DOWN' },
};

/** Направление на экране (свайп, стрелка) → направление на поле с учётом поворота камеры. */
export function screenToField(dir, turn) {
  return turn ? SCREEN_TO_FIELD[turn][dir] : dir;
}

/**
 * Плавно подвигает точку к цели: мягкое приближение с ограничением скорости.
 * Когда змейка проходит сквозь стену, её голова «перепрыгивает» на другой край поля;
 * без ограничения скорости камера, следящая за головой, резко дёргалась вслед за прыжком.
 * Обычное следование за головой на такую скорость не выходит и ограничение не замечает.
 *
 * @param {{x: number, y: number, z: number}} current
 * @param {{x: number, y: number, z: number}} target
 * @param {number} dt секунды
 * @param {{rate: number, maxSpeed: number}} options rate — «жёсткость» (1/с), maxSpeed — единиц в секунду
 * @returns {{x: number, y: number, z: number}} новая точка
 */
export function approachPoint(current, target, dt, { rate, maxSpeed }) {
  const k = 1 - Math.exp(-rate * dt);
  const dx = (target.x - current.x) * k;
  const dy = (target.y - current.y) * k;
  const dz = (target.z - current.z) * k;
  const length = Math.hypot(dx, dy, dz);
  const limit = maxSpeed * dt;
  const scale = length > limit && length > 0 ? limit / length : 1;
  return { x: current.x + dx * scale, y: current.y + dy * scale, z: current.z + dz * scale };
}
