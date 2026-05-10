import { ACHIEVEMENT_DEFS, type Achievements } from '../simulation/Achievements';

/**
 * Bottom-sheet panel listing every achievement, locked and unlocked,
 * with progress info and the month earned. Mirrors the styling of the
 * other bottom sheets (Budget, Happiness, Council). Pure DOM/CSS.
 *
 * Refresh model: cheap. We rebuild the inner grid on every show() call
 * because there are ~25 cards and the panel only opens on demand.
 */
export class AchievementsPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly listEl: HTMLElement;

  constructor(private readonly achievements: Achievements) {
    this.el = mustGet('achievements-panel');
    this.closeBtn = mustGet('achievements-close');
    this.summaryEl = mustGet('achievements-summary');
    this.listEl = mustGet('achievements-list');
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  show(): void {
    this.refresh();
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }
  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
  isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private refresh(): void {
    const total = ACHIEVEMENT_DEFS.length;
    const earned = this.achievements.unlocked.size;
    this.summaryEl.textContent = `${earned} of ${total} earned`;
    this.listEl.innerHTML = '';
    for (const a of ACHIEVEMENT_DEFS) {
      const card = document.createElement('div');
      const isUnlocked = this.achievements.unlocked.has(a.id);
      card.className = `ach__card${isUnlocked ? ' ach__card--unlocked' : ''}`;

      const icon = document.createElement('div');
      icon.className = 'ach__icon';
      icon.textContent = a.icon;
      card.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'ach__body';

      const name = document.createElement('div');
      name.className = 'ach__name';
      name.textContent = a.name;
      body.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'ach__desc';
      desc.textContent = a.description;
      body.appendChild(desc);

      if (isUnlocked) {
        const month = this.achievements.unlockMonth.get(a.id);
        if (month !== undefined) {
          const stamp = document.createElement('div');
          stamp.className = 'ach__stamp';
          stamp.textContent = `Earned · month ${month.toLocaleString()}`;
          body.appendChild(stamp);
        }
      } else {
        const stamp = document.createElement('div');
        stamp.className = 'ach__stamp ach__stamp--locked';
        stamp.textContent = 'Locked';
        body.appendChild(stamp);
      }

      card.appendChild(body);
      this.listEl.appendChild(card);
    }
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
