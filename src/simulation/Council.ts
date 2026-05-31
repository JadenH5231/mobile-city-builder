import type { Happiness, FactionId } from './Happiness';
import type { Population } from './Population';
import {
  BEAUTIFICATION_TIERS,
  BEAUTIFICATION_TIER_ORDER,
  type BeautificationTier,
  type ZoneTier
} from '../types';

/**
 * Council — the governance layer that turns Happiness from "vibes" into
 * concrete game-mechanics pressure. Every 3 sim months an election fires:
 *
 * - Mayor (the player) always wins, ≥ 50.0001%, with the actual % scaled by
 *   overall city happiness so close races feel tense.
 * - Opponent = leader of the 2nd-most-angry faction. They don't get a council
 *   seat that term (they ran against the mayor and lost).
 * - 4 of the remaining 9 factions take council seats, ranked by votes
 *   (factionPop × turnout). Turnout climbs with anger, so neglected groups
 *   get over-represented.
 *
 * Councillors do three things while in office:
 *
 * 1. Cost multiplier: every buildable's price is multiplied by
 *    `1 − sumStances × 0.25`, clamped [0.20, 2.5]. If every councillor
 *    strongly opposes a thing (all stances ≤ −0.4), it's BANNED for the term.
 * 2. Zoning-change gate: re-zoning an already-zoned tile needs ≥ 2 councillors
 *    with stance ≥ 0 for the new (zone, tier). Fresh paint on grass is always
 *    fine — only zone CHANGES need approval.
 * 3. Population boost: each councillor's faction gets +10% to its natural
 *    share. Population.tick reads this when computing per-faction targets.
 *
 * This module is the **executive arm** of the keystone Happiness system —
 * future governance features (policies, executive orders, ballot measures)
 * should plug in here.
 */

/**
 * Per-faction stance toward each thing the player can place / paint / zone.
 * Range [-1, +1]: -1 = strongly opposed, 0 = indifferent, +1 = strongly for.
 *
 * Cost multiplier sums councillors' stances for the relevant key. Zone
 * approval reads the matching (zone, tier) key.
 */
export interface FactionStances {
  road_local: number;
  road_avenue: number;
  road_highway: number;
  // Residential / Commercial / Industrial × Low / Medium / High / Max.
  // Max (Alpha 4.18) is the new mid-rise tier between L3 and skyscrapers.
  // Each row's Max value is more polarized than its High value: factions
  // that liked High love Max, factions that hated High hate Max more.
  r_low: number;     r_medium: number;  r_high: number;  r_max: number;
  c_low: number;     c_medium: number;  c_high: number;  c_max: number;
  i_low: number;     i_medium: number;  i_high: number;  i_max: number;
  /** Mixed-use (Alpha 2.0). Each tile is half-residents, half-commercial,
   *  so stances usually average their R and C rows but with a thumb on the
   *  scale for factions that love (or hate) walkable density specifically. */
  mu_low: number;    mu_medium: number; mu_high: number; mu_max: number;
  /** Luxury low-density residential (Alpha 2.5). 2-tile pair. NIMBYs and
   *  hometown love it (rich, low-density, screens out density), taxpayers
   *  like the revenue, working-families and yimbys hate it (replaces
   *  workforce housing with a mansion). */
  r_lux: number;
  power_plant: number;
  water_tower: number;
  park: number;
  bus_stop: number;
  bus_depot: number;
  stop_sign: number;
  /** Highway interchange ramp (Alpha 4.16). Smooth merge that lets cars
   *  flow between highway and local/avenue tiers without stops or
   *  collisions. Drivers love (more highway access), Transit hates
   *  slightly (encourages driving), NIMBYs hate (more cars near
   *  residential). */
  ramp: number;
  /** Cloverleaf interchange (Alpha 4.17). Multi-tile prefab — bigger
   *  visual + cost than a single-tile ramp. Same political shape but
   *  more polarized: Drivers absolutely love it (proper freeway exit),
   *  Greenleaf / NIMBYs / Hometown hate it more (huge footprint of
   *  car-centric infrastructure). */
  cloverleaf: number;
  /** Roundabout (Beta 1.8). One-way ring road around a landscaped island.
   *  Drivers love (continuous flow, no stops); Safer Streets love (kills
   *  the right-angle / T-bone crashes that signalised intersections cause);
   *  Greenleaf likes the green island + reduced idling; Taxpayers dislike
   *  the up-front cost; everyone else mildly positive (smoother traffic). */
  roundabout: number;
  /** Forestry industry (Alpha 2.7). Doesn't drain forest resources, but
   *  industrial-flavoured visuals + lumber-truck haul; environmentalists
   *  hate, chamber/working-families love. Hometown likes it (logging is
   *  rural-coded). */
  forestry: number;
  /** Farm industry (Alpha 2.7.1). Grass-only modular operation. Hometown
   *  / working families love (food + jobs), environmentalists are
   *  neutral-to-positive (better than industry), NIMBYs mildly negative
   *  (rural feel near them). */
  farm: number;
  /** Big Box store (Beta 1.3). Chain-store retail — Chamber + Drivers
   *  + Working Families love (jobs + cheap goods + parking); Hometown
   *  HATES (kills small-town main-street feel); YIMBYs hate (sprawl /
   *  car-oriented); Greenleaf hates (heat-island parking, freight);
   *  Transit hates (anti-walkability); NIMBYs ambivalent (jobs are
   *  fine but the traffic isn't). */
  big_box: number;
  /** Warehouse (Beta 1.6). Industrial freight distribution centre.
   *  Drivers + Chamber + Working Families like (jobs + supply chain
   *  efficiency); YIMBYs neutral (less car-dependent than big_box);
   *  Greenleaf + NIMBYs + Hometown dislike (truck traffic, sprawl,
   *  noise); Transit mildly negative (heavy freight ≠ transit). */
  warehouse: number;
  /** Parking Lot (Beta 1.3). Pure car infrastructure. Drivers love;
   *  YIMBYs + Transit + Greenleaf HATE (sprawl, heat island, anti-
   *  walkability); Chamber mildly positive (customer access);
   *  everyone else mostly neutral. */
  parking_lot: number;
  /** Public services pack (Alpha 2.10). */
  school: number;
  hospital: number;
  fire_station: number;
  police_station: number;
  /** Landmarks (Alpha 2.17). Stadium is loud + crowd-magnet (NIMBYs/hometown
   *  hate, chamber/working_families love). Museum is the safe heritage build
   *  (broad positive, mildly hated by yimbys for being a single-purpose lot).
   *  Observatory is the science-y vanity build (yimbys/environmentalists love,
   *  taxpayers ambivalent). */
  museum: number;
  stadium: number;
  observatory: number;
  /** Transit pack (Alpha 2.19). Ferry is broadly liked waterfront transit;
   *  subway is heavy-duty public transit — transit/yimbys/greens love,
   *  drivers stay neutral (their roads aren't taken). */
  ferry_dock: number;
  subway_entrance: number;
  /** Architect Mode decoratives (Alpha 4.0). Each row mirrors the kind
   *  of player who'd cheer / object to a given monumental build. NIMBYs
   *  love anything that raises property values without bringing density;
   *  Greenleaf loves gardens / fountains / trees; Hometown loves
   *  classical heritage (statues, clock towers, arches); Chamber loves
   *  anything that draws shoppers; Taxpayers hate them on principle
   *  (vanity spending). */
  plaza: number;
  fountain: number;
  statue: number;
  flower_bed: number;
  topiary: number;
  pergola: number;
  reflecting_pool: number;
  memorial_garden: number;
  clock_tower: number;
  triumphal_arch: number;
  pier: number;
  /** The Mayor's Mansion (Alpha 4.2) — single-instance 4×2 showpiece.
   *  Hometown + NIMBYs + Chamber love (heritage / property values /
   *  prestige); Yimbys + Working Families + Taxpayers HATE (massive
   *  non-housing footprint, vanity spending, the wealthiest possible
   *  build). */
  mayor_mansion: number;
  /** Civic monuments (Alpha 4.12). All three serve a real civic role
   *  (35-tile L3 service field) so the stance matrix is different from
   *  the Mansion — Yimbys / Transit / Working Families WARMER toward
   *  them since they materially help dense central districts; Taxpayers
   *  + Hometown still scale with the price tag and grandeur. */
  city_hall: number;
  provincial_capital: number;
  national_capital: number;
  /** Council Beautification Budget stance (Alpha 4.0). Read by the
   *  council each election to pick a tier — see `Council.electBeautificationTier`.
   *  Mayor cannot influence; this is a council-only lever. */
  beautification: number;
}

export type StanceKey = keyof FactionStances;

/**
 * The political stance matrix. Each faction's row reflects their
 * declared values from Happiness.ts compute functions. Tune carefully —
 * the cost multiplier and zoning gate both read from here.
 */
export const FACTION_STANCES: Record<FactionId, FactionStances> = {
  nimbys: {
    road_local: 0.0, road_avenue: -0.3, road_highway: -0.7,
    r_low: 0.4, r_medium: -0.5, r_high: -1.0, r_max: -1.0,
    c_low: -0.4, c_medium: -0.6, c_high: -0.8, c_max: -1.0,
    i_low: -0.7, i_medium: -0.9, i_high: -1.0, i_max: -1.0,
    mu_low: 0.0, mu_medium: -0.3, mu_high: -0.7, mu_max: -0.9,
    r_lux: 0.9,
    power_plant: -0.7, water_tower: 0.0, park: 0.6,
    bus_stop: -0.3, bus_depot: -0.5, stop_sign: 0.4,
    // NIMBYs hate ramps — exit ramps mean more cars cutting through the
    // neighbourhood, more noise, more pollution. Cloverleaf is much
    // worse — a 5×5 freeway interchange right there.
    ramp: -0.6, cloverleaf: -0.9, roundabout: 0.2,
    forestry: -0.4,
    farm: -0.2,
    // NIMBYs ambivalent on big_box (jobs are good but the traffic isn't).
    // Mild negative on parking_lot — asphalt near homes lowers vibes.
    // Warehouse is worse than big_box — heavy trucks all day near homes.
    big_box: -0.3, warehouse: -0.4, parking_lot: -0.2,
    school: 0.3, hospital: 0.4, fire_station: 0.5, police_station: 0.7,
    museum: -0.1, stadium: -0.6, observatory: 0.2,
    ferry_dock: 0.1, subway_entrance: -0.2,
    plaza: 0.6, fountain: 0.8, statue: 0.5, flower_bed: 0.7, topiary: 0.8,
    pergola: 0.5, reflecting_pool: 0.6, memorial_garden: 0.7,
    clock_tower: 0.4, triumphal_arch: 0.3, pier: 0.4,
    mayor_mansion: 0.8,
    // NIMBYs see civic monuments as prestige + property values. Scale
    // with grandeur — National is the apex flex.
    city_hall: 0.5, provincial_capital: 0.7, national_capital: 0.8,
    beautification: 0.7
  },
  yimbys: {
    road_local: -0.1, road_avenue: 0.3, road_highway: 0.0,
    r_low: -0.5, r_medium: 0.4, r_high: 0.8, r_max: 1.0,
    c_low: 0.0, c_medium: 0.4, c_high: 0.7, c_max: 0.9,
    i_low: 0.0, i_medium: 0.2, i_high: 0.3, i_max: 0.4,
    mu_low: 0.2, mu_medium: 0.6, mu_high: 0.9, mu_max: 1.0,
    r_lux: -0.8,
    power_plant: 0.0, water_tower: 0.2, park: 0.3,
    bus_stop: 0.7, bus_depot: 0.8, stop_sign: 0.2,
    // YIMBYs are mildly anti-ramp — every ramp encourages car commuting.
    // Cloverleaf is worse: 5×5 of land that could've been housing.
    ramp: -0.3, cloverleaf: -0.6, roundabout: 0.3,
    forestry: 0.0,
    farm: -0.1,
    // YIMBYs HATE big_box (sprawl, car-oriented, low-density) and
    // HATE parking_lot (asphalt instead of housing). Warehouse: mildly
    // negative — industrial use, not housing, but the supply chain
    // does support density.
    big_box: -0.7, warehouse: -0.2, parking_lot: -0.8,
    school: 0.5, hospital: 0.5, fire_station: 0.3, police_station: 0.0,
    museum: 0.0, stadium: -0.2, observatory: 0.4,
    ferry_dock: 0.4, subway_entrance: 0.7,
    // Yimbys mildly resent monumental decoratives that occupy buildable
    // tiles (could've been housing). Plaza / pergola get a pass — they
    // promote walkability.
    plaza: 0.4, fountain: -0.1, statue: -0.3, flower_bed: 0.1, topiary: -0.2,
    pergola: 0.4, reflecting_pool: -0.4, memorial_garden: -0.4,
    clock_tower: -0.3, triumphal_arch: -0.6, pier: 0.3,
    mayor_mansion: -0.9,
    // Yimbys soften toward civic monuments because they DELIVER L3
    // services to a 35-tile area — that's straightforwardly pro-density.
    // Still skeptical of the National Capital's vast footprint.
    city_hall: 0.5, provincial_capital: 0.2, national_capital: -0.3,
    beautification: 0.3
  },
  environmentalists: {
    road_local: -0.2, road_avenue: -0.4, road_highway: -0.8,
    r_low: 0.0, r_medium: 0.0, r_high: 0.1, r_max: 0.2,
    c_low: 0.0, c_medium: 0.0, c_high: 0.0, c_max: 0.0,
    i_low: -0.5, i_medium: -0.7, i_high: -1.0, i_max: -1.0,
    mu_low: 0.1, mu_medium: 0.3, mu_high: 0.4, mu_max: 0.5,
    r_lux: -0.3,
    power_plant: -0.9, water_tower: 0.2, park: 1.0,
    bus_stop: 0.8, bus_depot: 0.8, stop_sign: 0.1,
    // Greenleaf hates ramps — more highway = more emissions, more cars
    // moving fast through the city. Cloverleaf is the apex offender:
    // huge paved footprint, encourages high-speed driving culture.
    ramp: -0.5, cloverleaf: -0.9, roundabout: 0.4,
    forestry: -0.7,
    farm: 0.4,
    // Greenleaf HATES big_box (freight emissions, sprawl) and HATES
    // parking_lot (heat island, paved-over green). Warehouse is the
    // freight side of that — even more truck traffic + diesel fumes.
    big_box: -0.6, warehouse: -0.5, parking_lot: -0.7,
    school: 0.4, hospital: 0.5, fire_station: 0.2, police_station: -0.1,
    museum: 0.4, stadium: -0.4, observatory: 0.5,
    ferry_dock: 0.5, subway_entrance: 0.7,
    // Greenleaf adores anything that adds nature: gardens, water
    // features, trees-in-architecture. Stone monuments are neutral.
    plaza: 0.2, fountain: 0.8, statue: 0.0, flower_bed: 1.0, topiary: 0.9,
    pergola: 0.7, reflecting_pool: 0.7, memorial_garden: 0.8,
    clock_tower: 0.0, triumphal_arch: -0.2, pier: 0.3,
    mayor_mansion: 0.2,
    // Greenleaf likes civic builds that consolidate the L3 service
    // field — fewer scattered power plants is environmentally better.
    // National Capital trips the "land use" alarm slightly.
    city_hall: 0.4, provincial_capital: 0.3, national_capital: 0.1,
    beautification: 0.6
  },
  hometown: {
    road_local: 0.1, road_avenue: -0.3, road_highway: -0.6,
    r_low: 0.4, r_medium: -0.2, r_high: -0.9, r_max: -1.0,
    c_low: 0.2, c_medium: -0.3, c_high: -0.7, c_max: -0.9,
    i_low: -0.3, i_medium: -0.5, i_high: -0.8, i_max: -0.9,
    mu_low: 0.0, mu_medium: -0.4, mu_high: -0.8, mu_max: -1.0,
    r_lux: 0.6,
    power_plant: -0.4, water_tower: 0.0, park: 0.5,
    bus_stop: -0.2, bus_depot: -0.3, stop_sign: 0.2,
    // Hometown Heritage hates ramps — they're modern highway
    // infrastructure that erodes the small-town feel. Cloverleaf is
    // the worst — pure suburban-sprawl architecture.
    ramp: -0.4, cloverleaf: -0.8, roundabout: 0.3,
    forestry: 0.6,
    farm: 0.8,
    // Hometown Heritage HATES big_box — kills small-town main-street
    // feel, this is their signature opposition. Mildly negative on
    // parking_lot for the same modern-suburban aesthetic reason.
    // Warehouse is heavy industrial sprawl — also strongly negative.
    big_box: -0.9, warehouse: -0.6, parking_lot: -0.4,
    school: 0.4, hospital: 0.5, fire_station: 0.7, police_station: 0.6,
    museum: 0.7, stadium: -0.4, observatory: 0.1,
    ferry_dock: 0.2, subway_entrance: -0.1,
    // Hometown Heritage venerates classical decoratives — statues, clock
    // towers, arches, memorial gardens are exactly their bag.
    plaza: 0.5, fountain: 0.6, statue: 0.9, flower_bed: 0.5, topiary: 0.6,
    pergola: 0.5, reflecting_pool: 0.4, memorial_garden: 0.9,
    clock_tower: 0.9, triumphal_arch: 0.8, pier: 0.6,
    mayor_mansion: 1.0,
    // Hometown Heritage VENERATES civic architecture — these are
    // exactly the buildings they want to see in their town. Top-tier
    // stance across the board.
    city_hall: 0.9, provincial_capital: 1.0, national_capital: 1.0,
    beautification: 0.7
  },
  chamber: {
    road_local: 0.1, road_avenue: 0.3, road_highway: 0.4,
    r_low: 0.0, r_medium: 0.2, r_high: 0.3, r_max: 0.4,
    c_low: 0.5, c_medium: 0.7, c_high: 0.9, c_max: 1.0,
    i_low: 0.6, i_medium: 0.7, i_high: 0.8, i_max: 0.9,
    mu_low: 0.2, mu_medium: 0.5, mu_high: 0.7, mu_max: 0.9,
    r_lux: 0.4,
    power_plant: 0.4, water_tower: 0.3, park: 0.1,
    bus_stop: 0.1, bus_depot: 0.2, stop_sign: -0.1,
    // Chamber loves ramps — easier highway access pulls in customers +
    // freight from out of town. Cloverleaf is the dream: a real
    // freeway interchange screams "regional commerce hub."
    ramp: 0.6, cloverleaf: 0.9, roundabout: 0.3,
    forestry: 0.7,
    farm: 0.6,
    // Chamber LOVES big_box — pure jobs + retail draw. Likes
    // parking_lot for the customer-access angle. ADORES warehouses —
    // efficient supply chain = better business margins, full stop.
    big_box: 0.7, warehouse: 0.8, parking_lot: 0.4,
    school: 0.3, hospital: 0.4, fire_station: 0.4, police_station: 0.5,
    museum: 0.5, stadium: 0.8, observatory: 0.3,
    ferry_dock: 0.3, subway_entrance: 0.4,
    // Chamber loves anything that draws shoppers to downtown.
    // Streetscape beautification is their #1 issue (they want it MAX).
    plaza: 0.8, fountain: 0.6, statue: 0.5, flower_bed: 0.4, topiary: 0.4,
    pergola: 0.5, reflecting_pool: 0.5, memorial_garden: 0.4,
    clock_tower: 0.7, triumphal_arch: 0.6, pier: 0.7,
    mayor_mansion: 0.8,
    // Chamber loves civic prestige — bigger = more business / tourist
    // draw. National Capital is a chamber-of-commerce dream.
    city_hall: 0.7, provincial_capital: 0.9, national_capital: 1.0,
    beautification: 0.9
  },
  transit: {
    road_local: -0.1, road_avenue: 0.3, road_highway: -0.5,
    r_low: -0.2, r_medium: 0.4, r_high: 0.6, r_max: 0.8,
    c_low: 0.0, c_medium: 0.3, c_high: 0.5, c_max: 0.7,
    i_low: 0.0, i_medium: 0.0, i_high: 0.0, i_max: 0.0,
    mu_low: 0.3, mu_medium: 0.6, mu_high: 0.8, mu_max: 1.0,
    r_lux: -0.5,
    power_plant: -0.3, water_tower: 0.1, park: 0.4,
    bus_stop: 1.0, bus_depot: 1.0, stop_sign: 0.3,
    // Transit dislikes ramps — every ramp validates "highways for cars"
    // as the city's primary mode of travel. Cloverleaf is the worst.
    ramp: -0.4, cloverleaf: -0.7, roundabout: 0.2,
    forestry: 0.0,
    farm: 0.1,
    // Transit HATES big_box (anti-walkability, requires car commute)
    // and HATES parking_lot (validates car-centric mobility). Warehouse
    // is mildly negative — heavy freight isn't transit-friendly, but
    // at least it's not a destination customers drive to.
    big_box: -0.7, warehouse: -0.4, parking_lot: -0.8,
    school: 0.4, hospital: 0.4, fire_station: 0.3, police_station: 0.1,
    museum: 0.4, stadium: 0.5, observatory: 0.4,
    ferry_dock: 0.7, subway_entrance: 1.0,
    // Transit loves walkability features (plaza/pergola/pier) — those
    // make a transit trip feel like a destination, not just transport.
    plaza: 0.7, fountain: 0.4, statue: 0.2, flower_bed: 0.3, topiary: 0.2,
    pergola: 0.6, reflecting_pool: 0.3, memorial_garden: 0.3,
    clock_tower: 0.4, triumphal_arch: 0.1, pier: 0.7,
    mayor_mansion: -0.2,
    // Transit loves civic buildings — they're transit destinations
    // by definition (government workers commute to them in volume).
    city_hall: 0.6, provincial_capital: 0.7, national_capital: 0.7,
    beautification: 0.5
  },
  drivers: {
    road_local: 0.5, road_avenue: 0.8, road_highway: 1.0,
    r_low: 0.0, r_medium: 0.0, r_high: -0.1, r_max: -0.2,
    c_low: 0.3, c_medium: 0.4, c_high: 0.4, c_max: 0.4,
    i_low: 0.2, i_medium: 0.2, i_high: 0.2, i_max: 0.2,
    mu_low: 0.0, mu_medium: -0.1, mu_high: -0.2, mu_max: -0.3,
    r_lux: 0.3,
    power_plant: 0.1, water_tower: 0.0, park: 0.0,
    bus_stop: -0.7, bus_depot: -0.8, stop_sign: -0.4,
    // Drivers LOVE ramps — easy on/off the highway, smooth merges
    // mean less time sitting at red lights. Cloverleaf is the apex —
    // proper freeway interchange, full speed both directions.
    ramp: 1.0, cloverleaf: 1.0, roundabout: 0.9,
    forestry: 0.2,
    farm: 0.3,
    // Drivers LOVE big_box (parking + drive-up access) and LOVE
    // parking_lot (their signature cause — pavement for cars).
    // Warehouse is fine — more trucking infrastructure = more roads.
    big_box: 0.6, warehouse: 0.5, parking_lot: 1.0,
    school: 0.2, hospital: 0.4, fire_station: 0.5, police_station: 0.6,
    museum: 0.0, stadium: 0.4, observatory: 0.0,
    ferry_dock: 0.0, subway_entrance: -0.1,
    // Drivers don't care either way about streetscape — but they
    // dislike pedestrian-only plazas (no parking).
    plaza: -0.2, fountain: 0.0, statue: 0.0, flower_bed: 0.0, topiary: 0.0,
    pergola: -0.1, reflecting_pool: 0.0, memorial_garden: 0.0,
    clock_tower: 0.1, triumphal_arch: 0.1, pier: 0.0,
    mayor_mansion: 0.2,
    // Drivers don't have strong feelings on civic buildings — slight
    // positive on prestige, slight negative on the National Capital's
    // mandatory pedestrian-friendly approach.
    city_hall: 0.2, provincial_capital: 0.1, national_capital: -0.1,
    beautification: 0.0
  },
  taxpayers: {
    road_local: -0.2, road_avenue: -0.3, road_highway: -0.5,
    r_low: 0.2, r_medium: 0.3, r_high: 0.4, r_max: 0.5,
    c_low: 0.4, c_medium: 0.5, c_high: 0.5, c_max: 0.6,
    i_low: 0.4, i_medium: 0.4, i_high: 0.5, i_max: 0.6,
    mu_low: 0.3, mu_medium: 0.4, mu_high: 0.4, mu_max: 0.5,
    r_lux: 0.7,
    power_plant: -0.4, water_tower: -0.2, park: -0.2,
    bus_stop: -0.2, bus_depot: -0.4, stop_sign: -0.2,
    // Taxpayers grudgingly approve ramp; cloverleaf is a $50K splurge
    // they'd rather skip — real utility but not THAT much real utility.
    ramp: 0.2, cloverleaf: -0.4, roundabout: -0.4,
    forestry: 0.5,
    farm: 0.4,
    // Taxpayers warm to big_box (low capital cost + real jobs) and
    // neutral on parking_lot (cheap to build). Warm to warehouses
    // too — efficient logistics keeps the commercial tax base from
    // collapsing.
    big_box: 0.3, warehouse: 0.4, parking_lot: 0.1,
    school: 0.1, hospital: -0.1, fire_station: 0.3, police_station: 0.3,
    museum: 0.2, stadium: 0.0, observatory: -0.1,
    ferry_dock: -0.1, subway_entrance: -0.3,
    // Taxpayers Alliance HATES vanity spending on principle.
    // Beautification is the policy lever they're most opposed to.
    plaza: -0.5, fountain: -0.7, statue: -0.6, flower_bed: -0.3, topiary: -0.5,
    pergola: -0.4, reflecting_pool: -0.7, memorial_garden: -0.6,
    clock_tower: -0.7, triumphal_arch: -0.9, pier: -0.3,
    mayor_mansion: -1.0,
    // Taxpayers HATE every civic monument — these are the largest
    // single capital expenditures in the game. Scales with price.
    city_hall: -0.5, provincial_capital: -0.8, national_capital: -1.0,
    beautification: -0.9
  },
  safer_streets: {
    road_local: 0.1, road_avenue: 0.0, road_highway: -0.4,
    r_low: 0.2, r_medium: 0.2, r_high: 0.2, r_max: 0.2,
    c_low: 0.2, c_medium: 0.2, c_high: 0.2, c_max: 0.2,
    i_low: -0.2, i_medium: -0.3, i_high: -0.4, i_max: -0.5,
    mu_low: 0.2, mu_medium: 0.3, mu_high: 0.3, mu_max: 0.4,
    r_lux: 0.2,
    power_plant: -0.3, water_tower: 0.4, park: 0.7,
    bus_stop: 0.3, bus_depot: 0.3, stop_sign: 1.0,
    // Safer Streets dislikes ramps — fast highway merges = more
    // accident risk than controlled intersections. Cloverleaf is even
    // worse: full freeway speeds + complex weaving zones.
    ramp: -0.5, cloverleaf: -0.7, roundabout: 0.8,
    forestry: 0.0,
    farm: 0.2,
    // Safer Streets dislikes both — large parking lots are dead at
    // night (loitering, no eyes-on-the-street), big_box's mall apron
    // is similar dead space at off-hours. Warehouses are worse —
    // heavy trucks on city streets = more pedestrian accidents.
    big_box: -0.2, warehouse: -0.3, parking_lot: -0.3,
    school: 0.6, hospital: 0.7, fire_station: 0.9, police_station: 0.7,
    museum: 0.4, stadium: -0.1, observatory: 0.3,
    ferry_dock: 0.4, subway_entrance: 0.6,
    // Safer Streets: more eyes-on-the-street = safer. Plazas and
    // gardens activate the public realm; supports beautification.
    plaza: 0.7, fountain: 0.4, statue: 0.3, flower_bed: 0.5, topiary: 0.3,
    pergola: 0.5, reflecting_pool: 0.3, memorial_garden: 0.4,
    clock_tower: 0.4, triumphal_arch: 0.2, pier: 0.4,
    mayor_mansion: -0.3,
    // Safer Streets warm to civic monuments because they bring civic
    // infrastructure to the central district (more eyes-on-the-street
    // around government). Police HQ adjacency is implied.
    city_hall: 0.6, provincial_capital: 0.7, national_capital: 0.7,
    beautification: 0.5
  },
  working_families: {
    road_local: 0.1, road_avenue: 0.2, road_highway: 0.1,
    r_low: 0.4, r_medium: 0.5, r_high: 0.4, r_max: 0.3,
    c_low: 0.5, c_medium: 0.6, c_high: 0.5, c_max: 0.4,
    i_low: 0.7, i_medium: 0.7, i_high: 0.6, i_max: 0.5,
    mu_low: 0.4, mu_medium: 0.5, mu_high: 0.4, mu_max: 0.3,
    r_lux: -0.6,
    power_plant: 0.2, water_tower: 0.3, park: 0.4,
    bus_stop: 0.4, bus_depot: 0.4, stop_sign: 0.3,
    // Working Families likes ramps — easier highway = easier commute
    // to out-of-town jobs. Cloverleaf is a real commute upgrade.
    ramp: 0.3, cloverleaf: 0.5, roundabout: 0.2,
    forestry: 0.6,
    farm: 0.7,
    // Working Families LOVE big_box (low prices, entry-level jobs) and
    // mildly like parking_lot (need to drive to work). LOVE warehouses
    // even more — warehouses are a classic working-class jobs engine.
    big_box: 0.5, warehouse: 0.6, parking_lot: 0.2,
    school: 0.8, hospital: 0.8, fire_station: 0.5, police_station: 0.4,
    museum: 0.5, stadium: 0.6, observatory: 0.3,
    ferry_dock: 0.3, subway_entrance: 0.6,
    // Working Families resent monuments-vs-housing trade-off but DO
    // value local plazas, flower beds, free public spaces.
    plaza: 0.5, fountain: 0.2, statue: -0.2, flower_bed: 0.4, topiary: 0.0,
    pergola: 0.2, reflecting_pool: -0.3, memorial_garden: -0.1,
    clock_tower: -0.2, triumphal_arch: -0.5, pier: 0.5,
    mayor_mansion: -0.8,
    // Working Families like City Hall (services for their
    // neighbourhood) but turn against capitals — that's money that
    // could've been housing / schools at scale.
    city_hall: 0.5, provincial_capital: -0.3, national_capital: -0.6,
    beautification: 0.2
  }
};

const ALL_FACTION_IDS: readonly FactionId[] = [
  'nimbys', 'yimbys', 'environmentalists', 'hometown', 'chamber',
  'transit', 'drivers', 'taxpayers', 'safer_streets', 'working_families'
];

/**
 * Per-faction natural enemies — used by the Coalition mechanic. When the
 * player allies with a faction, that faction's rivals take a happiness hit.
 * The pairs reflect real urban-political fault lines:
 *  - NIMBYs vs YIMBYs (zoning fight)
 *  - Environmentalists vs Chamber (industry fight)
 *  - Hometown vs YIMBYs (growth fight)
 *  - Drivers vs Transit (mode fight)
 *  - Drivers vs Safer Streets (speed-vs-safety fight)
 *  - Taxpayers vs Working Families (tax fight)
 */
export const FACTION_RIVALS: Record<FactionId, readonly FactionId[]> = {
  nimbys:           ['yimbys'],
  yimbys:           ['nimbys', 'hometown'],
  environmentalists: ['chamber'],
  hometown:         ['yimbys'],
  chamber:          ['environmentalists'],
  transit:          ['drivers'],
  drivers:          ['transit', 'safer_streets'],
  taxpayers:        ['working_families'],
  safer_streets:    ['drivers'],
  working_families: ['taxpayers']
};

/** Civic-action costs in Political Capital and treasury. */
export const COSTS = {
  endorse_pc: 5,
  photo_op_pc: 2,
  photo_op_cash: 200,
  coalition_pc: 10,
  override_pc: 40
} as const;

/** Hard ceiling on Political Capital so it can't be hoarded indefinitely. */
export const PC_CAP = 50;

export interface Coalition {
  readonly a: FactionId;
  readonly b: FactionId;
}

/** Per-faction "city hall mode" comment shown when they're on council. */
export const COUNCIL_COMMENTS: Record<FactionId, string> = {
  nimbys:
    "On the floor at council today: I introduced a motion to STRENGTHEN setback requirements 💪 " +
    "Filed comments on EVERY pending project. The neighbors are with me 🏡✨",
  yimbys:
    "voted YES on upzoning the corridor today. tiny win but momentum 📈 thread incoming on the " +
    "floor debate. council watch is the BEST sport 🏛️🔥",
  environmentalists:
    "Convened the council's environmental review subcommittee today 🌳 Pushing for tree-canopy " +
    "targets, parkland goals, and a moratorium on heavy industry. The bees are counting on us 🐝",
  hometown:
    "Spoke at council today. Reminded 'em what this town USED to be. Some listened. Some didn't. " +
    "We'll see at the next vote 🇺🇸",
  chamber:
    "Met with three small-biz owners between hearings today!! 📈 Council, the Chamber is at the " +
    "table. Pro-jobs agenda front and center 💼 ribbon cutting Friday — be THERE",
  transit:
    "moved to advance the BRT corridor study at council today 🚌 four-of-four committee approval. " +
    "tag a transit advocate — this is HISTORY ⚡",
  drivers:
    "Council meeting today. I voted NO on every bus-stop expansion they tried to slip through. " +
    "Eyes on these so-called planners. Standing up for drivers 🚗🇺🇸",
  taxpayers:
    "The Alliance is proud to report: I voted AGAINST every spending increase on the docket today. " +
    "Common sense WORKS, Greenmeadow 📊🏛️",
  safer_streets:
    "Today on council I introduced a motion for stop signs at three more intersections 🛑 " +
    "The data is the data. Lives are on the line. 🩺✊",
  working_families:
    "On council today, I fought for working families. R tax stays at 9. Period. " +
    "Tag a working family that has my back ❤️🏛️"
};

export interface VoteShare {
  readonly id: FactionId;
  readonly pct: number;
}

export interface ElectionResult {
  readonly term: number;
  readonly mayorPct: number;
  readonly opponentId: FactionId;
  readonly opponentPct: number;
  readonly councillors: readonly FactionId[];
  /** All 10 factions ranked by vote share, for the popup display. */
  readonly voteSorted: readonly VoteShare[];
}

/**
 * Council state — current term's councillors, opponent, and election result
 * (cleared when the popup is dismissed by the UI).
 *
 * Not currently saved across reloads; first reload-after-election starts
 * fresh and triggers the next election in 3 months. Acceptable for prototype.
 */
export class Council {
  councillors: readonly FactionId[] = [];
  opponent: FactionId | null = null;
  term = 0;
  /** Set when an election just fired; the popup picks it up and clears it. */
  pendingResult: ElectionResult | null = null;
  /** Months elapsed when the last election ran. Prevents double-firing. */
  private lastElectionMonth = -1;

  // ---- Civic action state -----------------------------------------------
  /** Slow-accumulating resource. Earned monthly based on faction happiness. */
  politicalCapital = 0;
  /** Faction the player has endorsed for the *upcoming* election. Cleared
   *  when that election fires. The endorsed faction can't be picked as
   *  opponent (you've publicly aligned with them). */
  endorsedFaction: FactionId | null = null;
  /** Two factions in a player-declared alliance. Cleared at next election. */
  coalition: Coalition | null = null;
  /** Per-term cap so a player can't photo-op the same faction repeatedly. */
  private readonly photoOpsThisTerm = new Set<FactionId>();
  /** Per-faction multiplier applied to vote scores at the next election.
   *  Photo-ops boost this; cleared after each election. */
  private readonly campaignBoost = new Map<FactionId, number>();
  /** Per-faction one-off happiness adjustments from civic actions
   *  (e.g. opposition factions take -0.05 when the player photo-ops a
   *  building they hate). Cleared at election. Read by Happiness via
   *  the CivicModifiers struct. */
  readonly campaignHappinessDelta = new Map<FactionId, number>();
  /** True when the player has paid for override but the next term hasn't
   *  started yet. Becomes false (and `overrideTerm` is set) at the next
   *  election. */
  private overridePending = false;
  /** Term number during which Mayoral Override is active. -1 = inactive. */
  private overrideTerm = -1;

  /**
   * Beautification Budget tier — chosen by the council each term, but
   * the mayor can override the pick when **Mayoral Override** is
   * active (Alpha 4.2.2 expanded the override to cover this lever
   * too — previously the council was sole decider).
   *
   * Lifecycle:
   * - At every election, `electBeautificationTier()` recomputes the
   *   tier from the new council's beautification stance sum.
   * - During a term, if Mayoral Override is active, the mayor may
   *   call `setBeautificationTier(tier)` to override the council's
   *   pick. The override pick stays in effect until the next election,
   *   when council control resumes (override is one-term-only).
   * - The monthly bill is settled by Economy regardless of who picked
   *   it; if treasury can't cover, the effective tier drops to 'none'
   *   for that month (defunded), as before.
   *
   * Defaults to 'none' for term 0 (pre-election starter cities).
   */
  beautificationTier: BeautificationTier = 'none';
  /**
   * Effective beautification tier for the current month. Equal to
   * `beautificationTier` when the bill is paid, drops to 'none' if the
   * monthly settlement could not afford the cost. Read by the renderer
   * to decide whether to draw streetscape flair. Set by Economy each
   * monthly tick.
   */
  effectiveBeautificationTier: BeautificationTier = 'none';
  /** True for one frame after the budget defunded — Game pumps a status
   *  toast so the player knows the streetscape just changed. */
  beautificationJustDefunded = false;

  /**
   * Run an election if it's due (every 12 months on the boundary). Returns
   * the new ElectionResult if one fired, else null.
   */
  maybeRunElection(monthsElapsed: number, happiness: Happiness, population: Population): ElectionResult | null {
    if (monthsElapsed === 0) return null;
    if (monthsElapsed % 12 !== 0) return null;
    if (this.lastElectionMonth === monthsElapsed) return null;
    this.lastElectionMonth = monthsElapsed;
    return this.runElection(happiness, population);
  }

  private runElection(happiness: Happiness, population: Population): ElectionResult {
    // Expire override that was active in the term that's now ending.
    if (this.overrideTerm === this.term) this.overrideTerm = -1;

    // Anger ranking — most-angry first. Endorsed faction can't be opponent
    // (you've publicly aligned with them, so they don't run against you).
    const byAnger = [...ALL_FACTION_IDS].sort((a, b) => happiness.get(a) - happiness.get(b));
    const opponentCandidates = this.endorsedFaction
      ? byAnger.filter((id) => id !== this.endorsedFaction)
      : byAnger;
    const opponentId = opponentCandidates[1] ?? opponentCandidates[0]!;

    // Vote score per faction = pop × turnout × campaignBoost × endorsementBoost.
    const voteScores = new Map<FactionId, number>();
    let totalVotes = 0;
    for (const id of ALL_FACTION_IDS) {
      const h = happiness.get(id);
      const turnout = 0.4 + 0.5 * Math.max(0, -h);
      const pop = population.factionPopulation.get(id) ?? 0;
      const photoBoost = this.campaignBoost.get(id) ?? 1;
      const endorseBoost = this.endorsedFaction === id ? 1.20 : 1;
      const v = pop * turnout * photoBoost * endorseBoost;
      voteScores.set(id, v);
      totalVotes += v;
    }

    // Council = top 4 by vote score among non-opponent factions.
    const councillors = ALL_FACTION_IDS
      .filter((id) => id !== opponentId)
      .sort((a, b) => (voteScores.get(b) ?? 0) - (voteScores.get(a) ?? 0))
      .slice(0, 4);

    // Mayor's % derived from overall mood. Always wins, never higher than 85.
    const overall = happiness.overall();
    const mayorPct = Math.max(50.0001, Math.min(85, 50 + overall * 25));
    const opponentPct = 100 - mayorPct;

    // Vote share table for the popup.
    const voteSorted: VoteShare[] = ALL_FACTION_IDS
      .map((id) => ({
        id,
        pct: totalVotes > 0 ? ((voteScores.get(id) ?? 0) / totalVotes) * 100 : 0
      }))
      .sort((a, b) => b.pct - a.pct);

    this.term++;
    this.councillors = councillors;
    this.opponent = opponentId;
    // Council picks its beautification budget for the new term (Alpha 4.0).
    // Mayor has no say. Effective tier is conservatively initialised to
    // the elected tier; if the next monthly settlement can't afford it,
    // Economy will demote it to 'none'.
    this.electBeautificationTier();
    this.effectiveBeautificationTier = this.beautificationTier;

    // Civic actions consumed at election: endorsement, coalition, photo-ops.
    this.endorsedFaction = null;
    this.coalition = null;
    this.photoOpsThisTerm.clear();
    this.campaignBoost.clear();
    this.campaignHappinessDelta.clear();

    // Pending override activates for this new term.
    if (this.overridePending) {
      this.overrideTerm = this.term;
      this.overridePending = false;
    }

    const result: ElectionResult = {
      term: this.term,
      mayorPct,
      opponentId,
      opponentPct,
      councillors,
      voteSorted
    };
    this.pendingResult = result;
    return result;
  }

  // ---- Civic actions ----------------------------------------------------

  /** Award PC for the month based on faction happiness. Capped at PC_CAP. */
  awardMonthlyPC(happiness: Happiness): number {
    let earned = 1; // base
    for (const id of ALL_FACTION_IDS) {
      if (happiness.get(id) >= 0.5) earned += 0.5;
    }
    const next = Math.min(PC_CAP, this.politicalCapital + earned);
    const actually = next - this.politicalCapital;
    this.politicalCapital = next;
    return actually;
  }

  private spendPC(amount: number): boolean {
    if (this.politicalCapital < amount) return false;
    this.politicalCapital -= amount;
    return true;
  }

  /** Endorse a faction for the next election. 5 PC. */
  endorse(faction: FactionId): boolean {
    if (this.endorsedFaction !== null) return false; // already endorsed
    if (!this.spendPC(COSTS.endorse_pc)) return false;
    this.endorsedFaction = faction;
    return true;
  }

  /** Declare a 2-faction coalition. 10 PC. Picks two distinct factions. */
  declareCoalition(a: FactionId, b: FactionId): boolean {
    if (a === b) return false;
    if (this.coalition !== null) return false;
    if (!this.spendPC(COSTS.coalition_pc)) return false;
    this.coalition = { a, b };
    return true;
  }

  /**
   * Activate Mayoral Override for the *next* full term. 40 PC. While active,
   * `costMultiplier` returns 1.0 and `canChangeZone` returns true regardless
   * of council composition.
   */
  activateOverride(): boolean {
    if (this.overridePending || this.isOverrideActive()) return false;
    if (!this.spendPC(COSTS.override_pc)) return false;
    this.overridePending = true;
    return true;
  }

  isOverrideActive(): boolean {
    return this.overrideTerm === this.term && this.term > 0;
  }

  isOverridePending(): boolean {
    return this.overridePending;
  }

  /**
   * Try to redeem a photo-op opportunity for the given faction. Returns true
   * if successful (PC + cash spent, faction recorded). Caller passes the
   * list of *opponents of the underlying building* so Council can apply a
   * small happiness penalty to them — the photo-op makes them mad.
   */
  tryPhotoOp(faction: FactionId, cashOk: boolean, opponents: readonly FactionId[] = []): boolean {
    if (this.photoOpsThisTerm.has(faction)) return false;
    if (!cashOk) return false;
    if (this.politicalCapital < COSTS.photo_op_pc) return false;
    this.spendPC(COSTS.photo_op_pc);
    this.photoOpsThisTerm.add(faction);
    const prev = this.campaignBoost.get(faction) ?? 1;
    this.campaignBoost.set(faction, prev * 1.25);
    for (const opp of opponents) {
      const cur = this.campaignHappinessDelta.get(opp) ?? 0;
      this.campaignHappinessDelta.set(opp, cur - 0.05);
    }
    return true;
  }

  hasPhotoOpThisTerm(faction: FactionId): boolean {
    return this.photoOpsThisTerm.has(faction);
  }

  /**
   * Multiplier on a placement / paint cost. Sums councillors' stances toward
   * `key` and converts to a multiplier. Returns Infinity when the council
   * has banned the action (every councillor strongly opposes).
   *
   * **Mayoral Override** completely bypasses this — returns 1.0 always.
   */
  costMultiplier(key: StanceKey): number {
    if (this.isOverrideActive()) return 1.0;
    if (this.councillors.length === 0) return 1.0;
    let sum = 0;
    let allStronglyOpposed = true;
    for (const id of this.councillors) {
      const stance = FACTION_STANCES[id][key];
      sum += stance;
      if (stance > -0.4) allStronglyOpposed = false;
    }
    if (allStronglyOpposed) return Infinity;
    // Each councillor's stance is worth 25% of cost.
    const mult = 1 - sum * 0.25;
    return Math.max(0.20, Math.min(2.5, mult));
  }

  /**
   * Zoning-change rule: at least two councillors must have a non-negative
   * stance toward the new (zone, tier). **Mayoral Override** bypasses
   * (always returns true).
   */
  canChangeZone(zoneKind: 'residential' | 'commercial' | 'industrial' | 'mixed', tier: ZoneTier): boolean {
    if (this.isOverrideActive()) return true;
    if (this.councillors.length === 0) return true;
    const prefix =
      zoneKind === 'residential' ? 'r'
      : zoneKind === 'commercial' ? 'c'
      : zoneKind === 'industrial' ? 'i'
      : 'mu';
    const key = `${prefix}_${tier}` as StanceKey;
    let approvals = 0;
    for (const id of this.councillors) {
      if (FACTION_STANCES[id][key] >= 0) approvals++;
    }
    return approvals >= 2;
  }

  /** Population growth boost: 1.10 if on council, else 1.0. */
  populationBoost(id: FactionId): number {
    return this.councillors.includes(id) ? 1.10 : 1.0;
  }

  isCouncillor(id: FactionId): boolean {
    return this.councillors.includes(id);
  }

  isOpponent(id: FactionId): boolean {
    return this.opponent === id;
  }

  /** Clear the pending result (called by UI after the popup is dismissed). */
  acknowledgeResult(): void {
    this.pendingResult = null;
  }

  /**
   * Council Beautification Budget — pick a tier based on the sum of
   * sitting councillors' `beautification` stances (Alpha 4.0).
   *
   * Sum is in [-N, +N] where N = councillor count. Walking
   * `BEAUTIFICATION_TIER_ORDER` highest-first picks the most expensive
   * tier whose `stanceThreshold` is met. With no council seated yet
   * (term 0), defaults to 'none'.
   *
   * Mayor's primary lever for changing this is **electing a different
   * council** (via Endorse / Coalition / photo-op campaigns). For
   * direct control mid-term, the mayor must spend Political Capital on
   * Mayoral Override and then call `setBeautificationTier()` (Alpha
   * 4.2.2). Both election and override eventually feed into the same
   * `beautificationTier` field — Economy doesn't care who picked it.
   */
  private electBeautificationTier(): void {
    if (this.councillors.length === 0) {
      this.beautificationTier = 'none';
      return;
    }
    let sum = 0;
    for (const id of this.councillors) sum += FACTION_STANCES[id].beautification;
    let picked: BeautificationTier = 'none';
    for (const tier of BEAUTIFICATION_TIER_ORDER) {
      if (sum >= BEAUTIFICATION_TIERS[tier].stanceThreshold) picked = tier;
    }
    this.beautificationTier = picked;
  }

  /** Monthly cost of the elected beautification tier in $. Settled by
   *  Economy.runMonth — if the treasury can't afford it, the effective
   *  tier drops to 'none' for that month. */
  beautificationMonthlyCost(): number {
    return BEAUTIFICATION_TIERS[this.beautificationTier].monthlyCost;
  }

  /**
   * Mayoral Override of the Beautification Budget tier (Alpha 4.2.2).
   * Allowed ONLY when `isOverrideActive()` — refuses (returns false)
   * otherwise. The mayor's override pick stays in effect until the
   * next election, at which point council control resumes via
   * `electBeautificationTier()`.
   *
   * The effective tier is also bumped immediately so the renderer
   * picks up the change without waiting for the next monthly
   * settlement (the bill still gets paid normally next month).
   */
  setBeautificationTier(tier: BeautificationTier): boolean {
    if (!this.isOverrideActive()) return false;
    this.beautificationTier = tier;
    this.effectiveBeautificationTier = tier;
    return true;
  }

  /** True iff the mayor can currently change the beautification tier
   *  (i.e. Mayoral Override is active). UI uses this to swap the
   *  read-only readout for an editable selector. */
  canMayorSetBeautification(): boolean {
    return this.isOverrideActive();
  }

  /**
   * Restore beautification state from a save snapshot. Called by
   * SaveGame.applySave so a reload doesn't lose the elected tier
   * mid-term. Defaults preserve back-compat with pre-4.0 saves.
   */
  restoreBeautification(elected?: BeautificationTier, effective?: BeautificationTier): void {
    if (elected) this.beautificationTier = elected;
    if (effective) this.effectiveBeautificationTier = effective;
  }

  /**
   * Beta 1.6.26 — full council snapshot. Pre-1.6.26 only
   * politicalCapital + beautification tier round-tripped through saves;
   * the elected seats, the opponent, the running term counter, all the
   * civic-action state (endorsement, coalition, photo-op cap, campaign
   * boosts, override state), and the lastElectionMonth bookkeeping all
   * reset on reload. That meant every refresh effectively wiped the
   * current term and the next election ran fresh — totally un-sim-like.
   */
  serialize(): CouncilSnapshot {
    return {
      councillors: this.councillors.slice(),
      opponent: this.opponent,
      term: this.term,
      lastElectionMonth: this.lastElectionMonth,
      politicalCapital: this.politicalCapital,
      endorsedFaction: this.endorsedFaction,
      coalition: this.coalition ? { a: this.coalition.a, b: this.coalition.b } : null,
      photoOpsThisTerm: Array.from(this.photoOpsThisTerm),
      campaignBoost: Array.from(this.campaignBoost.entries()),
      campaignHappinessDelta: Array.from(this.campaignHappinessDelta.entries()),
      overridePending: this.overridePending,
      overrideTerm: this.overrideTerm,
      beautificationTier: this.beautificationTier,
      effectiveBeautificationTier: this.effectiveBeautificationTier
    };
  }

  restore(snap: CouncilSnapshot): void {
    this.councillors = snap.councillors.slice();
    this.opponent = snap.opponent;
    this.term = snap.term;
    this.lastElectionMonth = snap.lastElectionMonth;
    this.politicalCapital = snap.politicalCapital;
    this.endorsedFaction = snap.endorsedFaction;
    this.coalition = snap.coalition ? { a: snap.coalition.a, b: snap.coalition.b } : null;
    this.photoOpsThisTerm.clear();
    for (const f of snap.photoOpsThisTerm) this.photoOpsThisTerm.add(f);
    this.campaignBoost.clear();
    for (const [f, v] of snap.campaignBoost) this.campaignBoost.set(f, v);
    this.campaignHappinessDelta.clear();
    for (const [f, v] of snap.campaignHappinessDelta) this.campaignHappinessDelta.set(f, v);
    this.overridePending = snap.overridePending;
    this.overrideTerm = snap.overrideTerm;
    this.beautificationTier = snap.beautificationTier;
    this.effectiveBeautificationTier = snap.effectiveBeautificationTier;
  }
}

export interface CouncilSnapshot {
  councillors: FactionId[];
  opponent: FactionId | null;
  term: number;
  lastElectionMonth: number;
  politicalCapital: number;
  endorsedFaction: FactionId | null;
  coalition: { a: FactionId; b: FactionId } | null;
  photoOpsThisTerm: FactionId[];
  campaignBoost: Array<[FactionId, number]>;
  campaignHappinessDelta: Array<[FactionId, number]>;
  overridePending: boolean;
  overrideTerm: number;
  beautificationTier: BeautificationTier;
  effectiveBeautificationTier: BeautificationTier;
}
