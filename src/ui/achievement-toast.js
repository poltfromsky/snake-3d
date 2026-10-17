/**
 * Всплывающее «Достижение получено» в правом нижнем углу, как в Steam.
 * Несколько достижений подряд показываются по очереди.
 */
const SHOW_MS = 5000;
const GAP_MS = 400;

export class AchievementToasts {
  /**
   * @param {HTMLElement} container место для всплывашек
   * @param {(rarity: string) => void} playSound звук появления
   */
  constructor(container, playSound) {
    this.container = container;
    this.playSound = playSound;
    this.queue = [];
    this.busy = false;
  }

  show(achievement) {
    this.queue.push(achievement);
    if (!this.busy) this.next();
  }

  next() {
    const a = this.queue.shift();
    if (!a) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const el = document.createElement('div');
    el.className = `achievement-toast ${a.rarity}`;
    el.setAttribute('role', 'status');
    const icon = document.createElement('div');
    icon.className = 'achievement-icon';
    icon.textContent = a.icon;
    const text = document.createElement('div');
    text.className = 'achievement-text';
    const label = document.createElement('small');
    label.textContent = 'Достижение получено';
    const title = document.createElement('b');
    title.textContent = a.title;
    const desc = document.createElement('span');
    desc.textContent = a.description;
    text.append(label, title, desc);
    el.append(icon, text);
    this.container.append(el);
    this.playSound(a.rarity);
    // Запуск анимации появления на следующем кадре.
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 800); // если анимации нет (prefers-reduced-motion)
      setTimeout(() => this.next(), GAP_MS);
    }, SHOW_MS);
  }
}
