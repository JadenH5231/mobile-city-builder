import type { Grid } from '../world/Grid';
import type { Economy } from './Economy';
import type { Population } from './Population';
import type { Traffic } from './Traffic';

/**
 * Happiness & factions — the keystone civic system.
 *
 * The city has a fixed set of *factions*, each represented by a named
 * Community Leader with a persona. Each faction has a happiness in [-1, 1]
 * computed from current city state (zoning, density, services, taxes,
 * traffic, accidents, transit). Leaders post comments in the
 * HappinessPanel — five mood buckets × three variants per bucket — so
 * the comment shifts as the player's actions move the faction's mood.
 *
 * **This system is intended to be load-bearing for future features.** When
 * adding a mechanic (policies, elections, executive orders, weather,
 * disasters, public works), the FIRST design question is: which factions
 * does this touch, and how should their `compute` functions update?
 * Documented in CLAUDE.md as a keystone.
 *
 * Tone: comments lean into "flamboyant local community Facebook" — heavy
 * caps for emphasis, emoji where natural, exclamation marks, hashtags, and
 * the unmistakable cadence of someone Showing Up to civic discourse.
 */

export type FactionId =
  | 'nimbys'
  | 'yimbys'
  | 'environmentalists'
  | 'hometown'
  | 'chamber'
  | 'transit'
  | 'drivers'
  | 'taxpayers'
  | 'safer_streets'
  | 'working_families';

/**
 * What share of a fully-saturated city's population each faction
 * "naturally" represents — the demographic baseline that's filled when
 * everyone in that group is happy. Sums to exactly 1.0.
 *
 * The numbers reflect rough size-of-bloc rather than uniform 10% — Drivers
 * and the Hometown crowd are bigger blocs than the Chamber of Commerce or
 * the YIMBY newsletter readership, but every group has enough mass to
 * swing the city if neglected.
 */
export const FACTION_NATURAL_SHARE: Record<FactionId, number> = {
  nimbys:           0.12,
  yimbys:           0.08,
  environmentalists: 0.09,
  hometown:         0.14,
  chamber:          0.06,
  transit:          0.08,
  drivers:          0.13,
  taxpayers:        0.11,
  safer_streets:    0.10,
  working_families: 0.09
};

export type HappinessBucket = 'elated' | 'happy' | 'neutral' | 'unhappy' | 'furious';

export interface FactionComments {
  readonly elated: readonly string[];
  readonly happy: readonly string[];
  readonly neutral: readonly string[];
  readonly unhappy: readonly string[];
  readonly furious: readonly string[];
}

export interface Faction {
  readonly id: FactionId;
  readonly name: string;
  readonly leaderName: string;
  readonly leaderTitle: string;
  /** One-line bio shown under the leader's name. */
  readonly bio: string;
  /** Hex colour for the faction's accent (avatar background, badge). */
  readonly color: number;
  /** Player-facing summary of what the faction cares about. */
  readonly cares: string;
  /** Per-faction compute — pure function of city state, returns [-1, 1]. */
  readonly compute: (s: Stats) => number;
  readonly comments: FactionComments;
}

/**
 * Pre-computed snapshot of city stats, built once per `Happiness.computeAll`
 * pass and shared with every faction. Keeps `compute` functions O(1) and
 * the whole system O(n) per tick (one grid sweep), regardless of faction count.
 */
export interface Stats {
  totalResidents: number;
  totalCJobs: number;
  totalIJobs: number;
  /** Aggregate traffic stress across all road tiles, [0, 1]. */
  trafficStress: number;
  /** Lifetime accidents, used for negative momentum. */
  totalAccidents: number;
  /** Last-month accident cost in $, used by taxpayers / safer-streets. */
  lastAccidentCost: number;

  /** Net per-month treasury change (revenue - expenses), in $. */
  monthlyNet: number;
  treasury: number;
  taxR: number;
  taxC: number;
  taxI: number;

  // Tile / zone counts.
  rTiles: number;
  cTiles: number;
  iTiles: number;
  /** Mixed-use tiles (Alpha 2.0). Each tile counts as a single mu-tile;
   *  factions that specifically love or hate walkable density read this
   *  directly. Mixed tiles do NOT also bump rTiles/cTiles to avoid
   *  double-counting their stance influence. */
  muTiles: number;
  zonedLow: number;
  zonedMed: number;
  zonedHigh: number;
  density1Tiles: number;
  density2Tiles: number;
  density3Tiles: number;

  // City buildings.
  parks: number;
  busStops: number;
  busDepots: number;
  powerPlants: number;
  waterTowers: number;
  stopSigns: number;

  // Roads — counts per tier.
  localEdges: number;
  avenueEdges: number;
  highwayEdges: number;
  totalRoadEdges: number;

  // Service coverage proxy.
  servicesFullyCoveredTiles: number;

  // Forest preservation.
  forestTilesRemaining: number;

  /** Walking-path tiles painted on the map (Alpha 1.6). Pedestrian
   *  infrastructure — read by transit/safer-streets/environmentalists for
   *  big bonuses, by working_families/hometown/yimbys/nimbys/chamber for
   *  modest bonuses, and by taxpayers as a tiny maintenance penalty. */
  walkingPathTiles: number;
}

function emptyStats(): Stats {
  return {
    totalResidents: 0, totalCJobs: 0, totalIJobs: 0,
    trafficStress: 0, totalAccidents: 0, lastAccidentCost: 0,
    monthlyNet: 0, treasury: 0, taxR: 0, taxC: 0, taxI: 0,
    rTiles: 0, cTiles: 0, iTiles: 0, muTiles: 0,
    zonedLow: 0, zonedMed: 0, zonedHigh: 0,
    density1Tiles: 0, density2Tiles: 0, density3Tiles: 0,
    parks: 0, busStops: 0, busDepots: 0, powerPlants: 0, waterTowers: 0, stopSigns: 0,
    localEdges: 0, avenueEdges: 0, highwayEdges: 0, totalRoadEdges: 0,
    servicesFullyCoveredTiles: 0, forestTilesRemaining: 0,
    walkingPathTiles: 0
  };
}

function buildStats(grid: Grid, economy: Economy, population: Population, traffic: Traffic): Stats {
  const s = emptyStats();
  s.totalResidents = population.totalResidents;
  s.totalCJobs = population.totalCommercialJobs;
  s.totalIJobs = population.totalIndustrialJobs;
  s.trafficStress = traffic.overallStress(grid);
  s.totalAccidents = economy.totalAccidents;
  s.lastAccidentCost = economy.lastAccidentCost;
  s.monthlyNet = economy.lastRevenue - economy.lastExpenses;
  s.treasury = economy.treasury;
  s.taxR = economy.taxR;
  s.taxC = economy.taxC;
  s.taxI = economy.taxI;

  for (const t of grid.iter()) {
    if (t.terrain === 'forest') s.forestTilesRemaining++;
    if (t.zone !== 'none') {
      if (t.zone === 'residential') s.rTiles++;
      else if (t.zone === 'commercial') s.cTiles++;
      else if (t.zone === 'industrial') s.iTiles++;
      else if (t.zone === 'mixed') s.muTiles++;
      if (t.zoneCap === 1) s.zonedLow++;
      else if (t.zoneCap === 2) s.zonedMed++;
      // L4 (Alpha 4.18) is even more "high-density" than L3, so it
      // counts toward zonedHigh + density3Tiles for faction-mood
      // purposes (avoids needing parallel zonedMax / density4Tiles
      // counters). Factions that hated zonedHigh (NIMBYs/Hometown)
      // hate zonedMax even more — handled in their compute functions.
      else if (t.zoneCap >= 3) s.zonedHigh++;
      if (t.density === 1) s.density1Tiles++;
      else if (t.density === 2) s.density2Tiles++;
      else if (t.density >= 3) s.density3Tiles++;
      if (t.hasPower && t.hasWater && t.hasPark) s.servicesFullyCoveredTiles++;
    }
    if (t.building === 'park') s.parks++;
    else if (t.building === 'bus_stop') s.busStops++;
    else if (t.building === 'bus_depot') s.busDepots++;
    else if (t.building === 'power_plant') s.powerPlants++;
    else if (t.building === 'water_tower') s.waterTowers++;
    if (t.stopSign) s.stopSigns++;
    if (t.path) s.walkingPathTiles++;
  }

  for (const e of grid.iterRoadEdges()) {
    s.totalRoadEdges++;
    const ta = grid.get(e.ax, e.ay);
    const tb = grid.get(e.bx, e.by);
    const tier = ta?.roadType ?? tb?.roadType ?? 'local';
    if (tier === 'highway') s.highwayEdges++;
    else if (tier === 'avenue') s.avenueEdges++;
    else s.localEdges++;
  }

  return s;
}

function clamp(v: number, lo = -1, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}
/** Saturating "how far from zero" — returns 0..1 as `x` grows from 0 to `cap`. */
function sat(x: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(1, x / cap);
}

/**
 * Faction roster. Adding a new faction here automatically gets it on the
 * panel — no other plumbing required.
 */
export const FACTIONS: readonly Faction[] = [
  // -------------------------------------------------------------------
  {
    id: 'nimbys',
    name: 'The NIMBY Coalition',
    leaderName: 'Karen Whitfield',
    leaderTitle: 'Concerned Mother of Three',
    bio: 'Lifelong Greenmeadow resident. PTA member. Founder of "Residents for a Quieter Greenmeadow." She is paying attention.',
    color: 0xc4a3d6,
    cares: 'Quiet streets, no nearby industrial, no high-rise neighbours, parks within walking distance.',
    compute: (s) => {
      let h = 0.25;
      h -= 0.30 * sat(s.zonedMed, 25);
      h -= 0.55 * sat(s.zonedHigh, 20);
      h -= 0.40 * sat(s.iTiles, 15);
      h -= 0.10 * sat(s.totalRoadEdges, 250);
      h += 0.20 * sat(s.parks, 4);
      h += 0.10 * sat(s.zonedLow, 30);
      // Walking paths feel quaint and small-town when modestly applied —
      // mild positive that caps quickly.
      h += 0.08 * sat(s.walkingPathTiles, 25);
      // Mixed-use brings shops below apartments — quaint at small scale,
      // alarming at scale.
      h += 0.08 * sat(s.muTiles, 8);
      h -= 0.20 * sat(Math.max(0, s.muTiles - 10), 20);
      return clamp(h);
    },
    comments: {
      elated: [
        "Just walked the kids to school past the new park 💕 THIS is the city we were promised. Council you ARE listening!! 👏",
        "Quietest sunday morning we've had in YEARS. Bless the council members who voted to preserve our way of life ✨🏡",
        "Driving through downtown today and I actually recognized people! Tag a neighbor who's GRATEFUL for our council's leadership 🙌"
      ],
      happy: [
        "Things are looking up around here 🌷 Praying we maintain this momentum 🙏",
        "Saw the latest zoning meeting on Channel 12 — proud of the council for hearing us out ❤️",
        "Took a walk through the neighborhood. Birds! Children! NORMALCY!! 🐦"
      ],
      neutral: [
        "Eyes on next month's vote. We cannot let our guard down 👁️",
        "Ladies — be at the next council meeting. SHOW UP.",
        "Drafting my comments for the planning hearing. Pls share 📝"
      ],
      unhappy: [
        "Did you SEE the construction down on Maple?? 😡 NO ONE asked us if we wanted that!",
        "Three. THREE strollers couldn't pass on the sidewalk this morning. WHO is responsible for this congestion??? 😤",
        "Found a Starbucks cup on my LAWN today. We are losing the small-town feel 😔"
      ],
      furious: [
        "I am DONE. This is no longer the town I MOVED here for. I am LIVID. Council members PLEASE explain yourselves at the next meeting 🤬🤬🤬",
        "WAKE UP, GREENMEADOW!!! They are PAVING OVER our community while we sleep!! 🚨🚨🚨 SHARE this with EVERYONE you know!!",
        "Just filed an OPEN RECORDS REQUEST. We demand to know WHO approved this. The COMMUNITY deserves answers 📢"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'yimbys',
    name: 'YIMBYs United',
    leaderName: 'Marcus Chen',
    leaderTitle: 'Urban Planning Enthusiast',
    bio: 'Software engineer. Reads zoning code for fun. Will fight you about parking minimums. Newsletter: "The Density Dispatch."',
    color: 0x6da5d6,
    cares: 'High-density zoning, transit-oriented development, mixed use, missing-middle housing.',
    compute: (s) => {
      let h = -0.15;
      h += 0.50 * sat(s.density3Tiles + 0.5 * s.density2Tiles, 30);
      h += 0.20 * sat(s.busStops + 2 * s.busDepots, 6);
      h += 0.15 * sat(s.avenueEdges + 1.5 * s.highwayEdges, 60);
      // Sprawl penalty — lots of L1 zones drag us down.
      const lowRatio = s.zonedLow / Math.max(1, s.zonedLow + s.zonedMed + s.zonedHigh);
      h -= 0.35 * lowRatio;
      // Walkable density is the YIMBY platform — paths get a real bonus.
      h += 0.15 * sat(s.walkingPathTiles, 30);
      // Mixed-use IS the YIMBY platform. Saturates fast.
      h += 0.30 * sat(s.muTiles, 12);
      return clamp(h);
    },
    comments: {
      elated: [
        "city's vibing. transit + density = walkable future. council is COOKING 🔥🚲🚌",
        "imagine telling 2020-me we'd have a 4-lane avenue with bus rapid transit. unreal era 📈",
        "another L3 going up downtown 💪 this is what HOUSING ABUNDANCE looks like, folks"
      ],
      happy: [
        "we're getting there. baby steps. but momentum 📈",
        "appreciating the council for upzoning. more of this please 🙏",
        "the missing middle is filling in. proud of our planners 🏘️"
      ],
      neutral: [
        "could go either way next quarter. pls don't be cowards",
        "watching the demand bars like the dow 📊",
        "drafting an op-ed. the housing crisis won't solve itself ✍️"
      ],
      unhappy: [
        "another single-family-only zone?? are we serious. we are in a HOUSING CRISIS people 😤",
        "parking minimums are killing us. just say the word, council 🅿️",
        "zoning everything 'low' and wondering why rent is high. read a book."
      ],
      furious: [
        "we are LITERALLY zoning ourselves into a museum. wake up 🚨",
        "every tile of low-density is a tile that could've been a triplex. ENRAGING 🤬",
        "if you want a city without housing, MOVE to one. don't make ours one too 🗳️"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'environmentalists',
    name: 'Greenleaf Environmental Council',
    leaderName: 'Dr. Linda Greenfield',
    leaderTitle: 'Retired Biology Teacher',
    bio: 'Taught middle school science for 32 years. Now I tend my pollinator garden and watch what they\'re doing to the trees outside my window.',
    color: 0x4d8442,
    cares: 'Forests preserved, parks, low industrial footprint, low traffic, low pollution.',
    compute: (s) => {
      let h = 0.10;
      h -= 0.55 * sat(s.iTiles, 12);
      h += 0.30 * sat(s.parks, 5);
      h += 0.20 * sat(s.forestTilesRemaining, 50);
      h -= 0.25 * s.trafficStress;
      // Highways are a particular sin (per mile they emit way more).
      h -= 0.20 * sat(s.highwayEdges, 30);
      // Walking infrastructure = fewer car trips. Big love.
      h += 0.20 * sat(s.walkingPathTiles, 25);
      // Mixed-use shortens trips and supports transit ridership — moderate love.
      h += 0.15 * sat(s.muTiles, 12);
      return clamp(h);
    },
    comments: {
      elated: [
        "Just toured the new park area — my heart is so full 🌳 The bees were thriving!! Tag a friend who cares about pollinators!!",
        "Walked through the old woodland today. Can you BELIEVE this is still standing? Bless the council for protecting it 🌲💚",
        "Carbon sinks AND community space?? Council you are SHOWING UP for our ecosystems 🦋"
      ],
      happy: [
        "Saw two robins this morning. Never thought I'd say that in this town again 🐦",
        "Industry kept in check this quarter. Small wins matter 💚",
        "The kids had nature day at the park. THIS is what a community can do 🌱"
      ],
      neutral: [
        "Watching the budget closely — what are we doing for our forests next month??",
        "Filed a comment with planning re: tree canopy targets 📝",
        "Hopeful but cautious. The earth doesn't grade on a curve 🌍"
      ],
      unhappy: [
        "Another smokestack permit?? At what cost, council. AT WHAT COST 😔",
        "I drove past the lot they JUST cleared. Heartbreaking 🌳💔",
        "The bees are DISAPPEARING and we keep approving more pavement. Make it make sense 🐝"
      ],
      furious: [
        "Another forest gone. ANOTHER. I am asking the council: is the smell of car exhaust your idea of a legacy?? 🌍💔",
        "We are mortgaging our children's lungs for asphalt. SHAME on every council member who voted for this 🚨",
        "I have STUDIED this. The science is CLEAR. We are FAILING our planet. Tag a council member 📚🔥"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'hometown',
    name: 'Hometown Heritage Society',
    leaderName: 'Bud Hargrove',
    leaderTitle: 'Farmer, 4th Generation',
    bio: 'Born here, raised here, plan to die here (don\'t tell my wife). Used to milk the family cows where the city library now stands.',
    color: 0xc09660,
    cares: 'Small-town character, no skyscrapers, small road network, low population.',
    compute: (s) => {
      let h = 0.30;
      h -= 0.55 * sat(s.density3Tiles, 6);
      h -= 0.30 * sat(s.density2Tiles, 25);
      h -= 0.20 * sat(s.totalResidents, 1500);
      h -= 0.15 * sat(s.totalRoadEdges, 200);
      h += 0.15 * sat(s.zonedLow, 40);
      // Walking paths feel like the old town — sidewalks past white picket fences.
      h += 0.10 * sat(s.walkingPathTiles, 25);
      // Mixed-use is "downtown stuff" — Bud doesn't recognise his town anymore.
      h -= 0.30 * sat(s.muTiles, 10);
      return clamp(h);
    },
    comments: {
      elated: [
        "Took the wife to Main Street today, ran into Marge from church. THIS is what a town SHOULD feel like 🇺🇸",
        "Saw the whole town turn out for Friday night football. Don't change a thing, council 🏈",
        "Fixed the church bell with my own two hands today. Some things you can't put a price tag on ⛪"
      ],
      happy: [
        "Quiet evening on the porch. The way it should be 🌅",
        "Helped a neighbor patch his fence. We still have it, folks. Don't lose it.",
        "Pancake breakfast at the legion. Three plates. No regrets 🥞"
      ],
      neutral: [
        "Hmph. Council better know what they're doing.",
        "Going to the meeting. Better not be a long one.",
        "Watching the new construction with one eye open."
      ],
      unhappy: [
        "Used to be I knew every face on this street. Don't recognize half of 'em anymore 😞",
        "Another stoplight?? In MY town?? 🤬",
        "Got stuck behind a delivery truck on Main today. Can't even drive in my own town."
      ],
      furious: [
        "This ain't the town I grew up in. Don't even know my own town anymore. SHAMEFUL.",
        "Sold my soul for a casserole dish, didn't sign up for SKYSCRAPERS 🏙️",
        "If my granddaddy could see this he'd take his name off the founder's plaque. He WOULD."
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'chamber',
    name: 'Chamber of Commerce',
    leaderName: 'Chad Donaldson',
    leaderTitle: 'Local Business Owner',
    bio: 'Owns Donaldson\'s Auto Sales. President of the Chamber. "Pro-jobs, pro-growth, pro-Greenmeadow." Father of two.',
    color: 0xc8932a,
    cares: 'Commercial and industrial activity, low business taxes, jobs, growth.',
    compute: (s) => {
      let h = -0.10;
      h += 0.35 * sat(s.cTiles, 25);
      h += 0.25 * sat(s.iTiles, 18);
      // Tax penalty — sweet spot at 10% C / 11% I, anything above hurts.
      h -= 0.40 * sat(Math.max(0, s.taxC - 10), 10);
      h -= 0.30 * sat(Math.max(0, s.taxI - 11), 10);
      h += 0.15 * sat(s.totalCJobs + s.totalIJobs, 250);
      // Walkable streetscape brings foot traffic past storefronts. Modest plus.
      h += 0.07 * sat(s.walkingPathTiles, 30);
      // Mixed-use is "shop downstairs, customers upstairs" — solid for retail.
      h += 0.20 * sat(s.muTiles, 12);
      return clamp(h);
    },
    comments: {
      elated: [
        "Phenomenal numbers this quarter folks!! 📈 Bull market on Main Street. Tag a small biz owner who's CRUSHING IT 💪",
        "Council just lowered the C tax — THIS is leadership. THIS is why we vote 🇺🇸💼",
        "Three new businesses on the block this month!! THIS is the Greenmeadow we believe in!"
      ],
      happy: [
        "Solid quarter for downtown. Optimistic for next month 📊",
        "Council, keep pulling on the right levers. Business is responding 💼",
        "Ribbon cutting at the new place tomorrow at noon. Be THERE!"
      ],
      neutral: [
        "Holding steady. Need to see more from City Hall to start celebrating.",
        "Reviewing this quarter's permit numbers. Will report back to membership 📋",
        "Cautiously optimistic. The Chamber is watching."
      ],
      unhappy: [
        "Folks, we cannot tax our way to prosperity. The Chamber is watching closely 👀",
        "Empty storefronts hurt EVERYONE. Where's the action plan, council??",
        "A friend of the Chamber is taking his shop to the next town over. WE'RE LOSING JOBS. 😤"
      ],
      furious: [
        "These taxes are CRUSHING small business. The Chamber is exploring its options 📞⚖️",
        "If the council won't fight for jobs, the Chamber will find candidates who WILL 🗳️",
        "We've LITERALLY held meetings with EVERY member and the message is clear: ENOUGH IS ENOUGH 🚨"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'transit',
    name: 'Transit Riders Union',
    leaderName: 'Priya Patel',
    leaderTitle: 'Software Designer, Bike Commuter',
    bio: 'Sold my car in 2022 and never looked back. Newsletter goes out monthly. We deserve frequency.',
    color: 0xeec453,
    cares: 'Bus stops + depots, dense corridors with transit, avenues over highways.',
    compute: (s) => {
      let h = -0.10;
      h += 0.40 * sat(s.busStops, 6);
      h += 0.30 * sat(s.busDepots, 3);
      h += 0.15 * sat(s.density2Tiles + 2 * s.density3Tiles, 30);
      // High car traffic without enough transit to absorb it.
      const transitScore = s.busStops + 2 * s.busDepots;
      const carPressure = s.trafficStress;
      if (transitScore < 4) h -= 0.30 * carPressure;
      h -= 0.15 * sat(s.highwayEdges, 30);
      // Walking paths are multimodal infrastructure — major bonus.
      h += 0.25 * sat(s.walkingPathTiles, 25);
      // Mixed-use generates trip ends near transit; Priya is fired up.
      h += 0.25 * sat(s.muTiles, 10);
      return clamp(h);
    },
    comments: {
      elated: [
        "the new bus depot 😍 finally we are taking transit seriously!! goodbye stroad supremacy 🚌 hello frequency 🚌🚌🚌",
        "BRT corridor on the avenue?? COUNCIL I COULD KISS YOU 💋",
        "rode the bus past three traffic jams today and felt like a god ⚡"
      ],
      happy: [
        "stops are filling in nicely. ridership numbers next month should be strong 🚌",
        "transit-adjacent density is the WHOLE point. proud of the planning team 🙌",
        "stood at the stop with three other people today. it's HAPPENING ✨"
      ],
      neutral: [
        "we'll see what the next budget brings 📋",
        "writing a thread on bus frequency. don't tune out 🧵",
        "council on notice. we want a published service plan 📅"
      ],
      unhappy: [
        "we cannot car-brain our way out of climate change. WHERE are the buses?? 😤",
        "another stroad. another. WE are the alternative ⚡🚌",
        "if i wanted to drive everywhere i'd live in 1960s LA. wake up 😩"
      ],
      furious: [
        "you cannot 'address congestion' by widening roads, council. it's been STUDIED. studied!! 📚",
        "I am tired. I am SO tired. just give us TWO buses an hour, this is not hard 😤",
        "this is the moment. this is the moment we choose: more transit or more traffic. CHOOSE WISELY 🚨"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'drivers',
    name: "Drivers' Association",
    leaderName: 'Frank Mahoney',
    leaderTitle: 'Long-Haul Trucker, Retired',
    bio: 'Been driving since the council was in diapers. American-made truck in the driveway. Don\'t take my parking and we won\'t have a problem.',
    color: 0xa44a3a,
    cares: 'Plenty of roads (especially highways/avenues), no congestion, no bus-stop encroachment.',
    compute: (s) => {
      let h = 0.15;
      h += 0.30 * sat(s.highwayEdges + 0.6 * s.avenueEdges, 60);
      h -= 0.50 * s.trafficStress;
      h -= 0.20 * sat(s.busStops, 8);
      // Stop signs slow him down too — but not as much as bus stops do.
      h -= 0.10 * sat(s.stopSigns, 10);
      return clamp(h);
    },
    comments: {
      elated: [
        "Mayor finally widened that highway! Smooth sailing all the way to the diner today. THIS is what tax dollars are for 🇺🇸🚗",
        "Cruise control on the new avenue 🚗💨 Tag the council members who FINALLY get it 👍",
        "Best commute I've had in years!! Pavement was made to be DRIVEN. Period."
      ],
      happy: [
        "Roads are running. Parking is plentiful. Frank is HAPPY 🚙",
        "Took the truck out for a spin after church. Smooth as butter.",
        "Saw the new lane markers on the avenue. Looks SHARP."
      ],
      neutral: [
        "Watch out, council. We're watching 👀",
        "Going to the next meeting. Bringing donuts AND a list.",
        "If the budget cuts road maintenance there will be CONSEQUENCES."
      ],
      unhappy: [
        "Another bus stop on my block?? Just take cars away from the working man why don't you 🙄",
        "Sat in traffic for 25 MINUTES today. Where's the mayor?? Where's the leadership??",
        "Saw a CYCLIST on the avenue today. In TRAFFIC. WHO is signing off on this??"
      ],
      furious: [
        "THIS IS WAR ON DRIVERS. Plain and simple 🚨🚨🚨 They are coming for our cars!!",
        "If I see ONE MORE bus-only lane I am running for council MYSELF. ENOUGH 🤬",
        "Some city PLANNER who has NEVER held a steering wheel is making decisions for the rest of us. UNACCEPTABLE 😤"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'taxpayers',
    name: "Taxpayers' Alliance",
    leaderName: 'Eleanor Vance',
    leaderTitle: 'Retired Accountant',
    bio: 'I read every line of the city budget so you don\'t have to. I represent the silent majority who balance their checkbooks every month.',
    color: 0x7da06b,
    cares: 'Surplus, low taxes, no waste, treasury growth. Disasters and accidents are line items.',
    compute: (s) => {
      let h = 0;
      h += 0.40 * Math.tanh(s.monthlyNet / 5000);  // saturating
      h += 0.20 * Math.tanh(s.treasury / 50000);
      // Tax rates above ~10 hurt; below feels fine.
      const avgTax = (s.taxR + s.taxC + s.taxI) / 3;
      h -= 0.30 * sat(Math.max(0, avgTax - 10), 10);
      h -= 0.20 * sat(s.lastAccidentCost, 2000);
      return clamp(h);
    },
    comments: {
      elated: [
        "Just reviewed the books and we are FIRMLY in the black 📊 Common sense governance prevails!!",
        "Treasury reserves up double digits!! Take notes, neighboring cities 🏛️📈",
        "Tax cuts AND a surplus?? Tag your council member because THIS is the playbook 💪"
      ],
      happy: [
        "Books are tidy this month. Cautiously optimistic 📓",
        "Reviewing the numbers — we're trending the right way 📈",
        "Filed my comments with the auditor. Let the record show: this works 🧾"
      ],
      neutral: [
        "Reviewing the line items. Will report back 📋",
        "The Alliance is monitoring closely. No pen moves without us.",
        "Grading on a curve this quarter. Don't get comfortable, council."
      ],
      unhappy: [
        "The deficit is unacceptable. WHO is going to pay for all this?? Our grandchildren, that's who. SHAMEFUL.",
        "Accident claims are eating into the reserves. The math is the math, council 🧮",
        "Spending is up. Receipts are down. We've been here before and it ENDED BADLY."
      ],
      furious: [
        "WHERE is the money going?? Our tax dollars are vanishing into a BLACK HOLE of incompetence 😤",
        "We are HEMORRHAGING money. The Alliance demands an emergency audit. Sign the petition!! ✍️",
        "TAX. AND. SPEND. That's all this council knows. We are FED UP 🚨"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'safer_streets',
    name: 'Safer Streets Coalition',
    leaderName: 'Dr. Marcus Tate',
    leaderTitle: 'Pediatrician',
    bio: 'I see what comes through the ER doors. We can do better. We MUST do better. For our kids.',
    color: 0xd06a8a,
    cares: 'No accidents, stop signs at busy junctions, full service coverage, low traffic stress.',
    compute: (s) => {
      let h = 0.15;
      h -= 0.45 * sat(s.totalAccidents, 12);
      h -= 0.25 * s.trafficStress;
      h += 0.25 * sat(s.stopSigns, 6);
      // Service-coverage proxy: how many zoned tiles have all three services.
      const zoned = s.rTiles + s.cTiles + s.iTiles;
      const coverage = zoned > 0 ? s.servicesFullyCoveredTiles / zoned : 0;
      h += 0.30 * coverage;
      h += 0.10 * sat(s.parks, 5);
      // Pedestrian infrastructure = lives saved. Largest boost on the matrix.
      h += 0.25 * sat(s.walkingPathTiles, 25);
      // Mixed-use puts shops near homes — fewer car trips, fewer crashes.
      h += 0.10 * sat(s.muTiles, 12);
      return clamp(h);
    },
    comments: {
      elated: [
        "Stats just dropped: zero accidents this quarter 🩺 PROUD of this community for following the playbook!!",
        "Full service coverage citywide. THIS is what public health looks like 💚🏥",
        "Tag a parent who can finally let their kids walk to school without holding their breath 🧒❤️"
      ],
      happy: [
        "Numbers are trending the right way. Don't let up, council 📉",
        "Saw the new stop sign at 4th & Mulberry — it's saving lives. Period 🛑",
        "Health metrics improving across the board. Keep going 🩺"
      ],
      neutral: [
        "Hoping for the best, planning for the worst. Standard ⚠️",
        "Drafting recommendations for next month's hearing 📝",
        "Watching the dashboard. Watching the ER. Watching, watching."
      ],
      unhappy: [
        "ANOTHER preventable crash on Mulberry & 4th. We've been BEGGING for a stop sign there. PLEASE. 😭",
        "Service gap on the east side is a public health emergency in slow motion 🩺",
        "I had a family in the ER this week. THIS WAS PREVENTABLE 💔"
      ],
      furious: [
        "I will NOT mince words: people are DYING and the council is dragging its feet 🚨",
        "Filed an open records request. The community DESERVES answers ✊",
        "I took an OATH. I will not stand by while we approve more dangerous infrastructure 🩺🔥"
      ]
    }
  },
  // -------------------------------------------------------------------
  {
    id: 'working_families',
    name: 'Working Families First',
    leaderName: 'Maria Rodriguez',
    leaderTitle: 'Schoolteacher, Single Mom',
    bio: 'Teaching 4th grade for 14 years. Two kids. Real wages. We just want the city to work for the people who keep it running.',
    color: 0xe07a3a,
    cares: 'Plenty of jobs, low residential taxes, affordable density, services where people live.',
    compute: (s) => {
      let h = -0.05;
      // Jobs vs residents — happy when there's enough work for the people.
      const jobs = s.totalCJobs + s.totalIJobs;
      const ratio = s.totalResidents > 0 ? jobs / s.totalResidents : 1;
      h += 0.40 * Math.tanh((ratio - 0.5) * 3); // ~0.5 jobs/resident is healthy
      // R tax penalty — sweet spot at 9, anything above hurts hard for working folks.
      h -= 0.40 * sat(Math.max(0, s.taxR - 9), 10);
      // Service coverage matters.
      const zoned = s.rTiles + s.cTiles + s.iTiles;
      const coverage = zoned > 0 ? s.servicesFullyCoveredTiles / zoned : 0;
      h += 0.20 * coverage;
      // Affordable density (medium) is good; tons of high-density without jobs is suspect.
      h += 0.15 * sat(s.density2Tiles, 20);
      // Walking is free transportation — material help for people who can't
      // afford a second car.
      h += 0.10 * sat(s.walkingPathTiles, 25);
      // Mixed-use means jobs are walking distance from home. Big deal.
      h += 0.20 * sat(s.muTiles, 12);
      return clamp(h);
    },
    comments: {
      elated: [
        "First time in YEARS we've had more jobs than people!! 💪 Council you are HEARING us. Tag a working family that's finally catching a break ❤️",
        "R tax went DOWN this month and my budget JUST started to breathe 💚 Bless 🙏",
        "More C tiles = more cashiers, more managers, more PAYCHECKS. This is HOW we win 💼"
      ],
      happy: [
        "Council showed up for working families this month 💪",
        "Saw Maria from down the street found work at the new shop. THAT'S what jobs do ❤️",
        "Bills are paid. Kids are fed. Don't take this from us, council 🙏"
      ],
      neutral: [
        "Watching the unemployment numbers like a hawk 👀",
        "Going to the meeting on behalf of the parents on the block 📋",
        "Holding council to their promises. We don't forget."
      ],
      unhappy: [
        "Another tax hike on R?? Council, we are STRETCHED. Some of us are choosing groceries vs heat already 😔",
        "Where are the JOBS, council?? My nephew's been looking for 3 months 😤",
        "Working families pay a higher share than the corporates. STILL. WHY?? 😩"
      ],
      furious: [
        "Working families are BLEEDING and council just keeps RAISING taxes. Read the room!! 🤬",
        "I am tired. Tired of pretending. The system is BROKEN for people like us ✊",
        "If we can't afford to live here anymore, who is the city FOR?? Tag your council member 🗳️"
      ]
    }
  }
];

export function bucketOf(h: number): HappinessBucket {
  if (h >= 0.6) return 'elated';
  if (h >= 0.2) return 'happy';
  if (h >= -0.2) return 'neutral';
  if (h >= -0.6) return 'unhappy';
  return 'furious';
}

/**
 * Pick a comment for a faction at a given mood. `salt` should change slowly
 * (e.g., the months elapsed plus a happiness-bucket index) so the comment
 * is stable for a while but shifts when meaningful state changes.
 */
export function pickComment(faction: Faction, happiness: number, salt: number): string {
  const bucket = bucketOf(happiness);
  const arr = faction.comments[bucket];
  if (arr.length === 0) return '...';
  const idx = ((salt % arr.length) + arr.length) % arr.length;
  return arr[idx]!;
}

/**
 * Mean-tweet quotes posted by the leader who ran against the player and
 * lost (Alpha 2.7.2). Each set keeps that leader's voice — Karen's caps
 * and exclamation points, Marcus's lowercase wonk-Twitter, Bud's folksy
 * grumbling, Eleanor's fiscal-hawk dry, etc. — but every line is an
 * attack on the mayor's leadership / record / character. Used in the
 * Happiness panel: when a faction's row is the opposition, the comment
 * is replaced with one of these instead of their normal mood comment.
 */
export const OPPOSITION_TWEETS: Record<FactionId, readonly string[]> = {
  nimbys: [
    "MAYOR. Walk OUR streets and tell me with a straight face this is the city you promised. SHAMEFUL 🏡😡 #Recall",
    "I LITERALLY warned the council about this. ON THE RECORD. They ignored me. Now look 📋🚫",
    "Calling this leadership is GENEROUS. We ran a yard-sale better than this administration runs City Hall ✋ #StillKaren",
    "Three election promises. THREE. Not one delivered. Add it to the list 🧾",
    "Drove past the lot today. Unsightly. The mayor doesn't care about HOMEOWNERS, only headlines 📰"
  ],
  yimbys: [
    "another month of nothing. the mayor talks about ‘strong neighborhoods' but won't upzone a single corridor 🤡",
    "looked at the latest budget. priorities are SO out of whack it's almost impressive 📈 down",
    "if i had a dollar for every time the mayor punted on housing i could afford a down payment 🏚️",
    "the mayor's idea of bold leadership is a ribbon cutting at the same intersection for the third time 🎀",
    "mayor of a city with no plan, no spine, and no idea how supply curves work. anyway 🧵"
  ],
  environmentalists: [
    "The mayor's environmental record reads like a corporate press release. The bees deserve better. We all do 🐝",
    "Concerned to see the administration once again prioritising vanity projects over the canopy plan we submitted in 2024 🌳",
    "I have submitted comments. I have testified. I have begged. The mayor does not listen 📝",
    "Our streams will outlive this administration. Probably barely 🏞️",
    "Calling oneself a 'green mayor' while greenlighting heavy industry is a special kind of doublespeak 🌍"
  ],
  hometown: [
    "Used to be you could walk down Main without seein a backhoe. Mayor wouldn't know our town if it bit em 🚜",
    "My grandfather built half the buildings on this block with his bare hands. Mayor's bulldozin em with a smile 😤",
    "Said it before, sayin it again — this fella's runnin our town like a stranger. Cause that's what he is 🇺🇸",
    "Asked the mayor's office about the corner store closin. Got a press release. PRESS RELEASE 📰",
    "Whole council let this happen. The mayor most of all. Folks remember at the ballot box 🗳️"
  ],
  chamber: [
    "Met with the mayor about the corridor study. Mayor brought no materials, no plan, and no clue. We need leadership 📊",
    "City under this administration is the only one in the region with declining permit volume. Coincidence? Doubt it 📉",
    "I run a business. I sign payroll. The mayor signs photo-op cards. There is a difference 💼",
    "The mayor's economic strategy is hoping the cycle turns before the next election. It won't 📅",
    "Investors are noticing. They're moving capital elsewhere. THIS is what bad leadership looks like 🏗️"
  ],
  transit: [
    "the mayor's transit plan is a one-line tweet. that is not a plan, that is a tweet 🚌",
    "the bus i took to the press conference broke down. the mayor was 30 min late by car. nothing to add",
    "honestly impressive that an administration can claim to support transit while underfunding the system every single year 📉",
    "asked the mayor about frequency. they said ‘we're looking at it.' they have been looking at it for THREE YEARS 🚏",
    "every world-class city has world-class transit. the mayor would not know world-class if it ran them over (with a bus) 🌍"
  ],
  drivers: [
    "Mayor declared war on cars and pretends not to. Look at the budget. Look at the lane diets 🚗💢",
    "Sat in traffic for 35 min today thanks to the mayor's ‘calming' projects. Calming for who?? 🚦",
    "This mayor has never met a bus stop they wouldn't put in front of MY driveway. Unbelievable 🛻",
    "Mayor of a city that's increasingly hostile to the people who actually pay the bills (drivers) 💸",
    "Bring back the highways. Honestly the only platform I'd run on at this point 🛣️"
  ],
  taxpayers: [
    "Reviewed the line items. Spending is up 14% YoY with no measurable improvement in services. That is mismanagement, plain and simple 📊",
    "The mayor mistakes activity for accomplishment. There is a difference. The audit will reveal much 🧾",
    "Asked City Hall for the consultant invoices. Stonewalled. Transparency is not optional 🔎",
    "Every penny the mayor wastes is a penny our seniors don't get for the things they actually need 👵",
    "I would describe this administration's fiscal discipline as ‘theoretical.' Generously 💰"
  ],
  safer_streets: [
    "The mayor's safety record is a public-health crisis. We have the data. They do not have the will 🚸",
    "Another preventable crash this week. Asked the mayor for action. Got thoughts and prayers 🙏",
    "I am a doctor. I am telling you the trends are bad. The mayor is telling us the trends are fine. One of us is reading the chart 📋",
    "Lowering speed limits costs nothing. The mayor still won't do it. Why?? 🛑",
    "Children are walking past intersections we have flagged for YEARS. The mayor's office has not responded. Disgraceful 👧"
  ],
  working_families: [
    "Knocked doors all weekend. Same story everywhere — the mayor's not delivering for regular folks 🚪",
    "Rent is up. Wages aren't. Mayor's response: a press release. Cool, very helpful 🙃",
    "Childcare is a crisis. Healthcare is a crisis. The mayor's vacation photos are NOT 📸",
    "We elected this mayor expecting fight for working families. We got fight for headlines instead 🥊",
    "Tag your council member. Then tag the mayor. THEN show up to the meeting. They count on us not showing up ✊"
  ]
};

/** Pick an opposition tweet for the given faction. `salt` rotates the
 *  selection slowly (e.g., months elapsed) so the same tweet stays up
 *  for a while but eventually rolls. */
export function pickOppositionTweet(faction: FactionId, salt: number): string {
  const arr = OPPOSITION_TWEETS[faction];
  if (!arr || arr.length === 0) return '...';
  const idx = ((salt % arr.length) + arr.length) % arr.length;
  return arr[idx]!;
}

/**
 * Owns the per-faction happiness map. Recomputed on demand (panel open,
 * monthly tick, etc.) — pure function of city state, no internal accumulator
 * yet. Future: hook into events for momentum / decay.
 *
 * Civic actions (endorsement, coalition) layer modifiers on top of the
 * raw faction-state happiness — see `applyCivicModifiers` below.
 */
export class Happiness {
  /** Per-faction happiness in [-1, 1]. Empty until first compute. */
  readonly happiness = new Map<FactionId, number>();

  computeAll(
    grid: Grid,
    economy: Economy,
    population: Population,
    traffic: Traffic,
    civicMods?: CivicModifiers,
    events?: import('./Events').Events
  ): void {
    const stats = buildStats(grid, economy, population, traffic);
    for (const f of FACTIONS) {
      this.happiness.set(f.id, clamp(f.compute(stats)));
    }
    if (civicMods) applyCivicModifiers(this.happiness, civicMods);
    // Event-driven mood deltas (Alpha 2.9) — recessions / fires / etc.
    // shift specific factions for several months. Layered on top so
    // they decay independently of the underlying faction compute.
    if (events) {
      for (const f of FACTIONS) {
        const d = events.factionMoodDelta(f.id);
        if (d !== 0) this.happiness.set(f.id, clamp((this.happiness.get(f.id) ?? 0) + d));
      }
    }
  }

  /** Mean happiness across all factions, [-1, 1]. */
  overall(): number {
    if (this.happiness.size === 0) return 0;
    let sum = 0;
    for (const h of this.happiness.values()) sum += h;
    return sum / this.happiness.size;
  }

  get(id: FactionId): number {
    return this.happiness.get(id) ?? 0;
  }
}

/** Human-readable label for the city-wide overall mood. */
export function overallLabel(h: number): string {
  if (h >= 0.5) return 'Thriving';
  if (h >= 0.2) return 'Optimistic';
  if (h >= -0.2) return 'Mixed';
  if (h >= -0.5) return 'Restless';
  return 'In Crisis';
}

/**
 * Layered modifiers from civic actions, applied to happiness AFTER the raw
 * compute. Endorsement and coalition pull from `Council`; this struct is
 * the renderer-agnostic shape so Happiness doesn't import Council directly.
 */
export interface CivicModifiers {
  /** Endorsed faction gets +ENDORSE_BONUS, all others get -ENDORSE_PENALTY. */
  readonly endorsedFaction: FactionId | null;
  /** Allied factions in a coalition get +COALITION_BONUS. */
  readonly coalitionAllies: readonly FactionId[];
  /** Faction IDs that are rivals of the coalition's allies — they get -COALITION_PENALTY. */
  readonly coalitionRivals: readonly FactionId[];
  /** Per-faction one-off happiness deltas from civic actions (photo-ops etc.). */
  readonly campaignDeltas: ReadonlyMap<FactionId, number>;
}

/** Bonus to the endorsed faction. */
const ENDORSE_BONUS = 0.10;
/** Penalty to all non-endorsed factions. */
const ENDORSE_PENALTY = 0.05;
/** Bonus to each coalition ally. */
const COALITION_BONUS = 0.20;
/** Penalty to each rival of any coalition ally. */
const COALITION_PENALTY = 0.20;

function applyCivicModifiers(map: Map<FactionId, number>, mods: CivicModifiers): void {
  if (mods.endorsedFaction !== null) {
    for (const [id, h] of map) {
      const adj = id === mods.endorsedFaction ? ENDORSE_BONUS : -ENDORSE_PENALTY;
      map.set(id, clamp(h + adj));
    }
  }
  for (const id of mods.coalitionAllies) {
    map.set(id, clamp((map.get(id) ?? 0) + COALITION_BONUS));
  }
  for (const id of mods.coalitionRivals) {
    if (mods.coalitionAllies.includes(id)) continue; // ally is also a rival? skip
    map.set(id, clamp((map.get(id) ?? 0) - COALITION_PENALTY));
  }
  for (const [id, delta] of mods.campaignDeltas) {
    map.set(id, clamp((map.get(id) ?? 0) + delta));
  }
}
