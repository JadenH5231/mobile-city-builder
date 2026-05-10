import type { Districts } from '../simulation/Districts';

/**
 * Bottom-sheet for managing districts (Alpha 2.22). Lists every district
 * created so far with editable name + per-zone surtax sliders + a swatch
 * of the district's accent color.
 *
 * Refresh model: rebuilds the inner list every show + on every dirty
 * input. The list is small (typical city has ≤ 6 districts) so this is
 * cheap.
 */
export class DistrictsPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly activeIdEl: HTMLElement;

  /** Called when the player clicks "Make active" on a district row. */
  onSetActive?: (id: number) => void;
  /** Called when the player clicks "New district" — the caller resets
   *  the active district to 0 so the next paint stroke allocates a fresh
   *  one. */
  onNewDistrict?: () => void;
  /** Called after any district mutation (name / color / surtax) so the
   *  caller can re-tint the renderer overlay. */
  onChange?: () => void;

  constructor(private readonly districts: Districts) {
    this.el = mustGet('districts-panel');
    this.closeBtn = mustGet('districts-close');
    this.listEl = mustGet('districts-list');
    this.activeIdEl = mustGet('districts-active');
    this.closeBtn.addEventListener('click', () => this.hide());
    const newBtn = document.getElementById('districts-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      this.onNewDistrict?.();
      this.refresh();
    });
  }

  show(activeId: number): void {
    this.refresh(activeId);
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

  refresh(activeId?: number): void {
    if (activeId !== undefined) {
      this.activeIdEl.textContent = activeId === 0
        ? 'Active: none — first paint creates a new district'
        : `Active: District ${activeId}`;
    }
    this.listEl.innerHTML = '';
    const list = this.districts.list();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'districts__empty';
      empty.textContent = 'No districts yet — paint to create one.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const d of list) {
      const row = document.createElement('div');
      row.className = 'districts__row';
      const swatch = document.createElement('span');
      swatch.className = 'districts__swatch';
      swatch.style.background = `#${d.color.toString(16).padStart(6, '0')}`;
      row.appendChild(swatch);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = d.name;
      nameInput.maxLength = 32;
      nameInput.className = 'districts__name';
      nameInput.addEventListener('input', () => {
        d.name = nameInput.value;
        this.onChange?.();
      });
      row.appendChild(nameInput);

      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = 'districts__activate';
      activate.textContent = 'Use';
      activate.addEventListener('click', () => {
        this.onSetActive?.(d.id);
        this.refresh(d.id);
      });
      row.appendChild(activate);

      const sliders = document.createElement('div');
      sliders.className = 'districts__sliders';
      sliders.appendChild(makeSurtaxSlider(d, 'taxRSurtax', 'R', this.onChange));
      sliders.appendChild(makeSurtaxSlider(d, 'taxCSurtax', 'C', this.onChange));
      sliders.appendChild(makeSurtaxSlider(d, 'taxISurtax', 'I', this.onChange));
      row.appendChild(sliders);

      this.listEl.appendChild(row);
    }
  }
}

function makeSurtaxSlider(
  d: { taxRSurtax: number; taxCSurtax: number; taxISurtax: number },
  field: 'taxRSurtax' | 'taxCSurtax' | 'taxISurtax',
  label: string,
  onChange?: () => void
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'districts__slider';
  const top = document.createElement('div');
  top.className = 'districts__slider-row';
  const lab = document.createElement('span');
  lab.textContent = `${label}`;
  const val = document.createElement('span');
  val.className = 'mono';
  val.textContent = `${d[field]}%`;
  top.appendChild(lab);
  top.appendChild(val);
  wrap.appendChild(top);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '-5';
  input.max = '15';
  input.step = '1';
  input.value = String(d[field]);
  input.addEventListener('input', () => {
    d[field] = Number(input.value);
    val.textContent = `${d[field]}%`;
    onChange?.();
  });
  wrap.appendChild(input);
  return wrap;
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
