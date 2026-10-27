// All tunable constants for the game. Units: metres, seconds, kilograms.

/** Playing field (a walled yard). The cave sits at the origin. */
export const FIELD = {
  xMin: -1.2,
  xMax: 1.2,
  zMin: -1.4,
  zMax: 2.6,
  wallHeight: 0.07,
  wallThickness: 0.06,
};

/** The cave: a small round hole scooped into the dirt (~1 inch deep). */
export const CAVE = {
  x: 0,
  z: 0,
  radius: 0.032, // 64 mm across
  depth: 0.0254, // 1 inch
  // A gentle, wider dish around the cave (worn by years of play) that
  // nudges slow marbles towards the hole.
  dishRadius: 0.2,
  dishDepth: 0.0035,
};

/** Players throw from here at the start of the game. */
export const START_LINE = {
  z: 2.2,
  xMin: -1.0,
  xMax: 1.0,
};

/** Height of a crouching kid's hand above the ground when lobbing. */
export const HAND_HEIGHT = 0.22;

export const MARBLE_SIZES = {
  small: { key: 'small', radius: 0.0065, label: 'Small', note: '13 mm' },
  medium: { key: 'medium', radius: 0.008, label: 'Medium', note: '16 mm · most popular' },
  big: { key: 'big', radius: 0.0125, label: 'Big', note: '25 mm' },
};

/** Density of glass, for mass = 4/3 pi r^3 rho. */
export const GLASS_DENSITY = 2500;

export const PHYSICS = {
  gravity: 9.81,
  substep: 1 / 480,
  /** Rolling resistance coefficient of a glass marble on packed dirt. */
  rollingResistance: 0.11,
  /** Extra speed-dependent rolling loss (1/m): the marble hops over grains. */
  rollingDragQuad: 0.1,
  /** Kinetic friction glass-on-dirt while the marble slides (before it rolls). */
  rollingFriction: 0.5,
  /** Tangential speed lost on a hard landing: 1/(1 + plowFactor * impactSpeed). */
  plowFactor: 0.45,
  /** A marble wedged against something sleeps after this long nearly still. */
  wedgeSleepTime: 0.6,
  /** Ground impact restitution (dirt absorbs most of the bounce). */
  groundRestitution: 0.26,
  /** Sliding friction during a ground impact. */
  impactFriction: 0.6,
  /** Below this normal speed an impact is treated as rolling contact. */
  bounceThreshold: 0.22,
  wallRestitution: 0.45,
  wallFriction: 0.25,
  marbleRestitution: 0.86,
  marbleFriction: 0.08,
  /** Speed below which a grounded marble on a gentle slope goes to sleep. */
  sleepSpeed: 0.012,
  /**
   * Slopes shallower than atan(0.13) ~ 7.4 deg hold a resting marble. Must stay
   * below 1.4 x rollingResistance, the slope a rolling marble no longer climbs
   * down on its own in this model.
   */
  staticFriction: 0.13,
  /** Safety: a shot is forced to rest after this many seconds. */
  maxShotTime: 16,
};

export const SHOT = {
  /** Max launch speed (m/s, medium marble) for a flick WITHOUT the power. */
  flickWeakMax: 1.3,
  /** Max launch speed (m/s, medium marble) for a flick WITH the power. */
  flickPowerMax: 3.2,
  /** Max launch speed (m/s, medium marble) for the opening lob. */
  throwMax: 5.4,
  throwAngleDefault: 45,
  throwAngleMin: 15,
  throwAngleMax: 70,
  /** Drag distance in screen pixels that reaches full power. */
  fullPowerPixels: 230,
  minPower: 0.04,
  /**
   * A finger is not a machine and the marble leaves a dimpled lie: every
   * flick (human or computer) scatters by a random angle, 1 sigma in degrees,
   * scatterBase + scatterPerPower * power. A hard flick is harder to aim.
   */
  scatterBase: 0.5,
  scatterPerPower: 1.5,
};

/**
 * Launch speed multiplier by marble size: a finger moves a bigger (heavier)
 * marble more slowly, a small one faster.
 */
export function sizeSpeedFactor(radius) {
  return Math.sqrt(MARBLE_SIZES.medium.radius / radius);
}

/**
 * Points for a counted hit. Only the power scores: a powered shooter earns 1
 * for any hit; a shooter without the power earns 2 for knocking a powered
 * rival (who loses the power); two power-less marbles touching score nothing.
 */
export function hitPoints(shooterPowered, victimPowered) {
  if (shooterPowered) return 1;
  if (victimPowered) return 2;
  return 0;
}

/** Hit strength by closing speed (m/s): for sounds, sparks and the stats. */
export const HIT_TIERS = [
  { minSpeed: 0.0, key: 'soft' },
  { minSpeed: 0.45, key: 'solid' },
  { minSpeed: 1.0, key: 'hard' },
  { minSpeed: 1.7, key: 'smash' },
];

export function hitTier(closingSpeed) {
  let tier = HIT_TIERS[0];
  for (const t of HIT_TIERS) if (closingSpeed >= t.minSpeed) tier = t;
  return tier;
}

/** Probability, per marble-to-marble hit, that one of the two shatters. */
export const BREAK_CHANCE = 0.00001; // 0.001 %

/**
 * Computer skill. dirNoise is the aiming error (degrees, 1 sigma) at full
 * power; it shrinks for gentle shots. powerNoise is relative. blunder is the
 * chance of picking a clearly worse option.
 */
export const AI_LEVELS = {
  easy: { key: 'easy', label: 'Easy', dirNoise: 5.5, powerNoise: 0.2, candidates: 0.5, blunder: 0.35 },
  medium: { key: 'medium', label: 'Medium', dirNoise: 2.6, powerNoise: 0.1, candidates: 0.8, blunder: 0.15 },
  hard: { key: 'hard', label: 'Hard', dirNoise: 0.9, powerNoise: 0.035, candidates: 1.0, blunder: 0.03 },
};

export const MARBLE_STYLES = {
  catseye: { key: 'catseye', label: "Cat's eye", note: 'clear glass, coloured vanes inside' },
  swirl: { key: 'swirl', label: 'Swirl', note: 'opaque, twisted colour bands' },
  galaxy: { key: 'galaxy', label: 'Galaxy', note: 'dark glass full of glitter' },
  clear: { key: 'clear', label: 'Clear', note: 'tinted see-through glass' },
  opal: { key: 'opal', label: 'Opal', note: 'milky, shimmering' },
};

export const MARBLE_COLORS = {
  red: { key: 'red', label: 'Red', hex: 0xe03a2f },
  blue: { key: 'blue', label: 'Blue', hex: 0x2f6fe0 },
  green: { key: 'green', label: 'Green', hex: 0x2fb35a },
  yellow: { key: 'yellow', label: 'Yellow', hex: 0xf2c230 },
  orange: { key: 'orange', label: 'Orange', hex: 0xf07a22 },
  purple: { key: 'purple', label: 'Purple', hex: 0x8e44d8 },
  teal: { key: 'teal', label: 'Teal', hex: 0x22b5b0 },
  pink: { key: 'pink', label: 'Pink', hex: 0xe8569a },
};
