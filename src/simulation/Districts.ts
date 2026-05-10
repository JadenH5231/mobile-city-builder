/**
 * Districts (Alpha 2.22). Each tile carries a `districtId` (0 = unassigned).
 * A District has a name, accent color, and a per-zone tax surtax that
 * stacks on top of base R/C/I rates inside the district. Districts are
 * a labelling + lever-applying layer — they don't affect zoning, building
 * placement, or services.
 *
 * Persisted shape: districts are defined by IDs in [1, 254] so they fit
 * in a Uint8 if we ever need to compress per-tile storage. The registry
 * is stored as a flat array; per-tile districtId lives on Tile.ts.
 */

export interface District {
  readonly id: number;
  name: string;
  /** Hex color used for the overlay tint + chip in the UI. */
  color: number;
  /** Surtax % stacked onto each zone's base rate. -5..+15 typically. */
  taxRSurtax: number;
  taxCSurtax: number;
  taxISurtax: number;
}

const PALETTE = [
  0xc4a3d6, // lavender
  0x6da5d6, // sky blue
  0x4d8442, // forest green
  0xc09660, // tan
  0xc8932a, // amber
  0xeec453, // gold
  0xa44a3a, // brick
  0x7da06b, // sage
  0xd06a8a, // rose
  0xe07a3a  // orange
];

export interface DistrictsSnapshot {
  readonly districts: District[];
  readonly nextId: number;
}

export class Districts {
  /** Registry of districts. Empty until the first paint stroke. */
  readonly registry = new Map<number, District>();
  /** Monotonic id allocator. Starts at 1; 0 is reserved for "unassigned". */
  private nextId = 1;

  /** Get the district with the given id, or undefined. */
  get(id: number): District | undefined {
    return id === 0 ? undefined : this.registry.get(id);
  }

  /** Either return the existing district `id` or allocate a fresh one. */
  ensure(id: number): District {
    let d = this.registry.get(id);
    if (!d) {
      d = {
        id,
        name: `District ${id}`,
        color: PALETTE[(id - 1) % PALETTE.length] ?? 0xa0a0a0,
        taxRSurtax: 0,
        taxCSurtax: 0,
        taxISurtax: 0
      };
      this.registry.set(id, d);
    }
    return d;
  }

  /** Allocate a fresh district id and create the entry. */
  allocate(): District {
    while (this.registry.has(this.nextId)) this.nextId++;
    const id = this.nextId++;
    return this.ensure(id);
  }

  /** Remove a district from the registry. The caller is responsible for
   *  clearing per-tile districtId references; this method is purely
   *  registry maintenance. */
  delete(id: number): boolean {
    return this.registry.delete(id);
  }

  list(): District[] {
    return Array.from(this.registry.values()).sort((a, b) => a.id - b.id);
  }

  serialize(): DistrictsSnapshot {
    return {
      districts: this.list().map((d) => ({ ...d })),
      nextId: this.nextId
    };
  }

  restore(snap?: DistrictsSnapshot): void {
    this.registry.clear();
    this.nextId = 1;
    if (!snap) return;
    for (const d of snap.districts) {
      this.registry.set(d.id, { ...d });
    }
    this.nextId = snap.nextId ?? this.nextId;
  }

  /** Per-zone tax surtax applied INSIDE this district. Returns 0 if the
   *  tile has no district assigned. */
  surtaxFor(districtId: number, zone: 'residential' | 'commercial' | 'industrial' | 'mixed'): number {
    const d = this.get(districtId);
    if (!d) return 0;
    if (zone === 'residential') return d.taxRSurtax;
    if (zone === 'commercial') return d.taxCSurtax;
    if (zone === 'industrial') return d.taxISurtax;
    // Mixed-use averages R + C surtax — same logic as base tax.
    return (d.taxRSurtax + d.taxCSurtax) / 2;
  }
}
