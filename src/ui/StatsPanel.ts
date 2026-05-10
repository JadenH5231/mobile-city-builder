import type { Stats, StatsSample } from '../simulation/Stats';

/**
 * Stats panel (Alpha 2.11). Modal sheet showing line-graph history of
 * the city's headline metrics: population, treasury, monthly revenue
 * vs expenses, average mood, RCI demand, and export revenue.
 *
 * Renders directly to canvas with no chart-lib dependency — keeps the
 * production bundle lean. Each metric gets its own small chart with a
 * coloured stroke + light grid + min/current/max labels. Charts share
 * the same x-axis (months elapsed).
 *
 * Data source: `Stats` ring buffer, captured monthly from Game.
 */
export class StatsPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly chartsEl: HTMLElement;
  private readonly summaryEl: HTMLElement;

  constructor(private readonly stats: Stats) {
    this.el = mustGet('stats-panel');
    this.closeBtn = mustGet('stats-close');
    this.emptyEl = mustGet('stats-empty');
    this.chartsEl = mustGet('stats-charts');
    this.summaryEl = mustGet('stats-summary');
    this.closeBtn.addEventListener('click', () => this.hide());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
  }

  show(): void {
    this.render();
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

  private render(): void {
    const samples = this.stats.samples;
    if (samples.length < 2) {
      this.emptyEl.style.display = '';
      this.chartsEl.style.display = 'none';
      this.summaryEl.textContent = '';
      return;
    }
    this.emptyEl.style.display = 'none';
    this.chartsEl.style.display = '';
    this.chartsEl.innerHTML = '';

    const monthsCovered = samples[samples.length - 1]!.month - samples[0]!.month + 1;
    const yearText = monthsCovered >= 12
      ? `${(monthsCovered / 12).toFixed(1)} years`
      : `${monthsCovered} months`;
    this.summaryEl.textContent = `${samples.length} samples · ${yearText} of history`;

    // Chart definitions: label, accent colour, value extractor, formatter.
    type ChartDef = {
      label: string;
      sub: string;
      color: string;
      // For paired-series charts (revenue vs expenses) caller can return
      // [primary, secondary]. Single-series returns one element.
      pick: (s: StatsSample) => number | [number, number];
      secondaryColor?: string;
      secondaryLabel?: string;
      format: (v: number) => string;
      /** Optional zero-line (so negative values plot meaningfully). */
      zeroLine?: boolean;
    };
    const charts: ChartDef[] = [
      {
        label: 'Population',
        sub: 'Residents over time',
        color: '#7ad07a',
        pick: (s) => s.population,
        format: (v) => Math.round(v).toLocaleString()
      },
      {
        label: 'Treasury',
        sub: 'Cash on hand',
        color: '#e5c25a',
        pick: (s) => s.treasury,
        format: (v) => '$' + Math.round(v).toLocaleString(),
        zeroLine: true
      },
      {
        label: 'Revenue vs expenses',
        sub: 'Monthly income (green) vs spending (red)',
        color: '#7ad07a',
        secondaryColor: '#d05a5a',
        secondaryLabel: 'Expenses',
        pick: (s) => [s.revenue, s.expenses],
        format: (v) => '$' + Math.round(v).toLocaleString()
      },
      {
        label: 'City mood',
        sub: 'Average faction happiness',
        color: '#a78ed4',
        pick: (s) => s.mood,
        format: (v) => v.toFixed(2),
        zeroLine: true
      },
      {
        label: 'Export revenue',
        sub: 'Forestry + farm exports per month',
        color: '#6db5c5',
        pick: (s) => s.exportRevenue,
        format: (v) => '$' + Math.round(v).toLocaleString()
      },
      {
        label: 'RCI demand',
        sub: 'Residential / commercial / industrial demand pressure',
        color: '#7ad07a',
        secondaryColor: '#6db5c5',
        secondaryLabel: 'Commercial',
        pick: (s) => [s.demandR, s.demandC],
        format: (v) => v.toFixed(2),
        zeroLine: true
      }
    ];

    for (const def of charts) this.chartsEl.appendChild(this.makeChart(samples, def));
  }

  private makeChart(samples: readonly StatsSample[], def: {
    label: string;
    sub: string;
    color: string;
    secondaryColor?: string;
    secondaryLabel?: string;
    pick: (s: StatsSample) => number | [number, number];
    format: (v: number) => string;
    zeroLine?: boolean;
  }): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'stats__chart';

    const head = document.createElement('div');
    head.className = 'stats__chart-head';
    const title = document.createElement('div');
    title.className = 'stats__chart-title';
    title.textContent = def.label;
    const sub = document.createElement('div');
    sub.className = 'stats__chart-sub';
    sub.textContent = def.sub;
    head.appendChild(title);
    head.appendChild(sub);
    wrap.appendChild(head);

    // Pull series (always treat as 2-series; secondary may be undefined).
    const primary: number[] = [];
    const secondary: number[] = [];
    let hasSecondary = false;
    for (const s of samples) {
      const v = def.pick(s);
      if (Array.isArray(v)) {
        primary.push(v[0]);
        secondary.push(v[1]);
        hasSecondary = true;
      } else {
        primary.push(v);
      }
    }
    const last = primary[primary.length - 1]!;
    const min = primary.reduce((a, b) => Math.min(a, b), primary[0]!);
    const max = primary.reduce((a, b) => Math.max(a, b), primary[0]!);

    // Stat callouts.
    const stat = document.createElement('div');
    stat.className = 'stats__chart-stat';
    stat.innerHTML =
      `<span class="stats__chart-stat-current" style="color: ${def.color}">${def.format(last)}</span>` +
      `<span class="stats__chart-stat-range">range ${def.format(min)} – ${def.format(max)}</span>`;
    wrap.appendChild(stat);

    // Canvas + responsive width.
    const canvas = document.createElement('canvas');
    canvas.className = 'stats__chart-canvas';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = 320;
    const cssHeight = 90;
    canvas.style.width = '100%';
    canvas.style.height = cssHeight + 'px';
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    wrap.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawSeries(ctx, cssWidth, cssHeight, primary, def.color, def.zeroLine ?? false);
    if (hasSecondary && def.secondaryColor) {
      drawSeries(ctx, cssWidth, cssHeight, secondary, def.secondaryColor, def.zeroLine ?? false, /*overlay*/ true);
    }
    return wrap;
  }
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  series: readonly number[], color: string, zeroLine: boolean,
  overlay = false
): void {
  if (series.length < 2) return;
  if (!overlay) {
    // Background grid + zero line.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  // Range. Pad min/max so a flat series has visible thickness.
  let lo = series.reduce((a, b) => Math.min(a, b), series[0]!);
  let hi = series.reduce((a, b) => Math.max(a, b), series[0]!);
  if (zeroLine) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < 1e-6) {
    hi = lo + 1;
  }
  const padPct = 0.08;
  const span = hi - lo;
  lo -= span * padPct;
  hi += span * padPct;
  const range = hi - lo;

  // Zero line (drawn on the primary pass so it's behind both lines).
  if (!overlay && zeroLine && lo < 0 && hi > 0) {
    const yz = h - ((0 - lo) / range) * h;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yz);
    ctx.lineTo(w, yz);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Stroke.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((series[i]! - lo) / range) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Subtle area fill for the primary series only.
  if (!overlay) {
    ctx.fillStyle = color + '22';
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`StatsPanel: missing #${id}`);
  return el;
}
