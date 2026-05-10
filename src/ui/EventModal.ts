import { FACTIONS } from '../simulation/Happiness';
import type { GameEvent } from '../simulation/Events';

/**
 * Event modal (Alpha 2.9) — surfaces the random / crisis events queued
 * by the Events system. info / warning / danger events auto-dismiss
 * after 8 s; choice events block until the player picks an option.
 *
 * Multiple pending events queue inside the modal — when the current
 * one is dismissed (or resolved) the next one slides in. Severity
 * controls the accent colour (info=neutral, warning=amber, danger=red,
 * choice=blue).
 */
export class EventModal {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly avatar: HTMLElement;
  private readonly title: HTMLElement;
  private readonly heraldTag: HTMLElement;
  private readonly body: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private autoDismissTimer: number | undefined;
  private current: GameEvent | null = null;
  private readonly queue: GameEvent[] = [];
  /** Resolution callback — main.ts wires this to Game.resolveEventChoice. */
  onChoice?: (event: GameEvent, choiceId: string) => void;

  constructor() {
    this.root = mustGet('event-modal');
    this.card = mustGet('event-modal-card');
    this.avatar = mustGet('event-modal-avatar');
    this.title = mustGet('event-modal-title');
    this.heraldTag = mustGet('event-modal-herald');
    this.body = mustGet('event-modal-body');
    this.choices = mustGet('event-modal-choices');
    this.closeBtn = mustGet('event-modal-close');
    this.closeBtn.addEventListener('click', () => this.dismiss());
  }

  /** Show or queue an event. Choice events take priority over auto-dismiss. */
  enqueue(event: GameEvent): void {
    if (this.current && this.current.severity === 'choice') {
      // Don't interrupt a blocking choice — queue this one for later.
      this.queue.push(event);
      return;
    }
    if (this.current && event.severity === 'choice') {
      // Choice event preempts info/warning/danger.
      this.queue.unshift(this.current);
      this.show(event);
      return;
    }
    if (this.current) {
      this.queue.push(event);
      return;
    }
    this.show(event);
  }

  private show(event: GameEvent): void {
    this.current = event;
    this.card.dataset.severity = event.severity;
    this.title.textContent = event.title;
    this.body.textContent = event.body;

    const herald = event.herald ? FACTIONS.find((f) => f.id === event.herald) : undefined;
    if (herald) {
      const initials = herald.leaderName.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
      this.avatar.textContent = initials;
      this.avatar.style.background = `#${herald.color.toString(16).padStart(6, '0')}33`;
      this.avatar.style.borderColor = `#${herald.color.toString(16).padStart(6, '0')}aa`;
      this.heraldTag.textContent = `${herald.leaderName} · ${herald.name}`;
    } else {
      this.avatar.textContent = '!';
      this.heraldTag.textContent = '';
    }

    // Choices.
    this.choices.innerHTML = '';
    if (event.choices && event.choices.length > 0) {
      this.closeBtn.style.display = 'none';
      for (const c of event.choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'event-modal__choice';
        btn.innerHTML = `
          <span class="event-modal__choice-label">${escapeHtml(c.label)}</span>
          <span class="event-modal__choice-hint">${escapeHtml(c.hint)}</span>
        `;
        btn.addEventListener('click', () => this.resolve(c.id));
        this.choices.appendChild(btn);
      }
    } else {
      this.closeBtn.style.display = '';
      // Auto-dismiss after 8 s for non-choice events.
      if (this.autoDismissTimer !== undefined) clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = window.setTimeout(() => this.dismiss(), 8000);
    }

    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
  }

  private resolve(choiceId: string): void {
    if (!this.current) return;
    const e = this.current;
    this.onChoice?.(e, choiceId);
    this.dismiss();
  }

  private dismiss(): void {
    this.current = null;
    if (this.autoDismissTimer !== undefined) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = undefined;
    }
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.show(next);
        return;
      }
    }
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`EventModal: missing #${id}`);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
