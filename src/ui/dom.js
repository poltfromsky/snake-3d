/** Маленькие помощники для работы со страницей, общие для модулей интерфейса. */

export const $ = (sel) => document.querySelector(sel);

/** Подсвечивает выбранную кнопку в группе (segmented control). */
export function markActive(container, attr, value) {
  for (const b of container.querySelectorAll('button')) {
    const active = b.dataset[attr] === value;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', String(active));
  }
}

/** Меняет innerHTML, только если он действительно другой (HUD обновляется каждый кадр). */
export function setHtml(el, html) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

/** Всплывающая надпись по центру экрана («Уровень 2», «Вперёд!»). */
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add('show');
}

/** Текст ошибки сервера, если он «человеческий», иначе — запасной вариант. */
export function serverMessage(err, fallback) {
  return err?.message && !/^HTTP|fetch|network|abort/i.test(err.message) ? err.message : fallback;
}
