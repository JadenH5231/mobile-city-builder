import type { Grid } from '../world/Grid';
import type { Population } from './Population';
import {
  BUILDING_UPKEEP,
  COMMERCIAL_JOBS,
  FARM_BASE_REVENUE_PER_TILE,
  FARM_DISCONNECTED_MULT,
  FORESTRY_BASE_REVENUE_PER_TILE,
  FORESTRY_DISCONNECTED_MULT,
  HOSPITAL_PRODUCTIVITY_BONUS,
  LANDMARK_TOURISM_BASE,
  LANDMARK_TOURISM_PER_RESIDENT,
  LUXURY_RESIDENT_CAPACITY_PER_TILE,
  LUXURY_TAX_BONUS,
  MIXED_COMMERCIAL_JOBS,
  RESIDENT_CAPACITY,
  RESORT_BASE_REVENUE_PER_TILE,
  RESORT_DISCONNECTED_MULT,
  RESORT_SCALE_BONUS_PER_TILE,
  RESORT_SCALE_CAP,
  RESORT_WATER_BONUS_MULT,
  HOTEL_BASE_REVENUE_PER_TILE,
  HOTEL_DISCONNECTED_MULT,
  HOTEL_WATER_BONUS_MULT,
  HOTEL_AIRBNB_MULT,
  HOTEL_MOTEL_MULT,
  HOTEL_HOTEL_MULT,
  ROAD_TIER,
  type Building,
  type Zone
} from '../types';
import type { Tile } from '../world/Tile';
import type { GlobalMarket } from './GlobalMarket';
import type { Events } from './Events';
import type { Bonds } from './Bonds';
import type { Crime } from './Crime';
import type { Districts } from './Districts';
import type { Council } from './Council';

/** Real-time milliseconds per simulated month. ~3 months/min on a stable tab. */
const MONTH_MS = 20_000;

/**
 * Tax sweet spots — at these rates the demand penalty is zero. Below: small
 * boost to demand (good for kickstarting growth, bad for revenue). Above:
 * demand drag (citizens grumble, growth slows). Memory:
 * feedback_challenge_tuning — these are the levers, money has to feel tight.
 */
const TAX_SWEET: Record<Exclude<Zone, 'none'>, number> = {
  residential: 9,
  commercial: 10,
  industrial: 11,
  // Mixed-use sits between R and C — citizens AND merchants in the same
  // tile, both averaged.
  mixed: 9.5
};
const TAX_PENALTY_DENOMINATOR = 30;

/**
 * Revenue coefficients — `residents * taxR * REV_PER_RESIDENT` etc.
 *
 * Memory: feedback_challenge_tuning (post-alpha pass 2). Cut to ~50% of the
 * pass-1 values because per-capita revenue scaled linearly with pop while
 * expenses didn't, leaving high-pop cities trivially cash-positive (a 1500-pop
 * city was banking $30K+/month on default taxes).
 */
const REV_PER_RESIDENT = 1.0;
const REV_PER_C_JOB = 1.25;
const REV_PER_I_JOB = 1.13;

/**
 * Per-edge monthly road maintenance is now tier-dependent (post-alpha pass 4):
 * see `ROAD_TIER[type].maintenance`. Local = $15, avenue = $25, highway =
 * $40. Mixed-tier edges are charged the average of both endpoints.
 */

/**
 * Per-capita "city services" expense — generic services we don't model as
 * buildings (trash, fire, admin). Effective rate per resident is
 * `BASE + totalResidents / 1000 * GROWTH`, so:
 *   100 residents → $2.1/resident → $210/mo
 *   500 residents → $2.5/resident → $1,250/mo
 *  1500 residents → $3.5/resident → $5,250/mo
 *  3000 residents → $5.0/resident → $15,000/mo
 *
 * The growth term is what creates the real squeeze at scale — pop alone now
 * generates expenses, not just infrastructure. Memory:
 * feedback_challenge_tuning (post-alpha pass 2).
 */
const SERVICES_BASE_PER_RESIDENT = 2;
const SERVICES_GROWTH_PER_1K = 1;

/**
 * Treasury, tax rates, monthly settlement. The settlement runs every
 * `MONTH_MS` of accumulated real-time inside `tick`, NOT every render frame —
 * keeps cadence stable across stutter or backgrounded tabs.
 *
 * All public fields here are part of the save game (see persistence/SaveGame).
 */
export class Economy {
  treasury = 15_000;
  taxR = 9;
  taxC = 10;
  taxI = 11;
  monthsElapsed = 0;
  /** Last completed month's totals — read by BudgetPanel. */
  lastRevenue = 0;
  lastExpenses = 0;
  /** Last completed month's forestry exports (Alpha 2.7). 0 when no
   *  forestry tiles or city not connected. */
  lastForestryRevenue = 0;
  /** Last lumber-price multiplier seen by runMonth (Alpha 2.7). */
  lastLumberPrice = 1.0;
  /** Last completed month's farm exports (Alpha 2.7.1). */
  lastFarmRevenue = 0;
  /** Last produce-price multiplier (Alpha 2.7.1). */
  lastProducePrice = 1.0;
  /** Last completed month's tourism revenue (Alpha 2.17). 0 with no
   *  road-connected landmarks. Surfaced in the budget panel. */
  lastTourismRevenue = 0;
  /** Lifetime tourism revenue earned. Drives the tourism achievement. */
  lifetimeTourismRevenue = 0;
  /** Last completed month's resort tourism revenue (Beta 2.0). */
  lastResortRevenue = 0;
  /** Last completed month's hotel/motel tourism revenue (Beta 1.9.14). */
  lastHotelRevenue = 0;
  /** Last completed month's bond debt service (Alpha 2.18). Pull-out line
   *  in the budget panel so the player sees what their borrowing costs. */
  lastBondPayment = 0;
  /** Last month's surtax revenue (Alpha 2.18) — high-density / luxury
   *  tax bracket layered on top of base R/C rates. */
  lastSurtaxRevenue = 0;
  /** Last completed month's beautification budget paid out (Alpha 4.0).
   *  Council-elected line item; equals 0 when the bill defunded
   *  (treasury was short). Surfaced in BudgetPanel as a read-only
   *  council-controlled line. */
  lastBeautificationCost = 0;
  /** Player-set wealth surtax (Alpha 2.18). 0..30 (%) added on top of the
   *  base R/C rate for L3 R, L3 C, and luxury R tiles. Drives a small
   *  faction effect: taxpayers love surtax revenue, chamber hates it. */
  wealthSurtax = 0;
  /** Last completed month's accident-related expense (for budget breakdown). */
  lastAccidentCost = 0;
  /** Number of crashes during the current (in-progress) month. */
  accidentsThisMonth = 0;
  /** Total accidents across the lifetime of the city — for HUD / stats. */
  totalAccidents = 0;

  private accumulatorMs = 0;
  /** Accident cost accruing during the current month, settled at month rollover. */
  private monthAccidentCost = 0;

  tick(
    stepMs: number,
    grid: Grid,
    population: Population,
    market?: GlobalMarket,
    events?: Events,
    bonds?: Bonds,
    crime?: Crime,
    districts?: Districts,
    council?: Council,
    parkingStrictness?: import('../ui/SettingsPanel').ParkingStrictness,
    supplyChain?: import('./SupplyChain').SupplyChain
  ): void {
    this.accumulatorMs += stepMs;
    while (this.accumulatorMs >= MONTH_MS) {
      this.accumulatorMs -= MONTH_MS;
      this.runMonth(grid, population, market, events, bonds, crime, districts, council, parkingStrictness, supplyChain);
    }
  }

  /**
   * Apply a crash penalty: deduct the per-incident treasury cost immediately,
   * and accrue toward this month's "lost revenue from accidents" line.
   * Caller (Game) is responsible for any per-tile demand penalty.
   */
  recordCrash(treasuryHit: number): void {
    this.treasury -= treasuryHit;
    this.monthAccidentCost += treasuryHit;
    this.accidentsThisMonth++;
    this.totalAccidents++;
  }

  /** Last commercial supply-chain multiplier. Beta 1.6.37: a BONUS in
   *  [1.0, 1.35]. 1.0 = no supplies (full base revenue, no bonus);
   *  1.35 = every commercial tile fully supplied by local industry. */
  lastSupplyMultiplier = 1.0;
  /** Last fraction of commercial jobs served by import trucks (Beta 1.6).
   *  Those jobs earn half the supply bonus (no penalty). */
  lastImportedFraction = 0;

  private runMonth(
    grid: Grid,
    population: Population,
    market?: GlobalMarket,
    events?: Events,
    bonds?: Bonds,
    crime?: Crime,
    districts?: Districts,
    council?: Council,
    parkingStrictness?: import('../ui/SettingsPanel').ParkingStrictness,
    supplyChain?: import('./SupplyChain').SupplyChain
  ): void {
    // Luxury bonus (Alpha 2.5): luxury residents pay base R tax PLUS an
    // extra LUXURY_TAX_BONUS multiple. With bonus 1.5, a luxury resident
    // pays 2.5x the regular R rate. The base portion is already inside
    // population.totalResidents below — we just add the premium delta.
    const luxuryBonusRevenue =
      population.luxuryResidents * this.taxR * REV_PER_RESIDENT * LUXURY_TAX_BONUS;

    // Export industries (Alpha 2.7+): each forestry / farm tile produces
    // a tradable commodity at a base rate. Modulated by global price; if
    // the city isn't connected to the outside world (no road tile on the
    // edge), a steep discount applies.
    let forestryTiles = 0;
    let farmTiles = 0;
    for (const t of grid.iter()) {
      if (t.building === 'forestry') forestryTiles++;
      else if (t.building === 'farm') farmTiles++;
    }
    const isConnected = market ? market.isConnected() : true;
    // Active recession / boom / trade-deal modifiers (Alpha 2.9) layer on
    // top of the base oscillation as a multiplicative shock.
    const eventLumberMult = events ? events.lumberShockMult() : 1.0;
    const eventProduceMult = events ? events.produceShockMult() : 1.0;
    const lumberPrice = (market ? market.lumberPrice(this.monthsElapsed) : 1.0) * eventLumberMult;
    const producePrice = (market ? market.producePrice(this.monthsElapsed) : 1.0) * eventProduceMult;
    const forestryConn = isConnected ? 1.0 : FORESTRY_DISCONNECTED_MULT;
    const farmConn = isConnected ? 1.0 : FARM_DISCONNECTED_MULT;
    const forestryRevenue = forestryTiles * FORESTRY_BASE_REVENUE_PER_TILE * lumberPrice * forestryConn;
    const farmRevenue = farmTiles * FARM_BASE_REVENUE_PER_TILE * producePrice * farmConn;
    this.lastLumberPrice = lumberPrice;
    this.lastProducePrice = producePrice;
    this.lastForestryRevenue = Math.round(forestryRevenue);
    this.lastFarmRevenue = Math.round(farmRevenue);

    // Hospital productivity bonus (Alpha 2.10): tally commercial /
    // industrial jobs on tiles inside a hospital coverage radius so the
    // bonus applies only where the hospital actually reaches.
    let cJobsCovered = 0;
    let iJobsCovered = 0;
    // Wealth surtax (Alpha 2.18): per-month sweep over R-L3 + C-L3 +
    // luxury tiles. Each contributes additional revenue at the surtax
    // rate (multiplicative on base R/C). 0% by default — opt-in lever
    // for the player who wants more revenue from the affluent bracket.
    let surtaxResidents = 0;
    let surtaxCJobs = 0;
    for (const t of grid.iter()) {
      if (!t.hasHospital || t.density === 0) continue;
      if (t.zone === 'commercial') cJobsCovered++;
      else if (t.zone === 'industrial') iJobsCovered++;
    }
    if (this.wealthSurtax > 0) {
      for (const t of grid.iter()) {
        if (t.density === 0) continue;
        // Wealth surtax applies to L3+ residents/jobs (Alpha 4.18 widens
        // from `=== 3` to `>= 3` so L4 is also captured — L4 residents
        // / jobs are even higher density and should also be taxed).
        if (t.zone === 'residential' && (t.density >= 3 || t.luxury)) surtaxResidents += residentsForTile(t);
        else if (t.zone === 'commercial' && t.density >= 3) surtaxCJobs += commercialJobsForTile(t);
      }
    }
    const hospitalBonus =
      cJobsCovered * this.taxC * REV_PER_C_JOB * HOSPITAL_PRODUCTIVITY_BONUS +
      iJobsCovered * this.taxI * REV_PER_I_JOB * HOSPITAL_PRODUCTIVITY_BONUS;

    // Landmark tourism (Alpha 2.17): each landmark earns BASE + per-resident
    // scaler per month, gated on having a 4-connected road. A landmark
    // without road access generates zero tourism — visible "you should
    // build a road" feedback through the budget panel.
    let tourismRevenue = 0;
    for (const t of grid.iter()) {
      if (t.building !== 'museum' && t.building !== 'observatory') continue;
      if (!grid.hasRoadAdjacent(t.x, t.y)) continue;
      const kind = t.building;
      tourismRevenue += LANDMARK_TOURISM_BASE[kind] +
        LANDMARK_TOURISM_PER_RESIDENT[kind] * population.totalResidents;
    }
    // Resort tourism (Beta 2.0): connected clusters earn per-tile base revenue
    // boosted by cluster size (economies of scale) and water adjacency
    // (coastal/waterfront plots are premium). Disconnected clusters earn a
    // heavy discount — a resort nobody can reach still draws visitors, just far fewer.
    let resortRevenue = 0;
    {
      const visitedResorts = new Set<number>();
      for (const t of grid.iter()) {
        if (t.building !== 'resort') continue;
        const startKey = t.y * grid.width + t.x;
        if (visitedResorts.has(startKey)) continue;
        const cluster: Array<{x: number; y: number}> = [];
        const queue: Array<{x: number; y: number}> = [{x: t.x, y: t.y}];
        visitedResorts.add(startKey);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          cluster.push(curr);
          for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const nk = ny * grid.width + nx;
            if (visitedResorts.has(nk)) continue;
            const nt = grid.get(nx, ny);
            if (!nt || nt.building !== 'resort') continue;
            visitedResorts.add(nk);
            queue.push({x: nx, y: ny});
          }
        }
        const size = cluster.length;
        const scaleMult = 1 + Math.min(size - 1, RESORT_SCALE_CAP) * RESORT_SCALE_BONUS_PER_TILE;
        const hasWater = cluster.some(({x, y}) => {
          for (const [dx2, dy2] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
            const nt = grid.get(x + dx2, y + dy2);
            if (nt && nt.terrain === 'water') return true;
          }
          return false;
        });
        const hasRoad = cluster.some(({x, y}) => grid.hasRoadAdjacent(x, y));
        const connMult = hasRoad ? 1.0 : RESORT_DISCONNECTED_MULT;
        const waterBonus = hasWater ? RESORT_WATER_BONUS_MULT : 1.0;
        resortRevenue += size * RESORT_BASE_REVENUE_PER_TILE * scaleMult * waterBonus * connMult;
      }
    }
    this.lastResortRevenue = Math.round(resortRevenue);
    tourismRevenue += resortRevenue;
    // Hotel/motel tourism (Beta 1.9.14): cluster BFS identical to resorts.
    // Archetype multiplier branches on bounding-box shape:
    //   1×1 → airbnb (smallest, cheapest per tile)
    //   min dim = 1, max > 1 → motel strip
    //   both dims ≥ 2 → hotel block (premium multiplier)
    let hotelRevenue = 0;
    {
      const visitedHotels = new Set<number>();
      for (const t of grid.iter()) {
        if (t.building !== 'hotel') continue;
        const startKey = t.y * grid.width + t.x;
        if (visitedHotels.has(startKey)) continue;
        const cluster: Array<{x: number; y: number}> = [];
        const queue: Array<{x: number; y: number}> = [{x: t.x, y: t.y}];
        visitedHotels.add(startKey);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          cluster.push(curr);
          for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const nk = ny * grid.width + nx;
            if (visitedHotels.has(nk)) continue;
            const nt = grid.get(nx, ny);
            if (!nt || nt.building !== 'hotel') continue;
            visitedHotels.add(nk);
            queue.push({x: nx, y: ny});
          }
        }
        const size = cluster.length;
        const minX = Math.min(...cluster.map(c => c.x));
        const maxX = Math.max(...cluster.map(c => c.x));
        const minY = Math.min(...cluster.map(c => c.y));
        const maxY = Math.max(...cluster.map(c => c.y));
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const archMult =
          (bw === 1 && bh === 1) ? HOTEL_AIRBNB_MULT :
          (bw >= 2 && bh >= 2) ? HOTEL_HOTEL_MULT : HOTEL_MOTEL_MULT;
        const hasWater = cluster.some(({x, y}) => {
          for (const [dx2, dy2] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
            const nt = grid.get(x + dx2, y + dy2);
            if (nt && nt.terrain === 'water') return true;
          }
          return false;
        });
        const hasRoad = cluster.some(({x, y}) => grid.hasRoadAdjacent(x, y));
        const connMult = hasRoad ? 1.0 : HOTEL_DISCONNECTED_MULT;
        const waterBonus = hasWater ? HOTEL_WATER_BONUS_MULT : 1.0;
        hotelRevenue += size * HOTEL_BASE_REVENUE_PER_TILE * archMult * waterBonus * connMult;
      }
    }
    this.lastHotelRevenue = Math.round(hotelRevenue);
    tourismRevenue += hotelRevenue;
    this.lastTourismRevenue = Math.round(tourismRevenue);
    this.lifetimeTourismRevenue += this.lastTourismRevenue;

    const surtaxFraction = this.wealthSurtax / 100;
    let surtaxRevenue =
      surtaxResidents * this.taxR * REV_PER_RESIDENT * surtaxFraction +
      surtaxCJobs * this.taxC * REV_PER_C_JOB * surtaxFraction;

    // District surtax (Alpha 2.22): per-tile sweep applies each district's
    // per-zone surtax % on top of base R/C/I rates. Industrial is included
    // here too — the lever is district-level, not bracket-level. Skipped
    // entirely if no districts exist (the common case).
    if (districts && districts.registry.size > 0) {
      let districtRevenue = 0;
      for (const t of grid.iter()) {
        if (t.districtId === 0 || t.density === 0 || t.zone === 'none') continue;
        const r = residentsForTile(t);
        const c = commercialJobsForTile(t);
        const i = t.zone === 'industrial' ? (t.density === 1 ? 4 : t.density === 2 ? 14 : 50) : 0;
        if (r > 0) {
          const surtax = districts.surtaxFor(t.districtId, 'residential') / 100;
          districtRevenue += r * this.taxR * REV_PER_RESIDENT * surtax;
        }
        if (c > 0) {
          const surtax = districts.surtaxFor(t.districtId, t.zone === 'mixed' ? 'mixed' : 'commercial') / 100;
          districtRevenue += c * this.taxC * REV_PER_C_JOB * surtax;
        }
        if (i > 0) {
          const surtax = districts.surtaxFor(t.districtId, 'industrial') / 100;
          districtRevenue += i * this.taxI * REV_PER_I_JOB * surtax;
        }
      }
      surtaxRevenue += districtRevenue;
    }
    this.lastSurtaxRevenue = Math.round(surtaxRevenue);

    // Crime penalty (Alpha 2.21): high city-wide crime drags commercial
    // revenue (shoppers stay away from unsafe districts). Up to a 50%
    // floor at max crime; in practice the multiplier sits well above 0.9
    // even in cities with no police coverage.
    const crimeMult = crime ? crime.commercialRevenueMultiplier() : 1.0;
    // Parking penalty (Beta 1.3.5 / Phase 3). Realistic + Strict modes
    // penalise commercial revenue when commercial tiles don't have a
    // 4-adjacent parking_lot. The penalty scales with the fraction of
    // under-parked tiles citywide:
    //   - 'off' / 'lenient'  → 1.0 (no penalty; lenient is current)
    //   - 'realistic' → up to -15% if every commercial tile is unparked
    //   - 'strict'    → up to -30% if every commercial tile is unparked
    // A city with NO commercial tiles gets multiplier 1.0 (no
    // denominator). The fence-checks here are O(grid) but cheap; only
    // counted on tiles where it matters (developed C / MU / big_box).
    let parkingMult = 1.0;
    if (parkingStrictness === 'realistic' || parkingStrictness === 'strict') {
      let parkable = 0;
      let unparked = 0;
      for (const t of grid.iter()) {
        const counts =
          (t.zone === 'commercial' && t.density > 0) ||
          (t.zone === 'mixed' && t.density > 0) ||
          t.building === 'big_box';
        if (!counts) continue;
        parkable++;
        const n = [
          grid.get(t.x + 1, t.y),
          grid.get(t.x - 1, t.y),
          grid.get(t.x, t.y + 1),
          grid.get(t.x, t.y - 1)
        ];
        const hasParking = n.some((nb) => nb && nb.building === 'parking_lot');
        if (!hasParking) unparked++;
      }
      if (parkable > 0) {
        const unparkFrac = unparked / parkable;
        const maxPenalty = parkingStrictness === 'strict' ? 0.30 : 0.15;
        parkingMult = 1 - unparkFrac * maxPenalty;
      }
    }
    // Beta 1.6.37 — supply-chain BONUS multiplier in [1.0, 1.35].
    // Supplies are a reward, not a gate: a no-supplies tile keeps its
    // full base revenue (bonus 0), a well-supplied tile earns up to
    // +35% (imports give half). Cached on Economy for the BudgetPanel
    // + tile diagnostic UI.
    const supplyState = supplyChain
      ? supplyChain.commercialSupplyState(grid)
      : { multiplier: 1.0, averageSupplies: NaN, importedFraction: 0 };
    this.lastSupplyMultiplier = supplyState.multiplier;
    this.lastImportedFraction = supplyState.importedFraction;

    const revenue =
      population.totalResidents * this.taxR * REV_PER_RESIDENT +
      luxuryBonusRevenue +
      population.totalCommercialJobs * this.taxC * REV_PER_C_JOB * crimeMult * parkingMult * supplyState.multiplier +
      population.totalIndustrialJobs * this.taxI * REV_PER_I_JOB +
      forestryRevenue +
      farmRevenue +
      hospitalBonus +
      tourismRevenue +
      surtaxRevenue;

    // Tier-aware road maintenance — local $15, avenue $25, highway $40.
    // Charge the average of the two endpoints' tier so a mixed-tier edge
    // (e.g. on/off ramp) doesn't get a free pass.
    let edgeMaint = 0;
    for (const e of grid.iterRoadEdges()) {
      const ta = grid.get(e.ax, e.ay);
      const tb = grid.get(e.bx, e.by);
      const ma = ROAD_TIER[ta?.roadType ?? 'local'].maintenance;
      const mb = ROAD_TIER[tb?.roadType ?? 'local'].maintenance;
      edgeMaint += (ma + mb) / 2;
    }

    let expenses = edgeMaint;
    for (const t of grid.iter()) {
      if (t.building === 'none') continue;
      expenses += BUILDING_UPKEEP[t.building as Exclude<Building, 'none'>] ?? 0;
    }
    // Per-capita services with mild quadratic growth — see constants above.
    const ratePerResident =
      SERVICES_BASE_PER_RESIDENT +
      (population.totalResidents / 1000) * SERVICES_GROWTH_PER_1K;
    expenses += population.totalResidents * ratePerResident;

    // Council Beautification Budget (Alpha 4.0) — deducted BEFORE bond
    // debt service so the cheaper recurring expense settles first.
    // Council elects a tier each term (mayor cannot influence). If the
    // post-revenue/expenses treasury can't afford the bill, the bill
    // is *defunded* for this month: 0 paid, effective tier drops to
    // 'none' (renderer reads it and stops drawing flair city-wide).
    // Council relinks effective tier to elected at the next election or
    // any month where the bill clears.
    let beautCost = 0;
    if (council) {
      const billed = council.beautificationMonthlyCost();
      const projectedTreasury = this.treasury + (revenue - expenses);
      if (billed > 0 && projectedTreasury >= billed) {
        beautCost = billed;
        council.effectiveBeautificationTier = council.beautificationTier;
        council.beautificationJustDefunded = false;
      } else {
        const wasFunded = council.effectiveBeautificationTier !== 'none';
        council.effectiveBeautificationTier = 'none';
        council.beautificationJustDefunded = wasFunded && billed > 0;
      }
    }
    this.lastBeautificationCost = beautCost;
    expenses += beautCost;

    // Bond debt service (Alpha 2.18): runs AFTER routine revenue and
    // expenses settle, so a bond payment can pull the treasury into the
    // red. The Bonds module deducts directly from treasury and reports
    // back the cash actually paid (could be 0 on a default).
    let bondService = 0;
    if (bonds) bondService = bonds.tickMonth(this);
    this.lastBondPayment = bondService;

    const netRevenue = Math.round(revenue);
    const netExpenses = Math.round(expenses);
    // Accident cost was already deducted from treasury in recordCrash —
    // here we just surface it for the budget panel breakdown.
    this.treasury += netRevenue - netExpenses;
    this.lastRevenue = netRevenue;
    this.lastExpenses = netExpenses + bondService;
    this.lastAccidentCost = Math.round(this.monthAccidentCost);
    this.monthAccidentCost = 0;
    this.accidentsThisMonth = 0;
    this.monthsElapsed++;
  }

  /** Surtax demand penalty (Alpha 2.18) — kicks in when the player sets
   *  wealthSurtax > 0; affects L3 R + L3 C + luxury R demand only. The
   *  bracket population is small relative to total, so the lever feels
   *  targeted: cranking the surtax up to 30% won't crater general
   *  R/C demand the way moving the base R slider would. */
  surtaxDemandPenalty(zone: Exclude<Zone, 'none'>): number {
    if (this.wealthSurtax <= 0) return 0;
    if (zone !== 'residential' && zone !== 'commercial') return 0;
    return this.wealthSurtax / 100 * 0.5;
  }

  /**
   * Demand penalty for a zone, applied by Population. Zero at the sweet spot,
   * positive (= demand drag) above it, negative (= demand boost) below it.
   */
  taxDemandPenalty(zone: Exclude<Zone, 'none'>): number {
    const rate =
      zone === 'residential' ? this.taxR :
      zone === 'commercial' ? this.taxC :
      zone === 'industrial' ? this.taxI :
      // Mixed-use trips bear the average of R + C tax pressure.
      (this.taxR + this.taxC) / 2;
    return (rate - TAX_SWEET[zone]) / TAX_PENALTY_DENOMINATOR;
  }
}

/** Helpers (Alpha 2.18) for the wealth-surtax sweep. They mirror
 *  Population.tile-residents / commercial-jobs without importing the
 *  whole module — Economy.runMonth needs the per-tile capacity for
 *  the L3 / luxury bracket sweep but doesn't carry any other Population
 *  baggage. */
function residentsForTile(t: Tile): number {
  if (t.luxury) return LUXURY_RESIDENT_CAPACITY_PER_TILE;
  if (t.zone === 'residential') return RESIDENT_CAPACITY[t.density] ?? 0;
  return 0;
}
function commercialJobsForTile(t: Tile): number {
  if (t.zone === 'commercial') return COMMERCIAL_JOBS[t.density] ?? 0;
  if (t.zone === 'mixed') return MIXED_COMMERCIAL_JOBS[t.density] ?? 0;
  return 0;
}
