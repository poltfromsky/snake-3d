/**
 * Глазок у поля пароля: показать или скрыть введённое.
 *
 * По умолчанию пароль скрыт точками. Кнопка не отключается, даже пока игра проверяет пароль,
 * и показывает только своё поле — второй пароль виден, только если нажать глазок у него.
 */
import { iconSvg } from './icons.js';

function setVisible(input, button, visible) {
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
  button.replaceChildren(iconSvg(visible ? 'eyeOff' : 'eye'));
}

/** Добавить глазок ко всем полям пароля внутри root. */
export function addPasswordToggles(root) {
  for (const input of root.querySelectorAll('input[type="password"]')) {
    if (input.parentElement.classList.contains('pass-field')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'pass-field';
    input.replaceWith(wrap);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pass-eye';
    wrap.append(input, button);
    setVisible(input, button, false);
    // Нажатие не уводит фокус из поля: на телефоне клавиатура не прячется.
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('click', () => setVisible(input, button, input.type === 'password'));
  }
}

/** Снова скрыть все пароли (после входа, при смене экрана). */
export function hidePasswords(root) {
  for (const wrap of root.querySelectorAll('.pass-field')) {
    const input = wrap.querySelector('input');
    const button = wrap.querySelector('.pass-eye');
    if (input && button) setVisible(input, button, false);
  }
}
