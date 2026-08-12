// All distances in metres, times in seconds.
//
// A mini pitch: 30 × 20 yards with 5-yard endzones, which is what a phone held
// upright can draw across its full width. In metres, since everything the sim
// does is metric — 27.43 × 18.29 with a 4.57 m endzone, so the middle is a
// 20-yard square. Every distance below that is a *pitch* distance is scaled to
// it; the ones that are *bodies* — reach, stride, top speed, braking — are the
// same numbers they always were, because a mini field does not shrink anybody.
export const FIELD = { width: 18.29, length: 27.43, endzone: 4.57 };

export const SIM_DT = 1 / 60; // fixed physics step, shared by sim and preview

// --- tunable: live bindings, driven by the sliders in the HUD -------------
export let TURN_TIME = 1.2; // simulated seconds resolved per turn
export let TURN_STEPS = 72; // derived from TURN_TIME; exact, not a float compare
export let REACT_LAG = 0.4; // you cannot act on what you have not yet seen
export let RELEASE_AT = 0.8; // the wind-up takes this long to come round
export let DISC_SPEED = 20; // out of the hand: measured 20.1 backhand, 20.6 forehand
export let DISC_DRAG = 3.5; // ...which it sheds at this many m/s²
export let DISC_GLIDE = 0.45; // never below this fraction of the release speed
export let MAX_THROW = 30; // about the length of the pitch; the diagonal is 33
export let CATCH_R = 2.4; // an offensive receiver catches inside this
export let BLOCK_R = 1.5; // a hand on it. Under COVER_GAP, so a shoulder of room is a catch
export let STALL_LIMIT = 5; // turns holding the disc before a stall turnover
export let PATHING_MODE = 'physical'; // how a drawn line becomes movement
export let WIN_SCORE = 3; // first to this many wins the game
export let PULL_RANGE = 16; // goal line to goal line is 18.3, so this lands deep
export let PICKUP_R = 2.2; // how close you must get to a disc on the ground
export let PLAN_TURNS = 5; // how many turns ahead a drawn route is projected
export let CORNER_SLACK = 1.5; // how far out of a corner they start turning
export let JAB_STEP = 2.0; // legs this short are footwork: the corner is free
export const BODY_R = 0.85; // physical space a body occupies, not the drawn disc
export const CLOSING_LOOK = 9; // how far ahead a runner looks for traffic

export const LOOKAHEAD = 2.5; // how far up their own route a runner aims
export const DESTINATION_EPS = 0.05; // close enough to land exactly on a drawn endpoint
export const PLAYER_R = 0.85; // drawn radius — the body's own, at this scale
export const GRAB_R = 1.4; // pointer pick-up radius
export const ARC_SAMPLES = 24; // polyline resolution of a curved throw
export const MAX_BOW_RATIO = 0.32; // apex offset as a fraction of the throw's chord
export const MAX_BOW = 5; // ...and an absolute ceiling, in metres
export const HANDLE_GRAB = 0.9; // pointer radius for a bend / curve handle dot
export const LINE_GRAB = 0.85; // how close the pointer must be to bend a drawn path
export const THROW_MIN = 2; // shorter drag than this cancels the wind-up
export const RELEASE_CLEAR = 4.0; // no defender blocks this close to the release
export const MARK_RANGE = 4.5; // a defender this close to the thrower is the mark
export const TELL_LENGTH = 4; // how much of the flight's start the defence can read

/**
 * Touch. Every other pointer constant here is a distance in metres, which is the
 * right unit for a board that draws the pitch at about twenty pixels to the
 * metre — `HANDLE_GRAB` is an 18 px target on a desktop and on a phone alike,
 * because a mini pitch drawn across a phone's width lands on very nearly the
 * same scale as one drawn along a 620 px board. What does not change with the
 * pitch is the fingertip: 9 mm of skin needs more room than a mouse cursor, so
 * in touch mode these are added on top, in CSS pixels, and converted to metres
 * against the live scale.
 */
export const TOUCH_GRAB_PX = 17; // extra pick radius around every grip and body
export const TOUCH_TAP_PX = 11; // a press that moves less than this is a tap
export const TOUCH_GRIP_PX = 9; // smallest a bend dot may be drawn
export const TOUCH_END_PX = 13; // ...and the end grip, which is the one you pull
export const EXTEND_GRIP_PX = 34; // how far past the tip the "add a leg" grip sits

export const COLORS = {
  bg: '#0e1112',
  line: '#cfd6d4',
  A: { fill: '#7c3d3d', ring: '#f2938d', text: '#ffe8e6' },
  B: { fill: '#2c6136', ring: '#5fc46f', text: '#e6ffe9' },
  disc: '#ffffff',
  late: '#7b8582', // the part of a throw that lands after the turn ends
};

/**
 * Bodies, not cursors — and the numbers are basketball's, because that is the
 * athleticism an elite ultimate player is working with.
 *
 * Top speed and acceleration are solved together against the NBA combine's
 * three-quarter-court sprint: 22.86 m from a standstill, run in 3.05–3.14 s by
 * 2025's quickest, under 3.00 s being world class. Accelerate flat out to top
 * speed and hold it and these three cover it in 3.19 / 3.13 / 3.09 s — the
 * handler quickest off the mark, the deep quickest by the end of it. Top speeds
 * of 8.4–9.3 m/s are 19–21 mph, which is where tracking puts the league's
 * fastest in a short burst.
 *
 * `brake` and `agility` come off the same band: GPS work on team sports puts
 * peak decelerations at 7–10 m/s², well above what anyone can accelerate at.
 * A cut is braking sideways, so `agility` — the ceiling on how hard they can
 * bend a run — sits in the same range and falls off with size.
 */
const body = (maxSpeed, accel, agility, brake) => ({ maxSpeed, accel, agility, brake });
export const ARCHETYPES = [
  { role: 'handler', ...body(8.4, 9.0, 10.0, 10.0) },
  { role: 'deep', ...body(9.3, 7.4, 8.0, 9.0) },
  { role: 'cutter', ...body(8.8, 8.2, 9.0, 9.5) },
];

/** The beats have to stay in order: see, react, release, all inside the turn. */
function normalize() {
  TURN_STEPS = Math.round(TURN_TIME * 60);
  REACT_LAG = Math.min(REACT_LAG, TURN_TIME - 0.2);
  RELEASE_AT = Math.min(Math.max(RELEASE_AT, REACT_LAG + 0.1), TURN_TIME - 0.1);
}

const spec = (group, key, label, min, max, step, unit, get, set) => ({
  group,
  key,
  label,
  min,
  max,
  step,
  unit,
  get,
  set,
});

const bodySpecs = ARCHETYPES.flatMap((a, i) => [
  spec('Bodies', `spd${i}`, `${a.role} top speed`, 4, 11, 0.1, 'm/s', () => a.maxSpeed, (v) => {
    a.maxSpeed = v;
  }),
  spec('Bodies', `acc${i}`, `${a.role} acceleration`, 3, 14, 0.1, 'm/s²', () => a.accel, (v) => {
    a.accel = v;
  }),
  spec('Bodies', `brk${i}`, `${a.role} braking`, 3, 14, 0.1, 'm/s²', () => a.brake, (v) => {
    a.brake = v;
  }),
  spec('Bodies', `agi${i}`, `${a.role} agility`, 3, 14, 0.1, 'm/s²', () => a.agility, (v) => {
    a.agility = v;
  }),
]);

export const PATHING_OPTIONS = {
  physical: 'Physical — brake into the cut, drive out',
  floaty: 'Floaty — no corner limit, sails wide',
  rigid: 'Rigid — constant speed, no physics',
};

export const TUNING = [
  {
    group: 'Pathing',
    key: 'pathing',
    label: 'How a drawn line is run',
    options: PATHING_OPTIONS,
    get: () => PATHING_MODE,
    set: (v) => (PATHING_MODE = v),
  },
  spec('Turn', 'turn', 'Turn length', 0.4, 3, 0.1, 's', () => TURN_TIME, (v) => (TURN_TIME = v)),
  spec('Turn', 'lag', 'Defence reaction lag', 0, 1.2, 0.05, 's', () => REACT_LAG, (v) => (REACT_LAG = v)),
  spec('Turn', 'release', 'Wind-up to release', 0.1, 3, 0.05, 's', () => RELEASE_AT, (v) => (RELEASE_AT = v)),
  spec('Turn', 'stall', 'Stall count', 3, 12, 1, 'turns', () => STALL_LIMIT, (v) => (STALL_LIMIT = v)),
  spec('Turn', 'plan', 'Plan ahead', 1, 8, 1, 'turns', () => PLAN_TURNS, (v) => (PLAN_TURNS = v)),
  spec('Turn', 'win', 'Game to', 1, 15, 1, 'points', () => WIN_SCORE, (v) => (WIN_SCORE = v)),
  spec('Disc', 'speed', 'Release speed', 8, 30, 0.5, 'm/s', () => DISC_SPEED, (v) => (DISC_SPEED = v)),
  spec('Disc', 'drag', 'Speed shed in flight', 0, 12, 0.25, 'm/s²', () => DISC_DRAG, (v) => (DISC_DRAG = v)),
  spec('Disc', 'pull', 'Pull range', 6, 26, 1, 'm', () => PULL_RANGE, (v) => (PULL_RANGE = v)),
  spec('Disc', 'glide', 'Floor it glides at', 0.1, 1, 0.05, '× release', () => DISC_GLIDE, (v) => (DISC_GLIDE = v)),
  spec('Disc', 'range', 'Max throw', 8, 40, 1, 'm', () => MAX_THROW, (v) => (MAX_THROW = v)),
  spec('Disc', 'catch', 'Catch radius', 0.5, 4, 0.1, 'm', () => CATCH_R, (v) => (CATCH_R = v)),
  spec('Disc', 'block', 'Block radius', 0.5, 3.5, 0.1, 'm', () => BLOCK_R, (v) => (BLOCK_R = v)),
  spec('Disc', 'pickup', 'Pick-up radius', 1, 4, 0.1, 'm', () => PICKUP_R, (v) => (PICKUP_R = v)),
  ...bodySpecs,
  spec('Bodies', 'slack', 'Corner rounding', 0.3, 5, 0.1, 'm', () => CORNER_SLACK, (v) => (CORNER_SLACK = v)),
  spec('Bodies', 'jab', 'Jab step (free corner)', 0, 6, 0.1, 'm', () => JAB_STEP, (v) => (JAB_STEP = v)),
];

/** What the game shipped with, read off before anything has had a chance to move. */
const DEFAULTS = new Map(TUNING.map((t) => [t.key, t.get()]));

/** Put every last one of them back. */
export function resetTuning() {
  for (const t of TUNING) t.set(DEFAULTS.get(t.key));
  normalize();
}

/** Apply a slider change and keep derived values consistent. */
export function tune(key, value) {
  const t = TUNING.find((x) => x.key === key);
  if (!t) return;
  t.set(value);
  normalize();
}

normalize();
