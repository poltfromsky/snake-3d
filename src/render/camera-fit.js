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
// Наклонная камера смотрит чуть ближе к себе, чтобы ближний край поля не обрезался (см. placeCamera в scene.js).
export const ANGLED_LOOK_SHIFT = 1.2;
// Запас по краям кадра: доля половины экрана, которую поле не должно переходить.
const FIT_PAD = 0.97;
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
 * Расстояние наклонной камеры, при котором поле целиком в кадре. Считается по настоящей проекции
 * углов поля: наклон сжимает поле по вертикали экрана, и формула «вся длина поля по высоте кадра»
 * (она верна для камеры строго сверху) оставляла вокруг поля пустое место — поле выходило мелким.
 * @param {number} across клеток по горизонтали экрана
 * @param {number} along клеток по вертикали экрана
 * @param {number} tanHalf тангенс половины вертикального угла обзора
 * @param {number} aspect ширина области под поле / её высота
 */
function angledDistance(across, along, tanHalf, aspect) {
  const s = ANGLED_HEIGHT;
  const c = ANGLED_BACK;
  const norm = Math.hypot(s, c);
  // Углы борта (на 0,3 шире поля) у земли и по верху бортика.
  const hx = across / 2 + 0.3;
  const hz = along / 2 + 0.3;
  const corners = [];
  for (const y of [0, 0.6]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * hx, y, sz * hz]);
  }
  const fits = (d) => corners.every(([x, y, z]) => {
    const dy = y - s * d;
    const dz = z - (c * d + ANGLED_LOOK_SHIFT);
    const depth = (-s * dy - c * dz) / norm;
    if (depth <= 0) return false;
    const up = (c * dy - s * dz) / norm;
    return Math.abs(x) / (depth * tanHalf * aspect) <= FIT_PAD && Math.abs(up) / (depth * tanHalf) <= FIT_PAD;
  });
  let lo = 1;
  let hi = 400;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Раскладка камеры для поля и экрана.
 * @returns {{turn: 0|1|-1, fov: number, distance: number, back: {x: number, z: number},
 *   up: {x: number, z: number}, fogNear: number, fogFar: number}}
 *   back — куда от центра поля отступает камера (низ экрана), up — верх экрана для камеры сверху.
 */
export function cameraLayout({
  aspect, field, focusIndex = 0, mode = 'angled', screenAspect = aspect,
}) {
  // Куда повернуть поле, решает весь экран, а не область под поле: когда поле поднято над
  // кнопками-стрелками, область почти квадратная, но экран по-прежнему вертикальный.
  const turn = quarterTurn(screenAspect, field, focusIndex);
  const fov = fovFor(aspect);
  // Повёрнутое поле: по вертикали экрана идёт его ширина.
  const across = turn ? field.height : field.width; // по горизонтали экрана
  const along = turn ? field.width : field.height; // по вертикали экрана
  const tanHalf = Math.tan((fov / 2) * (Math.PI / 180));
  const fitVertical = (along + 2) / 2 / tanHalf;
  const fitHorizontal = (across + 2) / 2 / tanHalf / aspect;
  const flat = Math.max(fitVertical, fitHorizontal);
  const distance = mode === 'top' ? flat : Math.min(flat, angledDistance(across, along, tanHalf, aspect));

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
